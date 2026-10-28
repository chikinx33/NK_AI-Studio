import { authorizeRequest, readSecret, sanitizeUserId } from './auth.js';
import { snsContext, readSnsDocument, mutateSnsDocument } from './sns-store.js';

const TTL = 10 * 60 * 1000;
export const META_SCOPES = {
  instagram: ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_insights'],
  threads: ['threads_basic', 'threads_content_publish', 'threads_manage_insights'],
};
// Facebook·YouTube·TikTok·X 도 같은 서명 state·일회성 티켓·브라우저 proof 흐름을 쓴다.
// 예전 base64 state 는 서명이 없어 남의 NK 계정 ID 를 넣은 링크로 남의 채널 토큰을 가로챌 수 있었고,
// X 는 PKCE verifier 까지 state 에 실어 X 로 보냈다(verifier 는 이제 서버 티켓에만 둔다).
export const SNS_SCOPES = {
  ...META_SCOPES,
  // pages_manage_engagement=첫 댓글, business_management=비즈니스 포트폴리오 소유 페이지 찾기.
  facebook: ['public_profile', 'pages_show_list', 'pages_manage_posts', 'pages_read_engagement', 'business_management', 'pages_manage_engagement'],
  // youtube: 재생목록 만들기·넣기(playlists.insert·playlistItems.insert)는 upload 권한으로 안 된다.
  youtube: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube'],
  // video.upload 는 초안함(inbox) 업로드에서 실제로 쓴다 — 이 스코프를 넣는 한 api/sns/tiktok/inbox 흐름을 유지할 것.
  // video.list 는 요청하지 않는다: 이 앱에 Display API 제품이 없어 토큰에 실리지 않는다(승인 후 별도 신청).
  tiktok: ['user.info.basic', 'video.publish', 'video.upload'],
  x: ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'],
};
export const SNS_OAUTH_PLATFORMS = Object.keys(SNS_SCOPES);
const providers = {
  instagram: { id: 'INSTAGRAM_APP_ID', secret: 'INSTAGRAM_APP_SECRET', redirect: 'META_REDIRECT_URI', path: '/api/sns/callback/instagram', authorize: 'https://www.instagram.com/oauth/authorize', token: 'https://api.instagram.com/oauth/access_token', graph: 'https://graph.instagram.com', exchange: 'ig_exchange_token' },
  threads: { id: 'THREADS_APP_ID', secret: 'THREADS_APP_SECRET', redirect: 'THREADS_REDIRECT_URI', path: '/auth/threads/callback', authorize: 'https://threads.com/oauth/authorize', token: 'https://graph.threads.com/oauth/access_token', graph: 'https://graph.threads.com', exchange: 'th_exchange_token' },
  facebook: { id: 'META_APP_ID', secret: 'META_APP_SECRET', redirect: 'FACEBOOK_REDIRECT_URI', path: '/auth/facebook/callback', authorize: 'https://www.facebook.com/v21.0/dialog/oauth', graph: 'https://graph.facebook.com/v21.0' },
  youtube: { id: 'YOUTUBE_CLIENT_ID', secret: 'YOUTUBE_CLIENT_SECRET', redirect: 'YOUTUBE_REDIRECT_URI', fallbackRedirect: true, path: '/auth/youtube/callback', authorize: 'https://accounts.google.com/o/oauth2/v2/auth', scopeSeparator: ' ', params: { access_type: 'offline', include_granted_scopes: 'true', prompt: 'consent' } },
  tiktok: { id: 'TIKTOK_CLIENT_KEY', idParam: 'client_key', secret: 'TIKTOK_CLIENT_SECRET', redirect: 'TIKTOK_REDIRECT_URI', fallbackRedirect: true, path: '/auth/tiktok/callback', authorize: 'https://www.tiktok.com/v2/auth/authorize/' },
  // 로그인 세션 쿠키가 x.com 에 있으므로 authorize 도 x.com 이어야 한다(twitter.com 은 "Redirect is requested" 400).
  x: { id: 'X_CLIENT_ID', secret: 'X_CLIENT_SECRET', redirect: 'X_REDIRECT_URI', fallbackRedirect: true, path: '/auth/x/callback', authorize: 'https://x.com/i/oauth2/authorize', scopeSeparator: ' ', pkce: true },
};
export function snsJson(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
function base64(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
function decode(value) { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)); }
async function digest(value) { return base64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))); }
async function stateKey(env) { return crypto.subtle.importKey('raw', new TextEncoder().encode('sns-oauth-v1:' + readSecret(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
export async function signMetaState(data, env) {
  const body = base64(new TextEncoder().encode(JSON.stringify(data)));
  const sig = await crypto.subtle.sign('HMAC', await stateKey(env), new TextEncoder().encode(body));
  return body + '.' + base64(new Uint8Array(sig));
}
export async function verifyMetaState(raw, platform, env, now = Date.now()) {
  try {
    const parts = String(raw || '').split('.');
    if (parts.length !== 2 || raw.length > 4096) throw new Error();
    if (!await crypto.subtle.verify('HMAC', await stateKey(env), decode(parts[1]), new TextEncoder().encode(parts[0]))) throw new Error();
    const data = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    if (data.v !== 1 || data.platform !== platform || !providers[platform] || !/^[a-f0-9-]{36}$/.test(data.id) || !data.userId || sanitizeUserId(data.userId) !== data.userId || !Number.isFinite(data.exp) || data.exp <= now || data.exp > now + TTL || !allowedOrigin(data.origin)) throw new Error();
    return data;
  } catch { throw new Error('oauth_state_invalid'); }
}
function allowedOrigin(origin) { return ['https://nkstudio.org', 'https://www.nkstudio.org', 'https://nk-ai-studio.pages.dev'].includes(origin); }
// origin: 연결을 시작한 화면의 origin. 리다이렉트 변수가 없는 플랫폼(예: TikTok)은 예전처럼 그 origin 의 콜백을 쓴다.
function config(platform, env, origin) {
  const p = providers[platform];
  const configured = env[p?.redirect] || (p?.fallbackRedirect && allowedOrigin(origin) ? origin + p.path : '');
  if (!p || !env[p.id] || !env[p.secret] || !configured) throw new Error('service_configuration');
  const redirect = new URL(configured);
  if (!allowedOrigin(redirect.origin) || redirect.pathname !== p.path || redirect.search || redirect.hash) throw new Error('service_configuration');
  return { ...p, appId: String(env[p.id]), appSecret: env[p.secret], redirectUri: redirect.href };
}
function ticketFile(id) { return `sns-oauth/${id}.json`; }
export function metaFailure(value) {
  const msg = String(value?.message || value?.error_description || value?.error_message || value?.error?.message || value || '').toLowerCase();
  const code = Number(value?.error?.code || value?.code || 0);
  if (/developer|development|role|access level|app.*(live|review|permission|not active|inactive)|unaudited|개발자|개발 중|비활성/.test(msg)) return 'service_access_restricted';
  if (/access_denied|denied|cancel|declined/.test(msg)) return 'consent_denied';
  if (code === 190 || /expired|revoked|invalid.*token|validating access token/.test(msg)) return 'reconnect_required';
  if (code === 10 || code === 200 || /permission|scope/.test(msg)) return 'permission_required';
  if (/oauth_state|oauth_attempt|oauth_user|oauth_session/.test(msg)) return 'oauth_session_mismatch';
  if (/configuration/.test(msg)) return 'service_configuration';
  return 'connection_failed';
}

export async function startMetaOAuth(request, env, platform) {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return snsJson({ error: auth.error, category: 'login_required' }, auth.status);
  try {
    const origin = new URL(request.url).origin;
    if (!providers[platform]) return snsJson({ error: 'unsupported_platform' }, 400);
    if (!allowedOrigin(origin)) return snsJson({ error: 'origin_not_allowed' }, 400);
    const p = config(platform, env, origin);
    const id = crypto.randomUUID();
    const proof = base64(crypto.getRandomValues(new Uint8Array(32)));
    const data = { v: 1, id, platform, userId: auth.userId, origin, exp: Date.now() + TTL };
    const state = await signMetaState(data, env);
    const ctx = await snsContext(env, auth.userId, ticketFile(id));
    const proofHash = await digest(proof), sessionHash = await digest(auth.token);
    // PKCE verifier 와 Facebook 페이지 선택은 서버 티켓에만 둔다(state·URL 로 내보내지 않는다).
    const codeVerifier = p.pkce ? base64(crypto.getRandomValues(new Uint8Array(48))) : '';
    const pageHint = platform === 'facebook' ? String(new URL(request.url).searchParams.get('page') || '').trim().slice(0, 100) : '';
    await mutateSnsDocument(ctx, existing => {
      if (existing) throw new Error('oauth_attempt_exists');
      return { ...data, proofHash, sessionHash, status: 'pending', ...(codeVerifier ? { codeVerifier } : {}), ...(pageHint ? { pageHint } : {}) };
    });
    const params = new URLSearchParams({ ...(platform === 'instagram' ? { force_reauth: 'true' } : {}), [p.idParam || 'client_id']: p.appId, redirect_uri: p.redirectUri, scope: SNS_SCOPES[platform].join(p.scopeSeparator || ','), response_type: 'code', ...(p.params || {}), state });
    if (codeVerifier) { params.set('code_challenge', await digest(codeVerifier)); params.set('code_challenge_method', 'S256'); }
    return snsJson({ ok: true, oauthUrl: `${p.authorize}?${params}`, attemptId: id, proof, callbackOrigin: new URL(p.redirectUri).origin, expiresAt: data.exp });
  } catch (e) { return snsJson({ error: metaFailure(e), category: metaFailure(e) }, 503); }
}

// Callback only hands off a one-time code. It never decides which user's SNS
// settings to change: completion requires the initiating authenticated session
// AND a browser proof that is never sent to Meta or included in state.
export async function receiveMetaOAuth(request, env, platform) {
  let state;
  try {
    const url = new URL(request.url);
    state = await verifyMetaState(url.searchParams.get('state'), platform, env);
    const p = config(platform, env, state.origin);
    const incoming = new URL(request.url);
    if (incoming.origin + incoming.pathname !== p.redirectUri) throw new Error('oauth_state_invalid');
    // Facebook 은 error 없이 error_code·error_message 만 줄 때가 있다.
    const providerError = url.searchParams.get('error') || url.searchParams.get('error_code');
    const code = url.searchParams.get('code');
    const category = providerError ? metaFailure(providerError + ' ' + (url.searchParams.get('error_description') || url.searchParams.get('error_message') || '')) : '';
    if (!providerError && (!code || code.length > 4096)) throw new Error('oauth_state_invalid');
    const codeHash = providerError ? '' : await digest(code);
    await mutateSnsDocument(await snsContext(env, state.userId, ticketFile(state.id)), doc => {
      if (!doc || doc.status !== 'pending' || doc.exp <= Date.now() || doc.platform !== platform || doc.origin !== state.origin) throw new Error('oauth_attempt_used');
      return { ...doc, status: providerError ? 'error' : 'ready', codeHash, category };
    });
    return metaPopup(state, { ok: !providerError, category, attemptId: state.id, ...(providerError ? {} : { code }) });
  } catch (e) { return metaPopup(state, { ok: false, category: metaFailure(e) }); }
}
function metaPopup(state, result) {
  const nonce = base64(crypto.getRandomValues(new Uint8Array(16)));
  const payload = JSON.stringify({ type: 'sns_oauth_result', platform: state?.platform || '', result }).replaceAll('<', '\\u003c');
  const origin = JSON.stringify(state?.origin || 'https://nkstudio.org');
  return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>SNS 연결 확인</title><p>${result.ok ? '인증 응답을 받았습니다. NK Studio 화면에서 서버 저장 결과를 확인해 주세요.' : '연결을 완료하지 못했습니다. NK Studio 화면에서 오류 안내를 확인해 주세요.'}</p><a href="https://nkstudio.org/sns-settings" rel="noreferrer">SNS 연결 화면으로 돌아가기</a><script nonce="${nonce}">var data=${payload};try{if(window.opener){window.opener.postMessage(data,${origin});window.close();}else if(data.result.attemptId){location.replace(${origin}+'/sns-settings#sns_oauth='+encodeURIComponent(JSON.stringify(data)));}}catch(e){if(data.result.attemptId)location.replace(${origin}+'/sns-settings#sns_oauth='+encodeURIComponent(JSON.stringify(data)));}</script></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'` },
  });
}
async function providerJson(res) { try { return await res.json(); } catch { return {}; } }
export async function completeMetaOAuth(request, env) {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return snsJson({ error: auth.error, category: 'login_required' }, auth.status);
  let ctx, claimed = false;
  try {
    const body = await request.json();
    if (!/^[a-f0-9-]{36}$/.test(body.attemptId) || typeof body.proof !== 'string') return snsJson({ error: 'oauth_session_mismatch' }, 400);
    ctx = await snsContext(env, auth.userId, ticketFile(body.attemptId));
    const { data: doc } = await readSnsDocument(ctx);
    if (!doc || doc.userId !== auth.userId || doc.origin !== new URL(request.url).origin || doc.exp <= Date.now() || doc.proofHash !== await digest(body.proof) || doc.sessionHash !== await digest(auth.token)) return snsJson({ error: 'oauth_session_mismatch', category: 'oauth_session_mismatch' }, 403);
    // Reconcile a lost HTTP response or a popup fallback racing the opener.
    // This returns a receipt, never exchanges the authorization code twice.
    if (['processing', 'done', 'error'].includes(doc.status)) {
      const { data: settings } = await readSnsDocument(await snsContext(env, auth.userId));
      const saved = settings?.sns?.[doc.platform];
      if (saved?.connected && saved.connectionId === doc.id) return snsJson({ ok: true, platform: doc.platform, username: saved.username, connectionId: doc.id });
    }
    if (doc.status === 'pending' || doc.status === 'processing') return snsJson({ ok: false, pending: true }, 202);
    if (doc.status === 'error') return snsJson({ ok: false, error: doc.category, category: doc.category }, 400);
    if (doc.status !== 'ready') return snsJson({ error: 'oauth_attempt_used', category: 'oauth_session_mismatch' }, 409);
    // The initiating browser must possess the actual callback code, not just
    // its proof. A signed OAuth URL forwarded to another browser cannot link
    // that other browser's SNS account by polling this endpoint.
    if (!body.code) return snsJson({ ok: false, pending: true }, 202);
    if (typeof body.code !== 'string' || body.code.length > 4096 || await digest(body.code) !== doc.codeHash) return snsJson({ error: 'oauth_session_mismatch', category: 'oauth_session_mismatch' }, 403);
    await mutateSnsDocument(ctx, current => {
      if (current?.status !== 'ready') throw new Error('oauth_attempt_used');
      return { ...current, status: 'processing', codeHash: '' };
    });
    claimed = true;
    const p = config(doc.platform, env, doc.origin);
    const settingsCtx = await snsContext(env, auth.userId);
    const exchanged = await exchangers[doc.platform]({ p, doc, code: body.code, settingsCtx });
    const patch = { connected: true, enabled: true, needsReconnect: false, ...exchanged, connectedAt: new Date().toISOString(), connectionId: doc.id };
    if (doc.platform === 'instagram' || doc.platform === 'threads') {
      const { registerMetaConnections } = await import('./meta-events.js');
      await registerMetaConnections(env, auth.userId, { [doc.platform]: patch });
    }
    await mutateSnsDocument(settingsCtx, current => {
      const settings = current || { sns: {}, deployDefaults: {} };
      settings.sns = settings.sns || {};
      const previous = settings.sns[doc.platform] || {};
      // 이전 연결의 토큰·계정 필드는 남기지 않는다(다른 계정으로 다시 연결해도 섞이지 않게). 사용 토글만 이어받는다.
      settings.sns[doc.platform] = { ...patch, enabled: typeof previous.enabled === 'boolean' ? previous.enabled : true };
      if (doc.platform === 'youtube') {
        const shorts = settings.sns['youtube-shorts'] || {};
        settings.sns['youtube-shorts'] = { connected: true, enabled: typeof shorts.enabled === 'boolean' ? shorts.enabled : true, mirrorOf: 'youtube', channelId: patch.channelId, channelTitle: patch.channelTitle, channelHandle: patch.channelHandle, connectionId: doc.id };
      }
      settings.updatedAt = new Date().toISOString();
      return settings;
    });
    await mutateSnsDocument(ctx, current => ({ ...current, status: 'done', codeHash: '', codeVerifier: '' }));
    // UI must still reload /userdata/sns/get and match connectionId.
    return snsJson({ ok: true, platform: doc.platform, username: patch.username, connectionId: doc.id });
  } catch (e) {
    const known = ['service_access_restricted', 'consent_denied', 'permission_required', 'reconnect_required', 'facebook_page_required', 'facebook_page_not_granted', 'youtube_channel_required'];
    const category = known.includes(e?.message) ? e.message : metaFailure(e);
    if (ctx && claimed) await mutateSnsDocument(ctx, doc => doc?.status === 'processing' ? { ...doc, status: 'error', code: '', codeVerifier: '', category } : undefined).catch(() => {});
    return snsJson({ ok: false, error: category, category }, 400);
  }
}

const isoAfter = seconds => new Date(Date.now() + seconds * 1000).toISOString();
const scopeList = value => (Array.isArray(value) ? value : String(value || '').split(/[\s,]+/)).map(s => String(s).trim()).filter(Boolean);
function providerError(data) { return new Error(metaFailure(data?.error_description || data?.error?.message || data?.error || data)); }

// 플랫폼별 토큰 교환. 반환값이 sns-settings.json 의 그 플랫폼 항목이 된다(토큰 모듈들이 읽는 필드 이름 그대로).
// 응답 원문·토큰은 로그·오류 문구에 싣지 않는다.
const exchangers = {
  async instagram(args) { return exchangeMeta(args); },
  async threads(args) { return exchangeMeta(args); },

  async facebook({ p, doc, code, settingsCtx }) {
    const tokenRes = await fetch(`${p.graph}/oauth/access_token?` + new URLSearchParams({ client_id: p.appId, client_secret: p.appSecret, redirect_uri: p.redirectUri, code }));
    const short = await providerJson(tokenRes);
    if (!tokenRes.ok || !short.access_token) throw providerError(short);
    const longRes = await fetch(`${p.graph}/oauth/access_token?` + new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: p.appId, client_secret: p.appSecret, fb_exchange_token: short.access_token }));
    const long = await providerJson(longRes);
    if (!longRes.ok || !long.access_token) throw providerError(long);
    const userToken = long.access_token;
    const grantedScopes = await facebookGrantedScopes(p, userToken);
    if (grantedScopes.length && ['pages_show_list', 'pages_manage_posts'].some(s => !grantedScopes.includes(s))) throw new Error('permission_required');
    const pages = await findFacebookPages(p, userToken);
    if (!pages.length) throw new Error('facebook_page_required');
    // 같은 Facebook 사용자가 여러 NK 계정에 서로 다른 페이지를 붙인다:
    // 1) 연결 요청의 페이지(id·이름) 2) 이 NK 계정에 이미 저장된 페이지 3) 첫 번째.
    const hint = String(doc.pageHint || ''), hintKey = hint.toLowerCase();
    const byHint = hint ? pages.find(pg => pg.id === hint || String(pg.name || '').trim().toLowerCase() === hintKey) : undefined;
    if (hint && !byHint) throw new Error('facebook_page_not_granted');
    let savedPageId = '';
    if (!byHint && pages.length > 1) savedPageId = String((await readSnsDocument(settingsCtx)).data?.sns?.facebook?.pageId || '');
    const page = byHint || pages.find(pg => pg.id === savedPageId) || pages[0];
    if (!page.access_token) throw new Error('permission_required');
    // 장기 사용자 토큰에서 파생된 페이지 토큰은 만료가 없다. 사용자 토큰 만료 시각만 남긴다.
    return { pageId: String(page.id), pageName: String(page.name || ''), username: String(page.name || ''), userToken, pageToken: page.access_token, tokenExpiresAt: isoAfter(Number(long.expires_in) > 0 ? Number(long.expires_in) : 60 * 86400), grantedScopes };
  },

  async youtube({ p, code }) {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: p.appId, client_secret: p.appSecret, code, grant_type: 'authorization_code', redirect_uri: p.redirectUri }) });
    const token = await providerJson(tokenRes);
    if (!tokenRes.ok || !token.access_token) throw providerError(token);
    // 구글은 동의 화면에서 권한을 하나씩 뺄 수 있다. 업로드 권한 없이 '연결됨'으로 저장하지 않는다.
    const grantedScopes = scopeList(token.scope);
    if (!grantedScopes.includes('https://www.googleapis.com/auth/youtube.upload')) throw new Error('permission_required');
    if (!token.refresh_token) throw new Error('reconnect_required');
    const chRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${token.access_token}` } });
    const channel = (await providerJson(chRes))?.items?.[0];
    if (!chRes.ok || !channel?.id) throw new Error('youtube_channel_required');
    const channelTitle = String(channel.snippet?.title || '');
    return { channelId: String(channel.id), channelTitle, channelHandle: String(channel.snippet?.customUrl || ''), username: channelTitle || String(channel.id), accessToken: token.access_token, refreshToken: token.refresh_token, tokenExpiresAt: isoAfter(Number(token.expires_in) || 3600), scope: grantedScopes.join(' '), grantedScopes };
  },

  async tiktok({ p, code }) {
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_key: p.appId, client_secret: p.appSecret, code, grant_type: 'authorization_code', redirect_uri: p.redirectUri }) });
    const token = await providerJson(tokenRes);
    if (!tokenRes.ok || !token.access_token || !token.open_id) throw providerError(token);
    const auth = { Authorization: `Bearer ${token.access_token}` };
    // username·profile 필드는 user.info.profile 소관이다 — basic 으로 받을 수 있는 필드만 요청한다.
    const userRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url', { headers: auth });
    const user = (await providerJson(userRes))?.data?.user || {};
    // 진짜 @handle 은 creator_info 로만 받는다. 못 받으면 비워 두고 프로필 링크를 숨긴다.
    let handle = '';
    try {
      const ciRes = await fetch('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json; charset=UTF-8' }, signal: AbortSignal.timeout(6000) });
      handle = String((await providerJson(ciRes))?.data?.creator_username || '').replace(/^@/, '');
    } catch { /* 핸들 없이 진행 */ }
    const displayName = String(user.display_name || token.open_id);
    // username 필드에는 display_name 이 들어간다(SNS 설정 화면 하위 호환).
    return { openId: String(token.open_id), username: displayName, displayName, avatarUrl: String(user.avatar_url || ''), handle, accessToken: token.access_token, refreshToken: String(token.refresh_token || ''), tokenExpiresAt: isoAfter(Number(token.expires_in) || 86400), refreshExpiresAt: isoAfter(Number(token.refresh_expires_in) || 365 * 86400), grantedScopes: scopeList(token.scope) };
  },

  async x({ p, doc, code }) {
    if (!doc.codeVerifier) throw new Error('oauth_state_invalid');
    const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${btoa(`${p.appId}:${p.appSecret}`)}` }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: p.redirectUri, client_id: p.appId, code_verifier: doc.codeVerifier }) });
    const token = await providerJson(tokenRes);
    if (!tokenRes.ok || !token.access_token) throw providerError(token);
    if (!token.refresh_token) throw new Error('permission_required');
    const meRes = await fetch('https://api.twitter.com/2/users/me', { headers: { Authorization: `Bearer ${token.access_token}` } });
    const me = (await providerJson(meRes))?.data || {};
    if (!meRes.ok || !me.id) throw providerError(me);
    const grantedScopes = scopeList(token.scope);
    return { xUserId: String(me.id), username: String(me.username || me.name || me.id), name: String(me.name || ''), accessToken: token.access_token, refreshToken: token.refresh_token, tokenExpiresAt: isoAfter(Number(token.expires_in) || 7200), scope: grantedScopes.join(' '), grantedScopes };
  },
};

