import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const esbuild = createRequire(import.meta.url)('../../ai-company-app/node_modules/esbuild');
const ts = source => esbuild.transformSync(source, { loader: 'ts', format: 'cjs' }).code;
function evaluate(source, deps = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];[ \t]*$/gm, '')),
    { module, exports: module.exports, console, crypto, Request, Response, URL, TextEncoder, Uint8Array, ...deps });
  return module.exports;
}
function accounts() {
  const rows = new Map();
  const connectors = new Map();
  const sql = async (query, args = []) => {
    if (/^(ALTER|CREATE)/.test(query.trim())) return [];
    if (query.startsWith('SELECT * FROM app_settings')) return rows.has(args[0]) ? [rows.get(args[0])] : [];
    if (query.startsWith('SELECT * FROM nk_image_connectors')) return connectors.has(args[0]) ? [connectors.get(args[0])] : [];
    if (query.includes('INSERT INTO app_settings (user_id,user_chat_enabled')) {
      const old = rows.get(args[0]) || {};
      rows.set(args[0], { ...old, user_chat_enabled: args[1], user_image_enabled: args[2], image_auth_mode: args[3],
        image_openai_api_key: args[4] || old.image_openai_api_key, claude_auth_mode: args[5],
        claude_oauth_token: args[6] || old.claude_oauth_token, claude_api_key: args[7] || old.claude_api_key });
      return [];
    }
    throw new Error('Unexpected SQL: ' + query);
  };
  const deps = { getSql: () => sql, connectorSql: async () => sql,
    connectorStatus: row => ({ configured: !!row, online: !!row?.ready, email: row?.email || '' }) };
  const claude = evaluate(read('prototype/functions/api/_shared/claude-auth.js'), { ...deps, isCreditExhausted: () => false });
  const generation = evaluate(read('prototype/functions/api/_shared/generation-auth.ts'), { ...deps, ...claude });
  const env = { ANTHROPIC_API_KEY: 'MASTER-CLAUDE', CLAUDE_AUTH_MODE: 'api_key', OPENAI_API_KEY: 'MASTER-OPENAI',
    ATLASCLOUD_API_KEY: 'MASTER-ATLAS', GEMINI_API_KEY: 'MASTER-GEMINI' };
  return { rows, connectors, sql, claude, generation, env };
}
const ownClaude = 'sk-ant-oat01-' + 'a'.repeat(30);
const ownImage = 'sk-proj-' + 'b'.repeat(30);
const choice = { chatEnabled: true, imageEnabled: true, authMode: 'subscription', imageMode: 'subscription', oauthToken: ownClaude };

test('checkboxes independently select owner credentials, preserve them when unchecked, and never expose secrets', async () => {
  const h = accounts();
  h.connectors.set('alice', { ready: true, email: 'alice@example.com' });
  await h.generation.saveGenerationSettings(h.env, 'alice', { ...choice, imageMode: 'api_key', imageApiKey: ownImage, userId: 'bob' });
  assert.equal(h.rows.has('bob'), false);
  assert.equal((await h.claude.resolveAuth(h.sql, 'alice', h.env)).source, 'user');
  assert.equal((await h.generation.imageAuth(h.env, 'alice')).apiKey, ownImage);
  await h.generation.saveGenerationSettings(h.env, 'alice', { ...choice, chatEnabled: false, imageEnabled: false });
  assert.equal((await h.claude.resolveAuth(h.sql, 'alice', h.env)).apiKey, 'MASTER-CLAUDE');
  assert.equal((await h.generation.imageAuth(h.env, 'alice')).source, 'master');
  assert.equal(h.rows.get('alice').claude_oauth_token, ownClaude);
  const status = await h.generation.generationStatus(h.env, 'alice', h.rows.get('alice'));
  assert.doesNotMatch(JSON.stringify(status), /sk-ant|sk-proj|MASTER-/);
  assert.equal(status.chatEnabled, false);
  assert.equal(status.imageEnabled, false);
  await h.generation.saveGenerationSettings(h.env, 'alice', { ...choice, chatEnabled: false, imageMode: 'api_key' });
  assert.equal((await h.generation.imageAuth(h.env, 'alice')).apiKey, ownImage);
  assert.equal((await h.claude.resolveAuth(h.sql, 'alice', h.env)).source, 'master');
  const other = await h.generation.imageAuth(h.env, 'bob');
  assert.equal(other.enabled, false);
});
test('checking chat without credentials fails closed; malformed settings never overwrite an account', async () => {
  const h = accounts();
  await h.generation.saveGenerationSettings(h.env, 'alice', { ...choice, oauthToken: '' });
  await assert.rejects(h.claude.resolveAuth(h.sql, 'alice', h.env), /claude_auth_required/);
  for (const patch of [{ chatEnabled: 'true' }, { imageMode: 'gemini' }, { imageApiKey: 'MASTER' }]) {
    await assert.rejects(h.generation.saveGenerationSettings(h.env, 'alice', { ...choice, ...patch }), /invalid_/);
  }
  assert.equal(h.rows.get('alice').claude_oauth_token, undefined);
});

