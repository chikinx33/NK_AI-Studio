// 서버측 프롬프트 조립기(_shared/prompt-assembly.js) 런타임 테스트.
// 브라우저 buildImagePrompt / pipeline-video promptBase 와 같은 블록·같은 문장을 내는지 실제 값으로 확인한다.
// (문자열 표류는 prompt-assembly-parity.test.mjs 가 소스 텍스트로 따로 막는다.)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const mod = await import(pathToFileURL(path.join(process.cwd(), 'prototype/functions/api/_shared/prompt-assembly.js')).href);
const {
  buildSceneImagePrompt, buildSceneVideoPrompt, buildBeatTimeline, cleanHeader,
  dedupeLocationAgainstCommon, firstFrameText, describePromptSections,
} = mod;

const FIRST_FRAME = 'This still is the FIRST FRAME of the shot (t=0)';
const NO_TEXT = '텍스트/워터마크를 넣지 말고, 지정된 스타일만 사용.';

test('beats 가 있으면 Composition 은 첫 프레임 + FIRST FRAME 문장', () => {
  const scene = {
    composition: '전신이 보이는 화면',
    beats: [{ at: 0, what: '발과 하체만 보인다' }, { at: 2.5, what: '틸트업해 전신' }],
  };
  const out = buildSceneImagePrompt(scene, 'Style header');
  const lines = out.split('\n');
  assert.equal(lines[0], 'Style header');
  assert.equal(lines[1], 'Composition: 발과 하체만 보인다', '첫 비트가 스틸의 화면이다');
  assert.ok(lines[2].startsWith(FIRST_FRAME));
  assert.ok(!out.includes('전신이 보이는 화면'), 'beats 가 있으면 composition 통째로는 쓰지 않는다');
  assert.equal(lines[lines.length - 1], NO_TEXT);
});

test('beats 가 없으면 composition 을 쓰고 action 은 절대 섞지 않는다', () => {
  const out = buildSceneImagePrompt({ composition: '@네모 stands still', action: '@네모 jumps' }, '');
  assert.ok(out.includes('Composition: @네모 stands still'));
  assert.ok(!out.includes('jumps'), '행동은 영상용 — 이미지 프롬프트에 들어가면 안 된다');
  assert.ok(!out.includes(FIRST_FRAME));
});

test('action 은 화면·비주얼이 모두 없을 때만 최후 보루', () => {
  const only = buildSceneImagePrompt({ action: '@네모 jumps' }, '');
  assert.ok(only.startsWith('Composition: @네모 jumps'));
  const withShot = buildSceneImagePrompt({ shot: 'A knight on a hill', action: '@네모 jumps' }, '');
  assert.ok(withShot.startsWith('A knight on a hill'), '비주얼(shot)이 있으면 그것을 라벨 없이 쓴다');
  assert.ok(!withShot.includes('jumps'));
});

test('scene.common 이 비어 있지 않으면 header 대신 쓴다', () => {
  const a = buildSceneImagePrompt({ common: 'Cut common', composition: 'x' }, 'Project header');
  assert.ok(a.startsWith('Cut common'));
  assert.ok(!a.includes('Project header'));
  // /api/project/get 은 미설정 common 을 "" 로 보낸다 → 헤더 폴백이 걸려야 한다.
  const b = buildSceneImagePrompt({ common: '', composition: 'x' }, 'Project header');
  assert.ok(b.startsWith('Project header'));
});

test('Location 은 common 과 겹치는 앞부분을 잘라내고 붙는다', () => {
  const header = '배경: 중세 판타지 전장. 어두운 톤';
  const out = buildSceneImagePrompt({ sceneLocation: '중세 판타지 전장 — 광활한 평원', composition: 'x' }, header);
  assert.ok(out.includes('Location: 광활한 평원'), out);
  assert.equal(dedupeLocationAgainstCommon('중세 판타지 전장 — 광활한 평원', header), '광활한 평원');
});

test('블록 순서: common → Location → Composition → camera → direction → blocking → no-text', () => {
  const scene = {
    sceneLocation: '숲속 오두막', composition: '@네모 waits by the door', shotType: 'MS', cameraMove: 'push_in',
    cameraDirection: 'back',
    blocking: [{ token: '@네모', x: 'left', depth: 'near', facing: 'camera' }],
  };
  const out = buildSceneImagePrompt(scene, 'Painterly style');
  const idx = (s) => out.indexOf(s);
  const order = [idx('Painterly style'), idx('Location: '), idx('Composition: '), idx('Camera: '), idx('Camera direction: '), idx('Spatial layout'), idx(NO_TEXT)];
  order.forEach((v, i) => assert.ok(v >= 0, `블록 ${describePromptSections('image')[i]} 이 없다`));
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], `블록 순서가 어긋남: ${describePromptSections('image')[i]}`);
  // 브라우저와 같은 후처리: ';' → ','
  assert.ok(!out.includes(';'));
  assert.ok(out.includes('Camera: medium shot framed from the waist up, slow push-in toward the subject, building tension.'));
});

