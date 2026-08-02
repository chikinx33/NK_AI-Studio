import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { prepareEndpointSource } from './lib/inline-esm-deps.mjs';

function loadEnforceFn() {
  const fullPath = path.join(process.cwd(), 'prototype/functions/api/scenario.js');
  let source = fs.readFileSync(fullPath, 'utf8');
  source = prepareEndpointSource(source);
  source = source
    .replace('export async function onRequestPost', 'async function onRequestPost')
    .replace('export async function onRequestOptions', 'async function onRequestOptions')
    .replace('export function calculateSceneCountForDuration', 'function calculateSceneCountForDuration')
    .replace(/^import\s+.*from\s+["']\.\/scenario\/prompt-builder\.js["'];\s*$/m,
      'const buildEnforcementSuffix = () => ({ suffix: "", validatorSpec: null, progressLabel: null });')
    .replace(/^import\s+.*from\s+["']\.\/scenario\/validator\.js["'];\s*$/m,
      'const runSceneValidator = async (args) => ({ scenes: args?.scenes || [], violations: [], hasCritical: false, retried: false }); const validateScenesDirect = () => ({ violations: [], hasCritical: false });')
    .replace(/^import\s+.*from\s+["']\.\/scenario\/rebalancer\.js["'];\s*$/m,
      'const splitUniformRuns = (s) => ({ scenes: s, splits: 0 }); const padScenesToBeatCount = (s) => ({ scenes: s, padded: 0 });')
    .replace(/^import\s+.*from\s+["']\.\/_shared\/claude-auth\.js["'];\s*$/m,
      'const claudeAuthHeaders = () => ({ subscription: false, headers: {} }); const buildClaudeSystem = (s, sys) => sys; const anthropicConfigured = () => true;');
  source += '\nmodule.exports = { enforceCharacterTokenInVisual };';
  const context = vm.createContext({
    console, setTimeout, clearTimeout,
    module: { exports: {} }, exports: {},
  });
  vm.runInContext(source, context, { filename: fullPath });
  return context.module.exports.enforceCharacterTokenInVisual;
}

const chars = [
  { token: '@네모', displayName: '네모' },
  { token: '@동그라미', displayName: '동그라미' },
  { token: '@세모', displayName: '세모' },
];

test('enforceCharacterTokenInVisual: displayName + 조사를 @토큰 형태로 치환 (색상 접두사 제거)', () => {
  const fn = loadEnforceFn();
  const out = fn('노란 동그라미가 두 손으로 얼굴을 가린 채 서 있다', { action: '@동그라미가 셈한다' }, { characters: chars });
  assert.equal(out.modified, true);
  // v3.884: "노란 동그라미가" → "@동그라미가" (색상 접두사 소비)
  assert.match(out.visual, /@동그라미가/);
  assert.doesNotMatch(out.visual, /노란 @동그라미가/);
});

test('enforceCharacterTokenInVisual: 여러 캐릭터 동시 치환 (색상 접두사 소비)', () => {
  const fn = loadEnforceFn();
  const out = fn('파란 네모가 왼쪽으로, 빨간 세모가 오른쪽으로 달려간다', { action: '@네모와 @세모가 도망친다' }, { characters: chars });
  assert.equal(out.modified, true);
  // v3.884: "파란 네모가" → "@네모가", "빨간 세모가" → "@세모가"
  assert.match(out.visual, /@네모가/);
  assert.match(out.visual, /@세모가/);
  assert.doesNotMatch(out.visual, /파란 @네모가/);
  assert.doesNotMatch(out.visual, /빨간 @세모가/);
});

test('enforceCharacterTokenInVisual: 이미 @토큰이 있으면 중복 치환 안 함', () => {
  const fn = loadEnforceFn();
  const out = fn('@동그라미가 손을 들고 @네모를 가리킨다', { action: '@동그라미가 @네모를 발견' }, { characters: chars });
  // 이미 @ 가 붙어 있으므로 lookbehind 로 매칭 안 됨
  assert.equal(out.modified, false);
});

test('enforceCharacterTokenInVisual: "네모난" 같이 다른 한글 단어 일부는 건드리지 않음', () => {
  const fn = loadEnforceFn();
  const out = fn('네모난 몸이 삐죽 튀어나온다', { action: '몸이 삐죽 나옴' }, { characters: chars });
  // beat.action 에 @네모 없으니 prefix 도 안 붙음, "네모난" 도 매칭 안 됨
  assert.equal(out.modified, false);
  assert.equal(out.visual, '네모난 몸이 삐죽 튀어나온다');
});

test('enforceCharacterTokenInVisual: visual 에 displayName 도 없으면 prefix 보강', () => {
  const fn = loadEnforceFn();
  const out = fn('인형이 나무 뒤에 서 있다', { action: '@네모가 숨음' }, { characters: chars });
  assert.equal(out.modified, true);
  assert.match(out.visual, /^@네모 등장\. /);
});

test('enforceCharacterTokenInVisual: 등록 캐릭터 없으면 무시', () => {
  const fn = loadEnforceFn();
  const out = fn('어떤 텍스트', { action: '아무 행동' }, { characters: [] });
  assert.equal(out.modified, false);
  assert.equal(out.visual, '어떤 텍스트');
});

test('enforceCharacterTokenInVisual: 다양한 조사 처리 (는/을/를/의/에서)', () => {
  const fn = loadEnforceFn();
  const cases = [
    { input: '동그라미는 작다', expect: /@동그라미는/ },
    { input: '동그라미를 본다', expect: /@동그라미를/ },
    { input: '동그라미의 손', expect: /@동그라미의/ },
    { input: '동그라미에서 시작', expect: /@동그라미에서/ },
  ];
  for (const { input, expect } of cases) {
    const out = fn(input, { action: '@동그라미가 행동' }, { characters: chars });
    assert.equal(out.modified, true, `case "${input}" should be modified`);
    assert.match(out.visual, expect, `case "${input}" should match ${expect}`);
  }
});
