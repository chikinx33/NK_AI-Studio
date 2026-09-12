// 연속성 1단계 버그 4건 회귀 고정.
//  (1) Kling 체인 방향: 이전 컷 마지막 프레임을 "이번 컷 끝 프레임"으로 보내던 역방향 체인 제거,
//      스틸 없는 컷은 같은 장소 직전 컷 마지막 프레임에서 "시작"한다(정방향).
//  (2) CAMERA_POOL 값이 통제 어휘(CAMERA_MOVES)에 있어야 정규화에서 살아남는다.
//  (3) 자동 연속성 앵커: 종횡비 보정으로 data: URL 이 된 직전 컷도 imagePath 로 잇는다.
//  (4) front 방위도 방위 힌트를 낸다(서버·브라우저 동일 문장).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

import { diversifyShotCameraMoves } from '../functions/api/scenario/rebalancer.js';
import { CAMERA_MOVE_KEYS, normalizeCameraMove, buildCameraDirectionHint } from '../functions/api/scenario/shots/vocab.js';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

function loadBrowserShotVocab() {
  const src = read('prototype/js/service/shot-vocab.js');
  const sandbox = { window: {}, console };
  sandbox.window.NK = {};
  vm.runInNewContext(src, sandbox);
  return sandbox.window.NK.service.shotVocab;
}

test('(2) CAMERA_POOL 치환 결과는 전부 통제 어휘이며 정규화에서 null 이 되지 않는다', () => {
  const scenes = [{
    id: 1,
    shots: Array.from({ length: 12 }, (_, i) => ({ id: `1.${i + 1}`, cameraMove: 'static', action: 'x' })),
  }];
  const res = diversifyShotCameraMoves(scenes);
  assert.ok(res.swaps >= 6);
  res.scenes[0].shots.forEach((s) => {
    assert.ok(CAMERA_MOVE_KEYS.includes(s.cameraMove), `${s.cameraMove} 는 어휘 밖`);
    assert.equal(normalizeCameraMove(s.cameraMove), s.cameraMove);
  });
});

test('(4) front 방위 힌트가 서버·브라우저 모두 같은 문장으로 나온다', () => {
  const server = buildCameraDirectionHint('front', 'en');
  assert.ok(server.startsWith('Camera direction: front side of the set'));
  assert.equal(buildCameraDirectionHint('', 'en'), server, '미지정도 front 문장');
  const browser = loadBrowserShotVocab();
  assert.equal(browser.buildCameraDirectionHint('front', 'en'), server);
  assert.equal(browser.buildCameraDirectionHint(undefined, 'en'), server);
  assert.notEqual(buildCameraDirectionHint('back', 'en'), server);
});

test('(3) 자동 연속성 앵커는 data: URL 직전 컷을 imagePath 영속 URL 로 대체해 잇는다', () => {
  const src = read('prototype/ui/pipeline-image.js');
  const block = src.slice(src.indexOf('자동 연속성 앵커'), src.indexOf('Auto continuity reference (image)'));
  assert.ok(block.length > 0, '자동 연속성 앵커 블록을 찾지 못함');
  assert.match(block, /prevSc\.imagePath/, 'imagePath 폴백이 없습니다');
  assert.match(block, /mediaProxyObjectUrl\(prevObj\)/, '영속 프록시 URL 로 바꾸지 않습니다');
  assert.doesNotMatch(block, /indexOf\('data:'\) === 0\) continue/, 'data: URL 을 여전히 그냥 건너뜁니다');
});

test('(1) 역방향 image_tail 체인이 사라지고, 스틸 없는 컷은 직전 마지막 프레임에서 시작한다', () => {
  const src = read('prototype/ui/pipeline-video.js');
  assert.doesNotMatch(src, /endImageDataUrl = \(prevScene && \(prevScene\.lastFrameDataUrl/, '역방향 체인이 남아 있습니다');
  assert.match(src, /function pickPrevLastFrameForStart\(scenes, idx\)/);
  assert.match(src, /imageUrl = pickPrevLastFrameForStart\(st\.scenes, opts\.idx\)/);
  // 마지막 프레임 추출이 Kling 전용 게이트에서 풀렸다
  assert.doesNotMatch(src, /isKlingModel && NK\.util && NK\.util\.extractLastFrame/);
  assert.match(src, /if \(NK\.util && NK\.util\.extractLastFrame\)/);
});

test('(1) pickPrevLastFrameForStart: 같은 장소만 잇고, 장소가 바뀌면 빈 값', () => {
  const src = read('prototype/ui/pipeline-video.js');
  const start = src.indexOf('function pickPrevLastFrameForStart');
  const end = src.indexOf('// Kling 선택 시', start);
  const fnSrc = src.slice(start, end);
  const sandbox = {};
  vm.runInNewContext(fnSrc + '\nthis.fn = pickPrevLastFrameForStart;', sandbox);
  const fn = sandbox.fn;
  const scenes = [
    { id: 1, sceneLocation: '거실', lastFrameDataUrl: 'data:1', videoUrl: 'v1' },
    { id: 2, sceneLocation: '거실', imageDataUrl: '' },
    { id: 3, sceneLocation: '옥상', imageDataUrl: '' },
  ];
  assert.equal(fn(scenes, 1), 'data:1');
  assert.equal(fn(scenes, 2), '', '장소가 바뀌면 잇지 않는다');
  assert.equal(fn([{ id: 1, videoUrl: 'v1' }, { id: 2 }], 1), '', '영상은 있는데 프레임 추출 실패면 포기');
});
