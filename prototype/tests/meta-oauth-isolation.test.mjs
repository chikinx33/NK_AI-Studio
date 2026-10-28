import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';

const esbuild = createRequire(import.meta.url)('../../ai-company-app/node_modules/esbuild');
const api = path.resolve(import.meta.dirname, '../functions/api');
const built = await esbuild.build({
  stdin: { contents: `export * from './_shared/meta-oauth.js'; export * from './_shared/meta-events.js'; export * from './_shared/sns-store.js'; export * from './_shared/meta-token.js'; export { issueSessionToken } from './_shared/auth.js'; export { onRequestPost as disconnect } from './sns/disconnect.ts'; export { onRequestPost as save } from './userdata/sns/save.ts'; export { onRequestGet as getSettings } from './userdata/sns/get.ts'; export { onRequestPost as publish } from './sns/publish.ts';`, resolveDir: api, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
});
const m = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const env = { AUTH_SESSION_SECRET: 'test-secret-only', GOOGLE_CLIENT_EMAIL: 'test@example.invalid', GOOGLE_PRIVATE_KEY: privateKey, VIDEO_OUTPUT_GCS_URI: 'gs://test-bucket/nk', INSTAGRAM_APP_ID: 'ig-test', INSTAGRAM_APP_SECRET: 'ig-test-secret', META_REDIRECT_URI: 'https://nk-ai-studio.pages.dev/api/sns/callback/instagram', THREADS_APP_ID: 'th-test', THREADS_APP_SECRET: 'th-test-secret', THREADS_REDIRECT_URI: 'https://nk-ai-studio.pages.dev/auth/threads/callback', IG_ACCESS_TOKEN: 'operator-token-must-never-be-used', IG_USER_ID: 'operator-id' };
const origin = 'https://nkstudio.org';
let objects, calls, nextGeneration, exchangeFails, providerFailure, conflictOnce, nestedToken, postedTokens;
const realFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = realFetch; });
test.beforeEach(() => {
  objects = new Map(); calls = []; nextGeneration = 1; exchangeFails = false; providerFailure = null; conflictOnce = false; nestedToken = false; postedTokens = [];
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    calls.push({ url: u, method: init.method || 'GET' });
    const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
    if (u.hostname === 'oauth2.googleapis.com') return json({ access_token: 'google-test', expires_in: 3600 });
    if (u.hostname === 'storage.googleapis.com') {
      if (u.pathname.startsWith('/upload/')) {
        const name = u.searchParams.get('name'), current = objects.get(name);
        if (conflictOnce && name.endsWith('/sns-settings.json')) {
          conflictOnce = false;
          const concurrent = structuredClone(current?.data || { sns: {} }); concurrent.sns.youtube = { connected: true, accessToken: 'concurrent-youtube' };
          objects.set(name, { generation: String(++nextGeneration), data: concurrent });
          return json({}, 412);
        }
        if (u.searchParams.get('ifGenerationMatch') !== (current?.generation || '0')) return json({}, 412);
        const data = JSON.parse(init.body); objects.set(name, { generation: String(++nextGeneration), data }); return json({ generation: String(nextGeneration) });
      }
      const name = decodeURIComponent(u.pathname.split('/o/')[1] || ''); const doc = objects.get(name);
      return doc ? json(doc.data, 200, { 'x-goog-generation': doc.generation }) : json({}, 404);
    }
    if (u.pathname === '/oauth/access_token') {
      if (providerFailure) return json(providerFailure, 400);
      const data = { access_token: 'short-test', user_id: 'sns-test-id', permissions: m.META_SCOPES[u.hostname === 'api.instagram.com' ? 'instagram' : 'threads'].join(',') };
      return json(nestedToken ? { data: [data] } : data);
    }
    if (u.pathname === '/access_token') return exchangeFails ? json({ error: { message: 'provider private detail short-test', code: 190 } }, 400) : json({ access_token: 'long-test', expires_in: 5184000 });
    if (u.pathname.endsWith('/me')) return json({ id: 'sns-test-id', username: 'test_channel' });
    if (u.pathname === '/refresh_access_token') return json({ access_token: 'fresh-test', expires_in: 5184000 });
    if (u.pathname.endsWith('/media') || u.pathname.endsWith('/threads')) {
      postedTokens.push(new Headers(init.headers).get('Content-Type')?.includes('application/json') ? JSON.parse(init.body).access_token : new URLSearchParams(init.body).get('access_token'));
      return json({ id: 'test-container' });
    }
    if (u.pathname.endsWith('/media_publish') || u.pathname.endsWith('/threads_publish')) {
      postedTokens.push(new Headers(init.headers).get('Content-Type')?.includes('application/json') ? JSON.parse(init.body).access_token : new URLSearchParams(init.body).get('access_token'));
      return json({ id: 'test-post' });
    }
    if (u.pathname.endsWith('/test-container')) return json({ status: 'FINISHED', status_code: 'FINISHED' });
    if (u.pathname.endsWith('/permissions')) throw new Error('A local disconnect must not revoke a shared provider grant');
    throw new Error('Unexpected test network destination: ' + u.hostname + u.pathname);
  };
});
const docName = user => `nk/users/${user}/userdata/sns-settings.json`;
function put(user, data) { objects.set(docName(user), { generation: String(++nextGeneration), data: structuredClone(data) }); }
async function session(user) { return (await m.issueSessionToken(user, env)).token; }
function request(route, token, body) { return new Request(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
async function start(user = 'alice', platform = 'instagram') {
  const token = await session(user); const res = await m.startMetaOAuth(request('/api/sns/connect/' + platform, token), env, platform);
  assert.equal(res.status, 200); const data = await res.json(); return { ...data, token, platform };
}
async function callback(attempt, extra = {}) {
  const u = new URL(attempt.platform === 'instagram' ? env.META_REDIRECT_URI : env.THREADS_REDIRECT_URI);
  u.searchParams.set('state', new URL(attempt.oauthUrl).searchParams.get('state'));
  u.searchParams.set('code', 'test-code'); Object.entries(extra).forEach(([k, v]) => u.searchParams.set(k, v));
  return m.receiveMetaOAuth(new Request(u), env, attempt.platform);
}
async function complete(attempt, token = attempt.token, proof = attempt.proof) {
  return m.completeMetaOAuth(request('/api/sns/complete', token, { attemptId: attempt.attemptId, proof, code: "test-code" }), env);
}

test('forged, legacy unsigned, expired, wrong-platform state are rejected before storage', async () => {
  const a = await start(); const state = new URL(a.oauthUrl).searchParams.get('state');
  await assert.rejects(m.verifyMetaState(state.slice(0, -2) + 'AA', 'instagram', env));
  await assert.rejects(m.verifyMetaState(btoa(JSON.stringify({ userId: 'victim' })), 'instagram', env));
  await assert.rejects(m.verifyMetaState(state, 'threads', env));
  await assert.rejects(m.verifyMetaState(state, 'instagram', env, Date.now() + 700000));
  const signed = await m.verifyMetaState(state, 'instagram', env); assert.equal(signed.userId, 'alice');
  assert.ok(!state.includes(a.proof));
});
test('OAuth start requires an authenticated login and a configured HTTPS callback', async () => {
  assert.equal((await m.startMetaOAuth(request('/api/sns/connect/instagram', ''), env, 'instagram')).status, 401);
  const token = await session('alice');
  assert.equal((await m.startMetaOAuth(request('/api/sns/connect/instagram', token), { ...env, META_REDIRECT_URI: 'https://attacker.invalid/callback' }, 'instagram')).status, 503);
});
test('cross-domain callback cannot write a user connection without initiating browser proof', async () => {
  const a = await start(); await callback(a);
  assert.ok(!objects.has(docName('alice')));
  assert.equal((await complete(a, await session('bob'))).status, 403);
  assert.equal((await complete(a, a.token, 'wrong-proof')).status, 403);
  assert.equal(calls.filter(c => c.url.pathname === '/oauth/access_token').length, 0);
});
test('a forwarded authorization URL cannot link another browser SNS account by polling', async () => {
  const a = await start();
  await callback(a, { code: 'code-known-only-to-the-returned-browser' });
  const poll = await m.completeMetaOAuth(request('/api/sns/complete', a.token, { attemptId: a.attemptId, proof: a.proof }), env);
  assert.equal(poll.status, 202); assert.equal((await complete(a)).status, 403);
  assert.ok(!objects.has(docName('alice')));
  assert.equal(calls.filter(c => c.url.pathname === '/oauth/access_token').length, 0);
});
test('same-user new login cannot finish an earlier session attempt', async () => {
  const a = await start(); await callback(a);
  const token = (await m.issueSessionToken('alice', env, 1800, { persistent: true })).token;
  assert.equal((await complete(a, token)).status, 403);
});
test('signed callback is single use and targets only the initiating origin', async () => {
  const a = await start(); const first = await callback(a); const html = await first.text();
  assert.ok(html.includes('https://nkstudio.org')); assert.ok(!html.includes("}, '*')")); assert.ok(html.includes('test-code'));
  assert.ok(!JSON.stringify([...objects.values()]).includes('test-code'));
  const second = await callback(a, { code: 'replacement-code' }); assert.ok((await second.text()).includes('연결을 완료하지 못했습니다'));
});
test('openerless popup returns the code only in an origin-bound URL fragment without the browser proof', async () => {
  const a = await start(); const html = await (await callback(a)).text();
  const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]; let redirected = '';
  vm.runInNewContext(script, { window: { opener: null }, location: { replace(url) { redirected = url; } }, encodeURIComponent, JSON });
  const u = new URL(redirected); assert.equal(u.origin, origin); assert.equal(u.pathname, '/sns-settings'); assert.equal(u.search, '');
  const message = JSON.parse(decodeURIComponent(u.hash.slice(11))); assert.equal(message.result.code, 'test-code'); assert.equal(message.result.attemptId, a.attemptId);
  assert.ok(!html.includes(a.proof));
});
test('Instagram documented nested token response is supported; only Alice changes', async () => {
  nestedToken = true;
  put('alice', { sns: { facebook: { connected: true, accessToken: 'alice-fb' } }, deployDefaults: {} });
  put('bob', { sns: { instagram: { connected: true, accessToken: 'bob-ig' }, threads: { connected: true, accessToken: 'bob-th' } } });
  const beforeBob = structuredClone(objects.get(docName('bob'))); const a = await start(); await callback(a);
  const done = await complete(a); assert.equal(done.status, 200); const safe = await done.text();
  assert.ok(!safe.includes('long-test')); assert.equal(objects.get(docName('alice')).data.sns.instagram.connectionId, a.attemptId);
  assert.equal(objects.get(docName('alice')).data.sns.facebook.accessToken, 'alice-fb'); assert.deepEqual(objects.get(docName('bob')), beforeBob);
  const server = await m.getSettings({ request: request('/api/userdata/sns/get', a.token), env }); const data = await server.json();
  assert.equal(data.settings.sns.instagram.connectionId, a.attemptId); assert.ok(!JSON.stringify(data).includes('long-test'));
  assert.equal((await complete(a)).status, 200);
  assert.equal(calls.filter(c => c.url.pathname === '/oauth/access_token').length, 1);
});
test('Threads callback also needs browser proof and stores only the initiating user', async () => {
  const a = await start('alice', 'threads'); await callback(a); const done = await complete(a); assert.equal(done.status, 200);
  assert.equal(objects.get(docName('alice')).data.sns.threads.threadsUserId, 'sns-test-id'); assert.ok(!objects.has(docName('bob')));
});
test('failed long-lived exchange never overwrites existing connections or invents 60-day expiry', async () => {
  put('alice', { sns: { instagram: { connected: true, accessToken: 'previous-token' } } }); const original = structuredClone(objects.get(docName('alice')));
  const a = await start(); await callback(a); exchangeFails = true;
  const done = await complete(a); assert.equal(done.status, 400); assert.deepEqual(objects.get(docName('alice')), original);
  assert.ok(!(await done.text()).includes('short-test'));
});
test('declined consent and service app restrictions are separate safe categories', async () => {
  assert.equal(m.metaFailure('개발자 역할 권한 부족'), 'service_access_restricted');
  assert.equal(m.metaFailure('access_denied user_denied'), 'consent_denied');
  const a = await start(); await callback(a, { error: 'access_denied', error_description: 'User denied' });
  const result = await (await complete(a)).json(); assert.equal(result.category, 'consent_denied'); assert.ok(!objects.has(docName('alice')));
});
test('concurrent channel write is retried without discarding its token', async () => {
  const a = await start(); await callback(a); conflictOnce = true;
  assert.equal((await complete(a)).status, 200);
  assert.equal(objects.get(docName('alice')).data.sns.youtube.accessToken, 'concurrent-youtube');
});
test('preference saves cannot forge connection, account ID or credentials', async () => {
  put('alice', { sns: { instagram: { connected: true, accessToken: 'original', igUserId: 'original-id' }, facebook: { connected: true, pageToken: 'fb-secret' } } });
  const token = await session('alice');
  const r = await m.save({ request: request('/api/userdata/sns/save', token, { sns: { instagram: { connected: true, enabled: false, igUserId: 'other-id', accessToken: 'forged' }, threads: { connected: true, accessToken: 'forged' } } }), env });
  assert.equal(r.status, 200); const text = await r.text(); assert.ok(!text.includes('fb-secret')); assert.ok(!text.includes('original"'));
  const sns = objects.get(docName('alice')).data.sns; assert.equal(sns.instagram.igUserId, 'original-id'); assert.equal(sns.instagram.accessToken, 'original'); assert.ok(!sns.threads.connected); assert.equal(sns.instagram.enabled, false);
});
test('disconnect clears Alice credentials while preserving Bob, other channels and provider grants', async () => {
  put('alice', { sns: { instagram: { connected: true, accessToken: 'same-sns-token', refreshToken: 'refresh', igUserId: 'shared-sns' }, youtube: { connected: true, accessToken: 'yt' } } });
  put('bob', { sns: { instagram: { connected: true, accessToken: 'same-sns-token', igUserId: 'shared-sns' } } });
  const bob = structuredClone(objects.get(docName('bob'))); const token = await session('alice');
  const r = await m.disconnect({ request: request('/api/sns/disconnect', token, { platform: 'instagram', ownerId: 'bob' }), env });
  assert.equal(r.status, 200); assert.equal(objects.get(docName('alice')).data.sns.instagram.accessToken, undefined); assert.equal(objects.get(docName('alice')).data.sns.youtube.accessToken, 'yt'); assert.deepEqual(objects.get(docName('bob')), bob);
});
test('refresh refuses to resurrect credentials after disconnect', async () => {
  put('alice', { sns: { instagram: { connected: false, enabled: false } } }); const ctx = await m.snsContext(env, 'alice');
  await assert.rejects(m.patchSnsPlatform(ctx, 'instagram', { accessToken: 'fresh' }, 'old'), /sns_connection_changed/);
  assert.equal(objects.get(docName('alice')).data.sns.instagram.accessToken, undefined);
});
test('expired credentials require reconnection; valid near-expiry tokens refresh without changing Bob', async () => {
  put('alice', { sns: { threads: { connected: true, accessToken: 'old', tokenExpiresAt: new Date(Date.now() - 1000).toISOString() } } });
  const ctx = await m.snsContext(env, 'alice'); const expired = objects.get(docName('alice')).data.sns.threads;
  await assert.rejects(m.ensureMetaToken(ctx, 'threads', expired), /threads_reconnect_required/);
  put('alice', { sns: { threads: { connected: true, accessToken: 'old', tokenExpiresAt: new Date(Date.now() + 86400000).toISOString() } } });
  const fresh = await m.ensureMetaToken(ctx, 'threads', objects.get(docName('alice')).data.sns.threads); assert.equal(fresh, 'fresh-test');
  assert.ok(!objects.has(docName('bob')));
});
test('an unconnected customer cannot publish with operator environment tokens', async () => {
  const token = await session('alice');
  const r = await m.publish({ request: request('/api/sns/publish', token, { platform: 'instagram', caption: 'test', mediaType: 'image', mediaDirectUrl: 'https://example.invalid/test.jpg' }), env });
  assert.equal(r.status, 412); assert.equal((await r.json()).error, 'instagram_not_connected');
  assert.ok(!calls.some(c => c.url.searchParams.get('access_token') === env.IG_ACCESS_TOKEN));
});
test('shared publishing without explicit editor grant and shared reads without grant are forbidden', async () => {
  const token = await session('alice');
  const r = await m.publish({ request: request('/api/sns/publish', token, { platform: 'threads', caption: 'test', ownerId: 'bob', projectId: 'p1' }), env });
  assert.equal(r.status, 403);
  const read = await m.getSettings({ request: request('/api/userdata/sns/get?ownerId=bob&projectId=p1', token), env }); assert.equal(read.status, 403);
  assert.ok(!objects.has(docName('bob')));
});
test('simulated Instagram and Threads publishing use only Alice credentials and leave Bob unchanged', async () => {
  const future = new Date(Date.now() + 30 * 86400000).toISOString();
  put('alice', { sns: { instagram: { connected: true, enabled: true, igUserId: 'alice-sns', accessToken: 'alice-ig', tokenExpiresAt: future }, threads: { connected: true, enabled: true, threadsUserId: 'alice-sns', accessToken: 'alice-th', tokenExpiresAt: future } } });
  put('bob', { sns: { instagram: { connected: true, accessToken: 'bob-ig' }, threads: { connected: true, accessToken: 'bob-th' } } });
  const bob = structuredClone(objects.get(docName('bob'))); const token = await session('alice');
  for (const platform of ['instagram', 'threads']) {
    const r = await m.publish({ request: request('/api/sns/publish', token, { platform, caption: 'simulated test', ...(platform === 'instagram' ? { mediaType: 'image', mediaDirectUrl: 'https://example.invalid/test.jpg' } : {}) }), env });
    assert.equal(r.status, 200); assert.equal((await r.json()).result.postId, 'test-post');
  }
  assert.deepEqual(postedTokens, ['alice-ig', 'alice-ig', 'alice-th', 'alice-th']); assert.deepEqual(objects.get(docName('bob')), bob);
});

async function signedEvent(platform, data, type = 'deauthorize') {
  const payload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', issued_at: Math.floor(Date.now() / 1000), ...data })).toString('base64url');
  const secret = env[platform === 'instagram' ? 'INSTAGRAM_APP_SECRET' : 'THREADS_APP_SECRET'];
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('base64url');
  return new Request(`${origin}/api/sns/meta/events?platform=${platform}&type=${type}`, { method: 'POST', body: new URLSearchParams({ signed_request: signature + '.' + payload }) });
}
test('forged platform revocation callbacks cannot read or change connection storage', async () => {
  const before = calls.length;
  const r = await m.receiveMetaEvent(new Request(`${origin}/api/sns/meta/events?platform=instagram&type=deauthorize`, { method: 'POST', body: new URLSearchParams({ signed_request: 'forged.payload' }) }), env);
  assert.equal(r.status, 400); assert.equal(calls.length, before);
  await assert.rejects(m.verifyMetaSignedRequest('bad.payload', env.INSTAGRAM_APP_SECRET));
});
test('verified platform revocation clears only matching accounts and preserves later reauthorization', async () => {
  const sns = { instagram: { connected: true, igUserId: 'sns-test-id', accessToken: 'old' } };
  put('alice', { sns }); put('bob', { sns: { instagram: { connected: true, igUserId: 'other', accessToken: 'bob' } } });
  await m.registerMetaConnections(env, 'alice', sns);
  const r = await m.receiveMetaEvent(await signedEvent('instagram', { user_id: 'sns-test-id' }), env); assert.equal(r.status, 200);
  assert.equal(objects.get(docName('alice')).data.sns.instagram.accessToken, undefined); assert.equal(objects.get(docName('bob')).data.sns.instagram.accessToken, 'bob');
  put('alice', { sns: { instagram: { ...sns.instagram, connectedAt: new Date(Date.now() + 10000).toISOString() } } });
  await m.receiveMetaEvent(await signedEvent('instagram', { user_id: 'sns-test-id' }), env);
  assert.equal(objects.get(docName('alice')).data.sns.instagram.accessToken, 'old');
});
test('platform deletion returns a real pending receipt and never falsely certifies retained-data deletion', async () => {
  const sns = { threads: { connected: true, threadsUserId: 'sns-test-id', accessToken: 'test' } }; put('alice', { sns }); await m.registerMetaConnections(env, 'alice', sns);
  const r = await m.receiveMetaEvent(await signedEvent('threads', { user_id: 'sns-test-id' }, 'deletion'), env); assert.equal(r.status, 200);
  const receipt = await r.json(); assert.match(receipt.confirmation_code, /^[a-f0-9-]{36}$/); assert.ok(receipt.url.startsWith('https://nkstudio.org/data-deletion?request='));
  assert.equal(objects.get(docName('alice')).data.sns.threads.accessToken, undefined);
  const queued = objects.get(`nk/admin/meta-deletion-${receipt.confirmation_code}.json`).data;
  assert.equal(queued.status, 'pending'); assert.equal(queued.connectionCredentialsRemoved, true);
});
