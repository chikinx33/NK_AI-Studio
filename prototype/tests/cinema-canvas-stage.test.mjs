// AI 시네마 ↔ 캔버스(에이전트 모드) 연결: 하나의 React 캔버스를 시네마 셸 스테이지로 열고,
// 캔버스 편집이 시나리오·제작·포스트 스테이지에 반영되게 캐시를 무효화한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('★사이드바 카드(AI 시네마 셸에서만) Pre-Prod 위에 캔버스 버튼이 있고 한/영 문구가 있다', () => {
  const dash = read('prototype/js/ui/dashboard.js');
  const start = dash.indexOf('<div class="sidebar-card-actions">');
  const canvas = dash.indexOf('data-action="sidebar-edit-canvas"', start);
  const pre = dash.indexOf('data-action="sidebar-edit-scenario"', start);
  assert.ok(canvas > start && canvas < pre, '캔버스 버튼이 Pre-Prod 위에 있어야 합니다');
  assert.match(dash.slice(start, pre), /getHostShell\(\) === 'video' \?/, 'AI 시네마 셸에서만 보여야 합니다');
  const core = read('prototype/core.js');
  assert.match(core, /sidebar_canvas_fixed: 'Canvas',/);
  assert.match(core, /sidebar_canvas_fixed: '캔버스',/);
});

test('★캔버스 버튼은 React 앱을 view=canvas 로 스테이지에 연다', () => {
  const script = read('prototype/script.js');
  assert.match(script, /action === 'sidebar-edit-canvas'/);
  assert.match(script, /'ai-company\/index\.html\?view=canvas' \+ \(currentProject\?\.id \? '&projectId=' \+ encodeURIComponent\(currentProject\.id\) : ''\)/);
  const nav = read('prototype/js/navigation.js');
  assert.match(nav, /ai-company\(\[/, 'normalizeStageName 이 ai-company 경로를 canvas 스테이지로 잡아야 합니다');
  assert.match(nav, /return 'canvas';/);
});

test('★캔버스가 프로젝트를 바꾸면 셸이 시나리오·제작·포스트 스테이지 캐시를 버리고 다시 불러온다', () => {
  const nav = read('prototype/js/navigation.js');
  assert.match(nav, /data\.type !== 'nk-project-changed'/);
  assert.match(nav, /__dirtyStages\.scenario = true;\s*\n\s*__dirtyStages\.scenes = true;\s*\n\s*__dirtyStages\.media = true;/);
  assert.match(nav, /if \(__dirtyStages\[st\]\) \{\s*\n\s*delete __dirtyStages\[st\];\s*\n\s*iframe\.__nkUrl = '';/);
  assert.match(nav, /NK\.store\.clearPipeline\(\)/);
  const canvas = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(canvas, /window\.parent\.postMessage\(\{ type: "nk-project-changed", projectId \}, "\*"\)/);
});

test('★React 앱은 임베드 파라미터로 캔버스를 바로 열고, stage-revisit 에 그래프를 다시 읽는다(코드 한 벌)', () => {
  const app = read('ai-company-app/src/App.tsx');
  assert.match(app, /const EMBED_MODE = EMBED_PARAMS\.get\("embed"\) === "1";/);
  assert.match(app, /const EMBED_CANVAS = EMBED_PARAMS\.get\("view"\) === "canvas";/);
  assert.match(app, /useState\(EMBED_PROJECT_ID \|\| readStorage\("canvasProjectId"\)\)/);
  assert.match(app, /EMBED_CANVAS \? "skills" : "chat"/);
  assert.match(app, /EMBED_CANVAS \? CANVAS_SKILL_CATEGORY_ID : "design-content"/);
  assert.match(app, /if \(type === "stage-revisit"\) dispatchUiAction\(\{ action: "canvas\.refresh" \}\);/);
  assert.match(app, /postMessage\(\{ type: "stage-ready", stage: "canvas" \}, "\*"\)/);
  assert.match(app, /onToggleFocus=\{EMBED_MODE \? undefined : \(\) => setFocusMode\(\(v\) => !v\)\}/);
  const sw = read('ai-company-app/src/components/SkillWorkspace.tsx');
  assert.match(sw, /hideTopBar=\{focusMode && !embed\}/, '임베드에서는 캔버스 상단 바(프로젝트·줌·일괄 생성)를 남긴다');
});
