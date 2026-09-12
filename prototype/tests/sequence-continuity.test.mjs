// 연속성 4단계: 컷 분해에 시퀀스 문맥 + 코드 검증기.
//  - 씬 경계를 넘어 인접 컷이 같은 셋업(shotType+cameraDirection)이면 사이즈를 한 단계 옮긴다.
//  - 같은 세트 안에서 이동 서술이 없는데 인물 무대 좌표가 달라지면 앵커로 되돌린다.
//  - 분해 프롬프트에 앞·뒤 씬 문맥이 실린다(한/영).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { enforceSequenceContinuity, stepShotType } from '../functions/api/scenario/rebalancer.js';
import { buildShotUserPromptKo, buildShotUserPromptEn, buildSequenceContextLines } from '../functions/api/scenario/shots/decomposer.js';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('★stepShotType: 한 단계 옮기되 핑퐁을 피한다', () => {
  assert.equal(stepShotType(null, 'MS'), 'MLS', '앞앞이 없으면 와이드로');
  assert.equal(stepShotType('WS', 'MS'), 'MCU', '앞앞이 더 와이드였으면 타이트로');
  assert.equal(stepShotType('CU', 'MS'), 'MLS');
  assert.equal(stepShotType(null, 'EWS'), 'WS', '끝에서는 반대로');
  assert.equal(stepShotType('WS', 'ECU'), 'CU');
  assert.equal(stepShotType(null, 'OTS'), 'MS', '특수 샷은 가장 가까운 사이즈 기준');
});

test('★씬 경계를 넘어 같은 셋업이면 뒤 컷의 사이즈를 바꾼다 (방위가 다르면 그대로)', () => {
  const scenes = [
    { id: 1, sceneLocation: '거실', shots: [
      { id: '1.1', shotType: 'WS', cameraMove: 'static', cameraDirection: 'front' },
      { id: '1.2', shotType: 'MS', cameraMove: 'pan', cameraDirection: 'front' },
    ] },
    { id: 2, sceneLocation: '거실', shots: [
      { id: '2.1', shotType: 'MS', cameraMove: 'static', cameraDirection: 'front' },   // 1.2 와 같은 셋업 → 바뀐다
      { id: '2.2', shotType: 'MS', cameraMove: 'static', cameraDirection: 'back' },    // 방위가 다르면 리버스 → 그대로
      { id: '2.3', shotType: 'INSERT', cameraMove: 'static', cameraDirection: 'back' },
      { id: '2.4', shotType: 'INSERT', cameraMove: 'static', cameraDirection: 'back' }, // INSERT 는 제외
    ] },
    { id: 3, sceneLocation: '옥상', shots: [
      { id: '3.1', shotType: 'INSERT', cameraMove: 'static', cameraDirection: 'back' }, // 세트가 다르면 비교 안 함
    ] },
  ];
  const res = enforceSequenceContinuity(scenes);
  assert.equal(res.shotSwaps, 1);
  const s2 = res.scenes[1].shots;
  assert.equal(s2[0].shotType, 'MCU', '앞앞(1.1=WS)이 더 와이드였으니 타이트로');
  assert.equal(s2[0]._autoShotTypeSwap, 'MS');
  assert.equal(s2[1].shotType, 'MS');
  assert.equal(s2[3].shotType, 'INSERT');
  assert.equal(res.scenes[2].shots[0].shotType, 'INSERT');
  // 원본은 건드리지 않는다
  assert.equal(scenes[1].shots[0].shotType, 'MS');
});

