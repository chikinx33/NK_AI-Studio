// 씬 나누기(sceneBreak): 같은 세트 안에서 씬을 둘로 가르는 표시. 캔버스 우선 개발.
//  - 캔버스: 컷(다중 선택)을 모든 씬 바 아래로 떼어내면 가장 앞 컷부터 새 씬 · 씬 바 ＋ 버튼 · 이전 씬과 합치기(⇤)
//  - 서버 scene_split 도구(게이트, 캔버스 자동 승인) · 필드는 save/get·컷 분해 평탄화·프로덕션 재조립·시나리오 정규화/수집/머지 길목을 모두 통과
//  - 씬 바·시나리오 Scene N 라벨 규칙: 장소가 바뀌거나 sceneBreak 인 컷에서 새 씬
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('★sceneBreak 가 길목을 모두 통과한다 (save/get · 컷 분해 평탄화 · 프로덕션 재조립 · 시나리오 정규화/수집/머지 · 그래프)', () => {
  for (const f of ['prototype/functions/api/project/save.ts', 'prototype/functions/api/project/get.ts']) assert.match(read(f), /sceneBreak: !!s\?\.sceneBreak,/, f);
  const shots = read('prototype/functions/api/scenario-shots.js');
  assert.match(shots, /sceneBreak: isFirst \? !!parent\.sceneBreak : false,/, '첫 컷만 상속');
  assert.match(shots, /sceneBreak: !!parent\.sceneBreak,/);
  assert.match(read('prototype/ui/pipeline.js'), /sceneBreak: !!s\.sceneBreak,/);
  const ui = read('prototype/js/ui/scenario.js');
  assert.match(ui, /sceneBreak: !!s\?\.sceneBreak,/, '정규화');
  assert.match(ui, /sceneBreak: String\(card\.dataset\.sceneBreak \|\| ''\) === '1',/, '카드 수집');
  assert.match(ui, /data-scene-break="\$\{s\.sceneBreak \? '1' : ''\}"/, '카드 렌더');
  assert.match(ui, /const sceneBreak = \(s\.sceneBreak !== undefined \? !!s\.sceneBreak : !!prev\.sceneBreak\);/, '머지');
  assert.match(read('prototype/functions/api/agent/production-graph.ts'), /sceneBreak: !!s\?\.sceneBreak,/);
});

test('★씬 경계 규칙이 캔버스 씬 바와 시나리오 Scene N 라벨에서 같다: 장소 변화 또는 sceneBreak', () => {
  assert.match(read('ai-company-app/src/components/ProductionCanvas.tsx'), /if \(!last \|\| !loc \|\| loc !== last\.location \|\| !!n\.data\.sceneBreak\) \{/);
  assert.match(read('prototype/js/ui/scenario.js'), /if \(!loc \|\| loc !== lastLoc \|\| !!\(sc && sc\.sceneBreak\)\) \{/);
});

test('★서버 scene_split 도구: 게이트 · sceneBreak 만 바꿈(순서·장소 불변) · 첫 컷은 거부 · scene_upsert FIELDS 포함', () => {
  const shared = read('prototype/functions/api/agent/_shared.ts');
  assert.match(shared, /scene_split: \{ agentId: "plot", kind: "external", gate: true, run: runSceneSplitTool \}/);
  const i = shared.indexOf('async function runSceneSplitTool(');
  const fn = shared.slice(i, shared.indexOf('\n}\n', i));
  assert.match(fn, /if \(split && idx === 0\) throw new Error\("첫 컷은 이미 첫 씬의 시작이에요\."\);/);
  assert.match(fn, /scenes\[idx\] = \{ \.\.\.scenes\[idx\], sceneBreak: split \};/);
  assert.match(fn, /callInternalJson\(ctx, "\/api\/project\/save", \{ body: \{ projectId, scenes \} \}\)/);
  assert.doesNotMatch(fn, /sceneLocation|applySceneOrder/, '순서·장소는 건드리지 않는다');
  assert.match(shared, /"cutRefId", "cutRefEnabled", "sceneBreak"\];/);
  assert.match(read('prototype/functions/api/agent/_orchestrator.ts'), /scene_split: "씬 나누기\/합치기"/);
});

test('★캔버스: 씬 바 아래로 떼어내면 가장 앞 컷부터 새 씬 · ＋ 버튼(선택 컷 우선, 없으면 컷 번호 입력) · ⇤ 이전 씬과 합치기 · 자동 승인 · 완료 후 재묶음', () => {
  const src = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(src, /const splitSceneAt = async \(cutNodeId: string\) => \{/);
  assert.match(src, /await enqueue\("scene_split", \{ projectId, sceneId: n\.data\.sceneId, split: true \}, `씬 나누기 · 컷 \$\{n\.data\.sceneId\}부터`, n\.data\.sceneId\);/);
  assert.match(src, /const splitFromSelection = async \(draggedId: string, laneKey\?: string\) => \{/);
  assert.match(src, /const picked = order\.filter\(\(c\) => multi\.has\(c\.id\) \|\| c\.id === draggedId\)/, '다중 선택 + 끌던 컷');
  assert.match(src, /if \(Number\.isFinite\(bottom\) && gy > bottom \+ CARD_GAP \* 2\) \{ void splitFromSelection\(d\.id, fromLane\?\.key\); return; \}/, '모든 씬 바 아래 = 씬 나누기');
  assert.match(src, /const mergeSceneIntoPrev = async \(laneKey: string\) => \{/);
  assert.match(src, /await enqueue\("scene_split", \{ projectId, sceneId: n\.data\.sceneId, split: false \}, `씬 합치기 · 컷 \$\{n\.data\.sceneId\}`, n\.data\.sceneId\);/);
  assert.match(src, /aria-label="씬 나누기">\+<\/button>/);
  assert.match(src, /aria-label="이전 씬과 합치기">⇤<\/button>/);
  assert.match(src, /const canMerge = !!firstNode\?\.data\?\.sceneBreak;/);
  assert.match(src, /window\.prompt\(`Scene \$\{l\.index\}을\(를\) 나눠요\. 몇 번 컷부터 새 씬으로 할까요\?/);
  assert.match(src, /const AUTO_APPROVE_TYPES = \["scene_still", "scene_video", "scene_upsert", "scene_reorder", "set_sheet", "location_merge", "scene_split", "style_anchor_set"\];/);
  assert.match(src, /if \(p\.type === "scene_split" && status === "approved"\) reorderResetRef\.current = true;/);
});

test('★컷 카드 상단 바 클릭 = 선택 토글(상세 안 열림), 그 외 영역 = 상세', () => {
  const src = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(src, /className="flex cursor-pointer items-center gap-1\.5 border-b border-edge px-3 py-2" data-zone="header"/);
  assert.match(src, /if \(d\.kind === "cut" && d\.id && !d\.moved && d\.zone === "header" && nodeById\.get\(d\.id\)\?\.type === "cut"\) \{\s*\n[\s\S]{0,200}setSelectedId\(""\);\s*\n\s*setMulti\(/);
});

test('★빈 씬 바(컷 0)에는 − 버튼: 잔상 바를 걷어내고 씬 바를 서버 순서로 다시 묶는다', () => {
  const src = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(src, /\{l\.kind === "scene" && l\.memberIds\.length === 0 && \(/);
  assert.match(src, /setLayout\(\(cur\) => reconcileLayout\(\{ \.\.\.cur, groups: undefined \}, graph, defaultLayout\(graph, measuredH\)\)\);/);
  assert.match(src, /aria-label="빈 씬 바 지우기">−<\/button>/);
});