test('every image request uses server account choice, including explicit Gemini/Atlas page or agent requests', async () => {
  const src = read('prototype/functions/api/imagen.ts');
  const dispatch = src.slice(src.indexOf('export const onRequestPost:'), src.indexOf('\nfunction json('))
    + src.slice(src.indexOf('function selectConversationHistory('), src.indexOf('function normalizeCameraTargetMode('));
  for (const mode of ['subscription', 'api_key', 'master', 'missing-key', 'settings-down']) {
    const calls = [];
    const env = { OPENAI_API_KEY: 'MASTER-OPENAI', GEMINI_API_KEY: 'MASTER-GEMINI', GOOGLE_API_KEY: 'MASTER-GOOGLE', ATLASCLOUD_API_KEY: 'MASTER-ATLAS' };
    const api = evaluate(dispatch, {
      authorizeRequest: async () => ({ ok: true, userId: 'alice' }),
      imageAuth: async () => { if (mode === 'settings-down') throw new Error('DB down');
        return { enabled: mode !== 'master', mode: mode === 'subscription' ? 'subscription' : 'api_key',
          apiKey: mode === 'missing-key' ? '' : ownImage, connector: { configured: true, online: true } }; },
      subscriptionImageRequest: async context => { calls.push({ kind: 'subscription', body: await context.request.json() }); return Response.json({ id: 'queue' }, { status: 202 }); },
      handlePost: async context => { calls.push({ kind: 'provider', env: context.env, body: await context.request.json() }); return Response.json({ signedUrl: 'saved' }); },
      withCreditCharge: async (context, _, handle) => { calls.push({ kind: 'credits' }); return handle(context); },
      json: (body, status = 200) => Response.json(body, { status }), normalizePrompt: s => s,
      normalizeGenerationMode: () => 'text-to-image', normalizeGenerationStyle: () => 'standard', normalizeCameraTargetMode: () => 'subject',
      normalizeReferenceImages: async () => [], buildGeminiImagePrompt: p => p,
    });
    const response = await api.onRequestPost({ env, request: new Request('https://nkstudio.org/api/imagen',
      { method: 'POST', headers: { Authorization: 'Bearer own' }, body: JSON.stringify({ prompt: 'glass marble', provider: 'gpt25-flare' }) }) });
    if (mode === 'subscription') { assert.equal(response.status, 202); assert.equal(calls[0].kind, 'subscription'); }
    if (mode === 'api_key') {
      assert.equal(calls[0].body.provider, 'openai'); assert.equal(calls[0].env.OPENAI_API_KEY, ownImage);
      for (const key of ['GEMINI_API_KEY','GOOGLE_API_KEY','ATLASCLOUD_API_KEY']) assert.equal(calls[0].env[key], '');
      assert.equal(calls[0].env.USER_IMAGE_AUTH, true); assert.equal((await response.json()).authSource, 'user');
    }
    if (mode === 'master') { assert.equal(calls[0].kind, 'credits'); assert.equal(calls[1].env.OPENAI_API_KEY, 'MASTER-OPENAI'); }
    if (['missing-key','settings-down'].includes(mode)) { assert.equal(calls.length, 0); assert.equal(response.status, mode === 'missing-key' ? 412 : 503); }
  }
});

