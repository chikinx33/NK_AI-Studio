import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadScenarioHelpers() {
  const fullPath = path.join(process.cwd(), 'prototype/functions/api/scenario.js');
  let source = fs.readFileSync(fullPath, 'utf8');
  source = source
    .replace('export function calculateSceneCountForDuration', 'function calculateSceneCountForDuration')
    .replace('export async function onRequestPost', 'async function onRequestPost')
    .replace('export async function onRequestOptions', 'async function onRequestOptions');
  source += '\nmodule.exports = { calculateSceneCountForDuration, normalizeKnowledgeHubInput, buildUserPrompt, buildScenarioSpec, validateScenarioAgainstSpec, alignScenesToScenarioSpec, getSpeechCharLimit };';
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    module: { exports: {} },
    exports: {}
  });
  vm.runInContext(source, context, { filename: fullPath });
  return context.module.exports;
}

test('custom duration uses interpolated scene count instead of fixed fallback', () => {
  const helpers = loadScenarioHelpers();
  assert.equal(helpers.calculateSceneCountForDuration('90'), 14);
  assert.equal(helpers.calculateSceneCountForDuration('120'), 16);
});

test('character-disabled scenario prompt suppresses brand character context', () => {
  const helpers = loadScenarioHelpers();
  const knowledgeHub = helpers.normalizeKnowledgeHubInput({
    brandCharacter: '네모와 동그라미',
    brandVoice: '따뜻하게 설명한다.'
  }, { characterGenerationDisabled: true });

  const prompt = helpers.buildUserPrompt({
    lang: 'ko',
    topic: '숲의 아침 풍경',
    target: '',
    purposeCategory: '스토리 · 서사',
    purposeTags: '에피소드',
    needs: '',
    toneText: '차분',
    tones: '차분',
    styleText: '실사',
    styles: '실사',
    manualDirectives: '',
    knowledgeHub,
    aspectRatio: '16:9',
    duration: '30',
    characterGenerationDisabled: true,
    narrationEnabled: false,
    dubbingEnabled: false,
    characters: []
  });

  assert.equal(knowledgeHub.brandCharacter, '');
  assert.match(prompt, /캐릭터 모드: 비활성화/);
  assert.match(prompt, /대표 캐릭터\/주체: \(없음\)/);
});

test('scenario spec turns learning-play-humor overview into hard signals and blueprint', () => {
  const helpers = loadScenarioHelpers();
  const spec = helpers.buildScenarioSpec({
    lang: 'ko',
    topic: 'ABC 동요 배우기',
    target: '영유아',
    purposeCategory: '키즈 · 영유아',
    purposeTags: '키즈 놀이, 동요',
    needs: '놀이, 학습',
    toneText: '',
    tones: '유머',
    styleText: '애니메이션(3D)',
    styles: '애니메이션(3D)',
    knowledgeHub: { worldSetting: '우주선 놀이 교실' },
    duration: '15',
    sceneCount: 4
  });

  assert.equal(spec.topicProfile.subject, 'ABC');
  assert.equal(spec.signals.learning, true);
  assert.equal(spec.signals.play, true);
  assert.equal(spec.signals.song, true);
  assert.equal(spec.signals.humor, true);
  assert.equal(spec.signals.simpleLanguage, true);
  assert.equal(spec.sceneBlueprint.length, 4);
  assert.equal(spec.continuity.place, '우주선 놀이 교실');
  assert.match(spec.requiredOutputsKo.join(' '), /학습 대상 제시/);
  assert.match(spec.requiredOutputsKo.join(' '), /참여 요소/);
  assert.match(spec.requiredOutputsKo.join(' '), /유머 비트/);
  assert.match(spec.requiredOutputsKo.join(' '), /공간, 배경, 행동, 프롭/);
});

