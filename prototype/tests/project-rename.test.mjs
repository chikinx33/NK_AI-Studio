// 프로젝트 이름 변경 — 폴더 id 는 그대로 두고, 이름이 저장된 모든 곳(에피소드 seriesTitle·brandTitle·brandRef.title,
// 브랜드 허브, 공유 기록)을 함께 바꾼다. 한 곳만 바뀌면 화면·에이전트·공유받은 사람이 서로 다른 이름을 보게 된다.
// 또 폴더 id 를 베낀 이름('projectsmemoment-ep1')은 이름이 없는 것으로 보고 실제 이름으로 대체한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function createContext(initialDrafts, api) {
  const map = new Map();
  let drafts = JSON.parse(JSON.stringify(initialDrafts || []));
  const context = {
    console, setTimeout, clearTimeout, URLSearchParams,
    window: null,
    localStorage: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(String(k), String(v)),
      removeItem: (k) => map.delete(String(k)),
    },
    document: {},
    NK: {
      config: { KEYS: { SELECTED_DRAFT: 'nk_selected_draft', CURRENT_PROJECT: 'nk_current_project_summary', BRANDS: 'nk_brands_v1', CURRENT_BRAND: 'nk_current_brand' } },
      store: {
        getDrafts: () => JSON.parse(JSON.stringify(drafts)),
        saveDrafts: (next) => { drafts = JSON.parse(JSON.stringify(Array.isArray(next) ? next : [])); },
        getAspectRatio: () => '16:9',
        dump: () => JSON.parse(JSON.stringify(drafts)),
      },
      state: { runtime: { currentProject: null }, set(p) { this.runtime = Object.assign({}, this.runtime, p || {}); } },
      service: {},
      api: api || {},
    },
  };
  context.window = context;
  return vm.createContext(context);
}

function loadProjectService(ctx) {
  const file = path.join(root, 'prototype/js/service/project.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  return ctx.NK.service.project;
}

test('renameSeries: 모든 에피소드의 seriesTitle·brandTitle·brandRef.title 을 바꾸고 폴더 id 는 그대로 둔다', async () => {
  const saved = [];
  const shareCalls = [];
  const api = {
    projectSave: async (id, payload, scenes, opts) => { saved.push({ id, payload, title: opts && opts.title }); return {}; },
    brandGet: async () => null,
    projectShareRename: async (ids, title) => { shareCalls.push({ ids, title }); return { ok: true, updated: 0 }; },
  };
  const ep = (id, title) => ({
    id, title,
    payload: { seriesId: 'projectsmemoment-ep1', seriesTitle: 'projectsmemoment-ep1', brandId: 'projectsmemoment-ep1', brandTitle: 'projectsmemoment-ep1', brandRef: { id: 'projectsmemoment-ep1', title: 'projectsmemoment-ep1' }, episodeTitle: title },
    scenes: [],
  });
  const ctx = createContext([ep('memoment-ep1', 'Memoment'), ep('memoment-ep2', 'Memoment 2'), { id: 'other', title: 'x', payload: { seriesId: 'other', seriesTitle: 'Other' }, scenes: [] }], api);
  const project = loadProjectService(ctx);

  const result = await project.renameSeries('projectsmemoment-ep1', '  Memoment  ');
  assert.equal(result.updatedCount, 2);
  assert.equal(result.failed, 0);

  const drafts = ctx.NK.store.dump();
  for (const d of drafts.filter((row) => row.id.startsWith('memoment'))) {
    assert.equal(d.payload.seriesTitle, 'Memoment');
    assert.equal(d.payload.brandTitle, 'Memoment');
    assert.equal(d.payload.brandRef.title, 'Memoment');
    // 폴더 id 는 그대로(자산 gs:// 경로가 여기에 묶여 있다).
    assert.equal(d.payload.seriesId, 'projectsmemoment-ep1');
    assert.equal(d.payload.brandId, 'projectsmemoment-ep1');
    assert.equal(d.payload.brandRef.id, 'projectsmemoment-ep1');
  }
  assert.equal(drafts.find((d) => d.id === 'other').payload.seriesTitle, 'Other');

  // 서버(data.json)에도 같은 이름으로 저장 — 에이전트 project_list·brand_list 가 여기서 이름을 읽는다.
  assert.deepEqual(saved.map((s) => s.id).sort(), ['memoment-ep1', 'memoment-ep2']);
  for (const s of saved) {
    assert.equal(s.payload.seriesTitle, 'Memoment');
    assert.equal(s.payload.brandRef.title, 'Memoment');
  }
  // 에피소드 이름은 바뀌지 않는다.
  assert.deepEqual(saved.map((s) => s.title).sort(), ['Memoment', 'Memoment 2']);
  // 공유 기록 이름도 같은 에피소드들로 갱신 요청.
  assert.equal(shareCalls.length, 1);
  assert.deepEqual(shareCalls[0].ids.slice().sort(), ['memoment-ep1', 'memoment-ep2']);
  assert.equal(shareCalls[0].title, 'Memoment');
});

test('renameSeries: 빈 이름·없는 프로젝트는 거절한다', async () => {
  const ctx = createContext([{ id: 'a', title: 'A', payload: { seriesId: 's', seriesTitle: 'S' }, scenes: [] }], {});
  const project = loadProjectService(ctx);
  await assert.rejects(() => project.renameSeries('s', '   '), /series_title_required/);
  await assert.rejects(() => project.renameSeries('nope', 'X'), /series_not_found/);
});

test('normalizeDraft: 폴더 id 를 베낀 이름은 실제 이름으로 대체하고, 진짜 이름은 그대로 둔다', () => {
  const ctx = createContext([], {});
  const project = loadProjectService(ctx);
  // seriesId 가 비어 'projects'+id 로 채워지고 이름까지 그 값이 된 경우 → 에피소드 이름으로.
  const leaked = project.normalizeDraft({ id: 'memoment-ep1', title: 'Memoment', payload: { seriesTitle: 'projectsmemoment-ep1' } });
  assert.equal(leaked.seriesId, 'projectsmemoment-ep1');
  assert.equal(leaked.seriesTitle, 'Memoment');
  // 옛 일련번호 이름도 같은 규칙.
  const legacy = project.normalizeDraft({ id: '1771052244218', title: '첫 화', payload: { seriesId: 'projects1771052244218', seriesTitle: 'projects1771052244218', brandTitle: 'Judge Bao' } });
  assert.equal(legacy.seriesTitle, 'Judge Bao');
  // 사용자가 정한 이름은 건드리지 않는다(영문 'projects' 로 시작해도 id 와 다르면 진짜 이름).
  const named = project.normalizeDraft({ id: 'x', title: 'EP1', payload: { seriesId: 'projects-hub', seriesTitle: 'Projects Hub' } });
  assert.equal(named.seriesTitle, 'Projects Hub');
  assert.equal(project.isMachineSeriesTitle('projectsmemoment-ep1', 'projectsmemoment-ep1'), true);
  assert.equal(project.isMachineSeriesTitle('Memoment', 'projectsmemoment-ep1'), false);
});

test('에이전트 프로젝트 요약도 같은 규칙으로 이름을 정한다(화면과 에이전트가 같은 이름을 본다)', () => {
  const src = read('prototype/functions/api/agent/production-projects.ts');
  assert.match(src, /const machineTitle = \(v: string\) => !v \|\| autoId\(v\) \|\| \(v === seriesId && \/\^projects\/i\.test\(v\)\)/);
  assert.match(src, /payload\?\.brandRef\?\.title, payload\.brandTitle, project\?\.title, payload\.episodeTitle\]/);
});

