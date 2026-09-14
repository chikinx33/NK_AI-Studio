// AI 시네마 프리비즈 연결: 셸 사이드바 → React 앱 ?view=previz 스테이지, 캔버스 컷 상세 → 같은 화면,
// 그래프가 blocking·previz 를 싣고, 반영은 scene_upsert 잡으로, 3D 는 저장소의 three.js·mp4-muxer 를 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('★사이드바 카드(AI 시네마 셸에서만) 캔버스 아래·Pre-Prod 위에 프리비즈 버튼, 한/영 문구', () => {
  const dash = read('prototype/js/ui/dashboard.js');
  const start = dash.indexOf('<div class="sidebar-card-actions">');
  const canvas = dash.indexOf('data-action="sidebar-edit-canvas"', start);
  const previz = dash.indexOf('data-action="sidebar-edit-previz"', start);
  const pre = dash.indexOf('data-action="sidebar-edit-scenario"', start);
  assert.ok(canvas > start && previz > canvas && previz < pre);
  assert.match(dash.slice(canvas, pre), /\$\{getHostShell\(\) === 'video' \? `<button class="btn-secondary sidebar-previz-btn" data-action="sidebar-edit-previz" data-i18n="sidebar_previz_fixed">프리비즈<\/button>` : ''\}/);
  const core = read('prototype/core.js');
  assert.match(core, /sidebar_previz_fixed: 'Previz',/);
  assert.match(core, /sidebar_previz_fixed: '프리비즈',/);
});

test('★프리비즈 버튼은 React 앱을 view=previz 로 열고, 셸은 캔버스와 다른 스테이지로 캐시한다', () => {
  const script = read('prototype/script.js');
  assert.match(script, /action === 'sidebar-edit-previz'[\s\S]{0,300}'ai-company\/index\.html\?view=previz' \+ \(currentProject\?\.id \? '&projectId=' \+ encodeURIComponent\(currentProject\.id\) : ''\)/);
  const nav = read('prototype/js/navigation.js');
  assert.ok(nav.includes("if (/[?&]view=previz(&|$)/.test(full)) return 'previz';"), '프리비즈는 previz 스테이지');
  assert.match(nav, /return 'previz';\n\s*return 'canvas';/, '그 외 ai-company 는 canvas 스테이지');
});

test('★React 진입점: view=previz 면 AI 기업 앱 대신 프리비즈만 지연 로드한다', () => {
  const main = read('ai-company-app/src/main.tsx');
  assert.match(main, /const PrevizStudio = React\.lazy\(\(\) => import\("\.\/previz\/PrevizStudio\.tsx"\)\);/);
  assert.match(main, /LAUNCH\.get\("view"\) === "previz" \?/);
  assert.match(main, /focusSceneId=\{String\(LAUNCH\.get\("sceneId"\) \|\| ""\)\.trim\(\)\}/);
});

test('★캔버스 컷 상세에 프리비즈 버튼 — 이 컷으로 열고 셸에 stage-changed(previz) 를 알린다', () => {
  const canvas = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(canvas, /window\.parent\.postMessage\(\{ type: "stage-changed", stage: "previz", url \}, "\*"\)/);
  assert.match(canvas, /\?view=previz\$\{inShell \? "&embed=1" : ""\}&projectId=\$\{encodeURIComponent\(projectId\)\}&sceneId=/);
  assert.match(canvas, /onClick=\{\(\) => openPreviz\(selected\.data\.sceneId\)\}/);
});

test('★제작 그래프가 컷 blocking 과 payload.previz 를 싣는다(초기 배치·저장 문서)', () => {
  const graph = read('prototype/functions/api/agent/production-graph.ts');
  assert.match(graph, /blocking: Array\.isArray\(s\?\.blocking\) \? s\.blocking : null,/);
  assert.match(graph, /previz: payload\.previz && typeof payload\.previz === "object" \? payload\.previz : null,/);
});

test('★저장은 payload.previz 얕은 병합, 컷 반영은 scene_upsert 잡(컷마다 완료를 기다림)', () => {
  const api = read('ai-company-app/src/lib/api.ts');
  assert.match(api, /body: JSON\.stringify\(\{ projectId, payload: \{ previz \} \}\),/);
  const studio = read('ai-company-app/src/previz/PrevizStudio.tsx');
  assert.match(studio, /createAgentJob\("scene_upsert", \{ projectId, sceneId: c\.sceneId, scene: fields \}\)/);
  assert.match(studio, /while \(!JOB_DONE\.includes\(status\) && Date\.now\(\) - started < 90_000\)/);
  assert.match(studio, /\.filter\(\(w\) => w\.changed\.length\)/, '바뀐 컷만 반영한다');
  // scene_upsert 가 반영 필드를 모두 받아야 저장 전에 증발하지 않는다
  const shared = read('prototype/functions/api/agent/_shared.ts');
  const fieldsAt = shared.indexOf('const FIELDS = ["title"');
  assert.ok(fieldsAt > 0, 'scene_upsert FIELDS 를 찾지 못했다');
  const fields = shared.slice(fieldsAt, shared.indexOf('];', fieldsAt));
  for (const f of ['shotType', 'cameraMove', 'cameraDirection', 'cameraElevation', 'blocking']) {
    assert.ok(fields.includes(`"${f}"`), `scene_upsert FIELDS 에 ${f}`);
  }
});

test('★편집 화면과 영상 내보내기가 같은 장면 코드(PrevizScene.sync)를 쓰고, 저장소의 three.js·mp4-muxer 를 쓴다', () => {
  const engine = read('ai-company-app/src/previz/engine.ts');
  assert.match(engine, /const THREE_URL = "\/lib\/three\/three\.module\.min\.js";/);
  assert.match(engine, /const ORBIT_URL = "\/lib\/three\/OrbitControls\.js";/);
  assert.ok(fs.existsSync(path.join(process.cwd(), 'prototype/lib/three/three.module.min.js')));
  assert.ok(fs.existsSync(path.join(process.cwd(), 'prototype/lib/mp4-muxer.min.js')));
  const exp = read('ai-company-app/src/previz/exportVideo.ts');
  assert.match(exp, /const MUXER_URL = "\/lib\/mp4-muxer\.min\.js";/);
  assert.match(exp, /world\.sync\(frame\);/);
  assert.match(engine, /this\.world\.sync\(shown\);/);
  const pkg = JSON.parse(read('ai-company-app/package.json'));
  assert.equal(pkg.dependencies.three, undefined, 'npm 의존성을 늘리지 않는다');
});
