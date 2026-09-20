import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('★일괄 제작은 컷별 스틸 직행 대신 동일한 스토리보드 워크플로를 사용한다', () => {
  const pipeline = read('prototype/ui/pipeline.js');
  const canvas = read('ai-company-app/src/components/ProductionCanvas.tsx');
  const executor = read('prototype/functions/api/agent/_video-pipeline-executor.ts');
  assert.match(pipeline, /id="sb-sheet-btn"/);
  assert.doesNotMatch(pipeline, /id="bulk-generate"|스토리보드 일괄 생성|var bulkGen/, '같은 모달을 여는 중복 메뉴를 두지 않는다');
  assert.match(pipeline, /sbSheetBtn\.onclick = function \(\) \{ if \(NK\.uiStoryboardSheet/);
  assert.match(canvas, /스토리보드 생성/);
  assert.match(canvas, /storyboard=auto&imageProvider=/, '캔버스는 제작 화면을 열지 않고 같은 엔진을 숨은 프레임에서 실행한다');
  assert.match(canvas, /title="스토리보드 백그라운드 생성"[\s\S]*className="hidden"/);
  assert.match(pipeline, /storyboardMode === 'auto'[\s\S]*auto: true/);
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
  assert.match(canvas, /const rawFrameUrl = stillUrl \|\| contiUrl/, '정식 스틸이 생기면 같은 이미지 슬롯의 콘티를 대체한다');
  assert.match(canvas, /grid grid-cols-2 gap-1 p-2/, '일반 컷 카드는 공용 이미지 슬롯과 영상 슬롯만 둔다');
  assert.doesNotMatch(canvas, /grid grid-cols-3 gap-1 p-2/, '콘티·스틸·영상을 서로 다른 세 칸으로 나누지 않는다');
  assert.match(canvas, />\s*스토리보드\s*<\/button>/, '일괄 생성 오른쪽에 전용 보기 버튼을 둔다');
  assert.match(canvas, /lanes\.filter\(\(l\) => !storyboardView \|\| l\.kind === "scene"\)/, '전용 보기는 씬 바만 남긴다');
  assert.match(canvas, /if \(storyboardView && n\.type !== "cut"\) return null/, '전용 보기는 컷 카드만 남긴다');
  assert.match(canvas, /if \(storyboardView\) return \([\s\S]*?\{frame\}[\s\S]*?n\.data\.action/, '전용 컷 카드에는 이미지와 행동 구문만 둔다');
  assert.match(canvas, /!storyboardView && <span className="absolute left-1\.5 top-1\.5/, '전용 보기에서는 콘티·스틸 배지도 감춘다');
});

test('★일괄 제작·승인 카드는 같은 왼쪽 독 스타일을 쓰고 접으면 아이콘과 +/-만 남는다', () => {
  const canvas = read('ai-company-app/src/components/ProductionCanvas.tsx');
  const approvals = read('ai-company-app/src/components/Approvals.tsx');
  const dock = read('ai-company-app/src/components/CanvasFloatingDock.tsx');
  const stack = read('ai-company-app/src/lib/canvasDockStack.ts');
  assert.match(canvas, /w-\[400px\][^\n]*data-testid="job-dock"/);
  assert.match(canvas, /data-testid="batch-dock"/);
  assert.match(canvas, /batchDockOpen \? "w-\[400px\] max-w-\[calc\(100%-24px\)\]" : "w-fit"/, '일괄 제작은 펼칠 때만 전체 폭을 쓴다');
  assert.match(approvals, /open \? "w-\[400px\] max-w-\[calc\(100vw-24px\)\]" : "w-fit"/, '승인도 같은 400px 폭과 최소화 규칙을 쓴다');
  assert.match(canvas, /<CanvasFloatingDock[\s\S]*?title="일괄 생성"[\s\S]*?tone="emerald"/);
  assert.match(approvals, /<CanvasFloatingDock[\s\S]*?title=\{`승인 \(\$\{count\}\)`\}[\s\S]*?tone="amber"/);
  assert.match(dock, /\{open && \([\s\S]*?\{title\}[\s\S]*?\)\}/, '접힌 상태에서는 제목·개수를 렌더링하지 않는다');
  assert.match(dock, /\{open \? "−" : "\+"\}/, '두 도크가 동일한 +/- 표기를 쓴다');
  assert.match(dock, /open \? "w-full gap-2 px-3 py-2" : "h-9 w-auto gap-1\.5 px-2"/, '접힌 버튼은 아이콘과 +/-에 필요한 폭만 차지한다');
  assert.match(approvals, /observeCanvasDockHeight\(dockRef\.current, APPROVAL_DOCK_HEIGHT_VAR\)/, '승인 카드의 실제 높이를 공유한다');
  assert.match(canvas, /style=\{\{ bottom: canvasDockBottom\(APPROVAL_DOCK_HEIGHT_VAR\) \}\}/, '작업 카드는 승인 카드의 실제 높이 위에 놓인다');
  assert.match(canvas, /canvasDockBottom\(APPROVAL_DOCK_HEIGHT_VAR, \.\.\.\(pending\.length \? \[JOB_DOCK_HEIGHT_VAR\] : \[\]\)\)/, '일괄 생성 카드는 승인·작업 카드의 실제 높이 위에 놓인다');
  assert.match(stack, /ResizeObserver\(publish\)/, '도크를 펼치거나 내용이 바뀌면 높이를 다시 측정한다');
  assert.match(stack, /CANVAS_DOCK_GAP_PX = 8/, '각 카드 사이에는 8px 간격을 둔다');
  assert.match(dock, /aria-expanded=\{open\}/);
});

test('★일괄 생성 카드는 생성·진행·결과·실패 사유만 간결하게 보여준다', () => {
  const canvas = read('ai-company-app/src/components/ProductionCanvas.tsx');
  const panel = read('ai-company-app/src/components/VideoPipelinePanel.tsx');
  assert.match(canvas, /"스토리보드 생성"\}\s*<\/button>/);
  assert.match(canvas, /<RefreshIcon className="h-3\.5 w-3\.5 shrink-0 animate-spin" \/>스토리보드 생성 중…/, '스토리보드 생성 중에는 문구 옆에 로딩 스피너를 표시한다');
  assert.match(canvas, /inline-flex w-full items-center justify-center gap-1\.5/, '스피너와 생성 중 문구를 버튼 중앙에 나란히 정렬한다');
  assert.doesNotMatch(canvas, /씬별 스토리보드 생성·검토|승인 콘티 기반 스틸·영상 파이프라인|부감 마스터를 공간 기준/);
  assert.match(panel, /busy \? "준비 중…" : "스틸·영상 생성"/);
  assert.match(panel, /성공 \{successCount\}/);
  assert.match(panel, /실패 \{failureCount\}/);
  assert.match(panel, /실패 사유:/);
  assert.match(panel, /스틸: \{s\.stillError\}/);
  assert.match(panel, /영상: \{s\.videoError\}/);
  assert.match(canvas, /data-testid="storyboard-generation-group"/);
  assert.match(panel, /data-testid="still-video-generation-group"[\s\S]*스틸·영상 생성[\s\S]*type="checkbox"/, '체크 항목은 스틸·영상 생성 그룹 아래에 둔다');
  assert.doesNotMatch(panel, /job\.title|파이프라인을 마쳤어요|비어 있는 컷을 스틸→영상 순으로 자동 생성해요/);
});

test('★스토리보드 재생성은 종료된 옛 스틸·영상 기록을 현재 카드에 되살리지 않는다', () => {
  const canvas = read('ai-company-app/src/components/ProductionCanvas.tsx');
  const panel = read('ai-company-app/src/components/VideoPipelinePanel.tsx');
  assert.match(panel, /TERMINAL_JOB_STATUSES[\s\S]*?"completed"[\s\S]*?"failed"[\s\S]*?"cancelled"/);
  assert.match(panel, /getCompanySkillJob\(parsed\.jobId\)[\s\S]*?if \(isTerminalJob\(savedJob\)\)[\s\S]*?writeUserStorage\(VIDEO_PIPELINE_JOB_KEY, ""\)/, '새로고침 때 종료된 로컬 포인터를 제거한다');
  assert.match(panel, /const active = jobs\.find\(\(candidate\) => !isTerminalJob\(candidate\)\);[\s\S]*?if \(!active \|\| active\.id === jobIdRef\.current\) return;/, '서버 목록에서는 진행 중 작업만 현재 카드에 붙인다');
  assert.doesNotMatch(panel, /const latest = active \|\| jobs\[0\]/, '종료된 최신 이력을 현재 작업으로 되살리지 않는다');
  assert.match(canvas, /setPipelineResetNonce\(\(n\) => n \+ 1\)[\s\S]*setStoryboardRun\(/, '새 스토리보드를 시작하면 종료된 이전 작업 포인터를 정리한다');
  assert.match(canvas, /resetNonce=\{pipelineResetNonce\}/);
  assert.match(panel, /if \(current && !isTerminalJob\(current\)\) return current;/, '진행 중 작업은 숨기지 않는다');
});
