import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const esbuild = require('../../ai-company-app/node_modules/esbuild');
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const plain = (value) => JSON.parse(JSON.stringify(value));
const inline = 'data:image/png;base64,aGVsbG8=';
const sheets = (count) => Array.from({ length: count }, (_, i) => ({
  characterId: `c${i}`, token: `@인물${i}`, displayName: `인물${i}`,
  items: [{ sheetId: `s${i}`, imageDataUrl: inline, isPrimary: true }]
}));

// 실제 Pages 핸들러를 실행하고 외부 인증·GCS만 대체한다.
function serverHarness({ failUpload = false, previous = null } = {}) {
  const metrics = { active: 0, peak: 0, uploads: 0, manifests: [], deletes: 0 };
  const source = read('prototype/functions/api/brand/save.ts').replace(/^import .*;\n/gm, '');
  const sandbox = {
    module: { exports: {} }, Request, Response, URL, URLSearchParams, TextEncoder, Uint8Array, atob, btoa,
    authorizeRequest: async () => ({ ok: true, userId: 'u1' }),
    buildAiVideoBrandPrefix: () => 'root/users/u1/brands/b1',
    crypto: { subtle: { importKey: async () => ({}), sign: async () => new ArrayBuffer(4) } },
    fetch: async (input, opts = {}) => {
      const url = new URL(input);
      if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test' });
      if (opts.method === 'DELETE') {
        assert.ok(metrics.manifests.length, 'Delete only after the new record is saved');
        metrics.deletes++;
        return new Response(null, { status: 204 });
      }
      if (opts.method !== 'POST') return previous ? Response.json({ brand: previous }) : new Response('', { status: 404 });
      if (url.searchParams.get('name').endsWith('/reference/data.json')) {
        metrics.manifests.push(JSON.parse(opts.body));
        return Response.json({});
      }
      metrics.uploads++;
      metrics.active++;
      metrics.peak = Math.max(metrics.peak, metrics.active);
      await new Promise(setImmediate);
      metrics.active--;
      return new Response(failUpload ? 'upload_failed' : '{}', { status: failUpload ? 503 : 200 });
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(esbuild.transformSync(source, { loader: 'ts', format: 'cjs' }).code, sandbox);
  return {
    metrics,
    save: async (brand) => sandbox.module.exports.onRequestPost({
      request: new Request('https://example.test/api/brand/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId: 'b1', brand })
      }),
      env: { GOOGLE_CLIENT_EMAIL: 'test', GOOGLE_PRIVATE_KEY: 'AAAA', VIDEO_OUTPUT_GCS_URI: 'gs://bucket/root' }
    })
  };
}

test('IP save: 12 character sheets upload with bounded concurrency; repeat save uploads none', async () => {
  const { save, metrics } = serverHarness();
  const response = await save({ characterSheets: sheets(12) });
  assert.equal(response.status, 200);
  const saved = (await response.json()).brand;
  assert.equal(metrics.uploads, 12);
  assert.equal(metrics.peak, 4);
  assert.deepEqual(saved.characterSheets.map((c) => c.token), sheets(12).map((c) => c.token));
  assert.ok(saved.characterSheets.every((c) => c.items[0].isPrimary && c.items[0].imageDataUrl.startsWith('gs://bucket/')));
  assert.deepEqual(saved.knowledgeCharacterSheets, saved.characterSheets);
  assert.equal((await save(saved)).status, 200);
  assert.equal(metrics.uploads, 12, 'Already stored sheets must not be uploaded again');
  assert.equal(metrics.manifests.length, 2);
});

test('IP save: failed image upload preserves the previous manifest and files', async () => {
  const { save, metrics } = serverHarness({ failUpload: true });
  const response = await save({ characterSheets: sheets(12) });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /upload_failed/);
  assert.equal(metrics.manifests.length, 0);
  assert.equal(metrics.deletes, 0);
});

test('IP save: replacement removes stale sheets only after storing all new paths', async () => {
  const previous = { characterSheets: sheets(8).map((c, i) => ({ ...c, items: [{ sheetId: `old${i}`, imageDataUrl: `gs://bucket/root/users/u1/brands/b1/ip/old${i}.png` }] })) };
  const { save, metrics } = serverHarness({ previous });
  const response = await save({ characterSheets: sheets(8), environmentAssets: [{ displayName: '진료실', description: '밝은 진료실', items: [{ sheetId: 'room', imageDataUrl: inline }] }] });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(metrics.deletes, 8);
  assert.equal(data.cleanup.failedCount, 0);
  assert.equal(data.brand.environmentAssets[0].description, '밝은 진료실');
  assert.match(data.brand.environmentAssets[0].items[0].imageDataUrl, /\/env\//);
});

function innerFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, signature);
  const end = source.indexOf('\n    }\n', start);
  assert.ok(end > start);
  return source.slice(start, end + '\n    }\n'.length);
}