test("cameraDirection:'back' 이면 블로킹 x 가 거울처럼 뒤집히고 정면은 등이 된다", () => {
  const scene = {
    composition: '@네모 and @세모 face off',
    cameraDirection: 'back',
    blocking: [
      { token: '@네모', x: 'left', depth: 'near', facing: 'camera' },
      { token: '@세모', x: 'right', depth: 'far', facing: 'away' },
    ],
  };
  const out = buildSceneImagePrompt(scene, '');
  assert.ok(out.includes('Camera direction: REVERSE ANGLE'));
  assert.ok(out.includes('네모 — on the right of frame, in the background far from camera, seen from behind, back to the camera'), out);
  assert.ok(out.includes('세모 — on the left of frame, in the foreground close to camera, facing the camera'), out);
});

test('블로킹은 화면 텍스트에 등장하는 @토큰으로만 제한한다', () => {
  const scene = {
    composition: '@네모 alone',
    blocking: [{ token: '@네모', x: 'center' }, { token: '@세모', x: 'left' }],
  };
  const out = buildSceneImagePrompt(scene, '');
  assert.ok(out.includes('네모 — at the center of frame'));
  assert.ok(!out.includes('세모 —'), '화면 밖 캐릭터는 끌어들이지 않는다');
});

test('front 방위도 방위 힌트를 명시한다 (기본값 컷이 방위 없이 평탄해지지 않게)', () => {
  const out = buildSceneImagePrompt({ composition: 'x', cameraDirection: 'front' }, '');
  assert.ok(out.includes('Camera direction: front side of the set'));
  const none = buildSceneImagePrompt({ composition: 'x' }, '');
  assert.ok(none.includes('Camera direction: front side of the set'), '방위 미지정도 front 로 명시');
});

test('buildBeatTimeline 은 "0.0s-2.5s: ..." 형식', () => {
  const scene = { beats: [{ at: 0, what: '발만' }, { at: 2.5, what: '전신' }] };
  assert.equal(buildBeatTimeline(scene, 4), '0.0s-2.5s: 발만\n2.5s-4.0s: 전신');
  assert.equal(buildBeatTimeline({ beats: [{ at: 0, what: '하나' }] }, 4), '', '비트 1개는 시간표가 아니다');
  assert.equal(firstFrameText(scene), '발만');
});

test('영상 프롬프트: Global / Scene Visual / Camera / Shot timeline / Scene Duration 순서', () => {
  const scene = { shot: 'A knight walks', estSec: 4, beats: [{ at: 0, what: '발만' }, { at: 2.5, what: '전신' }] };
  const out = buildSceneVideoPrompt(scene, 'HDR cinematic', { narrationEnabled: false });
  const expected = [
    'Global', 'HDR cinematic', 'Scene Visual', 'A knight walks',
    'Camera', 'Camera direction: front side of the set (same direction as the master plate).',
    'Shot timeline (what is visible over time)', '0.0s-2.5s: 발만', '2.5s-4.0s: 전신',
    'Scene Duration', '4s.',
    'No speech, no dialogue, no voice-over, no lip sync, keep mouths closed.',
  ];
  assert.deepEqual(out.split('\n'), expected);
});

test('영상 프롬프트: 헤더가 없으면 payload 선택값으로 Global 을 만든다', () => {
  const out = buildSceneVideoPrompt({ shot: 'x', estSec: 3 }, '', { topic: 'Space', tones: ['calm'], style: 'anime' });
  assert.ok(out.includes('Global\nTopic: Space\nTone: calm\nStyle: anime\nScene Visual'), out);
});

test('영상 프롬프트: scene.promptText 가 있으면 그것이 본문(브라우저 덮어쓰기 규칙)', () => {
  const scene = { shot: 'ignored', promptText: 'Hand-edited video prompt', estSec: 3 };
  const out = buildSceneVideoPrompt(scene, 'HDR', {});
  assert.ok(out.startsWith('Hand-edited video prompt'));
  assert.ok(!out.includes('Global'));
  assert.ok(!out.includes('ignored'));
});

test('영상 프롬프트: 더빙 ON 이면 대본 블록, voiceMode 가 payload 보다 우선', () => {
  const scene = { shot: 'x', estSec: 3, narration: '안녕' };
  const dub = buildSceneVideoPrompt(scene, 'H', { dubbingEnabled: true });
  assert.ok(dub.includes('[대사/립싱크] The character(s) speak the following lines on camera with accurate lip-sync. Match mouth movements precisely to the spoken words:\n대사\n@narrator "안녕"'), dub);
  assert.ok(!dub.includes('No speech'));
  const forcedOff = buildSceneVideoPrompt(scene, 'H', { dubbingEnabled: true }, { voiceMode: 'none' });
  assert.ok(forcedOff.includes('No speech, no dialogue'));
  const forcedNarr = buildSceneVideoPrompt(scene, 'H', {}, { voiceMode: 'narration' });
  assert.ok(forcedNarr.includes('나레이션 "안녕"'));
});

test('cleanHeader 는 화면비·분량 문구를 지운다', () => {
  const out = cleanHeader('# 비주얼 스타일: 수채화\n종횡비 16:9\n배경: 숲\n타겟 30초');
  assert.equal(out, '배경: 숲');
});

test('describePromptSections 는 조립 순서를 돌려준다', () => {
  assert.deepEqual(describePromptSections('image'), ['common', 'Location:', 'Composition:', 'camera', 'direction', 'blocking', 'no-text']);
  assert.deepEqual(describePromptSections('video'), ['Global', 'Scene Visual', 'Camera', 'Shot timeline (what is visible over time)', 'Scene Duration']);
});
