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
  const sql = async (query, params = []) => {
    if (/FROM company_work_items WHERE user_id = \$1 AND id = ANY/.test(query)) return works.filter(w => params[1].includes(w.id));
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
  return { api, post, objects };
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

test('copy·move 도구에 업무 카드를 주면 카드를 옮기지 않고 산출물을 그 폴더에 파일로 복사한다', async () => {
  const h = harness();
  const { status, data } = await h.post({ action: 'move', source: `@work/2026-10-20/${ALICE_WORK}`, destination: 'Elidus/Promotion' });
  assert.equal(status, 200, JSON.stringify(data));
  assert.equal(h.objects.get('users/alice/ai-video/projectsai-company/company-files/Elidus/Promotion/A lone hooded figure.png'), 'png-bytes');
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
  assert.match(work, /draggable\s+onDragStart=\{\(event\) => \{ event\.dataTransfer\.setData\(WORK_DRAG_TYPE, JSON\.stringify\(\[`@work\/\$\{date\}\/\$\{work\.id\}`\]\)\)/);
  assert.match(explorer, /export const WORK_DRAG_TYPE = "application\/x-nk-work-items";/);
  assert.match(explorer, /const result = await saveWorkItemsToFolder\(works, destinationFolder\);/);
  assert.match(explorer, /void saveWorkInto\(\{ path, kind: "folder" \}, works\.map\(String\)\)/, '목록 빈 곳에 놓으면 지금 폴더에');
  assert.match(explorer, /event\.stopPropagation\(\);\s+let works/, '폴더 카드에 놓으면 바깥 목록이 한 번 더 받지 않는다');
});
