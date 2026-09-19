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

test('★캔버스 그래프는 같은 프로젝트의 콘티를 스틸로 승격하고 스토리보드 전용 보기를 제공한다', () => {
  const graph = read('prototype/functions/api/agent/production-graph.ts');
  const canvas = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(graph, /const boardSheets:[\s\S]*isSheetStale\(sheet, scenes\)/);
  assert.match(graph, /const storyboard = storyboardFor/);
  assert.match(graph, /summary: \{ scenes: scenes\.length, storyboards, approvedStoryboards, stills: done, clips \}/);
  assert.match(canvas, /콘티 \{graph\.summary\.approvedStoryboards \|\| 0\}\/\{graph\.summary\.scenes\}/);
  assert.match(canvas, /n\.data\.storyboard\?\.url/);
  assert.match(canvas, /const frameUrl = stillUrl \|\| contiUrl/, '정식 스틸이 생기면 같은 이미지 슬롯의 콘티를 대체한다');
  assert.match(canvas, /grid grid-cols-2 gap-1 p-2/, '일반 컷 카드는 공용 이미지 슬롯과 영상 슬롯만 둔다');
  assert.doesNotMatch(canvas, /grid grid-cols-3 gap-1 p-2/, '콘티·스틸·영상을 서로 다른 세 칸으로 나누지 않는다');
  assert.match(canvas, />\s*스토리보드\s*<\/button>/, '일괄 생성 오른쪽에 전용 보기 버튼을 둔다');
  assert.match(canvas, /lanes\.filter\(\(l\) => !storyboardView \|\| l\.kind === "scene"\)/, '전용 보기는 씬 바만 남긴다');
  assert.match(canvas, /if \(storyboardView && n\.type !== "cut"\) return null/, '전용 보기는 컷 카드만 남긴다');
  assert.match(canvas, /if \(storyboardView\) return \([\s\S]*?\{frame\}[\s\S]*?n\.data\.action/, '전용 컷 카드에는 이미지와 행동 구문만 둔다');
  assert.match(canvas, /!storyboardView && <span className="absolute left-1\.5 top-1\.5/, '전용 보기에서는 콘티·스틸 배지도 감춘다');
});

test('★일괄 제작 카드는 승인 카드와 같은 왼쪽 독에 쌓이고 접을 수 있다', () => {
  const canvas = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(canvas, /w-\[400px\][^\n]*data-testid="job-dock"/);
  assert.match(canvas, /data-testid="batch-dock"/);
  assert.match(canvas, /absolute left-3 z-30 w-\[400px\]/, '에이전트 대화창 반대편의 승인 독 폭을 공유한다');
  assert.match(canvas, /style=\{\{ bottom: pending\.length \? \(jobDockOpen \? 376 : 112\) : 72 \}\}/, '승인 카드의 펼침 상태만큼 위로 배치한다');
  assert.match(canvas, /aria-expanded=\{batchDockOpen\}/);
  assert.match(canvas, /\{batchDockOpen && \(/);
});
