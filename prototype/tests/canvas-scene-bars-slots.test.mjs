// 제작 캔버스: 바(레인) + 슬롯 격자 배치.
//  - 씬 바(파랑)·캐릭터 바(초록)·장소 바(연두) 아래 카드가 칸(슬롯)에 스냅한다. 카드 간격 = 바-카드 간격(12px).
//  - 바를 끌면 딸린 카드가 함께 움직이고, 클릭하면 그 바의 카드를 모두 선택한다.
//  - 카드는 같은 종류의 바에만 놓인다. 배치는 표시용이며 서버 컷 순서는 바꾸지 않는다(에이전트 잡 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.join(process.cwd(), 'ai-company-app/src/components/ProductionCanvas.tsx'), 'utf8').replace(/\r\n/g, '\n');

test('★슬롯 격자 상수: 카드 간격 = 바-카드 간격, 씬 묶음 규칙(연속 같은 장소)', () => {
  assert.match(src, /const CARD_GAP = 12;/);
  assert.match(src, /const CELL_W = NODE_W\.cut \+ CARD_GAP;/);
  assert.match(src, /const BAR_SNAP = GRID \* 2;/);
  assert.match(src, /function deriveLanes\(graph: ProductionGraph \| null\): Lane\[\]/);
  assert.match(src, /if \(!last \|\| !loc \|\| loc !== last\.location\) \{/, '시나리오 화면의 Scene N cutM 규칙과 같아야 합니다');
  assert.doesNotMatch(src, /function layoutGraph\(/, '자유 배치 layoutGraph 는 사라져야 합니다');
});

test('★세 종류의 바가 있고 색이 구분된다(씬 파랑, 캐릭터 초록, 장소 연두)', () => {
  assert.match(src, /scene: \{ bar: "border-sky-500\/80 bg-sky-900\/60/);
  assert.match(src, /characters: \{ bar: "border-emerald-500\/80 bg-emerald-900\/60/);
  assert.match(src, /locations: \{ bar: "border-lime-500\/80 bg-lime-900\/50/);
  assert.match(src, /key: "characters", kind: "characters"/);
  assert.match(src, /key: "locations", kind: "locations"/);
  assert.match(src, /label: "장소 · 배경"/);
});

test('★카드 좌표는 바 + 슬롯 번호로만 정해지고, 드롭 시 같은 종류의 가장 가까운 칸에 스냅한다', () => {
  assert.match(src, /pos\[id\] = \{ x: b\.x \+ i \* l\.cellW, y: b\.y \+ BAR_H \+ CARD_GAP \};/);
  assert.match(src, /function slotFromPoint\(layout: CanvasLayout, lanes: Lane\[\], x: number, y: number, draggedId: string, kind: LaneKind \| null\)/);
  assert.match(src, /if \(kind && l\.kind !== kind\) continue;/, '캐릭터 카드가 씬 줄에 들어가면 안 된다');
  assert.match(src, /function moveCutToSlot\(/);
  assert.match(src, /if \(slot\) setLayout\(\(l\) => moveCutToSlot\(l, d\.id!, slot\)\);/);
  assert.match(src, /border-dashed border-emerald-500\/70/);
});

test('★바를 끌면 40px 격자로 움직이고 딸린 카드가 함께 가며, 클릭은 그 바의 카드 전체 선택이다', () => {
  assert.match(src, /d\.kind === "bar"[\s\S]{0,200}Math\.round\(v \/ BAR_SNAP\) \* BAR_SNAP/);
  assert.match(src, /setMulti\(new Set\(g \? g\.memberIds : \[\]\)\);\s*\n\s*setSelectedId\(""\);/);
  assert.match(src, /onPointerDown=\{\(e\) => onPointerDown\(e, `lane:\$\{l\.key\}`\)\}/);
});

test('★컷 카드 제목은 컷 번호만(씬 번호는 바가 보여 준다), 배치는 canvasLayout 키에 저장, 서버 순서는 건드리지 않는다', () => {
  assert.match(src, /lanes\.filter\(\(l\) => l\.kind === "scene"\)\.forEach\(\(l\) => l\.memberIds\.forEach\(\(id, i\) => m\.set\(id, `cut\$\{i \+ 1\}`\)\)\);/);
  assert.match(src, /writeStorage\(`canvasLayout:\$\{projectId\}`, JSON\.stringify\(layout\)\);/);
  assert.match(src, /reconcileLayout\(parsed, g, defaultLayout\(g\)\)/);
  const i = src.indexOf('function moveCutToSlot(');
  const fn = src.slice(i, src.indexOf('\n}\n', i));
  assert.doesNotMatch(fn, /enqueue|createAgentJob/);
});
