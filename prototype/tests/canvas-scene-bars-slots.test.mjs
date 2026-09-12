// 제작 캔버스: 씬 바 + 슬롯 격자 배치.
//  - 컷은 자유 이동 대신 씬 줄의 칸(슬롯)에 스냅한다(카드 폭 + 40px 간격).
//  - 씬 바(연속된 같은 장소의 컷 묶음)를 끌면 딸린 컷이 함께 움직이고, 클릭하면 그 씬의 컷을 모두 선택한다.
//  - 배치는 표시용이며 서버 컷 순서는 바꾸지 않는다(에이전트 잡 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.join(process.cwd(), 'ai-company-app/src/components/ProductionCanvas.tsx'), 'utf8').replace(/\r\n/g, '\n');

test('★슬롯 격자 상수와 씬 묶음 규칙(연속 같은 장소)이 있다', () => {
  assert.match(src, /const CELL_W = NODE_W\.cut \+ 40;/);
  assert.match(src, /const SCENE_BAR_H = 44;/);
  assert.match(src, /const BAR_SNAP = GRID \* 2;/);
  assert.match(src, /function deriveSceneGroups\(graph: ProductionGraph \| null\): SceneGroup\[\]/);
  assert.match(src, /if \(!last \|\| !loc \|\| loc !== last\.location\) \{/, '시나리오 화면의 Scene N cutM 규칙과 같아야 합니다');
  assert.doesNotMatch(src, /function layoutGraph\(/, '자유 배치 layoutGraph 는 사라져야 합니다');
});

test('★컷 좌표는 씬 바 + 슬롯 번호로만 정해지고, 드롭 시 가장 가까운 칸에 스냅한다', () => {
  assert.match(src, /pos\[id\] = \{ x: b\.x \+ i \* CELL_W, y: b\.y \+ SCENE_BAR_H \+ SCENE_BAR_GAP \};/);
  assert.match(src, /function slotFromPoint\(/);
  assert.match(src, /function moveCutToSlot\(/);
  assert.match(src, /if \(slot\) setLayout\(\(l\) => moveCutToSlot\(l, d\.id!, slot\)\);/);
  // 끌고 있는 동안 놓일 칸을 점선으로 보여 준다
  assert.match(src, /setDropSlot\(slotFromPoint\(layoutRef\.current, groupsRef\.current, nx, ny, d\.id\)\);/);
  assert.match(src, /border-dashed border-emerald-500\/70/);
});

test('★씬 바를 끌면 40px 격자로 움직이고 딸린 컷이 함께 가며, 클릭은 그 씬의 컷 전체 선택이다', () => {
  assert.match(src, /d\.kind === "bar"[\s\S]{0,200}Math\.round\(v \/ BAR_SNAP\) \* BAR_SNAP/);
  assert.match(src, /setLayout\(\(l\) => \(\{ \.\.\.l, bars: \{ \.\.\.l\.bars, \[key\]: \{ x: snap\(nx\), y: snap\(ny\) \} \} \}\)\);/);
  assert.match(src, /setMulti\(new Set\(g \? g\.cutIds : \[\]\)\);\s*\n\s*setSelectedId\(""\);/);
  assert.match(src, /onPointerDown=\{\(e\) => onPointerDown\(e, `scene:\$\{g\.key\}`\)\}/);
});

test('★카드 제목이 Scene N cutM 이고, 배치는 canvasLayout 키에 저장되며 서버 순서는 건드리지 않는다', () => {
  assert.match(src, /g\.cutIds\.length > 1 \? `Scene \$\{g\.index\} cut\$\{i \+ 1\}` : `Scene \$\{g\.index\}`/);
  assert.match(src, /writeStorage\(`canvasLayout:\$\{projectId\}`, JSON\.stringify\(layout\)\);/);
  assert.match(src, /reconcileLayout\(parsed, g, defaultLayout\(g\)\)/);
  // 배치 변경이 에이전트 잡을 만들지 않는다: moveCutToSlot 근처에 createAgentJob/enqueue 호출이 없다
  const i = src.indexOf('function moveCutToSlot(');
  const fn = src.slice(i, src.indexOf('\n}\n', i));
  assert.doesNotMatch(fn, /enqueue|createAgentJob/);
});