function agentFunctions(deps) {
  const src = read('prototype/functions/api/agent/_shared.ts');
  const image = src.slice(src.indexOf('async function runImagenTool('), src.indexOf('/** 비트 도구:', src.indexOf('async function runImagenTool(')));
  const helpers = src.slice(src.indexOf('async function imageRequestKey('), src.indexOf('/** AI 회사 공용 파일 공간.', src.indexOf('async function imageRequestKey(')));
  const jobs = src.slice(src.indexOf('export async function processJob('), src.indexOf('// 에이전트 표시 메타', src.indexOf('export async function processJob(')));
  return evaluate('export { runImagenTool };\n' + image + helpers + jobs, deps);
}
test('a resumed nested image reuses its logical stage despite changed prompts and signed reference URLs', async () => {
  let sends = 0;
  const api = agentFunctions({ internalUrl: (request, url) => new URL(url, request.url),
    fetch: async () => { sends++; return Response.json({ id: 'image1' }, { status: 202 }); } });
  const ctx = { request: new Request('https://nkstudio.org'), env: {}, userId: 'alice', authHeader: 'Bearer alice', jobId: 'agent1' };
  let pending;
  try { await api.runImagenTool({ prompt: 'first prompt', _imageStageKey: 'scene_still:project:1',
    referenceImages: [{ imageUrl: 'https://storage.googleapis.com/bucket/ref?old-signature' }] }, ctx); }
  catch (error) { pending = error; }
  assert.equal(pending.imageJobId, 'image1');
  const stored = { signedUrl: 'saved-image', objectName: 'users/alice/image.png' };
  const resumed = await api.runImagenTool({ prompt: 'updated prompt with newly prepared plate', _imageStageKey: 'scene_still:project:1',
    referenceImages: [{ imageUrl: 'https://storage.googleapis.com/bucket/ref?renewed-signature' }] },
    { ...ctx, imageResults: { [pending.imageRequestKey]: stored } });
  assert.equal(resumed, stored); assert.equal(sends, 1);
});
test('own image quotes bypass an empty master wallet; unchecked image quotes keep master billing', async () => {
  let enabled = true, walletReads = 0;
  const api = evaluate(read('prototype/functions/api/credits/quote.ts'), {
    authorizeRequest: async () => ({ ok: true, userId: 'alice' }),
    quoteCredits: () => ({ credits: 12, provider: 'atlas' }), publicCreditRates: () => ({}),
    imageAuth: async (_, owner) => { assert.equal(owner, 'alice'); return { enabled, mode: 'subscription' }; },
    getCreditSummary: async () => { walletReads++; return { available: 0 }; },
  });
  const post = () => api.onRequestPost({ request: new Request('https://nkstudio.org/api/credits/quote',
    { method: 'POST', body: JSON.stringify({ feature: 'image_generation' }) }), env: {} });
  const own = await (await post()).json();
  assert.equal(own.quote.credits, 0); assert.equal(own.quote.billingSource, 'user-subscription'); assert.equal(walletReads, 0);
  enabled = false;
  const master = await (await post()).json();
  assert.equal(master.quote.credits, 12); assert.equal(walletReads, 1);
});
for (const approved of [false, true]) test(`agent remains working and resumes one owner image (approved tool: ${approved})`, async () => {
  let sends = 0;
  const records = new Map([['agent1', { id: 'agent1', type: 'image', input: { prompt: 'glass marble' }, user_id: 'alice', agent_id: 'pixel', status: 'queued' }]]);
  const messages = [];
  const tool = { agentId: 'pixel', gate: approved, run: null };
  const sql = async (query, args) => {
    if (query.startsWith('SELECT * FROM agent_jobs')) return [...records.values()].filter(j => j.user_id === args[0] && j.status === 'working' && j.output.subscriptionPending).map(j => structuredClone(j));
    if (query.startsWith('SELECT id,status')) return [{ id: 'image1', status: 'done', result: { signedUrl: 'https://storage.googleapis.com/alice/image.png', objectName: 'users/alice/image.png', provider: 'chatgpt-subscription' } }];
    if (query.startsWith('UPDATE agent_jobs SET output=jsonb_set')) {
      const job = records.get(args[1]);
      if (job.status !== 'working' || job.output.resuming) return [];
      job.output.resuming = true; return [structuredClone(job)];
    }
    throw new Error('Unexpected SQL: ' + query);
  };
  const api = agentFunctions({ AGENT_TOOLS: { image: tool }, AGENT_META: { pixel: { name: '픽셀' } },
    fetch: async (_, init) => { sends++; assert.equal(init.headers.Authorization, 'Bearer alice'); return Response.json({ id: 'image1', status: 'queued' }, { status: 202 }); },
    internalUrl: (request, url) => new URL(url, request.url),
    setJobStatus: async (_, id, user, patch) => { const job = records.get(id); assert.equal(job.user_id, user); Object.assign(job, patch); return job; },
    connectorSql: async () => sql, expireImageJobs: async () => {}, addMessage: async (_, m) => messages.push(m),
    fileJobAsWorkItem: async () => ({ workId: 'work1', dateKey: '2026-09-17' }) });
  tool.run = api.runImagenTool;
  const ctx = { request: new Request('https://nkstudio.org'), env: {}, userId: 'alice', authHeader: 'Bearer alice', conversationId: 'private-chat', runApproved: approved };
  const initial = await api.processJob(ctx, sql, 'agent1', 'image', { prompt: 'glass marble' });
  assert.equal(initial.pending, true); assert.equal(records.get('agent1').status, 'working');
  assert.equal(records.get('agent1').output.signedUrl, undefined);
  await api.reconcileSubscriptionJobs({ ...ctx, userId: 'bob' }, sql);
  assert.equal(messages.length, 0);
  await Promise.all([api.reconcileSubscriptionJobs(ctx, sql), api.reconcileSubscriptionJobs(ctx, sql)]);
  assert.equal(sends, 1); assert.equal(records.get('agent1').status, approved ? 'approved' : 'review_pending');
  if (approved) assert.equal(records.get('agent1').output.workItemId, 'work1');
  assert.equal(messages.length, 1); assert.equal(messages[0].conversationId, 'private-chat');
  assert.equal(messages[0].files[0].jobId, 'agent1');
  assert.match(messages[0].text, /본인 ChatGPT 구독/);
});