async function exchangeMeta({ p, doc, code }) {
  const tokenRes = await fetch(p.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: p.appId, client_secret: p.appSecret, grant_type: 'authorization_code', redirect_uri: p.redirectUri, code }) });
  const shortResponse = await providerJson(tokenRes);
  const short = Array.isArray(shortResponse.data) ? shortResponse.data[0] || {} : shortResponse;
  if (!tokenRes.ok || !short.access_token) throw new Error(metaFailure(short));
  const longRes = await fetch(`${p.graph}/access_token?` + new URLSearchParams({ grant_type: p.exchange, client_secret: p.appSecret, access_token: short.access_token }));
  const long = await providerJson(longRes);
  // Never pretend a short-lived token lasts 60 days if exchange fails.
  if (!longRes.ok || !long.access_token || !Number.isFinite(Number(long.expires_in)) || Number(long.expires_in) <= 0) throw new Error(metaFailure(long));
  const meRes = await fetch(`${p.graph}/${doc.platform === 'threads' ? 'v1.0/' : ''}me?` + new URLSearchParams({ fields: 'id,username', access_token: long.access_token }));
  const me = await providerJson(meRes);
  if (!meRes.ok || !me.id || !me.username) throw new Error(metaFailure(me));
  const grantedScopes = Array.isArray(short.permissions) ? short.permissions : String(short.permissions || short.scope || '').split(',').map(s => s.trim()).filter(Boolean);
  if (grantedScopes.length && META_SCOPES[doc.platform].slice(0, 2).some(scope => !grantedScopes.includes(scope))) throw new Error('permission_required');
  return { username: me.username, accessToken: long.access_token, tokenExpiresAt: isoAfter(Number(long.expires_in)), providerUserId: String(short.user_id || me.id), grantedScopes, ...(doc.platform === 'instagram' ? { igUserId: String(me.id) } : { threadsUserId: String(me.id) }) };
}

