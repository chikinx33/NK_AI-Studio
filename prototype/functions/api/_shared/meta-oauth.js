import { authorizeRequest, readSecret, sanitizeUserId } from './auth.js';
import { snsContext, readSnsDocument, mutateSnsDocument } from './sns-store.js';

const TTL = 10 * 60 * 1000;
export const META_SCOPES = {
  instagram: ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_insights'],
  threads: ['threads_basic', 'threads_content_publish', 'threads_manage_insights'],
};
const providers = {
  instagram: { id: 'INSTAGRAM_APP_ID', secret: 'INSTAGRAM_APP_SECRET', redirect: 'META_REDIRECT_URI', authorize: 'https://www.instagram.com/oauth/authorize', token: 'https://api.instagram.com/oauth/access_token', graph: 'https://graph.instagram.com', exchange: 'ig_exchange_token' },
  threads: { id: 'THREADS_APP_ID', secret: 'THREADS_APP_SECRET', redirect: 'THREADS_REDIRECT_URI', authorize: 'https://threads.com/oauth/authorize', token: 'https://graph.threads.com/oauth/access_token', graph: 'https://graph.threads.com', exchange: 'th_exchange_token' },
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
function config(platform, env) {
  const p = providers[platform];
  if (!p || !env[p.id] || !env[p.secret] || !env[p.redirect]) throw new Error('service_configuration');
  const redirect = new URL(env[p.redirect]);
  const path = platform === 'instagram' ? '/api/sns/callback/instagram' : '/auth/threads/callback';
  if (!allowedOrigin(redirect.origin) || redirect.pathname !== path || redirect.search || redirect.hash) throw new Error('service_configuration');
  return { ...p, appId: String(env[p.id]), appSecret: env[p.secret], redirectUri: redirect.href };
}
function ticketFile(id) { return `sns-oauth/${id}.json`; }
export function metaFailure(value) {
  const msg = String(value?.message || value?.error_description || value?.error_message || value?.error?.message || value || '').toLowerCase();
  const code = Number(value?.error?.code || value?.code || 0);
  if (/developer|development|role|access level|app.*(live|review|permission)|개발자|개발 중/.test(msg)) return 'service_access_restricted';
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
    const p = config(platform, env);
    const origin = new URL(request.url).origin;
    if (!allowedOrigin(origin)) return snsJson({ error: 'origin_not_allowed' }, 400);
    const id = crypto.randomUUID();
    const proof = base64(crypto.getRandomValues(new Uint8Array(32)));
    const data = { v: 1, id, platform, userId: auth.userId, origin, exp: Date.now() + TTL };
    const state = await signMetaState(data, env);
    const ctx = await snsContext(env, auth.userId, ticketFile(id));
    const proofHash = await digest(proof), sessionHash = await digest(auth.token);
    await mutateSnsDocument(ctx, existing => {
      if (existing) throw new Error('oauth_attempt_exists');
      return { ...data, proofHash, sessionHash, status: 'pending' };
    });
    const params = new URLSearchParams({ ...(platform === 'instagram' ? { force_reauth: 'true' } : {}), client_id: p.appId, redirect_uri: p.redirectUri, scope: META_SCOPES[platform].join(','), response_type: 'code', state });
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
    const p = config(platform, env);
    const incoming = new URL(request.url);
    if (incoming.origin + incoming.pathname !== p.redirectUri) throw new Error('oauth_state_invalid');
    const providerError = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const category = providerError ? metaFailure(providerError + ' ' + (url.searchParams.get('error_description') || '')) : '';
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
    const p = config(doc.platform, env);
    const tokenRes = await fetch(p.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: p.appId, client_secret: p.appSecret, grant_type: 'authorization_code', redirect_uri: p.redirectUri, code: body.code }) });
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
    const patch = { connected: true, enabled: true, needsReconnect: false, username: me.username, accessToken: long.access_token, tokenExpiresAt: new Date(Date.now() + Number(long.expires_in) * 1000).toISOString(), connectedAt: new Date().toISOString(), connectionId: doc.id, providerUserId: String(short.user_id || me.id), grantedScopes, ...(doc.platform === 'instagram' ? { igUserId: String(me.id) } : { threadsUserId: String(me.id) }) };
    const { registerMetaConnections } = await import('./meta-events.js');
    await registerMetaConnections(env, auth.userId, { [doc.platform]: patch });
    await mutateSnsDocument(await snsContext(env, auth.userId), current => {
      const settings = current || { sns: {}, deployDefaults: {} };
      settings.sns = settings.sns || {};
      const previous = settings.sns[doc.platform] || {};
      settings.sns[doc.platform] = { ...patch, enabled: typeof previous.enabled === 'boolean' ? previous.enabled : true };
      settings.updatedAt = new Date().toISOString();
      return settings;
    });
    await mutateSnsDocument(ctx, current => ({ ...current, status: 'done', codeHash: '' }));
    // UI must still reload /userdata/sns/get and match connectionId.
    return snsJson({ ok: true, platform: doc.platform, username: me.username, connectionId: doc.id });
  } catch (e) {
    const known = ['service_access_restricted', 'consent_denied', 'permission_required', 'reconnect_required'];
    const category = known.includes(e?.message) ? e.message : metaFailure(e);
    if (ctx && claimed) await mutateSnsDocument(ctx, doc => doc?.status === 'processing' ? { ...doc, status: 'error', code: '', category } : undefined).catch(() => {});
    return snsJson({ ok: false, error: category, category }, 400);
  }
}
