import test from 'node:test';
import assert from 'node:assert/strict';

import {
  splitOneUniformRun,
  splitUniformRuns,
  padScenesToBeatCount,
  diversifyShotCameraMoves,
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