test('alignment step repairs generic scenes toward overview-fit structure', () => {
  const helpers = loadScenarioHelpers();
  const spec = helpers.buildScenarioSpec({
    lang: 'ko',
    topic: 'ABC 동요 배우기',
    target: '영유아',
    purposeCategory: '키즈 · 영유아',
    purposeTags: '키즈 놀이, 동요',
    needs: '놀이, 학습',
    toneText: '',
    tones: '유머',
    styleText: '애니메이션(3D)',
    styles: '애니메이션(3D)',
    duration: '15',
    sceneCount: 4
  });
  const genericScenes = [
    { id: 1, title: 'Scene 1', estSec: 4, narration: '친구들이 모인다.', dialogue: [{ speaker: '@narrator', line: '시작하자.' }], visual: '친구들이 선다.' },
    { id: 2, title: 'Scene 2', estSec: 4, narration: '함께 본다.', dialogue: [{ speaker: '@narrator', line: '좋아.' }], visual: '모두가 본다.' },
    { id: 3, title: 'Scene 3', estSec: 4, narration: '다시 한다.', dialogue: [{ speaker: '@narrator', line: '한 번 더.' }], visual: '함께 움직인다.' },
    { id: 4, title: 'Scene 4', estSec: 3, narration: '끝난다.', dialogue: [{ speaker: '@narrator', line: '끝.' }], visual: '손을 흔든다.' }
  ];

  const aligned = helpers.alignScenesToScenarioSpec(genericScenes, spec, {
    lang: 'ko',
    topic: 'ABC 동요 배우기',
    purposeCategory: '키즈 · 영유아',
    purposeTags: '키즈 놀이, 동요',
    toneText: '',
    tones: '유머',
    styleText: '애니메이션(3D)',
    styles: '애니메이션(3D)',
    aspectRatio: '16:9',
    sceneCount: 4,
    duration: 15,
    narrationEnabled: true,
    dubbingEnabled: true,
    defaultSpeaker: '@narrator'
  });
  const validation = helpers.validateScenarioAgainstSpec(aligned, spec);
  const combined = JSON.stringify(aligned);

  assert.equal(validation.passed, true);
  assert.match(combined, /ABC/);
  assert.match(combined, /카메라 연출/);
  assert.match(combined, /다시|한 번 더/);
  assert.match(combined, /실수|다시/);
  assert.ok(aligned.every((scene) => scene.sceneIntent && scene.sceneIntent !== scene.visual));
  assert.ok(aligned.every((scene) => /교실|놀이방|포스터|매트|카드|블록/.test(scene.visual)));
});

test('alignment keeps narration as spoken line and trims voice to scene duration', () => {
  const helpers = loadScenarioHelpers();
  const spec = helpers.buildScenarioSpec({
    lang: 'ko',
    topic: 'ABC 동요 배우기',
    target: '영유아',
    purposeCategory: '키즈 · 영유아',
    purposeTags: '동요',
    needs: '놀이',
    toneText: '',
    tones: '유머',
    styleText: '애니메이션(3D)',
    styles: '애니메이션(3D)',
    duration: '15',
    sceneCount: 4
  });

  const scenes = [
    {
      id: 1,
      title: 'Scene 1',
      estSec: 3,
      narration: '안녕! 오늘은 ABC를 배워볼 거야! 함께해봐!',
      dialogue: [{ speaker: '@narrator', line: '안녕! 오늘은 ABC를 배워볼 거야! 함께해봐!' }],
      visual: '친구들이 모인다.'
    },
    {
      id: 2,
      title: 'Scene 2',
      estSec: 4,
      narration: 'A는 사과야! B는 공룡! C는 고양이!',
      dialogue: [{ speaker: '@narrator', line: 'A는 사과야! B는 공룡! C는 고양이!' }],
      visual: 'ABC를 보여준다.'
    }
  ];

  const aligned = helpers.alignScenesToScenarioSpec(scenes, spec, {
    lang: 'ko',
    topic: 'ABC 동요 배우기',
    purposeCategory: '키즈 · 영유아',
    purposeTags: '동요',
    toneText: '',
    tones: '유머',
    styleText: '애니메이션(3D)',
    styles: '애니메이션(3D)',
    aspectRatio: '16:9',
    sceneCount: 2,
    duration: 7,
    narrationEnabled: true,
    dubbingEnabled: true,
    defaultSpeaker: '@narrator'
  });
  const limitNarr = helpers.getSpeechCharLimit(3, 'ko', 'narration');
  const limitDial = helpers.getSpeechCharLimit(3, 'ko', 'dialogue');

  assert.doesNotMatch(aligned[0].narration, /호기심을 끌어낸다|한 단계씩 보여 주며 쉽게 따라 배우게 한다|리듬감 있게 반복하며 함께 부른다/);
  assert.ok(aligned[0].narration.length <= limitNarr);
  assert.ok(aligned[0].dialogue.every((row) => row.line.length <= limitDial));
  assert.ok(aligned.every((scene) => scene.sceneIntent && scene.sceneIntent !== scene.visual));
});

