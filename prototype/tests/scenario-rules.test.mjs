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
    .replace('export async function onRequestOptions', 'async function onRequestOptions')
    // Phase 0 Step 8 이후 scenario.js 는 블록 규칙 모듈을 ESM 으로 import 한다.
    // vm 스크립트 컨텍스트는 import 를 지원하지 않으므로 테스트에선 스텁으로 치환한다.
    .replace(/^import\s+.*from\s+["']\.\/scenario\/prompt-builder\.js["'];\s*$/m,
      'const buildEnforcementSuffix = () => ({ suffix: "", validatorSpec: null, progressLabel: null });')
    .replace(/^import\s+.*from\s+["']\.\/scenario\/validator\.js["'];\s*$/m,
      'const runSceneValidator = async (args) => ({ scenes: args?.scenes || [], violations: [], hasCritical: false, retried: false }); const validateScenesDirect = () => ({ violations: [], hasCritical: false });')
    .replace(/^import\s+.*from\s+["']\.\/scenario\/rebalancer\.js["'];\s*$/m,
      'const splitUniformRuns = (s) => ({ scenes: s, splits: 0 }); const padScenesToBeatCount = (s) => ({ scenes: s, padded: 0 });');
  source += '\nmodule.exports = { calculateSceneCountForDuration, normalizeKnowledgeHubInput, buildUserPrompt, buildSystemPromptKo, buildScenarioSpec, validateScenarioAgainstSpec, alignScenesToScenarioSpec, getSpeechCharLimit };';
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

test('scenario prompt separates episode topic title from story body', () => {
  const helpers = loadScenarioHelpers();
  const prompt = helpers.buildUserPrompt({
    lang: 'ko',
    topic: '네모와 세모의 첫 모험',
    story: '네모와 세모가 숲에서 길을 잃었다가 서로 힘을 합쳐 집으로 돌아오는 이야기',
    target: '아동',
    purposeCategory: '스토리 · 서사',
    purposeTags: '에피소드',
    needs: '스토리',
    toneText: '친근',
    tones: '친근',
    styleText: '애니메이션(2D)',
    styles: '애니메이션(2D)',
    manualDirectives: '',
    knowledgeHub: helpers.normalizeKnowledgeHubInput({}, { characterGenerationDisabled: true }),
    aspectRatio: '16:9',
    duration: '30',
    characterGenerationDisabled: true,
    narrationEnabled: true,
    dubbingEnabled: false,
    characters: []
  });

  assert.match(prompt, /주제: 네모와 세모의 첫 모험/);
  assert.match(prompt, /이야기: 네모와 세모가 숲에서 길을 잃었다가 서로 힘을 합쳐 집으로 돌아오는 이야기/);
});

test('system prompt includes audience-reaction and visual craft rules', () => {
  const helpers = loadScenarioHelpers();
  const prompt = helpers.buildSystemPromptKo(4, 15, {
    requiredOutputsKo: ['테스트 규칙을 따른다.'],
    avoidOutputsKo: ['범용 장면을 피한다.']
  });

  assert.match(prompt, /\[씬 작성 핵심 원칙\]/);
  assert.match(prompt, /각 씬은 반드시 관객 반응 목표 1개/);
  assert.match(prompt, /sceneIntent는 이 씬을 본 관객이 느끼거나 행동하는 구체적 반응/);
  assert.match(prompt, /visual 작성법:/);
  assert.match(prompt, /\[생성 후 자체 검증 - 모든 씬에 적용\]/);
  assert.match(prompt, /\[JSON 출력 규칙/);
  assert.match(prompt, /마크다운.*설명.*주석.*백틱을 절대 포함하지 않는다/);
});

test('user prompt adds genre-specific scene progression guide for advertising', () => {
  const helpers = loadScenarioHelpers();
  const prompt = helpers.buildUserPrompt({
    lang: 'ko',
    topic: '신형 텀블러 런칭',
    target: '성인',
    purposeCategory: '광고',
    purposeTags: '제품 광고, 디지털 캠페인',
    needs: '행동 유도',
    toneText: '세련',
    tones: '세련',
    styleText: '실사',
    styles: '실사',
    manualDirectives: '',
    knowledgeHub: helpers.normalizeKnowledgeHubInput({}, { characterGenerationDisabled: true }),
    aspectRatio: '9:16',
    duration: '15',
    characterGenerationDisabled: true,
    narrationEnabled: true,
    dubbingEnabled: false,
    characters: [],
    spec: helpers.buildScenarioSpec({
      lang: 'ko',
      topic: '신형 텀블러 런칭',
      target: '성인',
      purposeCategory: '광고',
      purposeTags: '제품 광고',
      needs: '행동 유도',
      toneText: '세련',
      tones: '세련',
      styleText: '실사',
      styles: '실사',
      duration: '15',
      sceneCount: 4
    })
  });

  assert.match(prompt, /\[장르별 씬 전개 규칙\]/);
  assert.match(prompt, /Attention\(2-3초/);
  assert.match(prompt, /Climax\(3-5초/);
  assert.match(prompt, /타이틀 카드/);
  assert.match(prompt, /6초 초과 금지/);
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
  assert.ok(spec.sceneBlueprint.every((item) => item.location));
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
  assert.ok(aligned.every((scene) => /관객이|시청자가/.test(scene.sceneIntent)));
  assert.ok(aligned.every((scene) => scene.sceneLocation));
  assert.ok(new Set(aligned.map((scene) => scene.sceneLocation)).size > 1);
  assert.ok(aligned.every((scene) => scene.backgroundStyle));
});

test('alignment replaces blank sceneLocation with blueprint location instead of preserving whitespace', () => {
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
    duration: '15',
    sceneCount: 4
  });

  const aligned = helpers.alignScenesToScenarioSpec([{
    id: 1,
    estSec: 4,
    sceneLocation: '   ',
    narration: '친구들이 모인다.',
    dialogue: [{ speaker: '@narrator', line: '시작하자.' }],
    visual: '친구들이 선다.'
  }], spec, {
    lang: 'ko',
    topic: 'ABC 동요 배우기',
    purposeCategory: '키즈 · 영유아',
    purposeTags: '동요',
    toneText: '',
    tones: '유머',
    styleText: '애니메이션(3D)',
    styles: '애니메이션(3D)',
    aspectRatio: '16:9',
    sceneCount: 1,
    duration: 4,
    narrationEnabled: true,
    dubbingEnabled: true,
    defaultSpeaker: '@narrator'
  });

  assert.ok(aligned[0].sceneLocation);
  assert.notEqual(aligned[0].sceneLocation.trim(), '');
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
  const backgroundStyles = aligned.map((scene) => scene.backgroundStyle);
  const locations = aligned.map((scene) => scene.sceneLocation);

  assert.doesNotMatch(narrationJoined, /장면을 설명하는 나레이션이 이어진다/);
  assert.doesNotMatch(dialogueJoined, /장면을 설명하는 나레이션이 이어진다/);
  assert.ok(locations.some((text) => /마을/.test(text)));
  assert.ok(locations.some((text) => /들판|숲|하늘/.test(text)));
  assert.ok(backgroundStyles.every((text) => /도형 생명체가 살아가는 밝은 자연 세계/.test(text)));
  assert.ok(visuals.every((text) => !/도형 생명체가 살아가는 밝은 자연 세계, 들판/.test(text)));
  assert.ok(new Set(visuals).size > 1);
});

test('scene visuals keep location-specific action while shared background style stays separate', () => {
  const helpers = loadScenarioHelpers();
  const spec = helpers.buildScenarioSpec({
    lang: 'ko',
    topic: 'ABC 동요 배우기',
    target: '영유아',
    purposeCategory: '키즈 · 영유아',
    purposeTags: '동요',
    needs: '놀이',
    knowledgeHub: {
      worldSetting: '도형 생명체가 살아가는 밝은 자연 세계\n마을, 들판, 숲, 하늘 등 단순하고 상징적인 공간'
    },
    duration: '15',
    sceneCount: 4
  });

  const scenes = [
    { id: 1, estSec: 4, narration: '', dialogue: [], visual: '' },
    { id: 2, estSec: 4, narration: '', dialogue: [], visual: '' },
    { id: 3, estSec: 4, narration: '', dialogue: [], visual: '' },
    { id: 4, estSec: 3, narration: '', dialogue: [], visual: '' }
  ];
  const aligned = helpers.alignScenesToScenarioSpec(scenes, spec, {
    lang: 'ko',
    topic: 'ABC 동요 배우기',
    purposeCategory: '키즈 · 영유아',
    purposeTags: '동요',
    narrationEnabled: true,
    dubbingEnabled: true,
    defaultSpeaker: '@narrator'
  });

  assert.ok(aligned.every((scene) => scene.backgroundStyle === aligned[0].backgroundStyle));
  assert.ok(new Set(aligned.map((scene) => scene.sceneLocation)).size > 1);
  assert.ok(aligned.every((scene) => scene.visual.includes(scene.sceneLocation)));
  assert.ok(aligned.every((scene) => !scene.visual.includes(scene.backgroundStyle)));
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
  assert.ok(failedKeys.includes('scene_intent_reaction'));
  assert.ok(failedKeys.includes('visual_concreteness') || failedKeys.includes('setting_anchor'));
  assert.ok(failedKeys.includes('setting_continuity'));
});

test('overview combinations resolve into different scenario profiles and blueprints', () => {
  const helpers = loadScenarioHelpers();

  const cookingSpec = helpers.buildScenarioSpec({
    lang: 'ko',
    topic: '토마토 파스타 만들기',
    target: '성인',
    purposeCategory: '음식 · 요리',
    purposeTags: '레시피, 홈쿡',
    needs: '생활 정보',
    tones: '친근',
    styles: '실사',
    duration: '15',
    sceneCount: 4
  });

  const techSpec = helpers.buildScenarioSpec({
    lang: 'ko',
    topic: 'AI 일정 관리 앱 소개',
    target: '직장인',
    purposeCategory: '테크 · IT',
    purposeTags: 'AI, 앱 소개',
    needs: '실용 정보',
    tones: '전문',
    styles: '모션그래픽',
    duration: '15',
    sceneCount: 4
  });

  assert.equal(cookingSpec.profile.key, 'cooking');
  assert.equal(techSpec.profile.key, 'tech');
  assert.notEqual(cookingSpec.continuity.backgroundStyle, techSpec.continuity.backgroundStyle);
  assert.deepEqual(Array.from(cookingSpec.sceneBlueprint, (row) => row.role), ['intro', 'prep', 'cook', 'taste']);
  assert.deepEqual(Array.from(techSpec.sceneBlueprint, (row) => row.role), ['hook', 'problem', 'demo', 'takeaway']);
  assert.deepEqual(Array.from(cookingSpec.sceneBlueprint, (row) => row.phaseKey), ['setup', 'rise', 'turn', 'close']);
  assert.deepEqual(Array.from(techSpec.sceneBlueprint, (row) => row.phaseKey), ['setup', 'rise', 'turn', 'close']);
  assert.ok(cookingSpec.requiredOutputsKo.join(' ').includes('재료') || cookingSpec.validationRulesKo.join(' ').includes('절차'));
  assert.ok(techSpec.requiredOutputsKo.join(' ').includes('문제') || techSpec.validationRulesKo.join(' ').includes('절차'));
  assert.ok(/마무리|판단|정리|결론|결과 확인/.test(cookingSpec.sceneBlueprint.at(-1)?.title || ''));
  assert.ok(/정리|결론|takeaway/i.test(techSpec.sceneBlueprint.at(-1)?.title || ''));
});

test('alignment uses profile-specific locations and props for non-kids scenarios', () => {
  const helpers = loadScenarioHelpers();
  const spec = helpers.buildScenarioSpec({
    lang: 'ko',
    topic: '토마토 파스타 만들기',
    target: '성인',
    purposeCategory: '음식 · 요리',
    purposeTags: '레시피, 홈쿡',
    needs: '생활 정보',
    tones: '친근',
    styles: '실사',
    duration: '15',
    sceneCount: 4
  });

  const scenes = [
    { id: 1, estSec: 4, narration: '', dialogue: [], visual: '' },
    { id: 2, estSec: 4, narration: '', dialogue: [], visual: '' },
    { id: 3, estSec: 4, narration: '', dialogue: [], visual: '' },
    { id: 4, estSec: 3, narration: '', dialogue: [], visual: '' }
  ];

  const aligned = helpers.alignScenesToScenarioSpec(scenes, spec, {
    lang: 'ko',
    topic: '토마토 파스타 만들기',
    purposeCategory: '음식 · 요리',
    purposeTags: '레시피, 홈쿡',
    narrationEnabled: true,
    dubbingEnabled: false,
    defaultSpeaker: '@narrator'
  });

  const joinedVisuals = aligned.map((scene) => scene.visual).join(' ');
  const validation = helpers.validateScenarioAgainstSpec(aligned, spec);

  assert.ok(aligned.some((scene) => /재료 준비대|도마와 싱크대 앞|화구 조리대|플레이팅 테이블/.test(scene.sceneLocation)));
  assert.match(joinedVisuals, /주재료와 도마, 조리도구|조리도구|재료/);
  assert.match(joinedVisuals, /조리대|싱크대|플레이팅/);
  assert.equal(validation.passed, true);
  assert.ok(/결과 확인|마무리|정리/.test(aligned.at(-1)?.sceneIntent || aligned.at(-1)?.title || ''));
});

test('shortened blueprints still preserve a closing role in the last scene', () => {
  const helpers = loadScenarioHelpers();

  const horrorSpec = helpers.buildScenarioSpec({
    lang: 'ko',
    topic: '폐건물 탈출',
    target: '청년',
    purposeCategory: '스토리 · 서사',
    purposeTags: '공포',
    needs: '스토리',
    tones: '진지',
    styles: '시네마틱',
    duration: '15',
    sceneCount: 4
  });
  const musicSpec = helpers.buildScenarioSpec({
    lang: 'ko',
    topic: '우주 리듬 챈트',
    target: '아동',
    purposeCategory: '음악 · 사운드',
    purposeTags: '동요',
    needs: '놀이',
    tones: '유머',
    styles: '애니메이션(3D)',
    duration: '15',
    sceneCount: 4
  });

  assert.equal(horrorSpec.sceneBlueprint.at(-1)?.role, 'escape');
  assert.equal(musicSpec.sceneBlueprint.at(-1)?.role, 'outro');
});

test('duration-scaled blueprints keep contiguous setup-rise-turn-close arcs from 15 seconds to 1 hour', () => {
  const helpers = loadScenarioHelpers();

  const shortSpec = helpers.buildScenarioSpec({
    lang: 'ko',
    topic: '숲속 모험',
    target: '아동',
    purposeCategory: '스토리 · 서사',
    purposeTags: '판타지',
    needs: '스토리',
    tones: '친근',
    styles: '애니메이션(3D)',
    duration: '15',
    sceneCount: 4
  });
  const longSpec = helpers.buildScenarioSpec({
    lang: 'ko',
    topic: '우주 식민지의 하루',
    target: '청소년',
    purposeCategory: '스토리 · 서사',
    purposeTags: 'SF',
    needs: '스토리',
    tones: '진지',
    styles: '시네마틱',
    duration: '3600',
    sceneCount: 240
  });

  const shortPhases = Array.from(shortSpec.sceneBlueprint, (row) => row.phaseKey);
  const longPhases = Array.from(longSpec.sceneBlueprint, (row) => row.phaseKey);
  const order = { setup: 0, rise: 1, turn: 2, close: 3 };

  assert.deepEqual(shortPhases, ['setup', 'rise', 'turn', 'close']);
  assert.equal(longPhases.length, 240);
  assert.equal(longPhases[0], 'setup');
  assert.equal(longPhases.at(-1), 'close');
  assert.ok(longPhases.includes('rise'));
  assert.ok(longPhases.includes('turn'));
  for (let i = 1; i < longPhases.length; i++) {
    assert.ok(order[longPhases[i]] >= order[longPhases[i - 1]]);
  }
});
