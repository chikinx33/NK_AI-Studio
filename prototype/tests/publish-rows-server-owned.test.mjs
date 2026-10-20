import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

// 2026-10-20 NEKOBAN EP01: 에이전트가 서버 기록에 인스타 줄을 덧붙이고 TikTok 을 sent_to_inbox 로 바꾼 뒤,
// 열려 있던 SNS 세팅 화면이 옛 7줄 목록을 payload 째 저장해 인스타 줄이 사라지고 TikTok 이 processing 으로 돌아갔다.
// 배포 이력은 서버 목록이 기준 — 저장은 화면이 보낸 목록을 버리고 화면이 '바꾼 줄'만 적용한다.
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const esbuild = createRequire(import.meta.url)('../../ai-company-app/node_modules/esbuild');
function evaluate(source) {
  const module = { exports: {} };
  const code = esbuild.transformSync(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];[ \t]*$/gm, ''), { loader: 'ts', format: 'cjs' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, console });
  return module.exports;
}
const rows = evaluate(read('prototype/functions/api/_shared/publish-rows.ts'));
const records = evaluate(read('prototype/functions/api/_shared/publish-records.ts'));

function loadApi(fetchImpl) {
  const window = { NK: { config: { KEYS: {} } }, location: { hostname: 'nkstudio.org', protocol: 'https:' } };
  const storage = new Map([['nk_auth_token', 'tok'], ['nk_login_user', 'alice']]);
  const context = { window, NK: window.NK, localStorage: { getItem: k => storage.get(k) || null, removeItem() {} }, URL, AbortController,
    // 저장 요청의 시간 제한 타이머가 테스트 프로세스를 붙잡지 않게 unref 한다.
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; }, clearTimeout, console: { log() {}, warn() {}, error() {} }, fetch: fetchImpl || (async () => new Response('{}')) };
  vm.runInNewContext(read('prototype/api.js'), context);
  return window.NK.api;
}
const plain = v => JSON.parse(JSON.stringify(v));

const row = (id, channelType, status = 'published', extra = {}) => ({ id, channelType, status, remotePostId: '', caption: 'c', metrics: { views: 0 }, ...extra });
const OLD_SEVEN = ['youtube', 'x', 'facebook', 'threads', 'discord', 'naver_blog'].map((c, i) => row(`${c}_${i}`, c))
  .concat([row('tiktok_p1', 'tiktok', 'processing', { remotePostId: 'p1' })]);

// 서버(에이전트)가 그사이 남긴 기록: 인스타 줄 덧붙이기 + TikTok 상태 확인.
function serverAfterAgent() {
  let list = records.mergePublishRows(plain(OLD_SEVEN), [row('instagram_ig9', 'instagram', 'published', { remotePostId: 'ig9', sourceScope: 'agent' })]);
  list = list.map(r => (r.id === 'tiktok_p1' ? { ...r, status: 'sent_to_inbox' } : r));
  return list;
}

test('옛 목록을 payload 째 보내도(바꾼 줄 없음) 서버가 덧붙인 줄·상태가 남는다', () => {
  const existing = { brandStudioPublishResults: serverAfterAgent(), publishResults: serverAfterAgent(), brandStudioDeployingSteps: { 'job:1': { format: 'instagram' } } };
  const incoming = { title: '수정', brandStudioPublishResults: plain(OLD_SEVEN), publishResults: plain(OLD_SEVEN), brandStudioDeployingSteps: {} };
  const merged = Object.assign({}, existing, incoming); // save.ts 의 얕은 합치기
  rows.protectPayloadPublishRows(existing, merged, incoming, rows.readPublishRowOps(undefined));
  rows.keepServerOwnedPayloadKeys(existing, merged);
  assert.equal(merged.brandStudioPublishResults.length, 8);
  assert.ok(merged.brandStudioPublishResults.some(r => r.id === 'instagram_ig9'));
  assert.equal(merged.brandStudioPublishResults.find(r => r.id === 'tiktok_p1').status, 'sent_to_inbox');
  assert.deepEqual(merged.publishResults, merged.brandStudioPublishResults);
  assert.deepEqual(plain(merged.brandStudioDeployingSteps), { 'job:1': { format: 'instagram' } });
  assert.equal(merged.title, '수정');
});

