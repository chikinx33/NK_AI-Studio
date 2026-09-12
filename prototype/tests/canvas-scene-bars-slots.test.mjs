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

test('★세 종류의 바가 있고 색이 구분되며(씬 파랑, 캐릭터 초록, 장소 보라) 선택 카드 테두리가 바 색을 따른다', () => {
  assert.match(src, /scene: \{ bar: "border-sky-500\/80 bg-sky-900\/60/);
  assert.match(src, /characters: \{ bar: "border-emerald-500\/80 bg-emerald-900\/60/);
  assert.match(src, /locations: \{ bar: "border-violet-500\/80 bg-violet-900\/60/);
  assert.match(src, /card: "border-sky-400 ring-2 ring-sky-500\/30"/);
  assert.match(src, /card: "border-violet-400 ring-2 ring-violet-500\/30"/);
  assert.match(src, /\$\{isSelected \? selectedClass : "border-edge hover:border-gray-500"\}/);
  assert.match(src, /<Chip tone="violet">장소<\/Chip>/);
  assert.match(src, /<Chip tone="emerald">캐릭터<\/Chip>/);
  // 캐릭터·장소 바는 카드가 세로로 딸린다
  assert.match(src, /kind: "characters", orient: "column"/);
  assert.match(src, /kind: "locations", orient: "column"/);
  assert.match(src, /kind: "scene", orient: "row"/);
  assert.match(src, /const GROUP_GAP_Y = 24;/);
  assert.match(src, /key: "characters", kind: "characters"/);
  assert.match(src, /key: "locations", kind: "locations"/);
  assert.match(src, /label: "장소 · 배경"/);
});

test('★카드 좌표는 바 + 슬롯 번호로만 정해지고, 드롭 시 같은 종류의 가장 가까운 칸에 스냅한다', () => {
  assert.match(src, /: \{ x: b\.x \+ i \* l\.cellW, y: b\.y \+ BAR_H \+ CARD_GAP \};/, '가로 레인(씬)');
  assert.match(src, /\? \{ x: b\.x, y: b\.y \+ BAR_H \+ CARD_GAP \+ i \* \(l\.cardH \+ CARD_GAP\) \}/, '세로 레인(캐릭터·장소)');
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
  assert.match(src, /reconcileLayout\(parsed \|\| fromServer, g, base\)/);
  const i = src.indexOf('function moveCutToSlot(');
  const fn = src.slice(i, src.indexOf('\n}\n', i));
  assert.doesNotMatch(fn, /enqueue|createAgentJob/);
});

test('★배치 저장 버튼: 로컬은 작업 사본, 프로젝트 저장은 버튼으로(서버 payload.canvasLayout)', () => {
  assert.match(src, /const layoutDirty = useMemo\(\(\) => JSON\.stringify\(layout\) !== JSON\.stringify\(serverLayout\)/);
  assert.match(src, /await saveCanvasLayout\(projectId, layout\);/);
  assert.match(src, /\{layoutSaving \? "저장 중…" : \(layoutDirty \? "저장" : "저장됨"\)\}/, '버튼 문구는 저장');
  assert.match(src, /layoutDirty \? "bg-emerald-600 text-white hover:bg-emerald-500" : "border border-edge text-gray-500"/, '테마(에메랄드) 스타일');
  assert.match(src, /setLayout\(reconcileLayout\(parsed \|\| fromServer, g, base\)\);/, '로컬 사본 → 서버 배치 → 기본 배치 순');
  const api = fs.readFileSync(path.join(process.cwd(), 'ai-company-app/src/lib/api.ts'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(api, /export async function saveCanvasLayout\(projectId: string, layout: unknown\)/);
  assert.match(api, /body: JSON\.stringify\(\{ projectId, payload: \{ canvasLayout: layout \} \}\)/);
  const graph = fs.readFileSync(path.join(process.cwd(), 'prototype/functions/api/agent/production-graph.ts'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(graph, /canvasLayout: payload\.canvasLayout && typeof payload\.canvasLayout === "object" \? payload\.canvasLayout : null,/);
});

test('★프롬프트 바(호박색) 아래 공통 카드, 캐릭터·장소 바는 같은 높이로 나란히, 씬은 오른쪽', () => {
  assert.match(src, /type LaneKind = "prompt" \| "scene" \| "characters" \| "locations";/);
  assert.match(src, /prompt: \{ bar: "border-amber-500\/80 bg-amber-900\/50/);
  assert.match(src, /if \(type === "common"\) return "prompt";/);
  assert.match(src, /key: "prompt", kind: "prompt", orient: "column"/);
  assert.match(src, /const promptBottom = 40 \+ BAR_H \+ CARD_GAP \+ NODE_H\.common \+ GROUP_GAP_Y;/);
  assert.match(src, /bars\[l\.key\] = \{ x: assetX, y: promptBottom \};\s*\n\s*assetX \+= l\.cardW \+ 40;/, '캐릭터·장소 바가 같은 높이에서 옆으로');
  assert.doesNotMatch(src, /nodes\.common = \{ x: 40, y: 40 \};/, '공통 카드는 자유 노드가 아니라 프롬프트 바에 딸린다');
});

test('★확장 버튼: 임베드(AI 시네마)면 셸 사이드바를 감추고, AI 기업이면 집중 모드', () => {
  assert.match(src, /onToggleExpand && \(/);
  assert.match(src, /title=\{expanded \? "사이드바 다시 열기" : "확장 \(사이드바 감추기\)"\}/);
  const app = fs.readFileSync(path.join(process.cwd(), 'ai-company-app/src/App.tsx'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(app, /window\.parent\.postMessage\(\{ type: "nk-shell-sidebar", hidden: next \}, "\*"\)/);
  assert.match(app, /canvasExpanded=\{EMBED_MODE \? shellSidebarHidden : focusMode\}/);
  const nav = fs.readFileSync(path.join(process.cwd(), 'prototype/js/navigation.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(nav, /data\.type === 'nk-shell-sidebar'/);
  assert.match(nav, /appEl\.classList\.toggle\('no-sidebar', !!data\.hidden\)/);
  const css = fs.readFileSync(path.join(process.cwd(), 'prototype/styles.css'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(css, /body\.layout-fixed \.app\.no-sidebar > \.sidebar \{\s*\n\s*display: none;/);
});
