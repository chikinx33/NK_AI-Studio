// 프리비즈 자동 연출: LLM 계획 → 키프레임 풀이기(autoStage.ts)와 서버 프롬프트(previz-plan.js)를 못박는다.
// 핵심 계약: 풀이기가 만든 키프레임을 컷 필드로 되읽으면(deriveCutFields) 계획의 샷 크기·방위·높이·무브가 나온다.
// 그래야 자동 연출 → "컷에 반영" 이 기존 이미지·영상 프롬프트와 세트 플레이트 선택까지 그대로 이어진다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePlan, stageCuts, groupScenes, chunk, carryFromDoc, priorForRequest, knownHeights, sideOfLine, toMeters, toNormalized,
  fallbackCutPlan, sizeAndFramingOf, normalizeMove, yawToward,
} from '../../ai-company-app/src/previz/autoStage.ts';
import { deriveCutFields, emptyDoc, setKeyOf } from '../../ai-company-app/src/previz/model.ts';
import { sampleActor, sampleCamera, cameraMoveOf, facingOfYaw, primarySubject, POSE_HEIGHT } from '../../ai-company-app/src/previz/geometry.ts';
import { buildPrevizPlanPrompt, extractPlanJson, tokensOfScene, registeredCharacters, PREVIZ_PLAN_CHUNK } from '../functions/api/_shared/previz-plan.js';

const ASPECT = 16 / 9;
const cut = (id, over = {}) => ({
  sceneId: String(id), order: Number(id) - 1, sceneLocation: '거실', estSec: 4, shotType: 'MS', cameraMove: 'static',
  cameraDirection: 'front', cameraElevation: 'eye', blocking: null, tokens: ['@A', '@B'], ...over,
});
const carry0 = () => ({ setKey: setKeyOf('거실'), actors: {}, axis: null, views: [] });
const stage = (raw, cuts, opts = {}) => {
  const plan = normalizePlan(raw, cuts, opts.registered || ['@A', '@B', '@C']);
  return stageCuts({ plan, cuts, doc: opts.doc || emptyDoc(), aspect: opts.aspect || ASPECT, carry: opts.carry || carry0(), heights: opts.heights || {} });
};
const cam = (over) => ({ subjects: ['@A'], size: 'MS', view: 'front', angle: 'eye', framing: 'single', screen: 'center', move: 'static', t: [0.1, 0.9], ...over });
const derived = (res, id) => {
  const c = res.doc.cuts[id];
  return deriveCutFields(c, res.doc.sets[c.setKey], ASPECT, 'MS');
};

test('계획의 샷 크기·방위·높이를 키프레임으로 풀면 컷 필드로 그대로 되읽힌다(범용 조합)', () => {
  for (const view of ['front', 'back', 'left', 'right']) {
    for (const angle of ['eye', 'high', 'low', 'worm', 'top']) {
      for (const size of ['CU', 'MS', 'WS']) {
        for (const height of [0.45, 1.2, 1.75]) {
          const c = cut(1, { tokens: ['@A'] });
          const raw = { heights: { '@A': height }, cuts: [{ id: '1', actors: [{ who: '@A', pos: [0.2, -0.1], face: 'front' }], camera: cam({ view, angle, size }) }] };
          const res = stage(raw, [c]);
          const f = derived(res, '1');
          const label = `${view}/${angle}/${size}/h${height}`;
          assert.equal(f.cameraElevation, angle, label);
          if (angle !== 'top') assert.equal(f.cameraDirection, view, label);
          if (angle === 'eye') assert.equal(f.shotType, size, label);
          assert.equal(f.cameraMove, 'static', label);
        }
      }
    }
  }
});

test('세로 화면(9:16)에서도 샷 크기가 맞는다', () => {
  const c = cut(1, { tokens: ['@A'] });
  for (const size of ['CU', 'MCU', 'MS', 'MLS', 'WS']) {
    const res = stage({ cuts: [{ id: '1', actors: [{ who: '@A', pos: [0, 0] }], camera: cam({ size }) }] }, [c], { aspect: 9 / 16 });
    const pc = res.doc.cuts['1'];
    assert.equal(deriveCutFields(pc, res.doc.sets[pc.setKey], 9 / 16, 'MS').shotType, size, size);
  }
});

