// 컷 분해 견고성: 응답이 잘려도 완성된 샷은 살리고, 폴백된 씬은 사유와 함께 화면에 드러난다.
// (2026-09-12 생성 결과에서 5씬 중 2씬이 조용히 폴백돼 화면=행동·블로킹 없음·다중 컷 서술이 그대로 남았던 문제)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { parseShotResponse, salvageTruncatedShots, buildShotPromptKo, buildShotPromptEn } from '../functions/api/scenario/shots/decomposer.js';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

const full = JSON.stringify({ shots: [
  { id: '3.1', duration: 4, shotType: 'WS', cameraMove: 'static', cameraDirection: 'front', composition: '@네모 중앙 { 괄호 } 포함 "따옴표"', action: 'a', dialogue: null, beats: null, blocking: [{ token: '@네모', x: 'center', depth: 'mid', facing: 'camera' }] },
  { id: '3.2', duration: 5, shotType: 'CU', cameraMove: 'push_in', cameraDirection: 'back', composition: 'b', action: 'b', dialogue: null, beats: [{ at: 0, what: 'x' }, { at: 2, what: 'y' }], blocking: null },
  { id: '3.3', duration: 4, shotType: 'MS', cameraMove: 'pan', cameraDirection: 'left', composition: 'c', action: 'c', dialogue: null, beats: null, blocking: null },
] });

test('★max_tokens 로 잘린 JSON 에서 완성된 샷만 건진다 (마지막 잘린 샷은 버린다)', () => {
  const cut = full.slice(0, full.lastIndexOf('"composition":"c"') + 10); // 3번째 샷 중간에서 잘림
  const salvaged = salvageTruncatedShots(cut);
  assert.equal(salvaged.shots.length, 2);
  assert.equal(salvaged.shots[0].composition, '@네모 중앙 { 괄호 } 포함 "따옴표"', '문자열 안의 중괄호·따옴표에 속지 않는다');
  const shots = parseShotResponse(cut, { id: 3 });
  assert.equal(shots.length, 2, 'parseShotResponse 가 구제 결과를 쓴다');
  assert.equal(shots[1].cameraDirection, 'back');
  assert.equal(shots[1].beats.length, 2);
});

test('★정상 JSON·코드펜스는 예전처럼 처리되고, 샷이 하나도 완성되지 않으면 null', () => {
  assert.equal(parseShotResponse(full, { id: 3 }).length, 3);
  assert.equal(parseShotResponse('```json\n' + full + '\n```', { id: 3 }).length, 3);
  assert.equal(salvageTruncatedShots('{"shots":[{"id":"1.1","composition":"잘림'), null);
  assert.equal(parseShotResponse('{"shots":[{"id":"1.1","composition":"잘림', { id: 1 }), null);
  assert.equal(salvageTruncatedShots('no json here'), null);
});

test('★분해 프롬프트에 길이 제한(잘림 방지)이 한/영으로 있다', () => {
  assert.match(buildShotPromptKo(), /\[길이 제한 — 응답이 잘리면 이 씬 전체가 자동 폴백/);
  assert.match(buildShotPromptKo(), /composition 120자 이내, action 160자 이내, beats\.what 80자 이내, 샷은 4개 이내/);
  assert.match(buildShotPromptEn(), /\[Length limits — a truncated response drops this WHOLE scene/);
  assert.match(buildShotPromptEn(), /composition ≤ 120 characters, action ≤ 160, beats\.what ≤ 80, at most 4 shots/);
});

test('★토큰 상한·타임아웃 상향, stop_reason 이 실패 사유에 실리고 폴백 사유가 meta 로 나간다', () => {
  const src = read('prototype/functions/api/scenario/shots/index.js');
  assert.match(src, /const SHOT_MAX_TOKENS = 1600;/);
  assert.match(src, /const SHOT_TIMEOUT_MS = 25000;/);
  assert.match(src, /lastStopReason = String\(data\?\.stop_reason \|\| ""\);/);
  assert.match(src, /"shot_parse_failed" \+ \(lastStopReason \? "\(stop=" \+ lastStopReason \+ "\)" : ""\)/);
  assert.match(src, /meta\.fallbackReasons\.push\(\{ sceneId: scene\?\.id \?\? idx \+ 1, reason \}\)/);
});

test('★평탄화된 컷이 폴백 사유(decomposeFallback)를 나르고, 화면이 칩과 토스트로 보여 준다', () => {
  const flat = read('prototype/functions/api/scenario-shots.js');
  assert.match(flat, /decomposeFallback: String\(parent\.shotsFallback \|\| ""\)/);
  const ui = read('prototype/js/ui/scenario.js');
  assert.match(ui, /decomposeFallback: String\(s\.decomposeFallback \|\| ''\)\.trim\(\)/, 'normalizeScenes 가 사유를 버립니다');
  assert.match(ui, /card-fallback-chip/);
  assert.match(ui, /decomposeFallbackChip: '분해 실패'/);
  assert.match(ui, /decomposeFallbackChip: 'Decompose failed'/);
  assert.match(ui, /shotsM\.fallbackReasons/);
  assert.match(read('prototype/styles.css'), /\.card-fallback-chip \{/);
});
