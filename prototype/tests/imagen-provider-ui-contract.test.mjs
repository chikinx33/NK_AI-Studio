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
  assert.match(source, /Gemini 3\.1 Flash/);
  assert.match(source, /GPT Image 2/);
  assert.match(source, /KEYS\.IMAGE_PROVIDER/);
});
