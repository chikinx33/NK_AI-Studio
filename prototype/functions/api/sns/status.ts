import { authorizeRequest } from '../_shared/auth.js';
import { snsContext, readSnsDocument, patchSnsPlatform } from '../_shared/sns-store.js';
import { ensureMetaToken, isMetaCredentialError } from '../_shared/meta-token.js';
import { snsJson } from '../_shared/meta-oauth.js';

export const onRequestPost = async ({ request, env }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return snsJson({ error: auth.error, category: 'login_required' }, auth.status);
  try {
    const { platform } = await request.json();
    if (!['instagram', 'threads'].includes(platform)) return snsJson({ error: 'unsupported_platform' }, 400);
    const ctx = await snsContext(env, auth.userId);
    const { data } = await readSnsDocument(ctx);
    const entry = data?.sns?.[platform];
    const token = await ensureMetaToken(ctx, platform, entry);
    const graph = platform === 'instagram' ? 'https://graph.instagram.com' : 'https://graph.threads.com/v1.0';
    const res = await fetch(`${graph}/me?` + new URLSearchParams({ fields: 'id,username', access_token: token }));
    const me = await res.json().catch(() => ({}));
    if (!res.ok || !me.id) {
      if (isMetaCredentialError(me, res.status)) {
        await patchSnsPlatform(ctx, platform, { needsReconnect: true }, token);
        return snsJson({ ok: false, needsReconnect: true, category: 'reconnect_required' }, 412);
      }
      return snsJson({ ok: false, category: res.status === 403 ? 'permission_required' : 'connection_failed' }, 503);
    }
    const expectedId = platform === 'instagram' ? entry.igUserId : entry.threadsUserId;
    if (String(me.id) !== String(expectedId)) return snsJson({ ok: false, needsReconnect: true, category: 'reconnect_required' }, 412);
    return snsJson({ ok: true, platform, username: me.username, verifiedAt: new Date().toISOString() });
  } catch (e) {
    const needsReconnect = /reconnect_required/.test(String(e?.message || ''));
    return snsJson({ ok: false, needsReconnect, category: needsReconnect ? 'reconnect_required' : 'connection_failed' }, needsReconnect ? 412 : 503);
  }
};