test('★같은 세트에서 이동 서술이 없으면 인물 무대 좌표를 앵커로 되돌리고, 이동하면 새 좌표를 받아들인다', () => {
  const scenes = [
    { id: 1, sceneLocation: '교실', visual: '@네모가 칠판 앞에 서 있다', shots: [
      { id: '1.1', shotType: 'WS', cameraDirection: 'front', action: '@네모가 손을 든다',
        blocking: [{ token: '@네모', x: 'left', depth: 'mid', facing: 'camera' }] },
    ] },
    { id: 2, sceneLocation: '복도', visual: '@세모가 뛰어온다', shots: [
      { id: '2.1', shotType: 'MS', cameraDirection: 'front', action: '@세모가 달려온다',
        blocking: [{ token: '@세모', x: 'right', depth: 'far', facing: 'camera' }] },
    ] },
    { id: 3, sceneLocation: '교실', visual: '@네모가 계속 설명한다', shots: [
      // 이동 서술 없음 → 1.1 의 좌표(left/mid)로 되돌린다. facing 은 그대로.
      { id: '3.1', shotType: 'CU', cameraDirection: 'front', action: '@네모가 웃는다',
        blocking: [{ token: '@네모', x: 'right', depth: 'near', facing: 'left' }] },
      // 이동 서술 있음 → 새 좌표 인정, 앵커 갱신
      { id: '3.2', shotType: 'MS', cameraDirection: 'back', action: '@네모가 창가로 걸어간다',
        blocking: [{ token: '@네모', x: 'right', depth: 'far', facing: 'away' }] },
      // 이후 컷은 갱신된 앵커(right/far)를 따른다
      { id: '3.3', shotType: 'MCU', cameraDirection: 'front', action: '@네모가 고개를 든다',
        blocking: [{ token: '@네모', x: 'center', depth: 'mid', facing: 'camera' }] },
    ] },
  ];
  const res = enforceSequenceContinuity(scenes);
  assert.equal(res.blockingAnchors, 2);
  const s3 = res.scenes[2].shots;
  assert.deepEqual(s3[0].blocking[0], { token: '@네모', x: 'left', depth: 'mid', facing: 'left' });
  assert.equal(s3[0]._autoBlockingAnchor, true);
  assert.deepEqual(s3[1].blocking[0], { token: '@네모', x: 'right', depth: 'far', facing: 'away' });
  assert.deepEqual(s3[2].blocking[0], { token: '@네모', x: 'right', depth: 'far', facing: 'camera' });
  // 다른 세트의 인물은 영향 없음
  assert.deepEqual(res.scenes[1].shots[0].blocking[0], { token: '@세모', x: 'right', depth: 'far', facing: 'camera' });
});

test('★영문 이동 서술도 인식한다', () => {
  const scenes = [
    { id: 1, sceneLocation: 'kitchen', shots: [{ id: '1.1', shotType: 'WS', action: '@Ann stirs', blocking: [{ token: '@Ann', x: 'left', depth: 'near', facing: 'camera' }] }] },
    { id: 2, sceneLocation: 'kitchen', shots: [{ id: '2.1', shotType: 'MS', action: '@Ann walks to the table', blocking: [{ token: '@Ann', x: 'right', depth: 'mid', facing: 'camera' }] }] },
  ];
  const res = enforceSequenceContinuity(scenes);
  assert.equal(res.blockingAnchors, 0);
  assert.equal(res.scenes[1].shots[0].blocking[0].x, 'right');
});

test('★분해 프롬프트에 앞·뒤 씬 문맥이 실린다 (한/영, 같은 세트 판단 포함)', () => {
  const prev = { id: 1, sceneLocation: '거실', visual: '@네모가 소파에 앉아 리모컨을 든다.' };
  const cur = { id: 2, estSec: 6, sceneLocation: '거실', visual: '@네모가 채널을 돌린다.' };
  const next = { id: 3, sceneLocation: '주방', visual: '@세모가 물을 마신다.' };
  const ko = buildShotUserPromptKo(cur, { prevScene: prev, nextScene: next, sceneIndex: 1, sceneTotal: 3 });
  assert.match(ko, /\[시퀀스\] 전체 3씬 중 2번째/);
  assert.match(ko, /\[앞 씬\] 세트: 거실 — @네모가 소파에 앉아/);
  assert.match(ko, /앞 씬과 같은 세트다: .*무대 위치\(blocking x\/depth\)를 그대로 유지/);
  assert.match(ko, /\[뒤 씬\] 세트: 주방/);
  const en = buildShotUserPromptEn(cur, { prevScene: next, nextScene: null, sceneIndex: 1, sceneTotal: 3, lang: 'en' });
  assert.match(en, /\[previous scene\] set: 주방/);
  assert.match(en, /New set: this scene may open with an establishing/);
  assert.doesNotMatch(en, /\[next scene\]/);
  assert.deepEqual(buildSequenceContextLines(cur, {}, 'ko'), [], '문맥이 없으면 아무 줄도 넣지 않는다');
  const first = buildShotUserPromptKo(cur, { prevScene: null, nextScene: next, sceneIndex: 0, sceneTotal: 3 });
  assert.match(first, /\[앞 씬\] 없음 — 첫 씬이다\./);
});

test('★decomposeScenes 가 앞·뒤 씬을 넘기고, 다양화 뒤에 시퀀스 검증기를 돌린다', () => {
  const src = read('prototype/functions/api/scenario/shots/index.js');
  assert.match(src, /prevScene: idx > 0 \? scenes\[idx - 1\] : null/);
  assert.match(src, /nextScene: idx < scenes\.length - 1 \? scenes\[idx \+ 1\] : null/);
  const div = src.indexOf('diversifyShotCameraMoves(raw)');
  const seq = src.indexOf('enforceSequenceContinuity(diversified.scenes)');
  assert.ok(div > 0 && seq > div, '검증기는 cameraMove 다양화 뒤에 돌아야 합니다');
  assert.match(src, /meta\.shotTypeSwaps = sequenced\.shotSwaps/);
  assert.match(src, /meta\.blockingAnchors = sequenced\.blockingAnchors/);
});