test('alignment replaces placeholder narration and spreads scenes across sublocations in one world', () => {
  const helpers = loadScenarioHelpers();
  const spec = helpers.buildScenarioSpec({
    lang: 'ko',
    topic: 'ABC 동요 배우기',
    target: '영유아',
    purposeCategory: '키즈 · 영유아',
    purposeTags: '동요',
    needs: '놀이',
    tones: '유머',
    styleText: '애니메이션(3D)',
    styles: '애니메이션(3D)',
    knowledgeHub: {
      worldSetting: '도형 생명체가 살아가는 밝은 자연 세계\n마을, 들판, 숲, 하늘 등 단순하고 상징적인 공간'
    },
    duration: '15',
    sceneCount: 4
  });

  const scenes = [
    { id: 1, estSec: 4, narration: '장면을 설명하는 나레이션이 이어진다.', dialogue: [], visual: '' },
    { id: 2, estSec: 4, narration: '', dialogue: [{ speaker: '@narrator', line: '장면을 설명하는 나레이션이 이어진다.' }], visual: '' },
    { id: 3, estSec: 4, narration: '', dialogue: [], visual: '' },
    { id: 4, estSec: 3, narration: '', dialogue: [], visual: '' }
  ];

  const aligned = helpers.alignScenesToScenarioSpec(scenes, spec, {
    lang: 'ko',
    topic: 'ABC 동요 배우기',
    purposeCategory: '키즈 · 영유아',
    purposeTags: '동요',
    toneText: '',
    tones: '유머',
    styleText: '애니메이션(3D)',
    styles: '애니메이션(3D)',
    aspectRatio: '16:9',
    sceneCount: 4,
    duration: 15,
    narrationEnabled: true,
    dubbingEnabled: true,
    defaultSpeaker: '@narrator'
  });

  const visuals = aligned.map((scene) => scene.visual);
  const narrationJoined = aligned.map((scene) => scene.narration).join(' ');
  const dialogueJoined = JSON.stringify(aligned.map((scene) => scene.dialogue));

  assert.doesNotMatch(narrationJoined, /장면을 설명하는 나레이션이 이어진다/);
  assert.doesNotMatch(dialogueJoined, /장면을 설명하는 나레이션이 이어진다/);
  assert.ok(visuals.some((text) => /마을/.test(text)));
  assert.ok(visuals.some((text) => /들판|숲|하늘/.test(text)));
  assert.ok(new Set(visuals).size > 1);
});

test('character-enabled dialogue hints use actual character speakers instead of narrator', () => {
  const helpers = loadScenarioHelpers();
  const spec = helpers.buildScenarioSpec({
    lang: 'ko',
    topic: 'ABC 동요 배우기',
    target: '영유아',
    purposeCategory: '키즈 · 영유아',
    purposeTags: '동요',
    needs: '놀이',
    tones: '유머',
    styleText: '애니메이션(3D)',
    styles: '애니메이션(3D)',
    characters: [
      { token: '@네모', displayName: '네모' },
      { token: '@세모', displayName: '세모' }
    ],
    duration: '15',
    sceneCount: 2
  });

  const scenes = [
    { id: 1, estSec: 4, narration: '', dialogue: [], visual: '' },
    { id: 2, estSec: 4, narration: '', dialogue: [], visual: '' }
  ];

  const aligned = helpers.alignScenesToScenarioSpec(scenes, spec, {
    lang: 'ko',
    topic: 'ABC 동요 배우기',
    purposeCategory: '키즈 · 영유아',
    purposeTags: '동요',
    toneText: '',
    tones: '유머',
    styleText: '애니메이션(3D)',
    styles: '애니메이션(3D)',
    aspectRatio: '16:9',
    sceneCount: 2,
    duration: 8,
    narrationEnabled: true,
    dubbingEnabled: true,
    defaultSpeaker: '@네모'
  });

  const speakers = aligned.flatMap((scene) => (scene.dialogue || []).map((row) => row.speaker));
  assert.ok(speakers.includes('@네모'));
  assert.ok(!speakers.every((speaker) => speaker === '@narrator'));
});

test('delivery fields separate video speech and subtitles when narration and dialogue are both enabled', () => {
  const helpers = loadScenarioHelpers();
  const spec = helpers.buildScenarioSpec({
    lang: 'ko',
    topic: 'ABC 동요 배우기',
    target: '영유아',
    purposeCategory: '키즈 · 영유아',
    purposeTags: '동요',
    needs: '놀이',
    characters: [{ token: '@네모', displayName: '네모' }],
    duration: '8',
    sceneCount: 1
  });

  const aligned = helpers.alignScenesToScenarioSpec([{
    id: 1,
    estSec: 4,
    narration: '모양새 친구들이 꿈동산에 모였어요.',
    dialogue: [{ speaker: '@네모', line: '세모야, 날 따라해봐.' }],
    visual: '밝은 놀이방 교실, 교실 입구. 친구들이 모인다.'
  }], spec, {
    lang: 'ko',
    topic: 'ABC 동요 배우기',
    purposeCategory: '키즈 · 영유아',
    purposeTags: '동요',
    narrationEnabled: true,
    dubbingEnabled: true,
    defaultSpeaker: '@네모'
  });

  assert.match(aligned[0].videoSpeechPrompt, /"모양새 친구들이 꿈동산에 모였어요\."/);
  assert.match(aligned[0].videoSpeechPrompt, /네모가 말한다\.\s*"세모야, 날 따라해봐\."/);
  assert.equal(aligned[0].subtitleText, '세모야, 날 따라해봐.');
  assert.equal(aligned[0].script, '모양새 친구들이 꿈동산에 모였어요.\n세모야, 날 따라해봐.');
  assert.equal(aligned[0].lines, aligned[0].subtitleText);
});