test('카메라 무브를 풀면 같은 무브로 되읽히고, 시작 프레임(t=0)은 계획한 크기 그대로다', () => {
  for (const move of ['push_in', 'pull_out', 'pan', 'tilt', 'track', 'crane', 'zoom', 'handheld']) {
    const c = cut(1, { tokens: ['@A'], estSec: 5 });
    const res = stage({ cuts: [{ id: '1', actors: [{ who: '@A', pos: [0, 0] }], camera: cam({ move, t: [0.2, 0.85] }) }] }, [c]);
    const f = derived(res, '1');
    assert.equal(f.cameraMove, move, move);
    assert.equal(f.shotType, 'MS', `${move} 시작 프레임`);
    const keys = res.doc.cuts['1'].camera;
    // 의도값이 아니라 실제 카메라 경로도 같은 무브여야 한다(주인공이 가만히 있을 때)
    assert.equal(cameraMoveOf(keys), move, `${move} 기하`);
    if (move !== 'handheld') {
      // 무브는 계획한 시각에 시작해 끝난다(균등 분배가 아니라 계획의 타이밍)
      assert.ok(keys.some((k) => Math.abs(k.t - 1) < 1e-6), `${move} 시작 키 1.0s`);
      assert.ok(keys.some((k) => Math.abs(k.t - 4.25) < 1e-6), `${move} 끝 키 4.25s`);
    }
  }
});

test('"dolly"·"tracking" 같은 다른 이름도 어휘로 정규화한다', () => {
  assert.equal(normalizeMove('dolly'), 'push_in');
  assert.equal(normalizeMove('Tracking'), 'track');
  assert.equal(normalizeMove('push-in'), 'push_in');
  assert.equal(normalizeMove('???', 'pan'), 'pan');
  assert.deepEqual(sizeAndFramingOf('OTS'), { size: 'MS', framing: 'ots' });
  assert.deepEqual(sizeAndFramingOf('two shot'), { size: 'MLS', framing: 'two' });
});

test('인물 배치: 정규화 좌표 → 세트 미터, 겹치면 밀어내고, 토큰을 바라본다', () => {
  const c = cut(1);
  const raw = { cuts: [{ id: '1', actors: [{ who: '@A', pos: [-0.5, 0], face: '@B' }, { who: '@B', pos: [-0.5, 0], face: '@A' }], camera: cam({ subjects: ['@A', '@B'], framing: 'two', size: 'MLS' }) }] };
  const res = stage(raw, [c]);
  const [a, b] = res.doc.cuts['1'].actors;
  const pa = sampleActor(a.keys, 0);
  const pb = sampleActor(b.keys, 0);
  assert.ok(Math.hypot(pa.x - pb.x, pa.z - pb.z) >= 0.5, '같은 자리에 둘을 세우지 않는다');
  assert.ok(Math.abs(pa.yaw - yawToward(pa.x, pa.z, pb.x, pb.z)) < 0.5, 'A 는 B 를 본다');
  assert.ok(Math.abs(pb.yaw - yawToward(pb.x, pb.z, pa.x, pa.z)) < 0.5, 'B 는 A 를 본다');
  const [mx] = toMeters([-0.5, 0], 6, 5);
  assert.ok(Math.abs((pa.x + pb.x) / 2 - mx) < 0.6, '계획한 자리 근처');
});

test('이동: 출발 시각까지 제자리 → 이동 방향으로 돌고 → 도착 → 최종 방향·자세, 시각은 계획대로', () => {
  const c = cut(1, { tokens: ['@A'], estSec: 6 });
  const raw = { cuts: [{ id: '1', actors: [{ who: '@A', pos: [-0.8, 0.5], face: 'front' }], moves: [{ who: '@A', t: [0.25, 0.6], pos: [0.8, -0.5], face: 'back', pose: 'sit' }], camera: cam({ size: 'WS' }) }] };
  const res = stage(raw, [c]);
  const k = res.doc.cuts['1'].actors[0].keys;
  const s0 = sampleActor(k, 0);
  const sHold = sampleActor(k, 1.4);
  assert.deepEqual([s0.x, s0.z], [sHold.x, sHold.z], '1.5초 전에는 움직이지 않는다');
  assert.equal(facingOfYaw(sampleActor(k, 0).yaw), 'camera');
  const arrive = sampleActor(k, 3.6);
  const [dx, dz] = toMeters([0.8, -0.5], 6, 5);
  assert.ok(Math.abs(arrive.x - dx) < 0.01 && Math.abs(arrive.z - dz) < 0.01, '3.6초에 도착');
  const mid = sampleActor(k, 2.6);
  assert.ok(mid.x > s0.x && mid.x < dx, '이동 중');
  assert.equal(mid.pose, 'stand', '걷는 동안은 서 있다');
  const end = sampleActor(k, 6);
  assert.equal(end.pose, 'sit');
  assert.equal(facingOfYaw(end.yaw), 'away');
});

