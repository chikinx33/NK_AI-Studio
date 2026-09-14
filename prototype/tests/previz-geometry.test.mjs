// 프리비즈 기하·모델: 3D 배치 ↔ 컷 필드(blocking·cameraDirection·cameraElevation·shotType·cameraMove) 변환을 못박는다.
// 좌표 규약은 stage-geometry.js(정면 기준 블로킹)와 같아야 이미지·영상 프롬프트와 세트 플레이트 선택이 그대로 소비한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAspect, verticalFovDeg, wrapDeg, lerpAngleDeg, sampleActor, sampleCamera,
  quantizeX, quantizeDepth, facingOfYaw, yawOfFacing, cellPosition,
  cameraDirectionOf, cameraElevationOf, shotSizeOf, cameraMoveOf, cameraFromCutFields, primarySubject,
} from '../../ai-company-app/src/previz/geometry.ts';
import {
  normalizeDoc, initialCut, deriveCutFields, upsertKey, addKeyAt, removeKeyAt, moveKeyTo, changedFields, setKeyOf, ensureSet,
} from '../../ai-company-app/src/previz/model.ts';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('화면비와 렌즈 → 세로 화각: 16:9 는 긴 변 36mm 기준, 세로 영상은 세로가 긴 변', () => {
  assert.ok(near(parseAspect('16:9'), 16 / 9));
  assert.ok(near(parseAspect('9:16'), 9 / 16));
  assert.ok(near(parseAspect('2.39:1'), 2.39));
  assert.ok(near(parseAspect(''), 16 / 9));
  // 16:9 에서 세로 센서 = 20.25mm → 35mm 렌즈 세로 화각 약 32.3°
  assert.ok(near(verticalFovDeg(35, 16 / 9), 32.3, 0.1));
  // 9:16 에서는 세로가 36mm → 같은 렌즈가 더 넓게 담는다
  assert.ok(verticalFovDeg(35, 9 / 16) > verticalFovDeg(35, 16 / 9));
});

test('회전 보간은 짧은 쪽으로 돈다(350°→10° 가 한 바퀴 돌지 않음)', () => {
  assert.equal(wrapDeg(190), -170);
  assert.ok(near(lerpAngleDeg(170, -170, 0.5), 180));
  const mid = sampleActor([{ t: 0, x: 0, z: 0, yaw: 350, ease: 'linear' }, { t: 2, x: 2, z: 0, yaw: 10, ease: 'linear' }], 1);
  assert.ok(near(Math.abs(mid.yaw), 0, 1e-6) || near(Math.abs(mid.yaw), 360, 1e-6));
  assert.ok(near(mid.x, 1));
});

test('같은 시각 키 두 개도 0으로 나누지 않는다(오브젝트가 사라지지 않음)', () => {
  const s = sampleCamera([{ t: 1, pos: [0, 1, 5], target: [0, 1, 0], focal: 35 }, { t: 1, pos: [1, 1, 5], target: [0, 1, 0], focal: 35 }], 1);
  assert.ok(s.pos.every(Number.isFinite));
});

test('기본 보간은 부드럽게(가감속), linear 키는 등속', () => {
  const keys = (ease) => [{ t: 0, x: 0, z: 0, yaw: 0, ease }, { t: 1, x: 1, z: 0, yaw: 0 }];
  assert.ok(sampleActor(keys('smooth'), 0.25).x < 0.25);
  assert.ok(near(sampleActor(keys('linear'), 0.25).x, 0.25));
});

test('블로킹 격자: 정면 기준 좌/중/우 · 근/중/원 · 시선 — stage-geometry.js 와 같은 규약', () => {
  assert.equal(quantizeX(-2, 6), 'left');
  assert.equal(quantizeX(0.5, 6), 'center');
  assert.equal(quantizeX(2, 6), 'right');
  assert.equal(quantizeDepth(1.5, 5), 'near');
  assert.equal(quantizeDepth(-1.5, 5), 'far');
  assert.equal(quantizeDepth(0, 5), 'mid');
  assert.equal(facingOfYaw(0), 'camera');
  assert.equal(facingOfYaw(180), 'away');
  assert.equal(facingOfYaw(90), 'right');
  assert.equal(facingOfYaw(-90), 'left');
  for (const f of ['camera', 'away', 'left', 'right']) assert.equal(facingOfYaw(yawOfFacing(f)), f);
  for (const x of ['left', 'center', 'right']) for (const d of ['near', 'mid', 'far']) {
    const [px, pz] = cellPosition(x, d, 6, 5);
    assert.equal(quantizeX(px, 6), x);
    assert.equal(quantizeDepth(pz, 5), d);
  }
});

