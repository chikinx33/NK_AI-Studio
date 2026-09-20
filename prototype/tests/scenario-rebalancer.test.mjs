import test from 'node:test';
import assert from 'node:assert/strict';

import {
  splitOneUniformRun,
  splitUniformRuns,
  padScenesToBeatCount,
  diversifyShotCameraMoves,
  enforceSequenceContinuity,
  setupSimilarity,
} from '../functions/api/scenario/rebalancer.js';

test('splitOneUniformRun: 3개 연속 동일 estSec 구간을 한 번 분할', () => {
  const scenes = [
    { id: 1, estSec: 4, visual: '도입', action: '소개' },
    { id: 2, estSec: 6, visual: '첫 만남이 시작된다.', action: '첫 행동' },
    { id: 3, estSec: 6, visual: '두 번째 만남이 이어진다.', action: '두 번째 행동' },
    { id: 4, estSec: 6, visual: '세 번째 만남이 깊어진다.', action: '세 번째 행동' },
    { id: 5, estSec: 4, visual: '마무리', action: '엔딩' },
  ];
  const res = splitOneUniformRun(scenes);
  assert.equal(res.splitApplied, true);
  assert.equal(res.scenes.length, 6);
  // 분할된 두 씬의 estSec 합은 원본과 같아야 함
  const splitA = res.scenes[res.splitIndex];
  const splitB = res.scenes[res.splitIndex + 1];
  assert.equal(Math.round((splitA.estSec + splitB.estSec) * 10) / 10, 6);
  // 비대칭 분할 — A != B
  assert.notEqual(splitA.estSec, splitB.estSec);
});

test('splitOneUniformRun: 연속 동일 없으면 변경 없음', () => {
  const scenes = [
    { id: 1, estSec: 4 },
    { id: 2, estSec: 6 },
    { id: 3, estSec: 3 },
  ];
  const res = splitOneUniformRun(scenes);
  assert.equal(res.splitApplied, false);
  assert.equal(res.scenes.length, 3);
});

test('splitUniformRuns: 반복 적용 후 안정', () => {
  const scenes = [
    { id: 1, estSec: 6, visual: 'A' },
    { id: 2, estSec: 6, visual: 'B' },
    { id: 3, estSec: 6, visual: 'C' },
    { id: 4, estSec: 6, visual: 'D' },
    { id: 5, estSec: 6, visual: 'E' },
  ];
  const res = splitUniformRuns(scenes);
  assert.ok(res.splits >= 1, '최소 1회 분할');
  // 결과의 어느 3개 연속도 동일 estSec 이면 안 됨
  const secs = res.scenes.map((s) => s.estSec);
  let maxRun = 1;
  let run = 1;
  for (let i = 1; i < secs.length; i++) {
    if (Math.abs(secs[i] - secs[i - 1]) < 0.01) run++;
    else run = 1;
    if (run > maxRun) maxRun = run;
  }
  assert.ok(maxRun < 3, `안정 후 3개+ 연속 없어야 함 (got ${maxRun})`);
  // id 재부여
  res.scenes.forEach((s, idx) => assert.equal(s.id, idx + 1));
});

test('padScenesToBeatCount: 씬 부족 시 빈 슬롯으로 채움', () => {
  const scenes = [
    { id: 1, estSec: 3, visual: 'A' },
    { id: 2, estSec: 3, visual: 'B' },
  ];
  const beats = [
    { id: 'beat_01', action: '비트1' },
    { id: 'beat_02', action: '비트2' },
    { id: 'beat_03', action: '비트3', isClimax: true },
    { id: 'beat_04', action: '비트4 결말', isClimax: true },
  ];
  const res = padScenesToBeatCount(scenes, beats);
  assert.equal(res.padded, 2);
  assert.equal(res.scenes.length, 4);
  // 추가된 슬롯에 비트 매핑이 있어야 함
  assert.deepEqual(res.scenes[2].coversBeats, ['beat_03']);
  assert.deepEqual(res.scenes[3].coversBeats, ['beat_04']);
  assert.equal(res.scenes[3]._autoPadded, true);
});

test('padScenesToBeatCount: 씬 충분하면 변경 없음', () => {
  const scenes = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const beats = [{ action: 'a' }, { action: 'b' }];
  const res = padScenesToBeatCount(scenes, beats);
  assert.equal(res.padded, 0);
  assert.equal(res.scenes.length, 3);
});