test('설정(edit-series) 화면은 프로젝트 이름을 수정할 수 있고, 한/영 문구가 짝을 이룬다', () => {
  const script = read('prototype/script.js');
  const common = read('prototype/js/ui/common.js');
  const api = read('prototype/api.js');
  assert.match(script, /await NK\.service\.project\.renameSeries\(editingSeriesId, nextSeriesTitle\)/);
  assert.match(script, /if \(overlayPurpose === 'edit-series'\) return;/); // 표시 이름은 한글 허용
  assert.doesNotMatch(script, /프로젝트 유형, 브랜드 요약, 핵심 메시지만 수정할 수 있습니다/);
  for (const ko of [
    '프로젝트 이름, 프로젝트 유형, 브랜드 요약, 핵심 메시지를 수정할 수 있습니다.',
    '프로젝트 이름을 입력해 주세요.',
    '프로젝트 정보를 수정했습니다.',
    '프로젝트 수정 실패: ',
  ]) {
    assert.ok(script.includes(`'${ko}'`), `script.js 에 문구가 있어야 함: ${ko}`);
    assert.ok(common.includes(`'${ko}':`), `common.js 영문 사전에 짝이 있어야 함: ${ko}`);
  }
  assert.match(api, /api\.projectShareRename = async function/);
  assert.match(api, /method: 'PATCH'/);
});

test('공유 기록 이름 변경은 소유자 본인의 해당 프로젝트만, 권한은 그대로 둔다', async () => {
  const esbuild = createRequire(import.meta.url)('../../ai-company-app/node_modules/esbuild');
  const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nk-shares-')), 'out.mjs');
  await esbuild.build({ entryPoints: [path.join(root, 'prototype/functions/api/_shared/shares.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' });
  const { renameSharedSeries } = await import(pathToFileURL(outfile).href);
  const grants = [{ userId: 'friend', role: 'editor', at: 't0' }];
  const reg = {
    version: 1, updatedAt: '',
    shares: [
      { ownerId: 'me', projectId: 'memoment-ep1', title: 'Memoment', seriesId: 'projectsmemoment-ep1', seriesTitle: 'projectsmemoment-ep1', grants: grants.slice(), updatedAt: '' },
      { ownerId: 'me', projectId: 'other', title: 'O', seriesId: 'o', seriesTitle: 'Other', grants: [], updatedAt: '' },
      { ownerId: 'someone', projectId: 'memoment-ep1', title: 'X', seriesId: 'x', seriesTitle: 'Theirs', grants: [], updatedAt: '' },
    ],
  };
  assert.equal(renameSharedSeries(reg, 'me', ['memoment-ep1'], 'Memoment'), 1);
  assert.equal(reg.shares[0].seriesTitle, 'Memoment');
  assert.deepEqual(reg.shares[0].grants, grants);
  assert.equal(reg.shares[1].seriesTitle, 'Other');
  assert.equal(reg.shares[2].seriesTitle, 'Theirs');
  // 같은 이름이면 바뀐 게 없다(저장 생략).
  assert.equal(renameSharedSeries(reg, 'me', ['memoment-ep1'], 'Memoment'), 0);
  assert.equal(renameSharedSeries(reg, 'me', ['memoment-ep1'], '  '), 0);

  const endpoint = read('prototype/functions/api/project/share.ts');
  assert.match(endpoint, /export const onRequestPatch: PagesFunction/);
  assert.match(endpoint, /if \(updated\) await saveShares\(env, reg\);/);
  assert.match(endpoint, /"GET, POST, PATCH, DELETE, OPTIONS"/);
});