test('움직이는 주인공을 팬이 따라간다(이동 구간 중간 키에 조준점이 주인공 쪽)', () => {
  const c = cut(1, { tokens: ['@A'], estSec: 6 });
  const raw = { cuts: [{ id: '1', actors: [{ who: '@A', pos: [-0.8, 0] }], moves: [{ who: '@A', t: [0.2, 0.8], pos: [0.8, 0] }], camera: cam({ size: 'WS', move: 'pan', t: [0.2, 0.8] }) }] };
  const res = stage(raw, [c]);
  const pc = res.doc.cuts['1'];
  const start = sampleCamera(pc.camera, 0);
  const end = sampleCamera(pc.camera, 6);
  assert.deepEqual(start.pos, end.pos, '팬은 제자리');
  const aEnd = sampleActor(pc.actors[0].keys, 6);
  assert.ok(Math.abs(end.target[0] - aEnd.x) < 0.2, '끝에서 주인공을 조준');
});

test('180도 규칙: 대화 씬의 첫 투샷이 선을 정하고, 뒤 컷의 카메라가 반대편이면 같은 쪽으로 돌려 세운다', () => {
  const cuts = [cut(1), cut(2), cut(3)];
  const actors = [{ who: '@A', pos: [-0.4, 0], face: '@B' }, { who: '@B', pos: [0.4, 0], face: '@A' }];
  const raw = {
    cuts: [
      { id: '1', actors, camera: cam({ subjects: ['@A', '@B'], framing: 'two', size: 'MLS', view: 'front' }) },
      // 반대편(back)에서 A 단독 — 선을 넘는다
      { id: '2', actors, camera: cam({ subjects: ['@A'], size: 'MS', view: 'back' }) },
      { id: '3', actors, camera: cam({ subjects: ['@B'], framing: 'ots', over: '@A', size: 'MS' }) },
    ],
  };
  const res = stage(raw, cuts);
  const axis = res.carry.axis;
  assert.ok(axis && axis.a === '@A' && axis.b === '@B');
  const side = (id) => {
    const pc = res.doc.cuts[id];
    const a = sampleActor(pc.actors.find((x) => x.token === '@A').keys, 0);
    const b = sampleActor(pc.actors.find((x) => x.token === '@B').keys, 0);
    const p = pc.camera[0].pos;
    return sideOfLine(a, b, { x: p[0], z: p[2] });
  };
  assert.equal(side('1'), axis.sign);
  assert.equal(side('3'), axis.sign, '오버숄더도 같은 쪽 어깨');
  // 2번: back 에서 정면으로 선을 넘으면 30° 돌려도 못 지킬 수 있다 — 지킬 수 있으면 지켰는지, 방위는 그대로인지
  const f2 = derived(res, '2');
  assert.equal(f2.cameraDirection, 'back', '방위(세트 플레이트 축)는 계획대로');
});

test('180도 규칙: 선을 넘는 단독 샷은 방위 안에서 ±30° 돌려 같은 쪽을 지킨다', () => {
  const cuts = [cut(1), cut(2)];
  // 선이 약간 기울어 있다(A 왼쪽 앞, B 오른쪽 뒤). 정면 투샷이 선을 정한다.
  const actors = [{ who: '@A', pos: [-0.5, -0.15], face: '@B' }, { who: '@B', pos: [0.5, 0.15], face: '@A' }];
  const raw = { cuts: [
    { id: '1', actors, camera: cam({ subjects: ['@A', '@B'], framing: 'two', size: 'MLS', view: 'front' }) },
    // A 단독을 left 방위로 — 곧이곧대로 세우면 선의 반대편
    { id: '2', actors, camera: cam({ subjects: ['@A'], size: 'MS', view: 'left' }) },
  ] };
  const res = stage(raw, cuts);
  const axis = res.carry.axis;
  const pc = res.doc.cuts['2'];
  const a = sampleActor(pc.actors.find((x) => x.token === axis.a).keys, 0);
  const b = sampleActor(pc.actors.find((x) => x.token === axis.b).keys, 0);
  const p = pc.camera[0].pos;
  assert.equal(sideOfLine(a, b, { x: p[0], z: p[2] }), axis.sign, '같은 쪽');
  assert.equal(derived(res, '2').cameraDirection, 'left', '방위(세트 플레이트 축)는 계획대로');
});

test('오버숄더: 카메라는 어깨 너머 인물 뒤에서 주인공을 본다', () => {
  const c = cut(1);
  const raw = { cuts: [{ id: '1', actors: [{ who: '@A', pos: [0, 0.5], face: '@B' }, { who: '@B', pos: [0, -0.5], face: '@A' }], camera: cam({ subjects: ['@B'], framing: 'ots', over: '@A' }) }] };
  const res = stage(raw, [c]);
  const pc = res.doc.cuts['1'];
  const a = sampleActor(pc.actors[0].keys, 0);
  const b = sampleActor(pc.actors[1].keys, 0);
  const p = pc.camera[0].pos;
  assert.ok(p[2] > a.z, '카메라가 A 뒤(B 반대편)');
  assert.ok(Math.abs(pc.camera[0].target[2] - b.z) < 1e-3, 'B 를 조준');
  assert.equal(derived(res, '1').cameraDirection, 'front');
});