// 실제 버튼 핸들러와 내부 저장 함수를 같은 스코프에서 실행한다.
function uiHarness({ failSave = false } = {}) {
  const hub = read('prototype/js/ui/knowledge-hub.js');
  const start = hub.indexOf("if (action === 'character-manager-save') {");
  const end = hub.indexOf('\n        }\n      };', start);
  const handler = hub.slice(start + "if (action === 'character-manager-save') {".length, end)
    .replace('Promise.resolve()', 'return Promise.resolve()');
  const calls = { saves: [], projects: [], alerts: [] };
  const sandbox = { console, URL, Date, Promise, Map, Set, JSON };
  sandbox.window = sandbox;
  sandbox.NK = { config: {}, service: {
    brand: { persistShared: async (id, patch) => {
      calls.saves.push(plain(patch));
      if (failSave) throw new Error('upload_failed');
      return { ...plain(patch), brandId: id, characterSheets: patch.characterSheets.map((c) => ({ ...c, items: c.items.map((s) => ({ ...s, imageDataUrl: `gs://bucket/${s.sheetId}.png` })) })) };
    } },
    project: {
      updatePayload: async (id, patch) => { calls.projects.push(plain(patch)); return { ok: true, draft: { id, payload: patch } }; },
      getKnowledgeHub: (project) => project.payload.knowledgeHub
    }
  } };
  sandbox.alert = (message) => calls.alerts.push(message);
  const injected = `knowledgeHub.testSave = function () {
    var brandId = 'b1', projectId = 'p1', project = { id: 'p1' }, brand = { brandId: 'b1' };
    var root = { querySelector: function () { return null; } };
    var currentCharacters = [{ characterId: 'c0', token: '@인물0', displayName: '인물0' }];
    var characters = [], characterExtras = '', modalSaveInFlight = false;
    var modalBrandCharsDraft = [{ trigger: '@인물0', description: '새 설명' }];
    var modalCharacterSheetDraft = ${JSON.stringify(sheets(1))};
    var characterSheetDraft = [], environmentAssetDraft = [], modalEnvDraft = null;
    var knowledge = { referenceItems: [] }, ipLibraryUiText = { saveFail: '저장 실패: ' };
    function renderCharacterManagerModal() {} function syncCharacterUi() {}
    ${innerFunction(hub, 'function syncBrandAndProject(')}
    ${innerFunction(hub, 'function cloneCharacterSheetDraft(')}
    ${innerFunction(hub, 'function applySavedBrandCharacters(')}
    return { save: function () { ${handler} }, snapshot: function () { return { modalCharacterSheetDraft, characters, modalSaveInFlight }; } };
  };
  knowledgeHub.init = function () {`;
  vm.createContext(sandbox);
  vm.runInContext(hub.replace('knowledgeHub.init = function () {', injected), sandbox);
  return { calls, ui: sandbox.NK.ui.knowledgeHub.testSave() };
}

test('IP save button: one brand save includes text and sheets; project and modal retain GCS paths', async () => {
  const { ui, calls } = uiHarness();
  await ui.save();
  assert.equal(calls.saves.length, 1);
  assert.equal(calls.saves[0].brandCharacters[0].description, '새 설명');
  assert.equal(calls.saves[0].characterSheets[0].items[0].imageDataUrl, inline);
  assert.equal(calls.projects[0].characterSheets[0].items[0].imageDataUrl, 'gs://bucket/s0.png');
  assert.equal(ui.snapshot().modalCharacterSheetDraft[0].items[0].imageDataUrl, 'gs://bucket/s0.png');
  assert.equal(ui.snapshot().characters[0].description, '새 설명');
  assert.equal(ui.snapshot().modalSaveInFlight, false);
  await ui.save();
  assert.equal(calls.saves.length, 2);
  assert.equal(calls.saves[1].characterSheets[0].items[0].imageDataUrl, 'gs://bucket/s0.png');
  assert.deepEqual(calls.alerts, []);
});

test('IP save button: failed storage keeps the unsaved image and text draft for retry', async () => {
  const { ui, calls } = uiHarness({ failSave: true });
  await ui.save();
  assert.equal(calls.projects.length, 0);
  assert.equal(ui.snapshot().modalCharacterSheetDraft[0].items[0].imageDataUrl, inline);
  assert.equal(ui.snapshot().modalSaveInFlight, false);
  assert.match(calls.alerts[0], /upload_failed/);
});

test('brand API: duplicate compatibility fields are omitted without mutating the caller', async () => {
  let sent;
  const sandbox = {
    console, URL, URLSearchParams, AbortController, clearTimeout,
    setTimeout: (fn, ms) => setTimeout(fn, ms).unref(),
    localStorage: { getItem: () => null },
    fetch: async (_url, opts) => { sent = JSON.parse(opts.body); return Response.json({ ok: true }); }
  };
  sandbox.window = sandbox;
  sandbox.NK = { config: {} };
  vm.createContext(sandbox);
  vm.runInContext(read('prototype/api.js'), sandbox);
  const brand = { characterSheets: sheets(8), knowledgeCharacterSheets: sheets(8), environmentAssets: [], knowledgeEnvironmentAssets: [] };
  await sandbox.NK.api.brandSave('b1', brand);
  assert.equal(sent.brand.characterSheets.length, 8);
  assert.equal(sent.brand.knowledgeCharacterSheets, undefined);
  assert.equal(sent.brand.knowledgeEnvironmentAssets, undefined);
  assert.equal(brand.knowledgeCharacterSheets.length, 8);
});
