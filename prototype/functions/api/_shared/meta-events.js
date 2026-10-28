import { resolveGcsEnv } from './gcs.js';
import { buildAdminObject } from './storage';
import { snsContext, readSnsDocument, mutateSnsDocument } from './sns-store.js';
import { snsJson } from './meta-oauth.js';

async function indexContext(env, userId) {
  const ctx = await snsContext(env, userId);
  ctx.objectName = buildAdminObject(resolveGcsEnv(env).basePrefix, 'meta-connections.json');
  return ctx;
}
// Only identifiers, never credentials. Legacy connections are registered when
// their owner reads SNS settings; no token replacement/migration is performed.
export async function registerMetaConnections(env, userId, sns) {
  const entries = [];
  for (const platform of ['instagram', 'threads']) {
    const entry = sns?.[platform];
    if (!entry?.connected) continue;
    for (const id of new Set([entry.providerUserId, platform === 'instagram' ? entry.igUserId : entry.threadsUserId].filter(Boolean).map(String))) {
      if (/^[a-zA-Z0-9._-]{1,128}$/.test(id)) entries.push([`${platform}:${id}`, userId]);
    }
  }
  if (!entries.length) return;
  await mutateSnsDocument(await indexContext(env, userId), doc => {
    const links = doc?.links || {};
    let changed = false;
    for (const [key, uid] of entries) {
      if (!(links[key] || []).includes(uid)) { links[key] = [...(links[key] || []), uid]; changed = true; }
    }
    return changed ? { links } : undefined;
  });
}
const unbase64 = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
export async function verifyMetaSignedRequest(raw, secret, now = Date.now()) {
  try {
    const parts = String(raw || '').split('.');
    if (parts.length !== 2 || raw.length > 8192 || !secret) throw new Error();
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, unbase64(parts[0]), new TextEncoder().encode(parts[1]))) throw new Error();
    const data = JSON.parse(new TextDecoder().decode(unbase64(parts[1])));
    if (data.algorithm !== 'HMAC-SHA256' || !/^[a-zA-Z0-9._-]{1,128}$/.test(String(data.user_id || '')) || !Number.isFinite(data.issued_at) || data.issued_at * 1000 > now + 300000 || data.issued_at * 1000 < now - 86400000) throw new Error();
    return data;
  } catch { throw new Error('invalid_signed_request'); }
}

export async function receiveMetaEvent(request, env) {
  const url = new URL(request.url);
  const platform = url.searchParams.get('platform');
  const kind = url.searchParams.get('type');
  if (!['instagram', 'threads'].includes(platform) || !['deauthorize', 'deletion'].includes(kind)) return snsJson({ error: 'invalid_event' }, 400);
  let payload;
  try {
    const form = await request.formData();
    payload = await verifyMetaSignedRequest(form.get('signed_request'), env[platform === 'instagram' ? 'INSTAGRAM_APP_SECRET' : 'THREADS_APP_SECRET']);
  } catch { return snsJson({ error: 'invalid_signed_request' }, 400); }
  try {
    const index = await indexContext(env, 'meta-events');
    const { data } = await readSnsDocument(index);
    const users = data?.links?.[`${platform}:${payload.user_id}`] || [];
    if (!users.length) {
      // Never acknowledge deletion of an unindexed legacy record as complete.
      return snsJson({ error: 'connection_lookup_required' }, 503);
    }
    for (const userId of users) {
      await mutateSnsDocument(await snsContext(env, userId), doc => {
        const entry = doc?.sns?.[platform];
        if (!entry) return undefined;
        const ids = [entry.providerUserId, platform === 'instagram' ? entry.igUserId : entry.threadsUserId].map(String);
        if (!ids.includes(String(payload.user_id))) return undefined;
        // A delayed callback must not erase a later reauthorization.
        if (Date.parse(entry.connectedAt || '') > (payload.issued_at + 1) * 1000) return undefined;
        doc.sns[platform] = { connected: false, enabled: false, needsReconnect: kind === 'deauthorize' };
        doc.updatedAt = new Date().toISOString();
        return doc;
      });
    }
    if (kind === 'deauthorize') return snsJson({ ok: true });
    // Retained platform-derived reports may need review. Queue a real request
    // and return a receipt; do not claim all platform data has been deleted.
    const id = crypto.randomUUID();
    const receipt = { ...index, objectName: buildAdminObject(resolveGcsEnv(env).basePrefix, `meta-deletion-${id}.json`) };
    await mutateSnsDocument(receipt, () => ({ id, platform, users, requestedAt: new Date().toISOString(), status: 'pending', connectionCredentialsRemoved: true }));
    return snsJson({ url: `https://nkstudio.org/data-deletion?request=${id}`, confirmation_code: id });
  } catch { return snsJson({ error: 'event_processing_unavailable' }, 503); }
}
