import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const esbuild = require('../../ai-company-app/node_modules/esbuild');
const read = file => fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
function evaluate(source, deps = {}) {
  const module = { exports: {} };
  const code = esbuild.transformSync(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];[ \t]*$/gm, ''), { loader: 'ts', format: 'cjs' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, Request, Response, URL, Uint8Array,
    TextEncoder, TextDecoder, crypto, atob, btoa, console, ...deps });
  return module.exports;
}
const image = n => 'data:image/png;base64,' + Buffer.from('image-' + n).toString('base64');
const history = Array.from({ length: 5 }, (_, i) => ({ prompt: 'previous outfit ' + i, imageDataUrl: image(i) }));
const serverSource = read('prototype/functions/api/imagen.ts');
function server(deps = {}) {
  return evaluate(serverSource + '\nexport { selectConversationHistory, buildGeminiImagePrompt };', deps);
}

test('single generation excludes history on the client even with a selected prior result', () => {
  const source = read('prototype/js/ui/ai-image.js');
  const normalize = source.slice(source.indexOf('  function normalizeGenerationStyle('), source.indexOf('  // 선택 가능한 이미지 모델'));
  const build = source.slice(source.indexOf('  function buildConversationHistory('), source.indexOf('  function extractObjectTimestamp('));
  const state = { generationStyle: 'single', currentResultId: '2', results: [4, 1, 3, 0, 2].map(i => ({
    id: String(i), prompt: 'outfit ' + i, url: image(i), createdAt: new Date(i * 1000).toISOString(),
  })) };
  const fn = vm.runInNewContext(normalize + build + '\nbuildConversationHistory', { state, resolveResultUrl: row => row.url });
  assert.equal(fn(3).length, 0);
  state.generationStyle = 'conversation';
  assert.deepEqual(Array.from(fn(3), row => row.prompt), ['outfit 0', 'outfit 1', 'outfit 2']);
  state.currentResultId = '4';
  assert.deepEqual(Array.from(fn(3), row => row.prompt), ['outfit 2', 'outfit 3', 'outfit 4']);
  state.generationStyle = 'single';
  assert.equal(fn(3).length, 0);
});

test('server excludes single or unknown flow history and caps conversation history at three', () => {
  const api = server();
  for (const generationStyle of ['single', 'unknown', undefined]) {
    assert.equal(api.selectConversationHistory({ generationStyle, conversationHistory: history }).length, 0);
  }
  assert.deepEqual(Array.from(api.selectConversationHistory({ generationStyle: 'conversation', conversationHistory: history }), item => item.prompt), history.slice(-3).map(item => item.prompt));
  const prompt = api.buildGeminiImagePrompt('person wearing a red coat', [], 'text-to-image', 'single', 0, 'scene');
  assert.match(prompt, /independent image request/);
  assert.match(prompt, /unless the current instruction or attached references request it/);
  assert.doesNotMatch(prompt, /Preserve the existing subject identity/);
});

test('subscription dispatch sends prior images only for conversation and keeps explicit sources before history and mask', async () => {
  const queued = [];
  const api = server({
    authorizeRequest: async () => ({ ok: true, userId: 'alice' }),
    imageAuth: async () => ({ enabled: true, mode: 'subscription', connector: { configured: true, online: true } }),
    subscriptionImageRequest: async ctx => { queued.push((await ctx.request.json()).payload); return Response.json({ id: 'queue' }, { status: 202 }); },
  });
  const send = payload => api.onRequestPost({ env: {}, request: new Request('https://nkstudio.org/api/imagen', {
    method: 'POST', body: JSON.stringify({ prompt: 'change the coat to red', storageService: 'ai-image', ...payload }),
  }) });
  assert.equal((await send({ generationStyle: 'single', conversationHistory: history })).status, 202);
  assert.equal(queued[0].conversationHistory.length, 0);
  assert.equal(queued[0].referenceImages.length, 0);
  assert.match(queued[0].prompt, /independent image request/);
  assert.equal((await send({ generationStyle: 'conversation', conversationHistory: history,
    generationMode: 'image-to-image', referenceImages: [{ imageDataUrl: image('source') }], maskDataUrl: image('mask') })).status, 202);
  assert.deepEqual(queued[1].referenceImages.map(item => item.imageDataUrl), [image('source'), image(2), image(3), image(4), image('mask')]);
  assert.equal(queued[1].conversationHistory.length, 3);
  assert.match(queued[1].prompt, /latest user instruction takes priority/i);
  assert.match(queued[1].prompt, /Reference image 2 is previous conversation result 1/);
  assert.match(queued[1].prompt, /last reference is the edit mask/);
  const before = queued.length;
  assert.equal((await send({ generationStyle: 'conversation', conversationHistory: [{ prompt: 'prior', imageDataUrl: 'http://127.0.0.1/image.png' }] })).status, 400);
  assert.equal(queued.length, before);
  assert.equal((await send({ generationStyle: 'single', conversationHistory: [{ prompt: 'prior', imageDataUrl: 'http://127.0.0.1/image.png' }] })).status, 202);
  assert.equal(queued.at(-1).referenceImages.length, 0);
  assert.equal((await send({ generationStyle: 'single', conversationHistory: history,
    generationMode: 'image-to-image', referenceImages: [{ imageDataUrl: image('source') }] })).status, 202);
  assert.deepEqual(queued.at(-1).referenceImages.map(item => item.imageDataUrl), [image('source')]);
  assert.equal(queued.at(-1).conversationHistory.length, 0);
});

test('subscription queue independently strips stray history from single requests', () => {
  const api = evaluate(read('prototype/functions/api/_shared/codex-images.ts'));
  const base = { prompt: 'current', storageService: 'ai-image', conversationHistory: history };
  const single = api.validateImagePayload({ ...base, generationStyle: 'single' });
  assert.equal(single.generationStyle, 'single');
  assert.equal(single.conversationHistory.length, 0);
  const conversation = api.validateImagePayload({ ...base, generationStyle: 'conversation' });
  assert.equal(conversation.generationStyle, 'conversation');
  assert.deepEqual(Array.from(conversation.conversationHistory, item => item.prompt), history.slice(-3).map(item => item.prompt));
});