test('POV: 인물 눈높이에서 그 인물이 보는 대상을 본다', () => {
  const c = cut(1);
  const raw = { heights: { '@A': 1.1 }, cuts: [{ id: '1', actors: [{ who: '@A', pos: [0, 0.5], face: '@B' }, { who: '@B', pos: [0, -0.5] }], camera: cam({ subjects: ['@A'], framing: 'pov', look: '@B' }) }] };
  const res = stage(raw, [c]);
  const k = res.doc.cuts['1'].camera[0];
  assert.ok(Math.abs(k.pos[1] - 1.1 * 0.93) < 0.01, '눈높이');
  assert.ok(k.target[2] < k.pos[2], 'B 쪽을 본다');
});

test('인물 키: 모델이 정한 키를 쓰고, 이미 알려진 키(기본값 아님)가 이긴다', () => {
  const c = cut(1, { tokens: ['@A', '@B'] });
  const raw = { heights: { '@A': 0.4, '@B': 1.9 }, cuts: [{ id: '1', actors: [{ who: '@A', pos: [-0.3, 0] }, { who: '@B', pos: [0.3, 0] }], camera: cam() }] };
  const res = stage(raw, [c], { heights: { '@B': 1.5 } });
  const hs = Object.fromEntries(res.doc.cuts['1'].actors.map((a) => [a.token, a.height]));
  assert.deepEqual(hs, { '@A': 0.4, '@B': 1.5 });
  assert.deepEqual(knownHeights(res.doc), { '@A': 0.4, '@B': 1.5 });
});

test('연속성: 같은 세트의 다음 컷은 앞 컷이 끝난 자리·방향·자세에서 시작한다(계획에 좌표가 없으면)', () => {
  const cuts = [cut(1, { tokens: ['@A'] }), cut(2, { tokens: ['@A'] })];
  const raw = { cuts: [
    { id: '1', actors: [{ who: '@A', pos: [-0.5, 0] }], moves: [{ who: '@A', t: [0.1, 0.5], pos: [0.5, -0.5], face: 'left', pose: 'crouch' }], camera: cam({ size: 'WS' }) },
    { id: '2', actors: [{ who: '@A' }], camera: cam({ size: 'MS' }) },
  ] };
  const res = stage(raw, cuts);
  const end1 = sampleActor(res.doc.cuts['1'].actors[0].keys, 4);
  const start2 = sampleActor(res.doc.cuts['2'].actors[0].keys, 0);
  assert.deepEqual([start2.x, start2.z, start2.pose], [end1.x, end1.z, end1.pose]);
  assert.ok(Math.abs(start2.yaw - end1.yaw) < 0.01);
  // 청크를 나눠 요청할 때도 같은 상태가 서버로 간다
  const carry = carryFromDoc(res.doc, cuts, cuts[1]);
  const prior = priorForRequest(carry, 6, 5, {});
  assert.deepEqual(prior.actors[0].pos, toNormalized(end1.x, end1.z, 6, 5));
  assert.equal(prior.actors[0].face, 'left');
  assert.equal(prior.actors[0].pose, 'crouch');
});

test('세트가 바뀌면 앞 세트의 위치·180도 선을 가져가지 않는다, 세트 크기는 모델 제안(새 세트만)', () => {
  const cuts = [cut(1), cut(2, { sceneLocation: '거리' })];
  const raw = { set: { w: 18, d: 10 }, cuts: [
    { id: '1', actors: [{ who: '@A', pos: [-0.4, 0], face: '@B' }, { who: '@B', pos: [0.4, 0] }], camera: cam({ subjects: ['@A', '@B'], framing: 'two' }) },
    { id: '2', actors: [{ who: '@A' }, { who: '@B' }], camera: cam() },
  ] };
  const doc = emptyDoc();
  doc.sets[setKeyOf('거실')] = { key: setKeyOf('거실'), name: '거실', width: 5, depth: 4, props: [] };
  const res = stage(raw, cuts, { doc });
  assert.equal(res.doc.sets[setKeyOf('거실')].width, 5, '사용자가 만든 세트 크기는 유지');
  assert.equal(res.doc.sets[setKeyOf('거리')].width, 18);
  assert.equal(res.carry.setKey, setKeyOf('거리'));
});

