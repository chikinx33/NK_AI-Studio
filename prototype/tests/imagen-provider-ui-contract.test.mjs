import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

test('config exposes IMAGE_PROVIDER storage key shared across pages', () => {
  const source = read('prototype/js/config.js');
  assert.match(source, /IMAGE_PROVIDER:\s*'nk_ai_image_provider'/);
});

test('NK.api.imagen auto-injects provider from localStorage when caller omits it', () => {
  const source = read('prototype/api.js');
  assert.match(source, /api\.imagen = async function/);
  assert.match(source, /if \(!payload\.provider\)/);
  assert.match(source, /KEYS\.IMAGE_PROVIDER/);
  assert.match(source, /stored === 'openai' \|\| stored === 'gemini'/);
  // 새 모델 값도 통과시키지 않으면 저장된 선택이 조용히 무시된다.
  assert.match(source, /stored === 'gpt25-flare' \|\| stored === 'gpt25-sunburst'/);
});

test('이미지 모델 목록은 pipeline-image.js 가 단일 원천이고 한/영 라벨을 함께 가진다', () => {
  const source = read('prototype/ui/pipeline-image.js');
  assert.match(source, /var IMAGE_PROVIDERS = \[/);
  assert.match(source, /\{ id: 'gpt25-flare', ko: '[^']+', en: '[^']+' \}/);
  assert.match(source, /\{ id: 'gpt25-sunburst', ko: '[^']+', en: '[^']+' \}/);
  assert.match(source, /image\.IMAGE_PROVIDERS = IMAGE_PROVIDERS/);
  assert.match(source, /image\.normalizeProvider = normalizeProvider/);
});

test('AI image page renders a provider selector wired to localStorage', () => {
  const source = read('prototype/js/ui/ai-image.js');
  assert.match(source, /id="ai-image-provider"/);
  assert.match(source, /providerLabel/);
  assert.match(source, /providerGemini/);
  assert.match(source, /providerOpenai/);
  assert.match(source, /target\.id === 'ai-image-provider'/);
  assert.match(source, /KEYS\.IMAGE_PROVIDER/);
  assert.match(source, /function normalizeProviderValue/);
  assert.match(source, /function readStoredProvider/);
  assert.match(source, /state\.provider = readStoredProvider\(\)/);
});

test('AI cinema pipeline header renders an image-provider selector wired to the same key', () => {
  const source = read('prototype/ui/pipeline.js');
  assert.match(source, /id="image-provider-select"/);
  assert.match(source, /이미지생성 모델/);
  // 옵션은 공용 목록에서 만들고, 언어에 따라 ko/en 라벨을 고른다.
  assert.match(source, /__iopt\(imageProvider\)/);
  assert.match(source, /NK\.uiPipelineImage\.IMAGE_PROVIDERS/);
  assert.match(source, /lang === 'en' \? m\.en : m\.ko/);
  assert.match(source, /NK\.uiPipelineImage\.normalizeProvider/);
  assert.match(source, /KEYS\.IMAGE_PROVIDER/);
});

test('AI image page offers both GPT Image 2.5 tunings with ko/en labels', () => {
  const source = read('prototype/js/ui/ai-image.js');
  assert.match(source, /providerGpt25Flare: '[^']+'/);
  assert.match(source, /providerGpt25Sunburst: '[^']+'/);
  // ko/en 사전 양쪽에 있어야 한다.
  assert.equal((source.match(/providerGpt25Flare:/g) || []).length, 2);
  assert.equal((source.match(/providerGpt25Sunburst:/g) || []).length, 2);
  assert.match(source, /var PROVIDER_VALUES = \['gemini', 'gpt25-flare', 'gpt25-sunburst', 'openai'\]/);
  assert.match(source, /providerOptions\.map\(/);
});
