// 이동 서술 판정의 단일 원천(_shared/motion-words.js)과, 그 오탐이 낳던 두 증상의 재발 방지.
//  - "내려다보며"(시선)·"내밀며"(몸짓)를 이동으로 오인해 블로킹 앵커를 건너뛰던 문제.
//  - 인물이 자리를 옮기는 샷인데 composition 이 도착 상태로 쓰이고 beats 가 없던 문제.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { MOVE_RE, hasCharacterMovement } from '../functions/api/_shared/motion-words.js';
import { enforceSequenceContinuity } from '../functions/api/scenario/rebalancer.js';
import { shotsMissingBeats, buildBeatsRepairPrompt, buildShotPromptKo, buildShotPromptEn } from '../functions/api/scenario/shots/decomposer.js';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('★시선·몸짓은 이동이 아니고, 실제 이동은 잡는다', () => {
  for (const t of ['발밑을 내려다보며 두 눈을 동그랗게', '큐브를 올려다본다', '고개를 앞으로 쭉 내밀며', '팔을 아래로 뻗어 가리킨다', 'looks down at the cube']) {
    assert.equal(hasCharacterMovement(t), false, `이동 아님: ${t}`);
  }
  for (const t of ['왼쪽에서 달려 들어와', '창가로 걸어간다', '큐브 앞에 쪼그려 앉는다', '문을 밀고 들어간다', '@Ann walks to the table', 'stands up and steps back']) {
    assert.equal(hasCharacterMovement(t), true, `이동: ${t}`);
  }
});

test('★브라우저 pipeline-image.js 의 MOVE_RE 리터럴이 서버 단일 원천과 같다', () => {
  const client = read('prototype/ui/pipeline-image.js').match(/var MOVE_RE = (\/.*\/i);/);
  assert.ok(client, '브라우저 MOVE_RE 가 없습니다');
  assert.equal(client[1], MOVE_RE.toString());
  assert.match(read('prototype/functions/api/scenario/rebalancer.js'), /import \{ MOVE_RE as SHARED_MOVE_RE \} from "\.\.\/_shared\/motion-words\.js";/);
});

test('★"내려다보며"만 있는 컷은 이동으로 보지 않아 앵커가 좌표를 되돌린다', () => {
  const scenes = [
    { id: 1, sceneLocation: '방', shots: [{ id: '1.1', shotType: 'WS', action: '@네모가 손을 든다', blocking: [{ token: '@네모', x: 'left', depth: 'near', facing: 'camera' }] }] },
    { id: 2, sceneLocation: '방', shots: [{ id: '2.1', shotType: 'CU', action: '@네모가 발밑을 내려다보며 손가락을 뻗는다', blocking: [{ token: '@네모', x: 'center', depth: 'near', facing: 'camera' }] }] },
  ];
  const res = enforceSequenceContinuity(scenes);
  assert.equal(res.blockingAnchors, 1);
  assert.equal(res.scenes[1].shots[0].blocking[0].x, 'left');
});

test('★카메라가 서 있어도 인물이 자리를 옮기는 샷은 beats 가 없으면 보정 대상이다', () => {
  const shots = [
    { id: '2.1', cameraMove: 'static', action: '@동그라미가 왼쪽에서 달려 들어와 큐브 앞에 쪼그려 앉는다', beats: null },
    { id: '2.2', cameraMove: 'static', action: '@네모가 고개를 앞으로 내밀며 큐브를 들여다본다', beats: null },
    { id: '2.3', cameraMove: 'static', action: '@세모가 걸어간다', beats: [{ at: 0, what: 'a' }, { at: 2, what: 'b' }] },
    { id: '2.4', cameraMove: 'tilt', beats: null },
  ];
  assert.deepEqual(shotsMissingBeats(shots).map((s) => s.id), ['2.1', '2.4']);
  assert.match(buildBeatsRepairPrompt([{ id: '2.1' }], 'ko'), /카메라가 움직이거나 인물이 자리를 옮기는데/);
  assert.match(buildBeatsRepairPrompt([{ id: '2.1' }], 'en'), /a camera move or a character relocating/);
});

test('★분해 프롬프트: composition 은 언제나 t=0, 인물 이동 샷도 beats 필수(한/영)', () => {
  const ko = buildShotPromptKo();
  assert.match(ko, /\[composition 은 언제나 t=0 이다\]/);
  assert.match(ko, /도착 상태\("큐브 앞에 쪼그려 앉은"\)를 composition 에 쓰면/);
  assert.match(ko, /\[beats — 카메라가 움직이거나 인물이 자리를 옮기면 반드시 채운다\]/);
  const en = buildShotPromptEn();
  assert.match(en, /\[composition is ALWAYS t=0\]/);
  assert.match(en, /\[beats — mandatory whenever the camera moves OR a character relocates\]/);
});