test('approval starts a subscription image once and returns a working message, never a false completion', async () => {
  const job = { id: 'agent1', status: 'review_pending', user_id: 'alice', agent_id: 'pixel', type: 'set_master',
    input: { _conversationId: 'private-chat' }, output: null };
  let starts = 0;
  const api = evaluate(read('prototype/functions/api/agent/review.ts'), {
    authorizeRequest: async () => ({ ok: true, userId: 'alice' }), getSql: () => async () => {
      if (job.status !== 'review_pending') return [];
      job.status = 'working'; return [{ id: job.id }];
    }, ensureAgentSchema: async () => {}, getJob: async () => ({ ...job }),
    AGENT_META: { pixel: { name: '픽셀' } }, AGENT_TOOLS: { set_master: { gate: true, run: async () => {
      starts++; throw Object.assign(new Error('subscription_image_pending'), { imageJobId: 'image1' });
    } } },
    persistPendingImage: async (ctx) => { assert.equal(ctx.runApproved, true); assert.equal(ctx.conversationId, 'private-chat');
      job.output = { subscriptionPending: true }; job.review_status = 'approved'; },
    send: (body, status = 200) => Response.json(body, { status }),
  });
  const post = () => api.onRequestPost({ request: new Request('https://nkstudio.org/api/agent/review',
    { method: 'POST', body: JSON.stringify({ id: job.id, decision: 'approved' }) }), env: {}, waitUntil: () => {} });
  const response = await post();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.job.status, 'working'); assert.doesNotMatch(body.message.text, /작업 완료|완성/);
  assert.match(body.message.text, /본인 ChatGPT/);
  assert.equal((await post()).status, 409); assert.equal(starts, 1);
});

