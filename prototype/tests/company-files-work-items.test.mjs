// 2026-10-20 엔케: 직원이 만들어 검수 승인한 이미지(날짜 폴더 위쪽의 업무 카드)를 Promotion 폴더에 넣을 수 없었다.
// 카드는 업무 기록(DB)이고 파일이 아니라서 이동·복사 대상이 아니었다. 카드를 폴더로 끌어 놓거나 직원에게 "넣어줘" 하면
// 산출물이 그 폴더에 실제 파일로 복사되고 카드는 기록으로 남아야 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const esbuild = require('../../ai-company-app/node_modules/esbuild');
const root = path.resolve(import.meta.dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/^﻿/, '');
const compile = name => esbuild.transformSync(read(name).replace(/^import[\s\S]*?from\s+['"][^'"]+['"];[ \t]*$/gm, ''), { loader: 'ts', format: 'cjs' }).code;
function evaluate(name, deps) {
  const module = { exports: {} };
  vm.runInNewContext(compile(name), { ...deps, module, exports: module.exports, console, crypto, Request, Response, URL, URLSearchParams,
    TextEncoder, TextDecoder, ArrayBuffer, Date, Map, Set, JSON, Promise, Error });
  return module.exports;
}

const ALICE_WORK = '11111111-1111-4111-8111-111111111111';
const EMPTY_WORK = '22222222-2222-4222-8222-222222222222';
const FOREIGN_WORK = '33333333-3333-4333-8333-333333333333';

