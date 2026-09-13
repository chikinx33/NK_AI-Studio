// 제작 캔버스 컷 순서 변경 → 실제 컷 순서(scene_reorder).
//  - 순서의 단일 원천은 scenes 배열 순서. id 는 바꾸지 않고 배열만 재배열한다.
//  - 저장 전 검사: 세트 묶음을 넘어가면 set-crossing, 노래 구간이 어긋나면 song-section 경고(막지 않는다).
//  - 캔버스는 놓기 전에 같은 검사로 확인 창을 띄우고, 확인하면 scene_reorder 잡(승인 게이트, 자동 승인 목록 포함).
// 설계서: docs/storyboard-sheet-consistency-design.md 3.4 / 4.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applySceneOrder, analyzeReorder, movedCutIds, groupBySet, summarizeWarnings } from '../functions/api/_shared/scene-order.js';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

const S = (id, loc, extra = {}) => ({ id, sceneLocation: loc, title: `cut ${id}`, ...extra });

test('applySceneOrder: order 순열대로 재배열하고 id 는 그대로 둔다 · 빠지거나 겹치면 거부', () => {
  const scenes = [S(1, '거실'), S(2, '거실'), S(3, '부엌'), S(4, '부엌')];
  const ok = applySceneOrder(scenes, [1, 2, 4, 3]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.scenes.map((s) => s.id), [1, 2, 4, 3]);
  assert.deepEqual(ok.moved, ['4', '3']);
  assert.equal(applySceneOrder(scenes, [1, 2, 3]).ok, false, '길이가 다르면 거부');
  assert.equal(applySceneOrder(scenes, [1, 2, 3, 3]).ok, false, '중복이면 거부');
  assert.equal(applySceneOrder(scenes, [1, 2, 3, 9]).ok, false, '없는 컷이면 거부');
  const same = applySceneOrder(scenes, ['1', '2', '3', '4']);
  assert.equal(same.ok, true);
  assert.deepEqual(same.moved, [], '그대로면 옮긴 컷 없음');
});

test('movedCutIds: 끌어다 놓은 컷 하나만 옮긴 컷으로 잡는다(나머지는 상대 순서 유지)', () => {
  assert.deepEqual(movedCutIds(['1', '2', '3', '4', '5'], ['1', '2', '4', '5', '3']), ['3']);
  assert.deepEqual(movedCutIds(['1', '2', '3', '4', '5'], ['5', '1', '2', '3', '4']), ['5']);
  assert.deepEqual(movedCutIds(['1', '2', '3'], ['1', '2', '3']), []);
});

test('groupBySet: 연속 같은 장소 = 한 묶음, 빈 장소는 항상 새 묶음(시나리오 화면 Scene N 규칙)', () => {
  const g = groupBySet([S(1, '거실'), S(2, '거실'), S(3, ''), S(4, ''), S(5, '거실')]);
  assert.deepEqual(g.map((x) => x.ids), [['1', '2'], ['3'], ['4'], ['5']]);
});

test('★같은 세트 안에서 자리를 바꾸면 경고 없음', () => {
  const before = [S(1, '거실'), S(2, '거실'), S(3, '거실'), S(4, '부엌')];
  const after = applySceneOrder(before, [2, 1, 3, 4]).scenes;
  assert.deepEqual(analyzeReorder(before, after, {}), []);
});

test('★세트를 넘어가면 set-crossing 경고(막지는 않는다)', () => {
  const before = [S(1, '거실'), S(2, '거실'), S(3, '부엌'), S(4, '부엌')];
  const after = applySceneOrder(before, [1, 3, 2, 4]).scenes; // 부엌 컷 3 이 거실 사이로
  const w = analyzeReorder(before, after, {});
  assert.equal(w.length, 1);
  assert.equal(w[0].code, 'set-crossing');
  assert.equal(w[0].sceneId, '3');
  assert.match(w[0].message, /세트 묶음을 넘어갔어요/);
  assert.match(summarizeWarnings(w), /세트를 넘어감 1건/);
});