test('카메라 방위: -Z 를 보면 정면, +Z 리버스(back), +X 오른쪽, -X 왼쪽', () => {
  assert.equal(cameraDirectionOf([0, 1.6, 5], [0, 1.6, 0]), 'front');
  assert.equal(cameraDirectionOf([0, 1.6, -5], [0, 1.6, 0]), 'back');
  assert.equal(cameraDirectionOf([-5, 1.6, 0], [0, 1.6, 0]), 'right');
  assert.equal(cameraDirectionOf([5, 1.6, 0], [0, 1.6, 0]), 'left');
});

test('카메라 높이: 수평=eye, 내려다봄=high, 수직 부감=top, 바닥 가까이 올려다봄=worm/low', () => {
  assert.equal(cameraElevationOf([0, 1.6, 5], [0, 1.6, 0]), 'eye');
  assert.equal(cameraElevationOf([0, 4, 4], [0, 1, 0]), 'high');
  assert.equal(cameraElevationOf([0, 8, 0.2], [0, 0, 0]), 'top');
  assert.equal(cameraElevationOf([0, 0.2, 3], [0, 1.5, 0]), 'worm');
  assert.equal(cameraElevationOf([0, 0.6, 4], [0, 1.3, 0]), 'low');
});

test('샷 사이즈: 거리·렌즈가 담는 세로 높이 ÷ 인물 키', () => {
  const vfov = verticalFovDeg(35, 16 / 9) * Math.PI / 180;
  const distFor = (ratio) => (ratio * 1.7) / (2 * Math.tan(vfov / 2));
  assert.equal(shotSizeOf(distFor(0.3), 35, 16 / 9, 1.7), 'CU');
  assert.equal(shotSizeOf(distFor(0.75), 35, 16 / 9, 1.7), 'MS');
  assert.equal(shotSizeOf(distFor(2), 35, 16 / 9, 1.7), 'WS');
  assert.equal(shotSizeOf(distFor(6), 35, 16 / 9, 1.7), 'EWS');
  // 같은 거리에서 망원 렌즈는 더 타이트하다
  assert.equal(shotSizeOf(distFor(0.75), 85, 16 / 9, 1.7), 'CU');
});

test('카메라 무브: 키 하나=고정, 앞으로=push_in, 옆으로=track, 위로=crane, 제자리 회전=pan, 렌즈만=zoom', () => {
  const k = (t, pos, target, focal = 35) => ({ t, pos, target, focal });
  assert.equal(cameraMoveOf([k(0, [0, 1.6, 5], [0, 1.6, 0])]), 'static');
  assert.equal(cameraMoveOf([k(0, [0, 1.6, 5], [0, 1.6, 0]), k(2, [0, 1.6, 3], [0, 1.6, -2])]), 'push_in');
  assert.equal(cameraMoveOf([k(0, [0, 1.6, 3], [0, 1.6, 0]), k(2, [0, 1.6, 5], [0, 1.6, 2])]), 'pull_out');
  assert.equal(cameraMoveOf([k(0, [0, 1.6, 5], [0, 1.6, 0]), k(2, [2, 1.6, 5], [2, 1.6, 0])]), 'track');
  assert.equal(cameraMoveOf([k(0, [0, 1.6, 5], [0, 1.6, 0]), k(2, [0, 3.6, 5], [0, 3.6, 0])]), 'crane');
  assert.equal(cameraMoveOf([k(0, [0, 1.6, 5], [0, 1.6, 0]), k(2, [0, 1.6, 5], [3, 1.6, 0])]), 'pan');
  assert.equal(cameraMoveOf([k(0, [0, 1.6, 5], [0, 1.6, 0]), k(2, [0, 1.6, 5], [0, 1.6, 0], 85)]), 'zoom');
});

test('컷 필드로 세운 카메라를 되읽으면 같은 방위·높이·샷이 나온다(왕복)', () => {
  const subject = { token: '@a', x: 0.5, z: -0.5, height: 1.7 };
  for (const aspect of [16 / 9, 9 / 16]) {
    for (const dir of ['front', 'back', 'left', 'right']) {
      for (const elev of ['eye', 'high', 'low', 'worm']) {
        for (const shot of ['CU', 'MS', 'WS']) {
          const cam = cameraFromCutFields(dir, elev, shot, subject, aspect);
          assert.equal(cameraDirectionOf(cam.pos, cam.target), dir, `${dir}/${elev}/${shot}`);
          assert.equal(cameraElevationOf(cam.pos, cam.target), elev, `${dir}/${elev}/${shot}`);
          if (elev === 'eye') {
            const p = primarySubject(cam, aspect, [subject]);
            assert.ok(p, `${dir}/${shot} 인물이 화면에 있어야 한다`);
            assert.equal(shotSizeOf(p.distance, cam.focal, aspect, subject.height), shot, `${dir}/${shot}`);
          }
        }
      }
    }
  }
  const top = cameraFromCutFields('front', 'top', 'WS', subject, 16 / 9);
  assert.equal(cameraElevationOf(top.pos, top.target), 'top');
});