test('delivery fields use narration for both video speech and subtitles when only narration is enabled', () => {
  const helpers = loadScenarioHelpers();
  const spec = helpers.buildScenarioSpec({
    lang: 'ko',
    topic: 'ABC 동요 배우기',
    target: '영유아',
    purposeCategory: '키즈 · 영유아',
    purposeTags: '동요',
    needs: '놀이',
    duration: '4',
    sceneCount: 1
  });

  const aligned = helpers.alignScenesToScenarioSpec([{
    id: 1,
    estSec: 4,
    narration: '모양새 친구들이 꿈동산에 모였어요.',
    visual: '밝은 놀이방 교실, 교실 입구. 친구들이 모인다.'
  }], spec, {
    lang: 'ko',
    topic: 'ABC 동요 배우기',
    purposeCategory: '키즈 · 영유아',
    purposeTags: '동요',
    narrationEnabled: true,
    dubbingEnabled: false,
    defaultSpeaker: '@narrator'
  });

  assert.equal(aligned[0].videoSpeechPrompt, '"모양새 친구들이 꿈동산에 모였어요."');
  assert.equal(aligned[0].subtitleText, '모양새 친구들이 꿈동산에 모였어요.');
  assert.equal(aligned[0].script, '모양새 친구들이 꿈동산에 모였어요.');
});

test('delivery fields use dialogue for both video speech and subtitles when only dialogue is enabled', () => {
  const helpers = loadScenarioHelpers();
  const spec = helpers.buildScenarioSpec({
    lang: 'ko',
    topic: 'ABC 동요 배우기',
    target: '영유아',
    purposeCategory: '키즈 · 영유아',
    purposeTags: '동요',
    needs: '놀이',
    characters: [{ token: '@네모', displayName: '네모' }],
    duration: '4',
    sceneCount: 1
  });

  const aligned = helpers.alignScenesToScenarioSpec([{
    id: 1,
    estSec: 4,
    dialogue: [{ speaker: '@네모', line: '세모야, 날 따라해봐.' }],
    visual: '밝은 놀이방 교실, 교실 입구. 친구들이 모인다.'
  }], spec, {
    lang: 'ko',
    topic: 'ABC 동요 배우기',
    purposeCategory: '키즈 · 영유아',
    purposeTags: '동요',
    narrationEnabled: false,
    dubbingEnabled: true,
    defaultSpeaker: '@네모'
  });

  assert.match(aligned[0].videoSpeechPrompt, /네모가 말한다\.\s*"세모야, 날 따라해봐\."/);
  assert.equal(aligned[0].subtitleText, '세모야, 날 따라해봐.');
  assert.equal(aligned[0].script, '세모야, 날 따라해봐.');
});

test('validation fails abrupt location jumps and abstract visuals', () => {
  const helpers = loadScenarioHelpers();
  const spec = helpers.buildScenarioSpec({
    lang: 'ko',
    topic: 'ABC 동요 배우기',
    target: '영유아',
    purposeCategory: '키즈 · 영유아',
    purposeTags: '동요',
    needs: '놀이',
    tones: '유머',
    styleText: '애니메이션(3D)',
    styles: '애니메이션(3D)',
    knowledgeHub: { worldSetting: '우주선 놀이 교실' },
    duration: '15',
    sceneCount: 2
  });

  const broken = [
    {
      id: 1,
      title: 'Scene 1',
      estSec: 4,
      sceneIntent: '도입',
      narration: '시작해보자.',
      visual: '우주가 보이는 장면. 카메라 연출: 미디엄 샷, 아이레벨 앵글, 느린 돌리 인, 안정적인 중앙 구도.'
    },
    {
      id: 2,
      title: 'Scene 2',
      estSec: 4,
      sceneIntent: '전개',
      narration: '다음으로 간다.',
      visual: '깊은 바다 속에서 친구들이 등장한다. 카메라 연출: 와이드 샷, 하이앵글, 부드러운 패닝, 전경과 배경이 보이는 레이어 구도.'
    }
  ];

  const validation = helpers.validateScenarioAgainstSpec(broken, spec);
  const failedKeys = validation.failed.map((row) => row.key);

  assert.equal(validation.passed, false);
  assert.ok(failedKeys.includes('visual_concreteness') || failedKeys.includes('setting_anchor'));
  assert.ok(failedKeys.includes('setting_continuity'));
});
