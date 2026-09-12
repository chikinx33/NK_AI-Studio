// 연속성 6단계: 영상 단계에도 공간 데이터(방위·블로킹)와 세트 플레이트를 주입한다.
//  - 씬 영상 프롬프트(브라우저·서버 동일)에 'Camera' 블록: 샷 카메라 힌트 + 방위 + 블로킹.
//  - 컷 영상 프롬프트에도 방위·블로킹.
//  - 레퍼런스를 받는 영상 모델(grok-r2v, wan, seedance-r2v, vidu-q3)에 캐릭터 시트뿐 아니라 세트 플레이트도 보낸다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { buildSceneVideoPrompt } from '../functions/api/_shared/prompt-assembly.js';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

function loadVideo() {
  const ctx = { console, setTimeout, clearTimeout, window: null, localStorage: { getItem() { return null; }, setItem() {} },
    NK: { api: { mediaProxyObjectUrl(o) { return o ? '/proxy/' + o : ''; } }, service: {}, state: { runtime: { lang: 'ko' } } } };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['prototype/js/service/shot-vocab.js', 'prototype/js/service/stage-geometry.js', 'prototype/js/service/set-plates.js', 'prototype/ui/pipeline-video.js']
    .forEach((rel) => vm.runInContext(fs.readFileSync(path.join(process.cwd(), rel), 'utf8'), ctx, { filename: rel }));
  return ctx.NK;
}

const scene = {
  id: '3', sceneLocation: '거실', shot: '@네모가 소파에서 리모컨을 든다', composition: '@네모 상반신',
  shotType: 'MCU', cameraMove: 'push_in', cameraDirection: 'back', estSec: 5,
  blocking: [{ token: '@네모', x: 'left', depth: 'near', facing: 'camera' }, { token: '@세모', x: 'right', depth: 'far', facing: 'left' }],
};

test('★서버 씬 영상 프롬프트에 Camera 블록(카메라 힌트·방위·블로킹)이 들어간다', () => {
  const out = buildSceneVideoPrompt(scene, 'HDR', { narrationEnabled: false });
  const lines = out.split('\n');
  const camIdx = lines.indexOf('Camera');
  assert.ok(camIdx > lines.indexOf('Scene Visual'), 'Camera 는 Scene Visual 뒤');
  assert.ok(camIdx < lines.indexOf('Scene Duration'));
  assert.match(out, /Camera: medium close-up framed from chest up; slow push-in toward the subject/);
  assert.match(out, /Camera direction: REVERSE ANGLE/);
  // 블로킹은 화면(composition)에 있는 @네모만, 방위 back 이라 좌우가 뒤집힌다
  assert.match(out, /Spatial layout as seen from THIS camera: 네모 — on the right of frame, in the background far from camera, seen from behind, back to the camera\./);
  assert.doesNotMatch(out, /세모 —/, '화면에 없는 캐릭터의 블로킹은 넣지 않는다');
});

test('★브라우저 씬 영상 프롬프트도 같은 Camera 문장을 낸다 (서버와 동일)', () => {
  const NK = loadVideo();
  const lines = NK.uiPipelineVideo._helpers.buildVideoCameraLines(scene, null);
  const server = buildSceneVideoPrompt(scene, 'HDR', { narrationEnabled: false }).split('\n');
  const from = server.indexOf('Camera') + 1;
  assert.deepEqual([...lines], server.slice(from, from + lines.length));
});

test('★컷 영상 프롬프트에 방위·블로킹이 붙는다', () => {
  const NK = loadVideo();
  const shot = { id: '3.2', composition: '@세모 얼굴', action: '@세모가 웃는다', shotType: 'CU', cameraMove: 'static', cameraDirection: 'left', duration: 4,
    blocking: [{ token: '@세모', x: 'right', depth: 'far', facing: 'left' }] };
  const out = NK.uiPipelineVideo._helpers.buildShotVideoPrompt(scene, shot, 'HDR', {});
  assert.match(out, /Camera: close-up of one face/);
  assert.match(out, /Camera direction: the camera faces the left side of the set\./);
  assert.match(out, /Spatial layout as seen from THIS camera: 세모 —/);
  const i1 = out.indexOf('Camera:'); const i2 = out.indexOf('Camera direction:'); const i3 = out.indexOf('Duration');
  assert.ok(i1 < i2 && i2 < i3, '카메라 힌트 → 방위·블로킹 → Duration 순서');
});

test('★세트 플레이트 URL: 컷의 방위 플레이트 우선, 없으면 마스터, 장소 없으면 빈 값', () => {
  const NK = loadVideo();
  const st = { payload: { episodeLocations: [{ id: 'room', name: '거실', refObjectName: 'plates/room.png', sceneIds: ['3'],
    variants: [{ id: 'dir-back', refObjectName: 'plates/room-back.png' }] }] } };
  const h = NK.uiPipelineVideo._helpers;
  assert.equal(h.resolveSetPlateUrl(st, scene, null), '/proxy/plates/room-back.png', 'back 방위 플레이트');
  assert.equal(h.resolveSetPlateUrl(st, scene, { cameraDirection: 'left' }), '/proxy/plates/room.png', '없는 방위는 마스터');
  assert.equal(h.resolveSetPlateUrl(st, { id: '9', sceneLocation: '우주' }, null), '');
  assert.deepEqual([...h.insertPlateReference(['c1', 'c2', 'c3'], 'p')], ['c1', 'c2', 'p', 'c3'], '캐릭터 두 장 뒤에 끼워 상한 4장 모델에서도 살아남는다');
  assert.deepEqual([...h.insertPlateReference([], 'p')], ['p']);
  assert.deepEqual([...h.insertPlateReference(['p'], 'p')], ['p'], '중복 방지');
});

test('★레퍼런스 모델 경로(씬·컷) 모두 플레이트를 끼우고 프롬프트에 플레이트 문장을 덧붙인다', () => {
  const src = read('prototype/ui/pipeline-video.js');
  const sceneStart = src.indexOf('video.startVideoForIdx = async function');
  const shotStart = src.indexOf('video.startVideoForShot = async function');
  const sceneBlock = src.slice(sceneStart, shotStart);
  const shotBlock = src.slice(shotStart);
  assert.match(sceneBlock, /resolveSetPlateUrl\(st, scene, null\)/);
  assert.match(sceneBlock, /insertPlateReference\(referenceImages, scenePlateUrl\)/);
  assert.match(shotBlock, /resolveSetPlateUrl\(st, scene, shot\)/);
  assert.match(shotBlock, /insertPlateReference\(referenceImages, shotPlateUrl\)/);
  assert.match(sceneBlock, /SET_PLATE_PROMPT_LINE/);
  assert.match(shotBlock, /SET_PLATE_PROMPT_LINE/);
});
