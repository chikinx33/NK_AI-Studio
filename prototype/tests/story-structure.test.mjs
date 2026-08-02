import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { inlineCreditHelper } from './lib/inline-esm-deps.mjs';

function loadHelpers() {
  const fullPath = path.join(process.cwd(), 'prototype/functions/api/story-structure.js');
  let source = fs.readFileSync(fullPath, 'utf8');
  source = inlineCreditHelper(source);
  source = source
    .replace('export async function onRequestOptions', 'async function onRequestOptions')
    .replace('export async function onRequestPost', 'async function onRequestPost')
    .replace(/^import\s+.*from\s+["']\.\/_shared\/claude-auth\.js["'];\s*$/m,
      'const claudeAuthHeaders = () => ({ subscription: false, headers: {} }); const buildClaudeSystem = (s, sys) => sys; const anthropicConfigured = () => true;');
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

test('story structure prompt carries duration, audience, humor, and style rules with event-preservation philosophy', () => {
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
  // v3.873: 압축 지침 제거. 사용자 이야기의 모든 사건을 enumerate하는 보존 철학으로 전환.
  assert.match(prompt, /사용자 이야기의 모든 사건을 비트로 enumerate한다/);
  assert.match(prompt, /사건 보존 규칙/);
  assert.match(prompt, /아주 짧고 쉬운 문장/);
  assert.match(prompt, /스타일과 세계관은 이야기 흐름을 바꾸지 않는다/);
  // 압축 표현이 출력 목표에서 제거됐는지 검증
  assert.doesNotMatch(prompt, /압축형 이야기 뼈대/);
  assert.match(prompt, /사건을 병합하거나 누락하지 않는다/);
});

test('story structure system prompt enforces event enumeration (no compression) and forbids abstract prose', () => {
  const helpers = loadHelpers();
  const prompt = helpers.buildSystemPrompt('ko');

  // v3.873: 시스템 프롬프트는 enumerate 철학.
  assert.match(prompt, /모든 사건을 한 줄씩 비트로 enumerate/);
  assert.match(prompt, /사용자가 N개 사건을 적으면 N개 비트를 출력/);
  assert.match(prompt, /두 사건을 한 비트로 병합하지 않는다/);
  assert.match(prompt, /마지막 결말 비트.*절대 누락하지 않는다/);
  assert.match(prompt, /우정을 더욱 깊게 다진다/); // 금지 예시 여전히 포함
  // 압축을 강제하는 문구는 제거됨
  assert.doesNotMatch(prompt, /짧은 영상용 이야기 뼈대로 재정리/);
  assert.doesNotMatch(prompt, /2~5개의 짧은 문장/);
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

  assert.match(story, /헛짚고 멈칫한다|착각해 멈칫하고/);
  assert.doesNotMatch(story, /유머러스한 상황에 처하|우정을 더욱 깊게 다지|즐거움을 느낀다/);
});
