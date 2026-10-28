import { authorizeRequest } from '../_shared/auth.js';
import { snsContext, mutateSnsDocument, readSnsDocument, safeSnsSettings } from '../_shared/sns-store.js';
import { snsJson } from '../_shared/meta-oauth.js';

export const onRequestPost = async ({ request, env }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return snsJson({ error: auth.error }, auth.status);
  try {
    const { platform } = await request.json();
    if (!['instagram', 'threads'].includes(platform)) return snsJson({ error: 'unsupported_platform' }, 400);
    const ctx = await snsContext(env, auth.userId);
    const { data } = await readSnsDocument(ctx);
    const previous = data?.sns?.[platform];
    // Remove local credentials first, even when the provider is unavailable.
    const settings = await mutateSnsDocument(ctx, current => {
      if (current?.sns?.[platform]?.accessToken !== previous?.accessToken) throw new Error('sns_connection_changed');
      const next = current || { sns: {}, deployDefaults: {} };
      next.sns = next.sns || {};
      next.sns[platform] = { connected: false, enabled: false, disconnectedAt: new Date().toISOString() };
      next.updatedAt = new Date().toISOString();
      return next;
    });
    // Meta permissions are granted to an app/SNS-account pair, not an NK
    // login. Revoking them here could revoke a second NK user's grant to the
    // same SNS account. Local disconnect must remain strictly user scoped.
    return snsJson({ ok: true, platform, revoked: false, settings: safeSnsSettings(settings), warning: 'platform_permission_retained' });
  } catch { return snsJson({ error: 'disconnect_failed' }, 503); }
};
