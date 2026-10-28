import { authorizeRequest } from '../_shared/auth.js';
import { snsContext, mutateSnsDocument, readSnsDocument, safeSnsSettings } from '../_shared/sns-store.js';
import { snsJson, SNS_OAUTH_PLATFORMS } from '../_shared/meta-oauth.js';

export const onRequestPost = async ({ request, env }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return snsJson({ error: auth.error }, auth.status);
  try {
    const { platform } = await request.json();
    if (![...SNS_OAUTH_PLATFORMS, 'discord'].includes(platform)) return snsJson({ error: 'unsupported_platform' }, 400);
    const ctx = await snsContext(env, auth.userId);
    const { data } = await readSnsDocument(ctx);
    const previous = data?.sns?.[platform];
    // Remove local credentials first, even when the provider is unavailable.
    // connectionId 도 비교한다: 해제를 누른 사이 새로 연결된 계정(토큰 필드가 다른 플랫폼 포함)을 지우지 않게.
    const settings = await mutateSnsDocument(ctx, current => {
      const now = current?.sns?.[platform];
      if (now?.accessToken !== previous?.accessToken || now?.connectionId !== previous?.connectionId) throw new Error('sns_connection_changed');
      const next = current || { sns: {}, deployDefaults: {} };
      next.sns = next.sns || {};
      next.sns[platform] = { connected: false, enabled: false, disconnectedAt: new Date().toISOString() };
      if (platform === 'youtube') {
        const shorts = next.sns['youtube-shorts'] || {};
        next.sns['youtube-shorts'] = { connected: false, enabled: false, mirrorOf: 'youtube', prevEnabled: !!shorts.enabled };
      }
      next.updatedAt = new Date().toISOString();
      return next;
    });
    // Meta permissions are granted to an app/SNS-account pair, not an NK
    // login. Revoking them here could revoke a second NK user's grant to the
    // same SNS account. Local disconnect must remain strictly user scoped.
    // (구글·TikTok·X 의 토큰 철회도 앱-계정 단위라 같은 이유로 하지 않는다. 디스코드는 웹훅이라 철회할 권한이 없다.)
    return snsJson({ ok: true, platform, revoked: false, settings: safeSnsSettings(settings), ...(platform === 'discord' ? {} : { warning: 'platform_permission_retained' }) });
  } catch { return snsJson({ error: 'disconnect_failed' }, 503); }
};