test('초기 배치: 컷 blocking → 같은 격자 칸, 없으면 같은 세트 직전 컷의 마지막 위치(연속성)', () => {
  const doc = normalizeDoc(null);
  const cuts = [
    { sceneId: '1', order: 0, sceneLocation: '소녀의 방', estSec: 4, shotType: 'WS', cameraMove: 'static', cameraDirection: 'front', cameraElevation: 'eye', blocking: [{ token: '@소녀', x: 'left', depth: 'far', facing: 'right' }], tokens: ['@소녀'] },
    { sceneId: '2', order: 1, sceneLocation: ' 소녀의  방 ', estSec: 0, shotType: 'MS', cameraMove: 'static', cameraDirection: 'back', cameraElevation: 'eye', blocking: null, tokens: ['@소녀'] },
  ];
  const c1 = initialCut(doc, cuts[0], cuts, 16 / 9);
  assert.equal(c1.duration, 4);
  const set = ensureSet(doc, '소녀의 방');
  doc.sets[set.key] = set;
  doc.cuts['1'] = c1;
  const f1 = deriveCutFields(c1, set, 16 / 9, 'WS');
  assert.deepEqual(f1.blocking, [{ token: '@소녀', x: 'left', depth: 'far', facing: 'right' }]);
  assert.equal(f1.cameraDirection, 'front');
  assert.equal(f1.cameraElevation, 'eye');
  assert.equal(f1.shotType, 'WS');
  assert.equal(f1.cameraMove, 'static');
  assert.deepEqual(changedFields(f1, cuts[0]), []);

  const c2 = initialCut(doc, cuts[1], cuts, 16 / 9);
  assert.equal(c2.setKey, setKeyOf('소녀의 방'), '공백이 다른 같은 장소는 같은 세트');
  assert.equal(c2.duration, 3);
  assert.deepEqual(c2.actors[0].keys[0].x, c1.actors[0].keys[0].x, '직전 컷의 위치를 이어받는다');
  const f2 = deriveCutFields(c2, set, 16 / 9, 'MS');
  assert.equal(f2.cameraDirection, 'back');
});

test('화면에 인물이 없으면 샷 사이즈는 기존 값을 유지한다', () => {
  const set = { key: 'k', name: 'k', width: 6, depth: 5, props: [] };
  const cut = { sceneId: '1', setKey: 'k', duration: 3, actors: [{ token: '@a', height: 1.7, keys: [{ t: 0, x: 0, z: 0, yaw: 0 }] }], camera: [{ t: 0, pos: [0, 1.6, 5], target: [0, 1.6, 10], focal: 35 }] };
  assert.equal(deriveCutFields(cut, set, 16 / 9, 'insert').shotType, 'INSERT');
});

test('키프레임 편집 규칙: 키 하나면 그 키를 고치고(정지 블로킹), 둘 이상이면 현재 시각에 끼운다', () => {
  const one = [{ t: 0, x: 0, z: 0, yaw: 0 }];
  const moved = upsertKey(one, 2, (b) => ({ ...b, x: 3 }));
  assert.equal(moved.length, 1);
  assert.equal(moved[0].t, 0);
  assert.equal(moved[0].x, 3);
  const two = addKeyAt(one, 2, { t: 0, x: 0, z: 0, yaw: 0 });
  assert.equal(two.length, 2);
  const three = upsertKey(two, 1, (b) => ({ t: 1, x: 1, z: 0, yaw: 0, ...(b || {}) }));
  assert.deepEqual(three.map((k) => k.t), [0, 1, 2]);
  assert.equal(removeKeyAt(one, 0).length, 1, '마지막 키는 지우지 않는다');
  assert.deepEqual(moveKeyTo(three, 2, 5, 3).map((k) => k.t), [0, 1, 3], '마지막 키는 길이까지');
  const clamped = moveKeyTo(three, 1, 5, 3).map((k) => k.t);
  assert.ok(clamped[1] < 2 && clamped[1] > 1.9, '이웃 키를 넘지 않는다(끄는 동안 순서 유지)');
  assert.equal(moveKeyTo(three, 1, 1, 3), three, '제자리면 그대로');
});

test('깨진 문서는 안전한 기본값으로 정규화한다', () => {
  const doc = normalizeDoc({ sets: { a: { width: 'x', props: [{ id: 'p', kind: 'rocket', color: 'red' }] } }, cuts: { 1: { camera: [{ t: -1, pos: [1, 2], focal: 'z' }], actors: [{ token: '소녀', keys: [{ t: 0 }] }] }, 2: { camera: [] } } });
  assert.equal(doc.sets.a.width, 6);
  assert.equal(doc.sets.a.props[0].kind, 'box');
  assert.equal(doc.sets.a.props[0].color, '#8a94a6');
  assert.equal(doc.cuts['1'].camera[0].t, 0);
  assert.equal(doc.cuts['1'].camera[0].focal, 35);
  assert.equal(doc.cuts['1'].actors[0].token, '@소녀');
  assert.equal(doc.cuts['2'], undefined, '카메라 없는 컷은 버린다');
});
