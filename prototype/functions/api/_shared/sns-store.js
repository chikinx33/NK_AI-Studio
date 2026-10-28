import { resolveGcsEnv, getGoogleAccessToken } from './gcs.js';
import { buildUserDataObject } from './storage';

// SNS writes use GCS generations: concurrent OAuth, disconnect and refresh must
// never silently replace another channel or resurrect a disconnected token.
export async function snsContext(env, userId, file = 'sns-settings.json') {
  if (!userId) throw new Error('sns_user_required');
  const c = resolveGcsEnv(env);
  const googleToken = await getGoogleAccessToken({ clientEmail: c.clientEmail, privateKeyPem: c.privateKeyRaw, scope: 'https://www.googleapis.com/auth/cloud-platform' });
  return { bucket: c.bucket, objectName: buildUserDataObject(c.basePrefix, userId, file), googleToken };
}

export async function readSnsDocument(ctx) {
  const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o/${encodeURIComponent(ctx.objectName)}?alt=media`, {
    headers: { Authorization: `Bearer ${ctx.googleToken}` },
  });
  if (res.status === 404) return { data: null, generation: '0' };
  if (!res.ok) throw new Error('sns_storage_unavailable');
  const generation = res.headers.get('x-goog-generation');
  if (!generation) throw new Error('sns_storage_generation_missing');
  const data = await res.json();
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('sns_storage_invalid');
  return { data, generation };
}

export async function mutateSnsDocument(ctx, mutate) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, generation } = await readSnsDocument(ctx);
    const next = await mutate(data);
    if (next === undefined) return data;
    const res = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o?uploadType=media&name=${encodeURIComponent(ctx.objectName)}&ifGenerationMatch=${generation}`, {
      method: 'POST', headers: { Authorization: `Bearer ${ctx.googleToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(next),
    });
    if (res.status === 412) continue;
    if (!res.ok) throw new Error('sns_storage_unavailable');
    return next;
  }
  throw new Error('sns_storage_conflict');
}

export async function patchSnsPlatform(ctx, platform, patch, expectedToken) {
  return mutateSnsDocument(ctx, data => {
    const doc = data || { sns: {}, deployDefaults: {} };
    doc.sns = doc.sns || {};
    const prev = doc.sns[platform] || {};
    if (expectedToken !== undefined && (!prev.connected || prev.accessToken !== expectedToken)) throw new Error('sns_connection_changed');
    doc.sns[platform] = { ...prev, ...patch };
    doc.updatedAt = new Date().toISOString();
    return doc;
  });
}

export function safeSnsSettings(settings) {
  const fields = ['connected', 'enabled', 'needsReconnect', 'username', 'displayName', 'avatarUrl', 'handle', 'pageName', 'pageId', 'channelTitle', 'channelId', 'channelHandle', 'igUserId', 'webhookHint', 'guildId', 'connectedAt', 'connectionId', 'grantedScopes'];
  const sns = {};
  for (const [platform, entry] of Object.entries(settings?.sns || {})) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    sns[platform] = Object.fromEntries(fields.filter(f => Object.hasOwn(entry, f)).map(f => [f, entry[f]]));
  }
  return { sns, deployDefaults: publicDeployDefaults(settings?.deployDefaults), updatedAt: settings?.updatedAt || '' };
}

// Publishing preferences remain editable. Credential-shaped keys never belong
// in this public metadata, including nested objects supplied by agent tools.
export function publicDeployDefaults(value, depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 5) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 100).filter(([key]) => !/token|secret|password|authorization|webhook|__proto__|constructor/i.test(key)).map(([key, item]) => [key,
    item && typeof item === 'object' ? (Array.isArray(item) ? item.filter(v => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean').slice(0, 100) : publicDeployDefaults(item, depth + 1)) : item,
  ]));
}
