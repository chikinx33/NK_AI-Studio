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
  source += '\nmodule.exports = { calculateSceneCountForDuration, normalizeKnowledgeHubInput, buildUserPrompt };';
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