test('diversifyShotCameraMoves: 인접 동일 cameraMove를 풀에서 치환', () => {
  const scenes = [
    {
      id: 1,
      shots: [
        { id: '1.1', cameraMove: 'push-in', action: '다가감' },
        { id: '1.2', cameraMove: 'push-in', action: '계속 다가감' },
        { id: '1.3', cameraMove: 'push-in', action: '더 다가감' },
      ],
    },
  ];
  const res = diversifyShotCameraMoves(scenes);
  assert.ok(res.swaps >= 1, '최소 1건 치환 발생');
  const moves = res.scenes[0].shots.map((s) => s.cameraMove);
  // 인접 동일이 더 이상 없어야 함
  for (let i = 1; i < moves.length; i++) {
    assert.notEqual(moves[i], moves[i - 1], `샷 ${i}와 ${i + 1}이 같은 무브 (${moves[i]})`);
  }
});

test('diversifyShotCameraMoves: 인접 다른 무브는 그대로 유지', () => {
  const scenes = [
    {
      id: 1,
      shots: [
        { id: '1.1', cameraMove: 'static' },
        { id: '1.2', cameraMove: 'push-in' },
        { id: '1.3', cameraMove: 'pan-left' },
      ],
    },
  ];
  const res = diversifyShotCameraMoves(scenes);
  assert.equal(res.swaps, 0);
  assert.equal(res.scenes[0].shots[0].cameraMove, 'static');
  assert.equal(res.scenes[0].shots[1].cameraMove, 'push-in');
  assert.equal(res.scenes[0].shots[2].cameraMove, 'pan-left');
});

test('★연속 구도 검사: WS와 GROUP이어도 같은 인물·배치·정면이면 점프컷 위험으로 판정해 실제 커버리지로 변경', () => {
  const blocking = [
    { token: '@동그라미', x: 'left', depth: 'near', facing: 'camera' },
    { token: '@네모', x: 'center', depth: 'mid', facing: 'camera' },
    { token: '@세모', x: 'right', depth: 'near', facing: 'camera' },
  ];
  const a = { id: '1.6', shotType: 'WS', cameraMove: 'zoom', cameraDirection: 'front', composition: '@동그라미 @네모 @세모와 중앙의 ABC큐브', action: '@네모가 큐브를 들어 올린다', blocking };
  const b = { id: '1.7', shotType: 'GROUP', cameraMove: 'pull-out', cameraDirection: 'front', composition: '@동그라미 @네모 @세모와 중앙의 ABC큐브', action: '셋이 춤을 춘다', blocking };
  assert.ok(setupSimilarity(a, b) >= 0.75);
  const out = enforceSequenceContinuity([{ id: 1, sceneLocation: '소녀의 방', shots: [a, b] }]);
  const fixed = out.scenes[0].shots[1];
  assert.notEqual(fixed.cameraDirection, 'front', '같은 책장 벽을 반복하지 않도록 카메라 방위를 바꾼다');
  assert.ok(Math.abs(['ECU', 'CU', 'MCU', 'MS', 'MLS', 'WS', 'EWS'].indexOf(fixed.shotType) - 5) >= 2, '화면 크기도 두 단계 이상 바꾼다');
  assert.equal(out.coverageFixes, 1);
  assert.ok(fixed._autoCoverageChange);
});

test('★방향 충돌 검사: 뒷모습 서술은 모델이 front를 내도 back 플레이트로 보정', () => {
  const out = enforceSequenceContinuity([{ id: 1, sceneLocation: '교실', shots: [{
    id: '1.1', shotType: 'MS', cameraMove: 'static', cameraDirection: 'front',
    composition: '@네모의 뒷모습이 화면 중앙에 보인다', action: '@네모가 반대편 벽을 바라본다',
    blocking: [{ token: '@네모', x: 'center', depth: 'mid', facing: 'camera' }],
  }] }]);
  assert.equal(out.scenes[0].shots[0].cameraDirection, 'back');
  assert.equal(out.directionFixes, 1);
});

test('★방향 다양성 검사: 같은 세트의 3개 연속 컷을 모두 front 배경으로 두지 않는다', () => {
  const out = enforceSequenceContinuity([{ id: 1, sceneLocation: '방', shots: [
    { id: '1.1', shotType: 'WS', cameraDirection: 'front', composition: '@네모 전신', action: '걷는다' },
    { id: '1.2', shotType: 'CU', cameraDirection: 'front', composition: '@세모 얼굴', action: '웃는다' },
    { id: '1.3', shotType: 'INSERT', cameraDirection: 'front', composition: 'ABC큐브', action: '빛난다' },
    { id: '1.4', shotType: 'MS', cameraDirection: 'front', composition: '@동그라미 상반신', action: '박수친다' },
  ] }]);
  // INSERT 는 방향 다양성 대상이 아니므로 앞선 두 인물 컷 뒤의 다음 인물 컷이 측면으로 바뀐다.
  assert.notEqual(out.scenes[0].shots[3].cameraDirection, 'front');
  assert.equal(out.scenes[0].shots[3]._autoDirectionCoverage, 'front-run');
});