test('옛 목록에서 고친 줄만 서버 목록에 적용된다(덧붙이기·칸 수정·지우기)', () => {
  const api = loadApi();
  const stale = plain(OLD_SEVEN);
  // 화면: 직접 올리기 완료(새 줄) + 유튜브 조회수 갱신 + 디스코드 줄 지우기
  const edited = [row('manual_ep_kakao', 'kakao', 'published', { delivery: 'manual' })].concat(
    stale.filter(r => r.channelType !== 'discord').map(r => (r.channelType === 'youtube' ? { ...r, metrics: { views: 42 } } : r)));
  const ops = plain(api.publishRowOps(stale, edited));
  assert.deepEqual(ops.remove, ['discord_4']);
  assert.equal(ops.upsert.length, 2);
  // 바뀌지 않은 칸(status 등)은 싣지 않는다 — 서버가 바꾼 TikTok 상태를 되돌리지 않게.
  assert.deepEqual(Object.keys(ops.upsert.find(u => u.id === 'youtube_0')).sort(), ['channelType', 'id', 'metrics']);
  assert.ok(!ops.upsert.some(u => u.id === 'tiktok_p1'));

  const result = rows.applyPublishRowOps(serverAfterAgent(), rows.readPublishRowOps(ops));
  assert.equal(result.length, 8); // 8 + 카카오 - 디스코드
  assert.ok(result.some(r => r.id === 'instagram_ig9'));
  assert.ok(!result.some(r => r.id === 'discord_4'));
  assert.equal(result.find(r => r.id === 'tiktok_p1').status, 'sent_to_inbox');
  assert.equal(result.find(r => r.id === 'youtube_0').metrics.views, 42);
  assert.equal(result[0].id, 'manual_ep_kakao');
});

test('id 가 달라도 채널+게시 id 가 같으면 같은 줄로 고친다', () => {
  const list = rows.applyPublishRowOps([row('instagram_ig9', 'instagram', 'published', { remotePostId: 'ig9', sourceScope: 'agent' })],
    { upsert: [{ id: 'other_ig9', channelType: 'instagram', remotePostId: 'ig9', remoteUrl: 'https://i/9' }] });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'instagram_ig9');
  assert.equal(list[0].remoteUrl, 'https://i/9');
  assert.equal(list[0].sourceScope, 'agent');
});

test('서버에 목록이 없을 때만 화면이 보낸 목록을 처음 값으로 받는다(브랜드 기록 포함)', () => {
  assert.deepEqual(plain(rows.resolvePublishRows(undefined, OLD_SEVEN, null)), plain(OLD_SEVEN));
  assert.equal(rows.resolvePublishRows(undefined, undefined, null), undefined);
  // 브랜드 기록: 서버 목록이 있으면 화면 목록은 버린다
  assert.equal(rows.resolvePublishRows(serverAfterAgent(), OLD_SEVEN, null).length, 8);
});

test('화면 저장 요청이 바꾼 줄(publishRowOps)을 함께 보낸다', async () => {
  const bodies = [];
  const api = loadApi(async (url, opts) => { bodies.push({ url: String(url), body: JSON.parse(opts.body) }); return new Response(JSON.stringify({ ok: true, publishResults: [] }), { status: 200 }); });
  await api.projectSave('ep1', { a: 1 }, [], { publishRowOps: { upsert: [{ id: 'x' }], remove: [] } });
  await api.brandSave('b1', { brandId: 'b1' }, { publishRowOps: { upsert: [], remove: ['y'] } });
  assert.deepEqual(bodies[0].body.publishRowOps, { upsert: [{ id: 'x' }], remove: [] });
  assert.deepEqual(bodies[1].body.publishRowOps, { upsert: [], remove: ['y'] });
  assert.equal(api.publishRowOps(OLD_SEVEN, plain(OLD_SEVEN)), null);
});