test('모델이 컷을 빠뜨리거나 모르는 인물을 넣어도 모든 컷이 컷 필드 기준으로 채워진다', () => {
  const cuts = [cut(1, { shotType: 'OTS', cameraDirection: 'back', cameraMove: 'dolly' }), cut(2, { tokens: ['@A'] })];
  const plan = normalizePlan({ cuts: [{ id: '2', actors: [{ who: '@A' }, { who: '@행인' }], camera: { subjects: ['@행인'] } }] }, cuts, ['@A', '@B']);
  assert.equal(plan.cuts.length, 2);
  assert.equal(plan.cuts[0].fromModel, false);
  assert.equal(plan.cuts[0].camera.framing, 'ots');
  assert.equal(plan.cuts[0].camera.view, 'back');
  assert.equal(plan.cuts[0].camera.move, 'push_in');
  assert.deepEqual(plan.cuts[1].actors.map((a) => a.token), ['@A']);
  assert.deepEqual(plan.cuts[1].camera.subjects, ['@A'], '모르는 인물은 주인공이 될 수 없다');
  const korean = normalizePlan({ cuts: [{ id: '1', actors: [{ who: '@하나가', face: '@토토를' }, { who: '토토' }], camera: { subjects: ['@하나는'] } }] }, [cut(1, { tokens: ['@하나', '@토토'] })], ['@하나', '@토토']);
  assert.deepEqual(korean.cuts[0].actors.map((a) => a.token), ['@하나', '@토토'], '조사가 붙어도 같은 인물');
  assert.deepEqual(korean.cuts[0].actors[0].face, { token: '@토토' });
  assert.deepEqual(korean.cuts[0].camera.subjects, ['@하나']);
  const res = stageCuts({ plan, cuts, doc: emptyDoc(), aspect: ASPECT, carry: carry0(), heights: {} });
  assert.equal(Object.keys(res.doc.cuts).length, 2);
  for (const c of Object.values(res.doc.cuts)) assert.ok(c.camera.every((k) => k.pos.every(Number.isFinite) && k.target.every(Number.isFinite)));
});

test('fallback: 두 인물 컷은 투샷, 한 인물은 단독', () => {
  assert.equal(fallbackCutPlan(cut(1)).camera.framing, 'two');
  assert.equal(fallbackCutPlan(cut(1, { tokens: ['@A'] })).camera.framing, 'single');
});

test('인물이 없는 설정샷은 point 를 본다', () => {
  const c = cut(1, { tokens: [] });
  const res = stage({ cuts: [{ id: '1', actors: [], camera: cam({ subjects: [], size: 'WS', point: [0.5, -0.8] }) }] }, [c]);
  const k = res.doc.cuts['1'].camera[0];
  const [px, pz] = toMeters([0.5, -0.8], 6, 5);
  assert.ok(Math.abs(k.target[0] - px) < 0.6 && Math.abs(k.target[2] - pz) < 0.01);
});

test('씬 묶기: 같은 세트 연속 + 씬 나누기 없음, 청크는 순서 유지', () => {
  const cuts = [cut(1), cut(2), cut(3, { sceneBreak: true }), cut(4, { sceneLocation: '부엌' }), cut(5, { sceneLocation: '거실' })];
  assert.deepEqual(groupScenes(cuts).map((g) => g.map((c) => c.sceneId)), [['1', '2'], ['3'], ['4'], ['5']]);
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 4), [[1, 2, 3, 4], [5]]);
});

test('핸드헬드 판정: 작은 흔들림 키가 여럿이면 handheld, 하나뿐이면 static', () => {
  const k = (t, x) => ({ t, pos: [x, 1.6, 5], target: [0, 1.6, 0], focal: 35 });
  assert.equal(cameraMoveOf([k(0, 0), k(1, 0.03), k(2, -0.02), k(3, 0.01)]), 'handheld');
  assert.equal(cameraMoveOf([k(0, 0)]), 'static');
});

// ── 서버 프롬프트 ──────────────────────────────────────────────────────────
const project = {
  header: '따뜻한 3D 애니메이션',
  payload: {
    characters: [
      { name: '토토', appearance: '작은 주황색 강아지, 네 발', description: '장난꾸러기' },
      { trigger: '@하나', appearance: '7살 여자아이' },
    ],
    episodeLocations: [{ name: '거실', description: '소파와 창문이 있는 거실', layout: { back: '큰 창문', left: '소파', floor: '러그' } }],
  },
  scenes: [
    { id: 1, sceneLocation: '거실', estSec: 4, composition: '@하나가 소파 앞에 서 있다', action: '@하나가 창문 쪽으로 걸어간다', shotType: 'WS', cameraDirection: 'front', cameraElevation: 'eye', cameraMove: 'static', beats: [{ at: 0, what: '멈춤' }, { at: 2.5, what: '걷기 시작' }] },
    { id: 2, sceneLocation: '거실', estSec: 3, composition: '@토토가 러그 위에 엎드려 있다', dialogue: [{ speaker: '하나', line: '토토야!' }], shotType: 'CU', cameraMove: 'push_in' },
    { id: 3, sceneLocation: '거실', estSec: 2, action: '둘이 마주본다' },
  ],
};