async function facebookGrantedScopes(p, userToken) {
  try {
    const res = await fetch(`${p.graph}/me/permissions?` + new URLSearchParams({ access_token: userToken }));
    const rows = (await providerJson(res))?.data;
    return Array.isArray(rows) ? rows.filter(r => r?.status === 'granted').map(r => String(r.permission)) : [];
  } catch { return []; }
}

// 관리 페이지 찾기: 일반 페이지 → 중첩 accounts → 비즈니스 포트폴리오 소유 페이지 → 위임받은 클라이언트 페이지.
async function findFacebookPages(p, userToken) {
  const get = async (path, params) => {
    try { const res = await fetch(`${p.graph}/${path}?` + new URLSearchParams({ access_token: userToken, ...params })); return res.ok ? await providerJson(res) : {}; } catch { return {}; }
  };
  const fields = 'id,name,access_token,tasks';
  let pages = (await get('me/accounts', { fields, limit: '100' })).data || [];
  if (!pages.length) pages = (await get('me', { fields: `id,name,accounts.limit(100){${fields}}` })).accounts?.data || [];
  if (!pages.length) {
    const businesses = (await get('me/businesses', { fields: `id,owned_pages.limit(100){${fields}}` })).data || [];
    pages = businesses.flatMap(b => b?.owned_pages?.data || []);
    for (const biz of pages.length ? [] : businesses) pages.push(...((await get(`${encodeURIComponent(biz.id)}/client_pages`, { fields, limit: '100' })).data || []));
  }
  return pages.filter(pg => pg && pg.id);
}
