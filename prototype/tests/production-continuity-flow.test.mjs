import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('★일괄 제작은 컷별 스틸 직행 대신 동일한 스토리보드 워크플로를 사용한다', () => {
  const pipeline = read('prototype/ui/pipeline.js');
  const canvas = read('ai-company-app/src/components/ProductionCanvas.tsx');
  const executor = read('prototype/functions/api/agent/_video-pipeline-executor.ts');
  assert.match(pipeline, /id="bulk-generate"[\s\S]*스토리보드 일괄 생성/);
  assert.match(pipeline, /bulkGen\.onclick = function \(\) \{ if \(NK\.uiStoryboardSheet/);
  assert.doesNotMatch(pipeline.slice(pipeline.indexOf("var bulkGen"), pipeline.indexOf("var bulkVid")), /generateImageForIdx/);
  assert.match(canvas, /스토리보드 만들기·검토/);
  assert.match(canvas, /src=\{`\/scenes\.html\?embed=1&projectId=\$\{encodeURIComponent\(projectId\)\}&storyboard=1`\}/);
  assert.match(executor, /requireStoryboard: true/);
});

test('★정식 스틸은 최신 유효 승인 콘티를 첫 참조로 사용하고 stale 시트는 제외한다', () => {
  const shared = read('prototype/functions/api/agent/_shared.ts');
  assert.match(shared, /function approvedContiPanel\(/);
  assert.match(shared, /sheet\.kind !== "board" \|\| isSheetStale\(sheet, scenes\)/);
  assert.match(shared, /p\?\.role === "cut" && p\?\.status === "approved"/);
  assert.match(shared, /input\?\.requireStoryboard === true && !conti/);
  assert.match(shared, /const ROLE_ORDER:[\s\S]*storyboard: 0, plate: 1, character: 2/);
  assert.match(shared, /APPROVED STORYBOARD PANEL/);
});

test('★프로젝트 저장 성공은 셸의 모든 화면으로 중계되고 캔버스가 같은 프로젝트를 다시 읽는다', () => {
  const api = read('prototype/api.js');
  const nav = read('prototype/js/navigation.js');
  const app = read('ai-company-app/src/App.tsx');
  const canvas = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(api, /NK\.state\.broadcast\('nk-project-changed', \{ projectId: body\.projectId/);
  assert.match(nav, /Object\.keys\(__stageIframes\)\.forEach/);
  assert.match(nav, /frame\.contentWindow\.postMessage\(\{ type: 'nk-project-changed'/);
  assert.match(app, /type === "nk-project-changed"/);
  assert.match(app, /source: "canvas-embedded-production"/);
  assert.match(canvas, /if \(name === "canvas\.refresh"\)[\s\S]*if \(!pid \|\| pid === projectId\) void load\(true\)/);
});

test('★캔버스 그래프는 컷별 콘티 상태와 콘티-스틸-영상 요약을 같은 프로젝트 데이터에서 제공한다', () => {
  const graph = read('prototype/functions/api/agent/production-graph.ts');
  const canvas = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(graph, /const boardSheets:[\s\S]*isSheetStale\(sheet, scenes\)/);
  assert.match(graph, /const storyboard = storyboardFor/);
  assert.match(graph, /summary: \{ scenes: scenes\.length, storyboards, approvedStoryboards, stills: done, clips \}/);
  assert.match(canvas, /콘티 \{graph\.summary\.approvedStoryboards \|\| 0\}\/\{graph\.summary\.scenes\}/);
  assert.match(canvas, /n\.data\.storyboard\?\.url/);
});