test('저장 경로가 서버 목록 기준 규칙을 쓴다(에피소드·브랜드·화면 서비스)', () => {
  const save = read('prototype/functions/api/project/save.ts');
  assert.match(save, /savedPublishRows = protectPayloadPublishRows\(existing\?\.payload, mergedPayload, hasPayload \? body\.payload : null, publishRowOps\)/);
  assert.match(save, /keepServerOwnedPayloadKeys\(existing\?\.payload, mergedPayload\)/);
  const brandSave = read('prototype/functions/api/brand/save.ts');
  assert.match(brandSave, /resolvePublishRows\(persisted\.brand\?\.brandStudioPublishResults, incomingPublishRows, publishRowOps\)/);
  assert.match(brandSave, /ifGenerationMatch=/);
  assert.match(brandSave, /res\.status === 412 && attempt < 3/);
  const project = read('prototype/js/service/project.js');
  assert.match(project, /var sync = await syncDraftToServer\(saved, publishRowOps\);/);
  assert.match(project, /NK\.api\.publishRowOps\(/);
  const brand = read('prototype/js/service/brand.js');
  assert.match(brand, /NK\.api\.brandSave\(targetId, nextBrand, \{ publishRowOps: publishRowOps \}\)/);
  // 브랜드 스튜디오는 자기 저장 줄의 기준 목록으로 ops 를 계산해 넘긴다(브랜드 저장을 기다리는 사이 로컬이 바뀌어도 안전).
  const studio = read('prototype/js/ui/brand-studio.js');
  assert.match(studio, /\{ brand: diff\(brandRows, nextBrandRows\), project: diff\(projectRows, nextProjectRows\) \}/);
});

// ─── 실제 저장 핸들러(project/save·brand/save)와 에이전트 기록(publish-records)을 같은 가짜 GCS 에서 돌린다 ───
function fakeGcs() {
  const objects = new Map(); // name → { body, gen }
  let gen = 100;
  const hooks = { beforeWrite: null };
  async function fetchImpl(input, opts = {}) {
    const url = new URL(String(input));
    if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test' });
    if (url.pathname.startsWith('/upload/')) {
      const name = url.searchParams.get('name');
      if (hooks.beforeWrite) { const h = hooks.beforeWrite; hooks.beforeWrite = null; await h(name); }
      const match = url.searchParams.get('ifGenerationMatch');
      const cur = objects.get(name);
      if (match != null && String(cur ? cur.gen : 0) !== match) return new Response('precondition', { status: 412 });
      objects.set(name, { body: String(opts.body), gen: ++gen });
      return Response.json({});
    }
    const name = decodeURIComponent(url.pathname.split('/o/')[1] || '');
    const cur = objects.get(name);
    if (!cur) return new Response('', { status: 404 });
    return new Response(cur.body, { status: 200, headers: { 'x-goog-generation': String(cur.gen) } });
  }
  return { hooks, fetch: fetchImpl, get: name => JSON.parse(objects.get(name).body), put: (name, doc) => objects.set(name, { body: JSON.stringify(doc), gen: ++gen }) };
}
const ENV = { GOOGLE_CLIENT_EMAIL: 'test', GOOGLE_PRIVATE_KEY: 'AAAA', VIDEO_OUTPUT_GCS_URI: 'gs://bucket/root' };
const PROJECT_OBJ = 'root/users/u1/projects/ep1/reference/data.json';
const BRAND_OBJ = 'root/users/u1/brands/b1/reference/data.json';
function loadHandler(file, gcs) {
  const sandbox = {
    ...rows,
    authorizeRequest: async () => ({ ok: true, userId: 'u1' }), sanitizeUserId: v => String(v || ''),
    loadShares: async () => ({}), getGrantRole: () => '', isReservedProjectId: () => false,
    buildAiVideoProjectPrefix: (b, u, p) => `${b}/users/${u}/projects/${p}`, buildAiVideoBrandPrefix: (b, u, id) => `${b}/users/${u}/brands/${id}`,
    getGoogleAccessToken: async () => 'test',
    resolveGcsEnv: () => ({ bucket: 'bucket', basePrefix: 'root', clientEmail: 'test', privateKeyRaw: 'AAAA' }),
    caches: { open: async () => { throw new Error('no cache'); } },
    crypto: { subtle: { importKey: async () => ({}), sign: async () => new ArrayBuffer(4) } },
    fetch: gcs.fetch, Request, Response, URL, URLSearchParams, TextEncoder, Uint8Array, atob, btoa, console,
    module: { exports: {} },
  };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(esbuild.transformSync(read(file).replace(/^import .*;\n/gm, ''), { loader: 'ts', format: 'cjs' }).code, sandbox);
  return sandbox.module.exports;
}
const post = (handler, url, body) => handler.onRequestPost({
  request: new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env: ENV });

test('회귀(10-20): 에이전트가 덧붙인 뒤 옛 화면이 에피소드·브랜드를 저장해도 그 줄·상태가 남는다', async () => {
  const gcs = fakeGcs();
  gcs.put(PROJECT_OBJ, { projectId: 'ep1', payload: { brandId: 'b1', brandStudioPublishResults: plain(OLD_SEVEN), publishResults: plain(OLD_SEVEN) }, scenes: [] });
  gcs.put(BRAND_OBJ, { brandId: 'b1', brand: { brandId: 'b1', brandStudioPublishResults: plain(OLD_SEVEN) } });
  const agent = loadHandler('prototype/functions/api/_shared/publish-records.ts', gcs);
  const projectSave = loadHandler('prototype/functions/api/project/save.ts', gcs);
  const brandSave = loadHandler('prototype/functions/api/brand/save.ts', gcs);

  // 에이전트: 인스타 게시 기록 + TikTok 알림함 전송 확인
  const ig = agent.buildPublishRow({ platform: 'instagram', status: 'published', postId: 'ig9', projectId: 'ep1', brandId: 'b1' });
  await agent.appendPublishRecords(ENV, 'u1', 'ep1', 'b1', [ig]);
  await agent.updatePublishRowStatus(ENV, 'u1', 'ep1', 'b1', 'tiktok_p1', 'tiktok', 'sent_to_inbox');

  // 열려 있던 SNS 세팅 화면: 옛 7줄을 payload 째(바꾼 줄 없이) 저장
  const staleProject = await post(projectSave, 'https://x.test/api/project/save', { projectId: 'ep1', payload: { brandId: 'b1', brandStudioPublishResults: plain(OLD_SEVEN), publishResults: plain(OLD_SEVEN), brandStudioDeployingSteps: {} } });
  assert.equal(staleProject.status, 200);
  const staleBrand = await post(brandSave, 'https://x.test/api/brand/save', { brandId: 'b1', brand: { brandId: 'b1', brandStudioPublishResults: plain(OLD_SEVEN) } });
  assert.equal(staleBrand.status, 200);

  for (const list of [gcs.get(PROJECT_OBJ).payload.brandStudioPublishResults, gcs.get(PROJECT_OBJ).payload.publishResults, gcs.get(BRAND_OBJ).brand.brandStudioPublishResults]) {
    assert.equal(list.length, 8);
    assert.ok(list.some(r => r.id === ig.id), '에이전트가 덧붙인 인스타 줄이 남아야 한다');
    assert.equal(list.find(r => r.id === 'tiktok_p1').status, 'sent_to_inbox', 'TikTok 상태가 processing 으로 돌아가면 안 된다');
  }
  // 응답으로 서버 목록을 돌려줘 화면 사본도 맞춘다
  assert.equal((await staleProject.json()).publishResults.length, 8);
  assert.equal((await staleBrand.json()).brand.brandStudioPublishResults.length, 8);
});

test('회귀: 화면 저장 도중 에이전트가 끼어들어도(세대 불일치) 다시 읽어 그 줄을 지키고, 화면이 바꾼 줄도 반영한다', async () => {
  const gcs = fakeGcs();
  gcs.put(PROJECT_OBJ, { projectId: 'ep1', payload: { brandStudioPublishResults: plain(OLD_SEVEN) }, scenes: [] });
  gcs.put(BRAND_OBJ, { brandId: 'b1', brand: { brandId: 'b1', brandStudioPublishResults: plain(OLD_SEVEN) } });
  const agent = loadHandler('prototype/functions/api/_shared/publish-records.ts', gcs);
  const projectSave = loadHandler('prototype/functions/api/project/save.ts', gcs);
  const brandSave = loadHandler('prototype/functions/api/brand/save.ts', gcs);
  const api = loadApi();
  const kakao = row('manual_ep1_kakao', 'kakao', 'published', { delivery: 'manual' });
  const ops = plain(api.publishRowOps(OLD_SEVEN, [kakao].concat(plain(OLD_SEVEN))));
  const ig = agent.buildPublishRow({ platform: 'instagram', status: 'published', postId: 'ig9', projectId: 'ep1', brandId: 'b1' });

  gcs.hooks.beforeWrite = () => agent.appendPublishRecords(ENV, 'u1', 'ep1', 'b1', [ig]);
  assert.equal((await post(projectSave, 'https://x.test/api/project/save', { projectId: 'ep1', payload: { brandStudioPublishResults: [kakao].concat(plain(OLD_SEVEN)) }, publishRowOps: ops })).status, 200);
  gcs.hooks.beforeWrite = () => agent.appendPublishRecords(ENV, 'u1', 'ep1', 'b1', [{ ...ig, id: 'threads_t1', channelType: 'threads' }]);
  assert.equal((await post(brandSave, 'https://x.test/api/brand/save', { brandId: 'b1', brand: { brandId: 'b1', brandStudioPublishResults: [kakao].concat(plain(OLD_SEVEN)) }, publishRowOps: ops })).status, 200);

  const projectRows = gcs.get(PROJECT_OBJ).payload.brandStudioPublishResults;
  assert.ok(projectRows.some(r => r.id === ig.id));
  assert.ok(projectRows.some(r => r.id === kakao.id));
  const brandRows = gcs.get(BRAND_OBJ).brand.brandStudioPublishResults;
  assert.ok(brandRows.some(r => r.id === 'threads_t1'), '브랜드 저장도 세대 확인으로 끼어든 줄을 지킨다');
  assert.ok(brandRows.some(r => r.id === ig.id));
  assert.ok(brandRows.some(r => r.id === kakao.id));
});