test('registered legacy and expired image connectors stay with their owner; explicit unchecked overrides registration', async () => {
  const h = accounts();
  h.connectors.set('alice', { ready: false, email: 'alice@example.com', expires_at: '2000-01-01' });
  assert.equal((await h.generation.imageAuth(h.env, 'alice')).source, 'user');
  assert.equal((await h.generation.imageAuth(h.env, 'alice')).connector.online, false);
  h.rows.set('alice', { user_image_enabled: false });
  assert.equal((await h.generation.imageAuth(h.env, 'alice')).source, 'master');
});

test('personal chat settings override GPT/Atlas agent models without reading or spending a master provider key', async () => {
  const h = accounts();
  await h.generation.saveGenerationSettings(h.env, 'alice', choice);
  const src = read('prototype/functions/api/agent/_orchestrator.ts');
  const call = evaluate(src.slice(src.indexOf('export async function callClaude('), src.indexOf('export interface KnowOp')), {
    ...h.claude, getSql: () => h.sql, normalizeModelChoice: () => null, isAnthropicProvider: p => p === 'anthropic',
    stripThink: s => s, callLLM: async (_, opts) => {
      assert.equal(opts.provider, 'anthropic'); assert.equal(opts.auth.headers.Authorization, 'Bearer ' + ownClaude); return 'ok';
    },
  }).callClaude;
  for (const provider of ['openai','atlas']) assert.equal(await call(h.env, 'system', [],
    { userId: 'alice', modelChoice: { provider, model: 'gpt' } }), 'ok');
});

