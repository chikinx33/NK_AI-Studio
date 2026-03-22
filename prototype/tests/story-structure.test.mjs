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
  source += '\nmodule.exports = { normalizeInput, buildUserPrompt, restoreCharacterTokenHints };';
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
      { token: '@동그라미', displayName: '동그라미' },
      { token: '@세모', displayName: '세모' }
    ]
  });

  const prompt = helpers.buildUserPrompt(input);
  assert.match(prompt, /반드시 유지할 캐릭터 토큰: @네모, @동그라미, @세모/);
  assert.match(prompt, /등록 캐릭터: @네모\(네모\), @동그라미\(동그라미\), @세모\(세모\)/);
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