test('★세트 경계로 옮겨 붙으면(같은 세트 옆) 경고 없음 · 세트 묶음 수가 늘면 경고', () => {
  const before = [S(1, '거실'), S(2, '거실'), S(3, '부엌'), S(4, '부엌')];
  // 컷 2 를 부엌 뒤로 → 거실 | 부엌 부엌 | 거실 : 묶음 2→3 으로 늘어남
  const after = applySceneOrder(before, [1, 3, 4, 2]).scenes;
  const w = analyzeReorder(before, after, {});
  assert.equal(w.length, 1);
  assert.equal(w[0].code, 'set-crossing');
  // 컷 4 를 컷 3 앞으로(같은 세트 안) → 경고 없음
  assert.deepEqual(analyzeReorder(before, applySceneOrder(before, [1, 2, 4, 3]).scenes, {}), []);
});

test('★노래 구간 순서가 어긋나면 song-section 경고 · 가사 컷이 구간 첫 컷이 아니게 돼도 경고', () => {
  const payload = { songSections: [{ id: 'sec_01', label: '[1절]' }, { id: 'sec_02', label: '[후렴]' }] };
  const before = [
    S(1, '거실', { songSectionId: 'sec_01', songSectionLabel: '[1절]', lyrics: '가나다' }),
    S(2, '거실', { songSectionId: 'sec_01', songSectionLabel: '[1절]' }),
    S(3, '거실', { songSectionId: 'sec_02', songSectionLabel: '[후렴]', lyrics: '라마바' }),
    S(4, '거실', { songSectionId: 'sec_02', songSectionLabel: '[후렴]' }),
  ];
  // 후렴 컷 4 를 1절 사이로: 구간 순서 어긋남
  const w1 = analyzeReorder(before, applySceneOrder(before, [1, 4, 2, 3]).scenes, payload);
  assert.ok(w1.some((w) => w.code === 'song-section' && w.sceneId === '2'), '컷 2(1절)가 컷 4(후렴) 뒤에 오면 어긋남');
  assert.ok(w1.some((w) => w.code === 'song-section' && w.sceneId === '3' && /첫 컷이 아니에요/.test(w.message)), '가사 컷 3 이 후렴의 첫 컷이 아니게 됨');
  assert.match(summarizeWarnings(w1), /노래 구간 어긋남/);
  // 같은 구간 안에서 순서만 바꾸고 가사 컷이 여전히 첫 컷이면 경고 없음
  assert.deepEqual(analyzeReorder(before, applySceneOrder(before, [1, 2, 3, 4]).scenes, payload), []);
  // 가사 없는 컷끼리 같은 구간 안에서 바꿔도 경고 없음: 컷 2 는 가사 없음 → 1,2 순서 유지, 3,4 는 가사 컷 3 이 앞이므로 그대로
  const swapInside = analyzeReorder(before, applySceneOrder(before, [2, 1, 3, 4]).scenes, payload);
  assert.ok(swapInside.some((w) => w.sceneId === '1' && /첫 컷이 아니에요/.test(w.message)), '가사 컷 1 이 뒤로 가면 경고');
  assert.deepEqual(analyzeReorder(before, applySceneOrder(before, [1, 2, 3, 4]).scenes, {}), [], '노래 구간이 없는 프로젝트는 검사하지 않는다');
});