test('video production batches persist an image wait and resume the same generated result', async () => {
  let runs = 0;
  let done = false;
  const ctx = { request: new Request('https://nkstudio.org'), env: {}, userId: 'alice', authHeader: 'Bearer alice' };
  const api = evaluate(read('prototype/functions/api/agent/_video-pipeline-executor.ts'), {
    AGENT_TOOLS: { scene_still: { run: async (_, toolCtx) => {
      if (toolCtx.imageResults?.key) return toolCtx.imageResults.key;
      runs++; throw Object.assign(new Error('pending'), { imageJobId: 'image1', imageRequestKey: 'key', imageResults: {} });
    } } }, fetch: async (_, init) => { assert.equal(init.headers.Authorization, 'Bearer alice'); return Response.json(done
      ? { status: 'done', result: { signedUrl: 'saved-image' } } : { status: 'working' }); },
  });
  const plan = { steps: [{ sceneId: '1', still: 'pending', video: 'skipped' }], maxScenesPerRun: 1, runs: 0 };
  const batch1 = await api.runVideoPipelineBatch(plan, ctx);
  assert.equal(batch1.continueRunning, true); assert.equal(batch1.plan.steps[0].still, 'pending');
  const batch2 = await api.runVideoPipelineBatch(batch1.plan, ctx);
  assert.equal(batch2.continueRunning, true); assert.equal(runs, 1);
  done = true;
  const batch3 = await api.runVideoPipelineBatch(batch2.plan, ctx);
  assert.equal(batch3.plan.steps[0].still, 'done'); assert.equal(batch3.plan.steps[0].stillUrl, 'saved-image');
  assert.equal(batch3.continueRunning, false); assert.equal(runs, 1);
});
test('background image completion events are isolated by owner and conversation, and acknowledged by cursor', async () => {
  const stored = { user_id: 'alice', conversation_id: 'private-chat', background_seq: '7',
    role: 'agent', agent_id: 'pixel', text: 'saved', files: [{ jobId: 'agent1' }], created_at: '2026-09-17T00:00:00Z' };
  const api = evaluate(read('prototype/functions/api/agent/events.ts'), {
    authorizeRequest: async request => ({ ok: true, userId: request.headers.get('user') }),
    ensureAgentSchema: async () => {}, getSql: () => async (_, args) =>
      stored.user_id === args[0] && stored.conversation_id === args[1] && Number(stored.background_seq) > args[2] ? [stored] : [],
    send: (body, status = 200) => Response.json(body, { status }), corsHeaders: () => ({}),
  });
  const get = async (user, conversationId, since) => (await api.onRequestGet({ env: {},
    request: new Request(`https://nkstudio.org/api/agent/events?conversationId=${conversationId}&since=${since}`, { headers: { user } }) })).json();
  assert.equal((await get('bob', 'private-chat', 0)).items.length, 0);
  assert.equal((await get('alice', 'another-chat', 0)).items.length, 0);
  const first = await get('alice', 'private-chat', 0);
  assert.equal(first.seq, 7); assert.equal(first.items[0].files[0].jobId, 'agent1');
  assert.equal((await get('alice', 'private-chat', first.seq)).items.length, 0);
});
test('client polling receives the saved image event after reconciling jobs and keeps its cursor on network errors', async () => {
  const source = read('ai-company-app/src/lib/api.ts');
  let fail = false;
  const calls = [];
  const api = evaluate(source.slice(source.indexOf('export async function getEvents('), source.indexOf('// 산출물(이미지', source.indexOf('export async function getEvents('))), {
    fetch: async url => { calls.push(url); if (url.includes('/jobs')) return Response.json({ items: [] });
      if (fail) throw new Error('offline');
      return Response.json({ seq: 7, items: [{ background_seq: 7, text: 'saved', agent_id: 'pixel', files: [{ jobId: 'agent1' }] }] }); },
  });
  const events = await api.getEvents(0, 'private-chat');
  assert.match(calls[0], /\/jobs/); assert.match(calls[1], /conversationId=private-chat&since=0/);
  assert.equal(events.messages[0].turn.files[0].jobId, 'agent1'); assert.equal(events.seq, 7);
  fail = true;
  const retry = await api.getEvents(7, 'private-chat');
  assert.equal(retry.seq, 7); assert.equal(retry.messages.length, 0);
});
test('overlapping chat polls present one completion and a stale response cannot rewind its durable cursor', async () => {
  const source = read('ai-company-app/src/App.tsx');
  const start = source.indexOf('  useLiveRefresh(async () => {', source.indexOf('// 서버 백그라운드 작업 폴링:'));
  const body = source.slice(start + '  useLiveRefresh(async () => {'.length, source.indexOf('  }, 2000);', start));
  const waiting = [], presented = [];
  const cursor = { current: 0 };
  const api = evaluate('export async function poll() {' + body + '}', {
    lastSeqRef: cursor, activeConvRef: { current: 'private-chat' },
    getEvents: () => new Promise(resolve => waiting.push(resolve)),
    presentCompletedAgentTurns: messages => presented.push(...messages), markActive: () => {}, setServerWorking: () => {},
  });
  const event = { seq: 1, messages: [{ seq: 1, turn: { text: 'saved', agentId: 'pixel' } }], working: [] };
  const a = api.poll(), b = api.poll();
  waiting[0](event); await a;
  waiting[1](event); await b;
  assert.equal(presented.length, 1); assert.equal(cursor.current, 1);
  const stale = api.poll(); waiting[2]({ seq: 0, messages: [], working: [] }); await stale;
  assert.equal(cursor.current, 1); assert.equal(waiting.length, 3);
});