test('프롬프트: 세트·평면도·인물 신체·컷 필드·비트·대사·직전 상태가 들어가고, 인물 이름은 코드에 없다', () => {
  const p = buildPrevizPlanPrompt(project, { targetIds: ['1', '2'], contextIds: ['1', '2', '3'], prior: { actors: [{ token: '@하나', pos: [-0.3, 0.2], face: 'back', pose: 'stand' }], views: ['WS single · view front · eye · static'], heights: { '@하나': 1.15 } } });
  assert.match(p.user, /\[Set\] 거실 — 소파와 창문이 있는 거실/);
  assert.match(p.user, /\[Set layout\] back: 큰 창문 \| left: 소파 \| floor: 러그/);
  assert.match(p.user, /- @토토 — appearance: 작은 주황색 강아지, 네 발/);
  assert.match(p.user, /- @하나 — appearance: 7살 여자아이 \[height known: 1.15m\]/);
  assert.match(p.user, /beats: 0s 멈춤 \| 2.5s 걷기 시작/);
  assert.match(p.user, /dialogue: @하나: 토토야!/);
  assert.match(p.user, /shot notes: size CU, view front, angle eye, move push_in/);
  assert.match(p.user, /- @하나: pos \[-0.30, 0.20\], face back, pose stand/);
  assert.match(p.user, /\[Camera setups already used in this scene, in order\] WS single/);
  assert.match(p.user, /cut 3: 둘이 마주본다/);
  assert.doesNotMatch(p.user, /## cut 3/, '문맥용 컷은 계획 대상이 아니다');
  assert.deepEqual(p.targets.map((t) => t.id), ['1', '2']);
  assert.deepEqual(p.targets[1].tokens.sort(), ['@토토', '@하나'].sort(), '대사 화자도 등장인물');
  assert.doesNotMatch(p.system, /토토|하나|강아지/);
  assert.match(p.system, /view: which side of the set the camera LOOKS TOWARD/);
  assert.match(p.system, /180-degree rule/);
  assert.match(p.system, /Do NOT spread moments uniformly/);
});

test('프롬프트: 요청 컷이 없으면 거절, 청크 크기는 4', () => {
  assert.throws(() => buildPrevizPlanPrompt(project, { targetIds: ['99'] }), /previz_plan_no_cuts/);
  assert.equal(PREVIZ_PLAN_CHUNK, 4);
  assert.deepEqual(registeredCharacters(project.payload).map((c) => c.token), ['@토토', '@하나']);
  assert.deepEqual(tokensOfScene(project.scenes[0], registeredCharacters(project.payload)), ['@하나']);
});

test('응답 JSON 추출: 코드 펜스·설명·끝 쉼표를 견딘다', () => {
  assert.deepEqual(extractPlanJson('계획입니다\n```json\n{"cuts":[{"id":"1",}],}\n```'), { cuts: [{ id: '1' }] });
  assert.throws(() => extractPlanJson('no json'), /previz_plan_not_json/);
});

// ── 조사 붙은 언급 · 연결 계약 ─────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { resolveMentionToken as resolveServer, mentionTokens as mentionServer } from '../functions/api/_shared/token-match.js';
import { resolveMentionToken as resolveClient, mentionTokens as mentionClient } from '../../ai-company-app/src/previz/model.ts';
import { AUTO_STAGE_CHUNK } from '../../ai-company-app/src/previz/autoStage.ts';

const readSrc = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('조사 붙은 언급("@하나가")을 등록 캐릭터로 읽는다 — 서버·클라이언트 같은 규칙', () => {
  const reg = ['@하나', '@토토', '@이가은', '@A1'];
  const cases = [
    ['@하나가', '@하나'], ['@토토를', '@토토'], ['@하나', '@하나'], ['@이가은이', '@이가은'], ['@이가은', '@이가은'],
    ['@A1', '@A1'], ['@행인이', '@행인'], ['@곰', '@곰'], ['@곰이', '@곰이'],
  ];
  for (const [raw, want] of cases) {
    assert.equal(resolveServer(raw, reg), want, `server ${raw}`);
    assert.equal(resolveClient(raw, reg), want, `client ${raw}`);
  }
  const text = '@하나가 @토토와 마주 보고, @하나는 웃는다';
  assert.deepEqual(mentionServer(text, reg), ['@하나', '@토토']);
  assert.deepEqual(mentionClient(text, reg), mentionServer(text, reg));
});

test('제작 그래프: 조사가 붙은 언급도 캐릭터 연결을 만든다', async () => {
  const src = readSrc('prototype/functions/api/agent/production-graph.ts');
  assert.ok(src.includes('import { mentionTokens } from "../_shared/token-match.js";'));
  assert.ok(src.includes('[...characterNodeByToken.keys()]);'), '등록 토큰 목록으로 언급을 해석');
  assert.ok(!src.includes('tokensIn('), '조사를 못 떼는 옛 추출기는 쓰지 않는다');
});

test('연결: 서버 청크 크기 = 클라이언트, 엔드포인트는 사용자 자격증명(412)·25초·프로젝트 로딩', () => {
  assert.equal(AUTO_STAGE_CHUNK, PREVIZ_PLAN_CHUNK);
  const ep = readSrc('prototype/functions/api/previz/plan.ts');
  assert.match(ep, /auth = await studioAuth\(env, who\.userId\);/);
  assert.match(ep, /return send\(\{ error: CLAUDE_AUTH_REQUIRED \}, 412, origin\);/);
  assert.match(ep, /const TIMEOUT_MS = 25_000;/);
  assert.match(ep, /\.slice\(0, PREVIZ_PLAN_CHUNK\)/);
  assert.match(ep, /AGENT_TOOLS\.project_get\.run\(\{ projectId \}, ctx as any\)/);
  const studio = readSrc('ai-company-app/src/previz/PrevizStudio.tsx');
  assert.match(studio, /for \(const part of chunk\(group, AUTO_STAGE_CHUNK\)\) await run\(part\);/);
  assert.match(studio, /prior: priorForRequest\(carry, set\.width, set\.depth, heights\),/);
  assert.match(studio, /const res = stageCuts\(\{ plan, cuts: list, doc: next, aspect, carry, heights \}\);/);
  assert.doesNotMatch(studio.slice(studio.indexOf('const autoStage = async'), studio.indexOf('const runExport = async')), /savePrevizDoc|persist\(/, '자동 연출 결과는 저장 버튼 전까지 휘발');
  assert.match(studio, /onClick=\{\(\) => void autoStage\("scene"\)\}/);
  assert.match(studio, /onClick=\{\(\) => void autoStage\("all"\)\}/);
  const api = readSrc('ai-company-app/src/lib/api.ts');
  assert.match(api, /fetch\("\/api\/previz\/plan", \{/);
});

test('무브 의도: 자동 연출이 계획한 무브를 컷 필드로 쓰고, 의도가 없으면(손으로 고친 카메라) 기하로 읽는다', () => {
  const c = cut(1, { tokens: ['@A'], estSec: 6 });
  // 주인공이 걸어가는 동안 줌 — 기하로는 따라가는 카메라가 다른 무브로 읽힐 수 있다
  const raw = { cuts: [{ id: '1', actors: [{ who: '@A', pos: [-0.8, 0] }], moves: [{ who: '@A', t: [0.1, 0.9], pos: [0.8, 0.3] }], camera: cam({ size: 'WS', move: 'zoom', t: [0.1, 0.9] }) }] };
  const res = stage(raw, [c]);
  const pc = res.doc.cuts['1'];
  assert.equal(pc.moveIntent, 'zoom');
  assert.equal(derived(res, '1').cameraMove, 'zoom');
  const edited = { ...pc, moveIntent: undefined };
  assert.equal(deriveCutFields(edited, res.doc.sets[pc.setKey], ASPECT, 'MS').cameraMove, cameraMoveOf(pc.camera));
});

test('범용성(고정 시드 퍼즈): 인물 수·키·자세·화면비·세트 크기·방위·높이·무브 조합 수백 컷에서 좌표가 깨지지 않는다', () => {
  let seed = 20260914;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  let total = 0;
  let visible = 0;
  let checked = 0;
  for (let ep = 0; ep < 25; ep++) {
    const reg = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, i) => `@인물${i}`);
    const aspect = pick([16 / 9, 9 / 16, 1, 2.39]);
    const cuts = Array.from({ length: 3 + Math.floor(rnd() * 8) }, (_, i) => ({ sceneId: String(i + 1), order: i, sceneLocation: pick(['방', '방', '거리']), estSec: 1.5 + rnd() * 6, shotType: pick(['CU', 'MS', 'WS', 'OTS']), cameraMove: 'static', cameraDirection: 'front', cameraElevation: 'eye', blocking: null, tokens: reg.filter(() => rnd() < 0.7), sceneBreak: rnd() < 0.1 }));
    let doc = emptyDoc();
    let heights = {};
    for (const g of groupScenes(cuts)) {
      let carry = carryFromDoc(doc, cuts, g[0]);
      for (const part of chunk(g, 4)) {
        const raw = { set: { w: 3 + rnd() * 15, d: 3 + rnd() * 10 }, heights: Object.fromEntries(reg.map((t) => [t, 0.3 + rnd() * 1.8])), cuts: part.map((c) => ({
          id: c.sceneId,
          actors: c.tokens.map((t) => ({ who: t + pick(['', '가', '는']), pos: rnd() < 0.8 ? [rnd() * 2 - 1, rnd() * 2 - 1] : undefined, face: pick(['front', 'back', 'left', 'right', ...c.tokens]), pose: pick(['stand', 'stand', 'sit', 'crouch', 'lie']) })),
          moves: c.tokens.filter(() => rnd() < 0.4).map((t) => { const a = rnd() * 0.7; return { who: t, t: [a, a + 0.1 + rnd() * 0.3], pos: [rnd() * 2 - 1, rnd() * 2 - 1], face: pick(['front', ...c.tokens]) }; }),
          camera: { subjects: c.tokens.slice(0, 1 + Math.floor(rnd() * 2)), size: pick(['CU', 'MCU', 'MS', 'MLS', 'WS']), view: pick(['front', 'back', 'left', 'right']), angle: pick(['eye', 'eye', 'high', 'low', 'worm', 'top']), framing: pick(['single', 'two', 'ots', 'pov', 'insert']), screen: pick(['left', 'center', 'right']), move: pick(['static', 'pan', 'tilt', 'track', 'crane', 'zoom', 'push_in', 'pull_out', 'handheld']), t: [rnd() * 0.5, 0.5 + rnd() * 0.5], over: pick(['', ...c.tokens]), look: pick(['', ...c.tokens]) },
        })) };
        const plan = normalizePlan(raw, part, reg);
        const res = stageCuts({ plan, cuts: part, doc, aspect, carry, heights });
        doc = res.doc; carry = res.carry; heights = res.heights;
        for (const c of part) {
          total++;
          const pc = doc.cuts[c.sceneId];
          const set = doc.sets[pc.setKey];
          const cp = plan.cuts.find((x) => x.sceneId === c.sceneId);
          const nums = [...pc.camera.flatMap((k) => [...k.pos, ...k.target, k.focal]), ...pc.actors.flatMap((a) => a.keys.flatMap((k) => [k.x, k.z, k.yaw]))];
          assert.ok(nums.every(Number.isFinite), `ep${ep} cut${c.sceneId} 유한수`);
          assert.ok(pc.actors.every((a) => a.keys.every((k) => Math.abs(k.x) <= set.width / 2 + 1e-6 && Math.abs(k.z) <= set.depth / 2 + 1e-6)), '세트 안');
          assert.ok(pc.actors.every((a) => a.keys.every((k, i, arr) => i === 0 || k.t > arr[i - 1].t) && a.keys.every((k) => k.t >= 0 && k.t <= pc.duration + 1e-6)), '키 시각 순서·길이 안');
          assert.ok(pc.camera.every((k, i, arr) => (i === 0 || k.t > arr[i - 1].t) && k.t <= pc.duration + 1e-6), '카메라 키 시각');
          const a0 = pc.actors.map((a) => ({ ...sampleActor(a.keys, 0), token: a.token, h: a.height }));
          for (let i = 0; i < a0.length; i++) for (let j = 0; j < i; j++) assert.ok(Math.hypot(a0[i].x - a0[j].x, a0[i].z - a0[j].z) >= 0.2, '시작 위치 겹침 없음');
          const f = deriveCutFields(pc, set, aspect, c.shotType);
          if (!['ots', 'pov'].includes(cp.camera.framing)) {
            assert.equal(f.cameraElevation, cp.camera.angle, `ep${ep} cut${c.sceneId} 높이`);
            if (cp.camera.angle !== 'top') assert.equal(f.cameraDirection, cp.camera.view, `ep${ep} cut${c.sceneId} 방위`);
          }
          const subs = cp.camera.subjects.map((t) => a0.find((a) => a.token === t)).filter(Boolean);
          if (subs.length && cp.camera.framing !== 'pov') {
            checked++;
            if (primarySubject(sampleCamera(pc.camera, 0), aspect, subs.map((s) => ({ token: s.token, x: s.x, z: s.z, height: s.h * POSE_HEIGHT[s.pose] })))) visible++;
          }
        }
      }
    }
  }
  assert.ok(total > 100, `검사 컷 ${total}`);
  assert.ok(visible / checked >= 0.97, `주인공이 첫 프레임에 보이는 비율 ${visible}/${checked}`);
});

test('자동 연출 버튼: 누른 버튼에만 로딩 스피너(lucide loader-circle), 폭 고정', () => {
  const studio = readSrc('ai-company-app/src/previz/PrevizStudio.tsx');
  assert.ok(studio.includes('setStagingScope(scope);'));
  assert.ok(studio.includes('{stagingScope === "scene" && <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />}{T.autoScene}'));
  assert.ok(studio.includes('{stagingScope === "all" && <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />}{T.autoAll}'));
  assert.ok(studio.includes('<path d="M21 12a9 9 0 1 1-6.219-8.56" />'));
  const finallyAt = studio.indexOf('setBusy("");\n      setStagingScope("");');
  assert.ok(finallyAt > studio.indexOf('const autoStage = async'), '끝나면(성공·실패 모두) 스피너를 끈다');
  assert.equal((studio.match(/inline-flex min-w-\[156px\]/g) || []).length, 2, '상태가 바뀌어도 버튼 폭 고정');
});
