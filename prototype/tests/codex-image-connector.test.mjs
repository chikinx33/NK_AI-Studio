import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';

const require = createRequire(import.meta.url);
const esbuild = require('../../ai-company-app/node_modules/esbuild');
const { CodexClient } = require('../../scripts/lib/codex-client.cjs');
const root = path.resolve(import.meta.dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/^\uFEFF/, '');
const compile = name => esbuild.transformSync(read(name).replace(/^import[\s\S]*?from\s+['"][^'"]+['"];[ \t]*$/gm, ''), { loader: 'ts', format: 'cjs' }).code;
const uuid = '11111111-1111-4111-8111-111111111111';
const another = '22222222-2222-4222-8222-222222222222';
const tokenA = 'a'.repeat(64);
const tokenB = 'b'.repeat(64);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');

function evaluate(name, deps) {
  const module = { exports: {} };
  vm.runInNewContext(compile(name), { ...deps, module, exports: module.exports, console, crypto,
    Request, Response, URL, File, Uint8Array, TextEncoder, TextDecoder, Date, Map, Set });
  return module.exports;
}
async function harness() {
  const connectors = new Map();
  const jobs = new Map();
  const saves = [];
  let revoked = false;
  const sql = async (q, p = []) => {
    q = q.replace(/\s+/g, ' ').trim();
    if (/^CREATE/.test(q)) return [];
    if (/^SELECT .* FROM nk_image_connectors/.test(q)) {
      return [...connectors.values()].filter(row => q.includes('WHERE token_hash') ? row.token_hash === p[0] : row.user_id === p[0]);
    }
    if (/^SELECT .* FROM nk_subscription_image_jobs/.test(q)) {
      return [...jobs.values()].filter(row => row.user_id === p[0] && row.id === p[q.includes('token_hash=$2') ? 2 : 1] && (!q.includes('token_hash=$2') || row.token_hash === p[1]));
    }
    if (/^INSERT INTO nk_subscription_image_jobs/.test(q)) {
      if (jobs.has(p[0])) return [];
      if ([...jobs.values()].some(row => row.user_id === p[1] && ['queued','working','uploading'].includes(row.status))) throw new Error('active_job_constraint');
      jobs.set(p[0], { id: p[0], user_id: p[1], token_hash: p[2], payload: JSON.parse(p[3]), status: 'queued', error: '', result: null, created_at: new Date().toISOString() });
      return [];
    }
    if (/^UPDATE nk_image_connectors SET last_seen/.test(q)) {
      const row = connectors.get(p[0]);
      if (row?.token_hash === p[1]) Object.assign(row, { last_seen: new Date().toISOString(), email: p[2], plan: p[3], ready: p[4] });
      return [];
    }
    if (/^UPDATE nk_subscription_image_jobs SET status='working',updated_at=now\(\) WHERE id=/.test(q)) {
      const row = [...jobs.values()].find(row => row.user_id === p[0] && row.token_hash === p[1] && row.status === 'queued');
      if (row) { row.status = 'working'; return [row]; } return [];
    }
    if (/^UPDATE nk_subscription_image_jobs SET status='uploading'/.test(q)) {
      const row = jobs.get(p[2]);
      if (row?.user_id === p[0] && row?.token_hash === p[1] && row.status === 'working') { row.status = 'uploading'; return [row]; } return [];
    }
    if (/^UPDATE nk_subscription_image_jobs SET status='done'/.test(q)) {
      const row = jobs.get(p[2]);
      if (row?.user_id === p[0] && row?.token_hash === p[1] && row.status === 'uploading') {
        row.status = 'done'; row.result = JSON.parse(p[3]); return [row];
      } return [];
    }
    if (/^UPDATE nk_subscription_image_jobs SET status='error', error='connector_job_timeout'/.test(q)) return [];
    if (/^UPDATE nk_subscription_image_jobs SET status='error',error=/.test(q)) {
      const row = jobs.get(p[2]);
      if (row?.user_id === p[0] && row.token_hash === p[1]) { row.status = 'error'; row.error = p[3]; } return [];
    }
    throw new Error('Unexpected test SQL: ' + q);
  };
  const helpers = evaluate('prototype/functions/api/_shared/codex-images.ts', {
    getSql: () => sql, checkAccountSession: async () => ({ ok: !revoked }), hasPagePermission: async () => true,
    buildAiImageSessionPrefix: () => '', buildAiVideoProjectPrefix: () => '', resolveProjectStorageOwner: async (_, user) => user,
    resolveGcsEnv: () => ({}), getGoogleAccessToken: async () => '', signGcsUrl: async () => '',
  });
  for (const [user, token] of [['alice',tokenA],['bob',tokenB]]) connectors.set(user, {
    user_id: user, token_hash: await helpers.hashConnectorToken(token), email: user + '@example.com', plan: 'pro', ready: true,
    connected_at: new Date().toISOString(), expires_at: new Date(Date.now()+86400000).toISOString(), last_seen: new Date().toISOString(),
  });
  const api = evaluate('prototype/functions/api/codex-images.ts', {
    ...helpers, authorizeRequest: async request => request.headers.get('x-user') ? { ok: true, userId: request.headers.get('x-user') } : { ok: false, error: 'auth_required', status: 401 },
    hasPagePermission: async () => true, resolveProjectStorageOwner: async (_, user) => user,
    storeSubscriptionImage: async (_, job) => { saves.push(job.user_id); return { signedUrl: 'https://example.test/' + job.id, objectName: 'users/' + job.user_id + '/image.png' }; },
  });
  const env = { DATABASE_URL: crypto.randomUUID(), OPENAI_API_KEY: 'MASTER_NOT_USED' };
  const request = (user, body, token, id) => new Request('https://nkstudio.org/api/codex-images' + (id ? '?jobId=' + id : ''), {
    method: body ? 'POST' : 'GET', headers: { ...(user ? { 'x-user': user } : {}), ...(token ? { 'X-NK-Image-Connector': token } : {}),
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
  });
  const post = (user, body, token) => api.onRequestPost({ env, request: request(user, body, token) });
  const get = (user, id) => api.onRequestGet({ env, request: request(user, null, null, id) });
  const create = (user, id=uuid) => post(user, { operation: 'create', requestId: id, payload: { userId: 'other_owner', prompt: 'blue circle', storageService: 'ai-image', sessionId: 'session' } });
  const heartbeat = (token, extra={}) => post(null, { operation: 'heartbeat', authMode: 'chatgpt', email: 'own@example.com', plan: 'pro', ...extra }, token);
  const complete = (token, id=uuid) => { const fd = new FormData(); fd.set('jobId', id); fd.set('userId', 'other_owner'); fd.set('file', new File([png], 'test.png')); return post(null, fd, token); };
  return { api, helpers, post, get, create, heartbeat, complete, connectors, jobs, saves, revoke: () => { revoked = true; } };
}

test('subscription generation and automatic save stay with the authenticated owner despite spoofed userId', async () => {
  const h = await harness();
  assert.equal((await h.create('alice')).status, 202);
  assert.equal(h.jobs.get(uuid).user_id, 'alice');
  assert.equal((await h.get('bob', uuid)).status, 404);
  assert.equal((await h.heartbeat(tokenB)).status, 200);
  assert.equal(h.jobs.get(uuid).status, 'queued');
  await h.heartbeat(tokenA);
  assert.equal((await h.complete(tokenB)).status, 404);
  assert.equal((await h.complete(tokenA)).status, 200);
  assert.deepEqual(h.saves, ['alice']);
  assert.equal((await h.complete(tokenA)).status, 200);
  assert.deepEqual(h.saves, ['alice'], 'replayed upload must not save twice');
});
test('missing or offline personal connector rejects requests without operator fallback', async () => {
  const h = await harness();
  assert.equal((await h.create('unregistered')).status, 412);
  h.connectors.get('alice').last_seen = new Date(0).toISOString();
  assert.equal((await h.create('alice')).status, 409);
  assert.equal(h.jobs.size, 0);
});
test('generated image storage uses the job owner session and authorized project owner', async () => {
  const storage = evaluate('prototype/functions/api/_shared/storage.ts', {});
  const uploads = [];
  const resolved = [];
  const helpers = evaluate('prototype/functions/api/_shared/codex-images.ts', {
    ...storage, getSql: () => null, checkAccountSession: async () => ({ ok: true }), hasPagePermission: async () => true,
    resolveProjectStorageOwner: async (_, user, owner, project) => { resolved.push([user,owner,project]); return 'shared-owner'; },
    resolveGcsEnv: () => ({ bucket: 'images', basePrefix: 'studio', clientEmail: 'storage', privateKeyRaw: 'storage-private' }),
    getGoogleAccessToken: async () => 'storage-only', signGcsUrl: async ({ object }) => 'https://images.test/' + object,
    fetch: async (url, options) => { uploads.push({ name: new URL(url).searchParams.get('name'), bytes: options.body }); return new Response('{}'); },
  });
  const job = { id: uuid, user_id: 'alice', created_at: '2026-09-17T00:00:00Z',
    payload: { storageService: 'ai-image', sessionId: '../session', projectId: 'p1', ownerId: 'shared-owner', prompt: 'blue circle', imageSize: '1K', aspectRatio: '1:1' } };
  const result = await helpers.storeSubscriptionImage({}, job, new File([png], 'test.png'));
  assert.ok(result.objectName.startsWith('studio/users/alice/ai-image/sessions/.._session/outputs/'));
  assert.ok(result.projectObjectName.startsWith('studio/users/shared-owner/ai-video/projectsp1/image/'));
  assert.equal(result.savedToProject, true);
  assert.deepEqual(resolved, [['alice','shared-owner','p1']]);
  assert.equal(uploads.length, 2);
  assert.ok(uploads.every(item => Buffer.from(item.bytes).equals(png)));
  await assert.rejects(helpers.storeSubscriptionImage({}, job, new File([Buffer.from('not-an-image-file')], 'fake.png')), /invalid_generated_image/);
  assert.equal(uploads.length, 2);
});
test('requestId is idempotent and a second concurrent generation is rejected', async () => {
  const h = await harness();
  assert.equal((await h.create('alice')).status, 202);
  assert.equal((await h.create('alice')).status, 202);
  assert.equal((await h.create('alice', another)).status, 409);
  assert.equal(h.jobs.size, 1);
});
test('another NKStudio account cannot pair an already owned connector', async () => {
  const h = await harness();
  assert.equal((await h.post('bob', { operation: 'connect', tokenHash: h.connectors.get('alice').token_hash })).status, 409);
  assert.equal(h.connectors.get('alice').user_id, 'alice');
});
test('revoked account and API-key mode never receive subscription jobs', async () => {
  const h = await harness();
  await h.create('alice');
  await h.heartbeat(tokenA, { authMode: 'apikey' });
  assert.equal(h.jobs.get(uuid).status, 'queued');
  assert.equal(h.connectors.get('alice').ready, false);
  h.revoke();
  assert.equal((await h.heartbeat(tokenA)).status, 403);
  assert.equal(h.jobs.get(uuid).status, 'queued');
});
test('busy heartbeat does not start a second generation or stop the connector being online', async () => {
  const h = await harness();
  await h.create('alice');
  await h.heartbeat(tokenA, { busy: true });
  assert.equal(h.jobs.get(uuid).status, 'queued');
  assert.equal(h.connectors.get('alice').ready, true);
});
test('private network URLs, oversized references, and path traversal are rejected', async () => {
  const h = await harness();
  const base = { prompt: 'test', storageService: 'ai-image' };
  for (const url of ['http://127.0.0.1/a.png','https://localhost/a.png','https://storage.googleapis.com:8443/a.png','https://nkstudio.org@internal.local/a.png']) {
    assert.throws(() => h.helpers.validateImagePayload({ ...base, referenceImages: [{ imageDataUrl: url }] }));
  }
  assert.throws(() => h.helpers.validateImagePayload({ ...base, projectId: '../other' }));
});
function fakeClient({ type='chatgpt', quota=0, failure=false }={}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-codex-client-'));
  const requests = [];
  let spawnOptions;
  let spawnArguments;
  const spawnProcess = (_, args, options) => {
    spawnOptions=options; spawnArguments=args;
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin = new Writable({ write(chunk, _, callback) {
      const message = JSON.parse(chunk.toString()); requests.push(message);
      const reply = result => queueMicrotask(() => child.stdout.write(JSON.stringify({ id: message.id, result })+'\n'));
      if (message.id != null) {
        if (message.method === 'account/read') reply({ account: { type, email: 'own@example.com', planType: 'pro' } });
        else if (message.method === 'account/rateLimits/read') reply({ rateLimits: { primary: { usedPercent: quota } } });
        else if (message.method === 'thread/start') reply({ thread: { id: 'own-thread' } });
        else if (message.method === 'turn/start') {
          reply({ turn: { id: 'own-turn' } });
          queueMicrotask(() => {
            for (const note of [
              { method: 'item/completed', params: { threadId: 'own-thread', item: { type: 'imageGeneration', status: 'completed', result: png.toString('base64'), ...(failure ? { failure: { type: 'usageLimitExceeded' } } : {}) } } },
              { method: 'turn/completed', params: { threadId: 'own-thread', turn: { id: 'own-turn', status: 'completed' } } },
            ]) child.stdout.write(JSON.stringify(note)+'\n');
          });
        } else reply({});
      }
      callback();
    }});
    child.kill = () => child.emit('exit', 0);
    return child;
  };
  const client = new CodexClient({ binary: 'official-codex', home: directory, cwd: directory, spawnProcess });
  return { client, requests, options: () => spawnOptions, args: () => spawnArguments, cleanup: () => { client.close(); fs.rmdirSync(directory); } };
}
test('official stdio client receives image output with isolated account and shell tools disabled', async () => {
  const previousPipe = process.env.CODEX_APP_TOOLS_PIPE_PATH;
  process.env.CODEX_APP_TOOLS_PIPE_PATH = 'operator-desktop-tool-bridge';
  const h = fakeClient();
  try {
    await h.client.initialize();
    const image = await h.client.generate({ prompt: 'blue circle', imageSize: '1K', aspectRatio: '1:1' });
    assert.equal(image.mimeType, 'image/png');
    assert.deepEqual(image.bytes, png);
    assert.ok(h.options().env.CODEX_HOME);
    assert.equal(h.options().env.OPENAI_API_KEY, undefined);
    assert.equal(h.options().env.ANTHROPIC_API_KEY, undefined);
    assert.equal(h.options().env.CODEX_APP_TOOLS_PIPE_PATH, undefined);
    assert.equal(h.options().env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE, undefined);
    assert.equal(h.options().shell, false);
    assert.ok(h.args().includes('shell_tool'));
    assert.ok(h.args().some((value, index, values) => value === 'code_mode_host' && values[index-1] === '--enable'));
    assert.equal(h.requests.filter(item => item.method==='turn/start').length, 1);
  } finally { h.cleanup(); if (previousPipe === undefined) delete process.env.CODEX_APP_TOOLS_PIPE_PATH; else process.env.CODEX_APP_TOOLS_PIPE_PATH = previousPipe; }
});
test('API-key authentication and exhausted subscription limits reject before any generation', async () => {
  for (const settings of [{ type: 'apiKey' }, { quota: 100 }]) {
    const h = fakeClient(settings);
    try { await assert.rejects(h.client.generate({ prompt: 'test' }), /chatgpt_(login_required|image_usage_limit)/); assert.equal(h.requests.some(item=>item.method==='turn/start'), false); }
    finally { h.cleanup(); }
  }
});
test('image quota failure is surfaced without repeated generation', async () => {
  const h = fakeClient({ failure: true });
  try { await assert.rejects(h.client.generate({ prompt: 'test' }), /chatgpt_image_usage_limit/); assert.equal(h.requests.filter(item=>item.method==='turn/start').length, 1); }
  finally { h.cleanup(); }
});
test('browser subscription request follows queue to saved result and never calls shared imagen', async () => {
  const calls = [];
  const storage = new Map([['nk_auth_token','own-session'],['nk_login_user','alice'],['nk_ai_image_provider','chatgpt-subscription']]);
  const window = { NK: { config: { KEYS: {} } }, crypto };
  const context = { window, NK: window.NK, localStorage: { getItem: key => storage.get(key) || null }, URL, AbortController,
    setTimeout: (fn, ms) => { if(ms===3000) queueMicrotask(fn); return 0; }, clearTimeout: () => {},
    fetch: async (url, options) => { calls.push({ url, ...options }); return new Response(JSON.stringify(options.method==='POST'
      ? { id: uuid, status: 'queued' } : { id: uuid, status: 'done', result: { objectName: 'users/alice/result.png' } }), { status: options.method==='POST' ? 202 : 200 }); },
  };
  vm.runInNewContext(read('prototype/api.js'), context);
  const result = await window.NK.api.imagen({ prompt: 'blue circle', storageService: 'ai-image' });
  assert.equal(result.objectName, 'users/alice/result.png');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call=>call.url.includes('/api/codex-images')));
  assert.equal(JSON.parse(calls[0].body).operation, 'create');
  assert.ok(calls.every(call=>call.headers.Authorization==='Bearer own-session'));
});
