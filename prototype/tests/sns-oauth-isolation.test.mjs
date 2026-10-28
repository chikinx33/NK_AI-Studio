import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateKeyPairSync, createHash } from 'node:crypto';
import path from 'node:path';

// Facebook·YouTube·TikTok·X 도 Instagram·Threads 와 같은 서명 state·일회성 티켓·브라우저 proof 흐름을 쓰는지
// 실제 서버 핸들러를 모의 GCS·플랫폼 응답으로 돌려 확인한다. 모의 결과는 실제 플랫폼 연결 검증을 대체하지 않는다.
const esbuild = createRequire(import.meta.url)('../../ai-company-app/node_modules/esbuild');
const fn = path.resolve(import.meta.dirname, '../functions');
const built = await esbuild.build({
  stdin: { contents: `export * from './api/_shared/meta-oauth.js'; export { issueSessionToken } from './api/_shared/auth.js'; export { onRequestPost as disconnect } from './api/sns/disconnect.ts'; export { onRequestPost as save } from './api/userdata/sns/save.ts'; export { onRequestGet as fbConnect } from './api/sns/connect/facebook.ts'; export { onRequestGet as xCallback } from './auth/x/callback.ts';`, resolveDir: fn, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
});
const m = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const env = {
  AUTH_SESSION_SECRET: 'test-secret-only', GOOGLE_CLIENT_EMAIL: 'test@example.invalid', GOOGLE_PRIVATE_KEY: privateKey, VIDEO_OUTPUT_GCS_URI: 'gs://test-bucket/nk',
  META_APP_ID: 'fb-test', META_APP_SECRET: 'fb-test-secret', FACEBOOK_REDIRECT_URI: 'https://nk-ai-studio.pages.dev/auth/facebook/callback', FACEBOOK_PAGE_ID: 'operator-page',
  YOUTUBE_CLIENT_ID: 'yt-test', YOUTUBE_CLIENT_SECRET: 'yt-test-secret', YOUTUBE_REDIRECT_URI: 'https://nk-ai-studio.pages.dev/auth/youtube/callback',
  TIKTOK_CLIENT_KEY: 'tt-test', TIKTOK_CLIENT_SECRET: 'tt-test-secret',
  X_CLIENT_ID: 'x-test', X_CLIENT_SECRET: 'x-test-secret', X_REDIRECT_URI: 'https://nk-ai-studio.pages.dev/auth/x/callback',
};
const origin = 'https://nkstudio.org';
const redirectOf = p => p === 'tiktok' ? origin + '/auth/tiktok/callback' : env[{ facebook: 'FACEBOOK_REDIRECT_URI', youtube: 'YOUTUBE_REDIRECT_URI', x: 'X_REDIRECT_URI' }[p]];
let objects, calls, nextGeneration, ytScope, fbPages, account;
const realFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = realFetch; });
test.beforeEach(() => {
  objects = new Map(); calls = []; nextGeneration = 1;
  ytScope = m.SNS_SCOPES.youtube.join(' ');
  fbPages = [{ id: 'page-1', name: 'First Page', access_token: 'page-token-1' }, { id: 'page-2', name: 'Second Page', access_token: 'page-token-2' }];
  account = 'acct-1';
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    const body = init.body == null ? '' : String(init.body);
    calls.push({ url: u, method: init.method || 'GET', body, headers: new Headers(init.headers) });
    const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
    if (u.hostname === 'oauth2.googleapis.com') {
      if (new URLSearchParams(body).get('grant_type') === 'authorization_code') return json({ access_token: 'yt-access', refresh_token: 'yt-refresh', expires_in: 3600, scope: ytScope });
      return json({ access_token: 'google-test', expires_in: 3600 });
    }
    if (u.hostname === 'storage.googleapis.com') {
      if (u.pathname.startsWith('/upload/')) {
        const name = u.searchParams.get('name'), current = objects.get(name);
        if (u.searchParams.get('ifGenerationMatch') !== (current?.generation || '0')) return json({}, 412);
        objects.set(name, { generation: String(++nextGeneration), data: JSON.parse(body) }); return json({ generation: String(nextGeneration) });
      }
      const doc = objects.get(decodeURIComponent(u.pathname.split('/o/')[1] || ''));
      return doc ? json(doc.data, 200, { 'x-goog-generation': doc.generation }) : json({}, 404);
    }
    if (u.hostname === 'graph.facebook.com') {
      if (u.pathname === '/v21.0/oauth/access_token') return json({ access_token: u.searchParams.get('fb_exchange_token') ? 'fb-long' : 'fb-short', expires_in: 5184000 });
      if (u.pathname === '/v21.0/me/permissions') return json({ data: ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement'].map(permission => ({ permission, status: 'granted' })) });
      if (u.pathname === '/v21.0/me/accounts') return json({ data: fbPages });
    }
    if (u.hostname === 'www.googleapis.com' && u.pathname === '/youtube/v3/channels') return json({ items: [{ id: 'UC-' + account, snippet: { title: 'Channel ' + account, customUrl: '@' + account } }] });
    if (u.hostname === 'open.tiktokapis.com') {
      if (u.pathname === '/v2/oauth/token/') return json({ access_token: 'tt-access', refresh_token: 'tt-refresh', open_id: 'open-' + account, expires_in: 86400, refresh_expires_in: 31536000, scope: 'user.info.basic,video.publish,video.upload' });
      if (u.pathname === '/v2/user/info/') return json({ data: { user: { open_id: 'open-' + account, display_name: 'TT ' + account, avatar_url: '' } } });
      if (u.pathname === '/v2/post/publish/creator_info/query/') return account === 'acct-1' ? json({ data: { creator_username: 'handle_' + account } }) : json({ error: { code: 'x' } }, 500);
    }
    if (u.hostname === 'api.twitter.com') {
      if (u.pathname === '/2/oauth2/token') return json({ access_token: 'x-access', refresh_token: 'x-refresh', expires_in: 7200, scope: 'tweet.read tweet.write users.read media.write offline.access' });
      if (u.pathname === '/2/users/me') return json({ data: { id: 'x-' + account, username: 'x_' + account, name: 'X ' + account } });
    }
    throw new Error('Unexpected test network destination: ' + u.hostname + u.pathname);
  };
});
const docName = user => `nk/users/${user}/userdata/sns-settings.json`;
const settingsOf = user => objects.get(docName(user))?.data;
async function session(user) { return (await m.issueSessionToken(user, env)).token; }
function request(route, token, body) { return new Request(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
async function start(platform, user = 'alice', query = '') {
  const token = await session(user);
  const res = await m.startMetaOAuth(request('/api/sns/connect/' + platform + query, token), env, platform);
  assert.equal(res.status, 200); return { ...(await res.json()), token, platform };
}
async function callback(attempt, code = 'code-' + attempt.platform) {
  const u = new URL(redirectOf(attempt.platform));
  u.searchParams.set('state', new URL(attempt.oauthUrl).searchParams.get('state')); u.searchParams.set('code', code);
  return m.receiveMetaOAuth(new Request(u), env, attempt.platform);
}
const complete = (a, token = a.token, proof = a.proof, code = 'code-' + a.platform) => m.completeMetaOAuth(request('/api/sns/complete', token, { attemptId: a.attemptId, proof, code }), env);
const exchanges = () => calls.filter(c => /oauth\/access_token|oauth2\/token|\/token\/$|^\/token$/.test(c.url.pathname) && !(c.url.hostname === 'oauth2.googleapis.com' && new URLSearchParams(c.body).get('grant_type') !== 'authorization_code'));
const PLATFORMS = ['facebook', 'youtube', 'tiktok', 'x'];

for (const platform of PLATFORMS) {
  test(`${platform}: 연결은 시작한 NK 사용자에게만 저장되고 콜백만으로는 저장되지 않는다`, async () => {
    put('bob', { sns: { [platform]: { connected: true, accessToken: 'bob-token', pageToken: 'bob-page', username: 'bob' } } });
    const a = await start(platform);
    const authUrl = new URL(a.oauthUrl);
    assert.equal(authUrl.searchParams.get('redirect_uri'), redirectOf(platform));
    const state = authUrl.searchParams.get('state');
    assert.ok(state.includes('.'), '서명된 state');
    await assert.rejects(m.verifyMetaState(state, platform === 'x' ? 'tiktok' : 'x', env));
    assert.ok(!a.oauthUrl.includes(a.proof));
    const html = await (await callback(a)).text();
    assert.ok(!html.includes("'*'"), 'postMessage 대상 origin 을 고정한다');
    assert.equal(settingsOf('alice'), undefined, '콜백은 사용자 설정을 바꾸지 않는다');
    assert.equal((await complete(a, await session('bob'))).status, 403);
    assert.equal((await complete(a, a.token, 'wrong-proof')).status, 403);
    assert.equal(exchanges().length, 0);
    const res = await complete(a); const data = await res.json();
    assert.equal(res.status, 200); assert.equal(data.connectionId, a.attemptId);
    assert.ok(!/access|refresh|token/i.test(JSON.stringify(data).replace('connectionId', '')), '응답에 토큰을 싣지 않는다');
    const saved = settingsOf('alice').sns[platform];
    assert.equal(saved.connected, true); assert.equal(saved.connectionId, a.attemptId);
    assert.deepEqual(settingsOf('bob').sns[platform], { connected: true, accessToken: 'bob-token', pageToken: 'bob-page', username: 'bob' });
    assert.equal((await complete(a)).status, 200, '응답이 유실돼 다시 불러도 코드를 두 번 교환하지 않는다');
    assert.equal(exchanges().filter(c => !/fb_exchange_token/.test(c.url.search)).length, 1);
  });
}

test('예전 서명 없는 base64 state 로는 콜백이 아무것도 하지 않는다', async () => {
  for (const platform of PLATFORMS) {
    const u = new URL(redirectOf(platform));
    u.searchParams.set('state', btoa(JSON.stringify({ userId: 'victim', ts: Date.now(), v: 'verifier' }))); u.searchParams.set('code', 'stolen');
    const html = await (await m.receiveMetaOAuth(new Request(u), env, platform)).text();
    assert.ok(html.includes('연결을 완료하지 못했습니다')); assert.ok(!html.includes('stolen'));
  }
  assert.equal(objects.size, 0); assert.equal(exchanges().length, 0);
  // 실제 라우트 파일도 같은 흐름을 쓴다
  const u = new URL(env.X_REDIRECT_URI); u.searchParams.set('state', btoa('{"userId":"victim"}')); u.searchParams.set('code', 'stolen');
  assert.ok((await (await m.xCallback({ request: new Request(u), env })).text()).includes('연결을 완료하지 못했습니다'));
});

test('X: PKCE verifier 는 state·인증 URL 에 실리지 않고 서버 티켓에서만 토큰 교환에 쓰인다', async () => {
  const a = await start('x');
  const authUrl = new URL(a.oauthUrl);
  const ticket = [...objects.entries()].find(([k]) => k.includes('/sns-oauth_'))[1].data;
  assert.ok(ticket.codeVerifier && ticket.codeVerifier.length >= 43);
  assert.ok(!a.oauthUrl.includes(ticket.codeVerifier));
  assert.ok(!JSON.stringify(a).includes(ticket.codeVerifier), '브라우저 응답에도 싣지 않는다');
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authUrl.searchParams.get('code_challenge'), createHash('sha256').update(ticket.codeVerifier).digest('base64url'));
  assert.equal(authUrl.hostname, 'x.com');
  await callback(a); assert.equal((await complete(a)).status, 200);
  const tokenCall = calls.find(c => c.url.pathname === '/2/oauth2/token');
  assert.equal(new URLSearchParams(tokenCall.body).get('code_verifier'), ticket.codeVerifier);
  const done = [...objects.entries()].find(([k]) => k.includes('/sns-oauth_'))[1].data;
  assert.equal(done.codeVerifier, '', '사용한 verifier 는 티켓에서 지운다');
});

test('YouTube: 업로드 권한을 빼고 동의하면 연결로 저장하지 않는다', async () => {
  ytScope = 'https://www.googleapis.com/auth/youtube.readonly';
  const a = await start('youtube'); await callback(a);
  const res = await complete(a);
  assert.equal(res.status, 400); assert.equal((await res.json()).category, 'permission_required');
  assert.equal(settingsOf('alice'), undefined);
});

test('YouTube: 쇼츠 미러를 함께 저장하고, 해제하면 같이 끈다', async () => {
  put('alice', { sns: { 'youtube-shorts': { connected: false, enabled: false } } });
  const a = await start('youtube'); await callback(a); await complete(a);
  const sns = settingsOf('alice').sns;
  assert.equal(sns.youtube.refreshToken, 'yt-refresh');
  assert.equal(sns['youtube-shorts'].connected, true); assert.equal(sns['youtube-shorts'].enabled, false, '사용자가 꺼 둔 쇼츠 토글은 유지');
  assert.equal(sns['youtube-shorts'].channelId, 'UC-acct-1');
  const res = await m.disconnect({ request: request('/api/sns/disconnect', a.token, { platform: 'youtube' }), env });
  assert.equal(res.status, 200);
  const after = settingsOf('alice').sns;
  assert.equal(after.youtube.connected, false); assert.equal(after.youtube.refreshToken, undefined);
  assert.equal(after['youtube-shorts'].connected, false);
});

test('Facebook: 저장된 페이지를 우선하고, 운영자 FACEBOOK_PAGE_ID 는 고객 선택에 끼어들지 않는다', async () => {
  fbPages.push({ id: 'operator-page', name: 'Operator', access_token: 'operator-token' });
  put('alice', { sns: { facebook: { connected: true, pageId: 'page-2', pageToken: 'old' } } });
  const a = await start('facebook'); await callback(a); await complete(a);
  assert.equal(settingsOf('alice').sns.facebook.pageId, 'page-2');
  assert.equal(settingsOf('alice').sns.facebook.pageToken, 'page-token-2');
  const b = await start('facebook', 'bob'); await callback(b); await complete(b);
  assert.equal(settingsOf('bob').sns.facebook.pageId, 'page-1');
});

test('Facebook: 지정한 페이지 권한이 없으면 다른 페이지를 저장하지 않는다', async () => {
  const a = await start('facebook', 'alice', '?page=' + encodeURIComponent('없는 페이지'));
  assert.ok(!new URL(a.oauthUrl).searchParams.get('state').includes('page'), '페이지 지정은 state 에 싣지 않는다');
  await callback(a);
  const res = await complete(a);
  assert.equal((await res.json()).category, 'facebook_page_not_granted');
  assert.equal(settingsOf('alice'), undefined);
});

test('다른 계정으로 다시 연결하면 예전 계정 필드가 남지 않는다', async () => {
  const a = await start('tiktok'); await callback(a); await complete(a);
  assert.equal(settingsOf('alice').sns.tiktok.handle, 'handle_acct-1');
  await m.save({ request: request('/api/userdata/sns/save', a.token, { sns: { tiktok: { enabled: false } } }), env });
  account = 'acct-2';
  const b = await start('tiktok'); await callback(b); await complete(b);
  const saved = settingsOf('alice').sns.tiktok;
  assert.equal(saved.openId, 'open-acct-2'); assert.equal(saved.handle, '', '새 계정의 핸들을 못 받으면 예전 핸들을 쓰지 않는다');
  assert.equal(saved.enabled, false, '사용 토글은 이어받는다');
});

test('설정 저장의 connected:false 로는 연결이 끊기지 않는다(해제는 전용 API)', async () => {
  const a = await start('x'); await callback(a); await complete(a);
  const res = await m.save({ request: request('/api/userdata/sns/save', a.token, { sns: { x: { connected: false, enabled: false, accessToken: 'forged' } } }), env });
  assert.equal(res.status, 200);
  const saved = settingsOf('alice').sns.x;
  assert.equal(saved.connected, true); assert.equal(saved.accessToken, 'x-access'); assert.equal(saved.enabled, false);
});

test('해제는 해제한 사용자만 지우고, 그 사이 새로 연결된 계정은 지우지 않는다', async () => {
  const a = await start('facebook'); await callback(a); await complete(a);
  const b = await start('facebook', 'bob'); await callback(b); await complete(b);
  const res = await m.disconnect({ request: request('/api/sns/disconnect', a.token, { platform: 'facebook' }), env });
  const body = await res.json();
  assert.equal(body.ok, true); assert.equal(body.warning, 'platform_permission_retained');
  assert.equal(settingsOf('alice').sns.facebook.connected, false); assert.equal(settingsOf('alice').sns.facebook.pageToken, undefined);
  assert.equal(settingsOf('bob').sns.facebook.connected, true);
  assert.equal(calls.filter(c => /permissions/.test(c.url.pathname) && c.method === 'DELETE').length, 0, '공유될 수 있는 플랫폼 권한은 철회하지 않는다');
});

function put(user, data) { objects.set(docName(user), { generation: String(++nextGeneration), data: structuredClone(data) }); }