test('★서버 도구 scene_reorder: 등록(게이트) · 순수 로직 재사용 · 저장은 /api/project/save 로', () => {
  const shared = read('prototype/functions/api/agent/_shared.ts');
  assert.match(shared, /import \{ applySceneOrder, analyzeReorder, summarizeWarnings \} from "\.\.\/_shared\/scene-order\.js";/);
  assert.match(shared, /async function runSceneReorderTool\(input: any, ctx: ToolContext\)/);
  assert.match(shared, /scene_reorder: \{ agentId: "plot", kind: "external", gate: true, run: runSceneReorderTool \}/);
  const i = shared.indexOf('async function runSceneReorderTool(');
  const fn = shared.slice(i, shared.indexOf('\n}\n', i));
  assert.match(fn, /const applied = applySceneOrder\(scenes, order\);/);
  assert.match(fn, /analyzeReorder\(scenes, applied\.scenes, cur\.payload \|\| \{\}\)/);
  assert.match(fn, /callInternalJson\(ctx, "\/api\/project\/save", \{ body: \{ projectId, scenes: applied\.scenes \} \}\)/);
  assert.doesNotMatch(fn, /\.id = /, 'id 를 다시 매기지 않는다');
  const orch = read('prototype/functions/api/agent/_orchestrator.ts');
  assert.match(orch, /scene_reorder: `\[\[RUN: scene_reorder \| \{"projectId"/);
  assert.match(orch, /scene_reorder: "컷 순서 변경"/);
});

test('★그래프가 노래 구간 필드를 싣는다(컷: songSectionId/label/isRefrain · 프로젝트: songSections)', () => {
  const graph = read('prototype/functions/api/agent/production-graph.ts');
  assert.match(graph, /songSectionId: String\(s\?\.songSectionId \|\| ""\),/);
  assert.match(graph, /songSectionLabel: String\(s\?\.songSectionLabel \|\| ""\),/);
  assert.match(graph, /isRefrain: !!s\?\.isRefrain,/);
  assert.match(graph, /songSections: Array\.isArray\(payload\.songSections\)/);
  const api = read('ai-company-app/src/lib/api.ts');
  assert.match(api, /songSections\?: Array<\{ id: string; label: string; role: string \}>;/);
});

test('★캔버스: 컷 카드를 놓으면 순서를 비교해 경고를 묻고, 확인하면 scene_reorder 잡을 만든다(자동 승인 목록 포함)', () => {
  const src = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(src, /import \{ analyzeReorderClient, sameOrder, type OrderCut \} from "\.\.\/lib\/sceneOrder";/);
  assert.match(src, /const orderOfLayout = useCallback\(\(l: CanvasLayout\): OrderCut\[\] => \{/);
  assert.match(src, /deriveLanes\(graph\)\.filter\(\(ln\) => ln\.kind === "scene"\)/, '씬 바 순서 → 칸 순서가 실제 순서');
  assert.match(src, /const next = moveCutToSlot\(layoutRef\.current, d\.id, slot\);/);
  assert.match(src, /if \(dropped\?\.type === "cut" && projectId\) \{/, '캐릭터·장소 카드는 순서 변경 대상이 아니다');
  assert.match(src, /if \(!sameOrder\(before, after\)\) \{/);
  assert.match(src, /const warnings = analyzeReorderClient\(before, after, d\.id, graph\?\.songSections\);/);
  assert.match(src, /if \(warnings\.length && !window\.confirm\(/, '경고가 있으면 먼저 묻는다');
  assert.match(src, /"그래도 컷 순서를 바꿀까요\?"/);
  assert.match(src, /void enqueue\("scene_reorder", \{ projectId, order: after\.map\(\(c\) => c\.sceneId\) \}/);
  assert.match(src, /const AUTO_APPROVE_TYPES = \["scene_still", "scene_video", "scene_upsert", "scene_reorder"\];/);
  // 잡이 실행된 뒤의 재로드에서 칸 배치는 서버 순서로 다시 묶는다(바 위치는 유지)
  assert.match(src, /if \(p\.type === "scene_reorder" && status === "approved"\) \{\s*\n\s*reorderResetRef\.current = true;/);
  assert.match(src, /const seed = reorderResetRef\.current && savedLayout \? \{ \.\.\.savedLayout, groups: undefined \} : savedLayout;/);
  // moveCutToSlot 자체는 순수(배치만) — 잡은 드롭 처리에서만
  const i = src.indexOf('function moveCutToSlot(');
  const fn = src.slice(i, src.indexOf('\n}\n', i));
  assert.doesNotMatch(fn, /enqueue|createAgentJob/);
  // 클라이언트 검사 모듈은 서버와 같은 두 코드를 낸다
  const cli = read('ai-company-app/src/lib/sceneOrder.ts');
  assert.match(cli, /code: "set-crossing" \| "song-section"/);
  assert.match(cli, /export function countSets\(cuts: OrderCut\[\]\): number/);
});
