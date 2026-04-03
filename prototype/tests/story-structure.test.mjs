import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadHelpers() {
  const fullPath = path.join(process.cwd(), 'prototype/functions/api/story-structure.js');
  let source = fs.readFileSync(fullPath, 'utf8');
  source = source
    .replace('export async function onRequestOptions', 'async function onRequestOptions')
    .replace('export async function onRequestPost', 'async function onRequestPost');
  source += '\nmodule.exports = { normalizeInput, buildSystemPrompt, buildUserPrompt, buildFallbackStory, restoreCharacterTokenHints, enforceCharacterScope };';
  const context = vm.createContext({
    console,
    module: { exports: {} },
    exports: {}
  });
  vm.runInContext(source, context, { filename: fullPath });
  return context.module.exports;
}

test('story structure prompt explicitly carries token preservation hints', () => {
  const helpers = loadHelpers();
  const input = helpers.normalizeInput({
    topic: '네모와 세모의 첫 모험',
    story: '@네모, @동그라미, @세모는 숲에서 함께 논다.',
    characters: [
      { token: '@네모', displayName: '네모' },
      { token: '@세모', displayName: '세모' }
    ],
    knowledgeCharacters: [
      { token: '@네모', displayName: '네모' },
      { token: '@동그라미', displayName: '동그라미' },
      { token: '@세모', displayName: '세모' }
    ]
  });

  const prompt = helpers.buildUserPrompt(input);
  assert.match(prompt, /반드시 유지할 캐릭터 토큰: @네모, @동그라미, @세모/);
  assert.match(prompt, /등록 캐릭터: @네모\(네모\), @세모\(세모\)/);
  assert.match(prompt, /등장 금지 캐릭터: @동그라미\(동그라미\)/);
});

test('story structure restores removed character token prefixes from the original draft', () => {
  const helpers = loadHelpers();
  const input = helpers.normalizeInput({
    topic: '네모와 세모의 첫 모험',
    story: '@네모, @동그라미, @세모는 숲에서 함께 논다.',
    characters: [
      { token: '@네모', displayName: '네모' },
      { token: '@동그라미', displayName: '동그라미' },
      { token: '@세모', displayName: '세모' }
    ]
  });

  const restored = helpers.restoreCharacterTokenHints(
    '네모, 동그라미, 세모는 숲에서 함께 논다.',
    input
  );

  assert.match(restored, /@네모/);
  assert.match(restored, /@동그라미/);
  assert.match(restored, /@세모/);
});

test('story structure input excludes unselected knowledge characters from the active cast', () => {
  const helpers = loadHelpers();
  const input = helpers.normalizeInput({
    topic: '모험',
    story: '@네모와 @동그라미가 출발한다.',
    characters: [
      { token: '@네모', displayName: '네모' }
    ],
    knowledgeCharacters: [
      { token: '@네모', displayName: '네모' },
      { token: '@동그라미', displayName: '동그라미' }
    ]
  });

  assert.deepEqual(Array.from(input.characters, (row) => row.token), ['@네모']);
  assert.deepEqual(Array.from(input.excludedCharacters, (row) => row.token), ['@동그라미']);
});

test('story structure removes excluded and unselected character tokens from fallback text', () => {
  const helpers = loadHelpers();
  const filtered = helpers.enforceCharacterScope('@네모와 @동그라미가 숲에서 만난다.', {
    characters: [],
    excludedCharacters: [
      { token: '@네모', displayName: '네모' },
      { token: '@동그라미', displayName: '동그라미' }
    ]
  });

  assert.doesNotMatch(filtered, /@네모|@동그라미|네모|동그라미/);
});

test('story structure prompt carries duration, young audience, humor, and style rules for short-form stories', () => {
  const helpers = loadHelpers();
  const input = helpers.normalizeInput({
    topic: '숨바꼭질',
    story: '@네모가 친구들을 찾는다.',
    duration: '15',
    target: '영유아 · 학습/놀이/감성 발달',
    tone: '유머',
    style: '애니메이션(3D)',
    characters: [
      { token: '@네모', displayName: '네모' },
      { token: '@동그라미', displayName: '동그라미' }
    ]
  });

  const prompt = helpers.buildUserPrompt(input);
  assert.match(prompt, /목표 길이: 15초/);
  assert.match(prompt, /15초 안팎으로 보고 한 가지 핵심 상황만 유지한다/);
  assert.match(prompt, /아주 짧고 쉬운 문장/);
  assert.match(prompt, /구체적 실수, 착각, 반전, 과장 반응/);
  assert.match(prompt, /3D 애니메이션이면 재질감이나 색감 같은 짧은 세계 힌트/);
  assert.match(prompt, /행동 순서가 보이는 압축형 이야기 뼈대/);
});

test('story structure system prompt forbids abstract planning prose and enforces short-video logic', () => {
  const helpers = loadHelpers();
  const prompt = helpers.buildSystemPrompt('ko');

  assert.match(prompt, /짧은 영상용 이야기 뼈대/);
  assert.match(prompt, /15초 안팎이면 한 가지 핵심 상황만 다루고/);
  assert.match(prompt, /실제 코믹 상황 1개 이상/);
  assert.match(prompt, /우정을 더욱 깊게 다진다/);
});

test('story structure fallback compresses abstract young-kids comedy into shorter action beats', () => {
  const helpers = loadHelpers();
  const story = helpers.buildFallbackStory(helpers.normalizeInput({
    topic: '숨바꼭질',
    story: '@네모가 마을, 들판, 숲을 돌아다니며 친구들을 찾고 유머러스한 상황에 처하게 된다. 이 과정에서 서로의 숨바꼭질을 도와주며 우정을 더욱 깊게 다지고, 문제를 함께 해결하는 즐거움을 느낀다.',
    duration: '15',
    target: '영유아',
    tone: '유머',
    style: '애니메이션(3D)',
    characters: [
      { token: '@네모', displayName: '네모' },
      { token: '@동그라미', displayName: '동그라미' }
    ]
  }));

  assert.match(story, /말랑한 3D 장난감 같은 색감/);
  assert.match(story, /헛짚고 멈칫한다|착각해 멈칫하고/);
  assert.doesNotMatch(story, /유머러스한 상황에 처하|우정을 더욱 깊게 다지|즐거움을 느낀다/);
});