function harness() {
  const objects = new Map([
    ['users/alice/ai-video/projectsai-company/image/1792-codex.png', 'png-bytes'],
    ['users/alice/ai-video/projectsai-company/company-files/.work-files/2026-10-20/Promotion/.raviok-folder', ''],
    ['users/alice/ai-video/projectsai-company/company-files/.work-files/2026-10-20/Promotion/A lone hooded figure.png', 'old'],
    ['users/bob/ai-video/projectsai-company/image/secret.png', 'bob-bytes'],
  ]);
  const works = [
    { id: ALICE_WORK, title: 'A lone hooded figure', metadata: { objectName: 'users/alice/ai-video/projectsai-company/image/1792-codex.png' }, date_key: '2026-10-20' },
    { id: EMPTY_WORK, title: '회의 메모', metadata: {}, date_key: '2026-10-20' },
    { id: FOREIGN_WORK, title: '남의 그림', metadata: { objectName: 'users/bob/ai-video/projectsai-company/image/secret.png' }, date_key: '2026-10-20' },
  ];
  const updates = [];
  const sql = async (query, params = []) => {
    if (/FROM company_work_items WHERE user_id = \$1 AND id = ANY/.test(query)) return works.filter(w => params[1].includes(w.id));
    if (/^\s*UPDATE company_work_items item\s+SET metadata = /.test(query)) {
      updates.push(params);
      for (const placement of JSON.parse(params[1])) Object.assign(works.find(w => w.id === placement.id).metadata, { movedTo: placement.movedTo, movedFiles: placement.movedFiles });
      return [];
    }
    throw new Error('Unexpected SQL: ' + query);
  };
  const decode = value => decodeURIComponent(value);
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const rewrite = u.pathname.match(/\/o\/([^/]+)\/rewriteTo\/b\/[^/]+\/o\/([^/]+)$/);
    if (rewrite) {
      const [source, target] = [decode(rewrite[1]), decode(rewrite[2])];
      if (!objects.has(source)) return Response.json({ error: { message: 'No such object' } }, { status: 404 });
      objects.set(target, objects.get(source));
      return Response.json({ done: true });
    }
    if (u.pathname.startsWith('/upload/')) { objects.set(u.searchParams.get('name'), ''); return Response.json({}); }
    const single = u.pathname.match(/\/o\/([^/]+)$/);
    if (single) return objects.has(decode(single[1])) ? Response.json({ name: decode(single[1]) }) : Response.json({}, { status: 404 });
    const prefix = u.searchParams.get('prefix') || '';
    const delimiter = u.searchParams.get('delimiter');
    const items = [], prefixes = new Set();
    for (const name of objects.keys()) {
      if (!name.startsWith(prefix)) continue;
      const rest = name.slice(prefix.length);
      if (delimiter && rest.includes('/')) prefixes.add(prefix + rest.split('/')[0] + '/');
      else items.push({ name });
    }
    return Response.json({ items, prefixes: [...prefixes] });
  };
  const storage = evaluate('prototype/functions/api/_shared/storage.ts', {});
  const api = evaluate('prototype/functions/api/agent/company-files.ts', {
    ...storage, fetch,
    authorizeRequest: async () => ({ ok: true, userId: 'alice' }),
    resolveGcsEnv: () => ({ bucket: 'b', basePrefix: '', clientEmail: 'c', privateKeyRaw: 'k' }),
    getGoogleAccessToken: async () => 'token', getSql: () => sql, ensureAgentSchema: async () => {},
    DOCUMENT_EXTENSIONS: [], extractDocumentText: async () => '', DOCUMENT_TYPE: 'application/x-nk-doc', DOCUMENT_SUFFIX: '.nkdoc',
    DocumentError: class extends Error {}, isCompanyDocument: () => false, parseCompanyDocument: () => ({}),
    updateCompanyDocument: () => ({}), documentSummary: () => ({}),
  });
  const post = async body => {
    const response = await api.onRequestPost({ env: {}, request: new Request('https://nkstudio.org/api/agent/company-files', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  return { api, post, objects, works, updates };
}

const promotion = 'users/alice/ai-video/projectsai-company/company-files/.work-files/2026-10-20/Promotion/';

test('업무 카드를 폴더에 넣으면 생성 이미지가 실제 파일로 복사되고, 같은 이름은 번호를 붙인다', async () => {
  const h = harness();
  const { status, data } = await h.post({ action: 'save_work_items', items: [`@work/2026-10-20/${ALICE_WORK}`], folder: '.work-files/2026-10-20/Promotion' });
  assert.equal(status, 200, JSON.stringify(data));
  assert.equal(data.count, 1);
  assert.equal(data.savedFiles[0].name, 'A lone hooded figure (2).png');
  assert.equal(h.objects.get(`${promotion}A lone hooded figure (2).png`), 'png-bytes');
  assert.equal(h.objects.get(`${promotion}A lone hooded figure.png`), 'old', '기존 파일은 덮어쓰지 않는다');
});

test('직원 도구가 쓰는 workId=… 참조·날짜 폴더 경로(@work/날짜/폴더)도 같은 곳에 넣는다', async () => {
  const h = harness();
  const { status, data } = await h.post({ action: 'save_work_items', items: [`workId=${ALICE_WORK}`], folder: '@work/2026-10-20/Promotion' });
  assert.equal(status, 200, JSON.stringify(data));
  assert.equal(data.savedFiles[0].path, '.work-files/2026-10-20/Promotion/A lone hooded figure (2).png');
});

test('copy 도구에 업무 카드를 주면 산출물을 파일로 복사하고 카드는 그대로, move 면 카드를 위쪽 목록에서 뺀다', async () => {
  const h = harness();
  const copied = await h.post({ action: 'copy', source: `@work/2026-10-20/${ALICE_WORK}`, destination: 'Elidus/Promotion' });
  assert.equal(copied.status, 200, JSON.stringify(copied.data));
  assert.equal(h.objects.get('users/alice/ai-video/projectsai-company/company-files/Elidus/Promotion/A lone hooded figure.png'), 'png-bytes');
  assert.equal(h.updates.length, 0, '복사는 카드를 건드리지 않는다');
  const moved = await h.post({ action: 'move', source: `@work/2026-10-20/${ALICE_WORK}`, destination: 'Elidus/Promotion' });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.deepEqual(moved.data.movedWorkIds, [ALICE_WORK]);
  assert.equal(h.works[0].metadata.movedTo, 'Elidus/Promotion');
});

test('파일이 없는 업무·다른 계정 저장소의 파일은 복사하지 않는다', async () => {
  const h = harness();
  const empty = await h.post({ action: 'save_work_items', items: [EMPTY_WORK], folder: 'Promotion' });
  assert.equal(empty.status, 500);
  assert.match(empty.data.error, /저장할 파일이 없는 업무/);
  const foreign = await h.post({ action: 'save_work_items', items: [FOREIGN_WORK], folder: 'Promotion' });
  assert.equal(foreign.status, 500);
  assert.ok(![...h.objects.keys()].some(name => name.startsWith('users/alice/') && h.objects.get(name) === 'bob-bytes'));
  const mixed = await h.post({ action: 'save_work_items', items: [ALICE_WORK, EMPTY_WORK], folder: 'Promotion' });
  assert.equal(mixed.status, 200);
  assert.equal(mixed.data.count, 1);
  assert.equal(mixed.data.skipped[0].workId, EMPTY_WORK);
  assert.equal(h.updates.length, 0, '저장(복사)은 카드를 위쪽 목록에 그대로 둔다');
});

// 2026-10-22 엔케: 위쪽 이미지 카드를 아래 Promotion 폴더로 끌어 놓았더니 복사본만 생기고 위쪽에도 그대로 남았다.
// 끌어 놓기는 이동이어야 한다 — 놓은 폴더에 파일이 생기고 위쪽 카드 목록에서는 사라진다.
test('끌어 놓기(mode: move)는 산출물을 폴더로 옮기고 카드에 movedTo 를 남겨 위쪽 목록에서 뺀다', async () => {
  const h = harness();
  const { status, data } = await h.post({ action: 'save_work_items', mode: 'move', items: [`@work/2026-10-20/${ALICE_WORK}`], folder: '.work-files/2026-10-20/Promotion' });
  assert.equal(status, 200, JSON.stringify(data));
  assert.equal(data.mode, 'move');
  assert.deepEqual(data.movedWorkIds, [ALICE_WORK]);
  assert.equal(h.objects.get(`${promotion}A lone hooded figure (2).png`), 'png-bytes', '놓은 폴더에 파일이 생긴다');
  assert.equal(h.objects.get(`${promotion}A lone hooded figure.png`), 'old', '같은 이름은 덮어쓰지 않고 번호를 붙인다');
  assert.equal(h.updates.length, 1, '카드 표시 변경은 쿼리 한 번');
  assert.equal(h.works[0].metadata.movedTo, '.work-files/2026-10-20/Promotion');
  assert.deepEqual(h.works[0].metadata.movedFiles, ['.work-files/2026-10-20/Promotion/A lone hooded figure (2).png']);
  assert.ok(h.objects.has('users/alice/ai-video/projectsai-company/image/1792-codex.png'), '채팅·검수 기록이 가리키는 생성 원본은 지우지 않는다');
});

test('카드가 있는 날짜 폴더 자리에 그대로 놓으면 아무것도 하지 않는다', async () => {
  const h = harness();
  const before = h.objects.size;
  const { status, data } = await h.post({ action: 'save_work_items', mode: 'move', items: [`@work/2026-10-20/${ALICE_WORK}`], folder: '.work-files/2026-10-20' });
  assert.equal(status, 200, JSON.stringify(data));
  assert.equal(data.count, 0);
  assert.deepEqual(data.unchanged, [ALICE_WORK]);
  assert.deepEqual(data.movedWorkIds, []);
  assert.equal(h.objects.size, before, '파일을 만들지 않는다');
  assert.equal(h.updates.length, 0);
});

test('못 옮긴 산출물이 있는 카드는 위쪽에 남긴다', async () => {
  const h = harness();
  h.objects.delete('users/alice/ai-video/projectsai-company/image/1792-codex.png');
  h.works[0].metadata.paths = ['Docs/brief.txt'];
  h.objects.set('users/alice/ai-video/projectsai-company/company-files/Docs/brief.txt', 'brief');
  const { status, data } = await h.post({ action: 'save_work_items', mode: 'move', items: [ALICE_WORK], folder: 'Promotion' });
  assert.equal(status, 200, JSON.stringify(data));
  assert.equal(data.count, 1);
  assert.equal(data.skipped[0].workId, ALICE_WORK);
  assert.deepEqual(data.movedWorkIds, []);
  assert.equal(h.updates.length, 0);
});

test('날짜 폴더의 업무 수는 옮긴 카드를 세지 않고, 카드를 다 옮겨도 날짜 폴더는 남는다', () => {
  const server = read('prototype/functions/api/agent/company-files.ts');
  assert.match(server, /COALESCE\(metadata \? 'movedTo', false\) AS moved/);
  assert.match(server, /\(COUNT\(\*\) FILTER \(WHERE NOT item\.moved\)\)::int AS item_count/);
  const work = read('ai-company-app/src/components/WorkExplorer.tsx');
  assert.match(work, /export function isMovedWork\(work: CompanyWorkItem\) \{\s+return typeof work\.metadata\?\.movedTo === "string";/);
  assert.match(work, /koreaDate\(item\.created_at\) === date && !isMovedWork\(item\)/, '위쪽 카드 목록에서 뺀다');
  assert.match(work, /const works = allWorks\.filter\(\(work\) => !isMovedWork\(work\)\);/, '업무 수에서만 빼고 날짜 폴더는 남긴다');
  assert.match(work, /onWorkItemsMoved=\{markWorkMoved\}/);
  assert.match(work, /function markWorkMoved\(workIds: string\[\], folder: string\) \{\s+setItems\(/, '전체 새로고침 없이 바로 뺀다');
});

test('직원은 company_files_save_media 의 files 에 업무 카드를 넣어 폴더에 저장한다', () => {
  const shared = read('prototype/functions/api/agent/_shared.ts');
  const tool = shared.slice(shared.indexOf('async function runCompanyFilesSaveMediaTool'), shared.indexOf('async function runContentRegisterTool'));
  assert.match(tool, /const workRefs = sources\.filter\(\(value\) => WORK_CARD_REF\.test\(value\)\);/);
  assert.match(tool, /action: "save_work_items", items: workRefs, folder/);
  assert.match(tool, /resolveContentSource\(fileSources\[i\], ctx\)/);
  const ref = new RegExp(shared.match(/const WORK_CARD_REF = \/(.+)\/i;/)[1], 'i');
  for (const value of [`@work/2026-10-20/${ALICE_WORK}`, `workId=${ALICE_WORK}`, ALICE_WORK]) assert.ok(ref.test(value), value);
  for (const value of ['attachment:1', 'Promotion/a.png', '@work/2026-10-20']) assert.ok(!ref.test(value), value);
  assert.match(read('prototype/functions/api/agent/_orchestrator.ts'), /"업무 기록이라 못 옮긴다"고 답하지 말고 이 도구로 바로 넣을 것/);
});

test('날짜 폴더 위쪽 업무 카드를 아래 폴더·목록으로 끌어 놓을 수 있다', () => {
  const work = read('ai-company-app/src/components/WorkExplorer.tsx');
  const explorer = read('ai-company-app/src/components/CompanyFileExplorer.tsx');
  assert.match(work, /draggable\s+onDragStart=\{\(event\) => \{ event\.dataTransfer\.setData\(WORK_DRAG_TYPE, JSON\.stringify\(\[`@work\/\$\{date\}\/\$\{work\.id\}`\]\)\); event\.dataTransfer\.effectAllowed = "move"; \}\}/);
  assert.match(explorer, /export const WORK_DRAG_TYPE = "application\/x-nk-work-items";/);
  assert.match(explorer, /const toMove = workRefsOutsideFolder\(works, destinationFolder\);\s+if \(!toMove\.length\) return;/, '제자리에 놓으면 아무것도 하지 않는다');
  assert.match(explorer, /const result = await saveWorkItemsToFolder\(toMove, destinationFolder, "move"\);/);
  assert.match(explorer, /if \(result\.movedWorkIds\.length\) onWorkItemsMoved\?\.\(result\.movedWorkIds, destinationFolder\);/);
  const workDropEffects = [...explorer.matchAll(/types\.includes\(WORK_DRAG_TYPE\)\) \{[^}]*?dropEffect = "(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(workDropEffects, ['move', 'move'], '업무 카드 끌기는 폴더 카드·목록 빈 곳 모두 이동 표시');
  assert.match(read('ai-company-app/src/lib/api.ts'), /body: JSON\.stringify\(\{ action: "save_work_items", items, folder, mode \}\)/);
  assert.match(explorer, /void saveWorkInto\(\{ path, kind: "folder" \}, works\.map\(String\)\)/, '목록 빈 곳에 놓으면 지금 폴더에');
  assert.match(explorer, /event\.stopPropagation\(\);\s+let works/, '폴더 카드에 놓으면 바깥 목록이 한 번 더 받지 않는다');
});

test('업무 카드 이동 문구는 한/영 짝이고 언어 전환을 따른다', () => {
  const explorer = read('ai-company-app/src/components/CompanyFileExplorer.tsx');
  const block = explorer.slice(explorer.indexOf('const WORK_MOVE_TEXT = {'), explorer.indexOf('function currentLang'));
  const keys = lang => [...block.slice(block.indexOf(`${lang}: {`)).split('},')[0].matchAll(/^\s+(\w+): "/gm)].map(m => m[1]).sort();
  assert.deepEqual(keys('ko'), ['dropHint', 'failed', 'moving']);
  assert.deepEqual(keys('en'), keys('ko'));
  assert.match(explorer, /window\.addEventListener\("nk:lang-changed", onChanged\);/);
  assert.match(explorer, /\{workDragOver \? workMoveText\.dropHint : "여기에 놓으면 이 폴더에 업로드돼요"\}/);
});

test('제자리 판정: 카드가 있는 날짜 폴더 맨 위만 제자리이고, 그 안 폴더·다른 날짜·일반 폴더는 옮긴다', () => {
  const explorer = read('ai-company-app/src/components/CompanyFileExplorer.tsx');
  const fnStart = explorer.indexOf('export function workRefsOutsideFolder');
  const fn = explorer.slice(fnStart, explorer.indexOf('\n}\n', fnStart) + 3);
  const helper = explorer.slice(explorer.indexOf('export function workFilesPath'), explorer.indexOf('function joinPath'));
  const m = { exports: {} };
  vm.runInNewContext(esbuild.transformSync(`${helper}\n${fn}`, { loader: 'ts', format: 'cjs' }).code, { module: m, exports: m.exports });
  const { workRefsOutsideFolder } = m.exports;
  const ref = `@work/2026-10-20/${ALICE_WORK}`;
  assert.deepEqual(workRefsOutsideFolder([ref], '.work-files/2026-10-20'), []);
  assert.deepEqual(workRefsOutsideFolder([ref], '.work-files/2026-10-20/Promotion'), [ref]);
  assert.deepEqual(workRefsOutsideFolder([ref], '.work-files/2026-10-21'), [ref]);
  assert.deepEqual(workRefsOutsideFolder([ref], 'Elidus/Promotion'), [ref]);
});
