import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readImagenSource() {
  const fullPath = path.join(process.cwd(), 'prototype/functions/api/imagen.ts');
  return fs.readFileSync(fullPath, 'utf8');
}

test('imagen source resolves provider from body or AI_IMAGE_PROVIDER env', () => {
  const source = readImagenSource();
  assert.match(source, /normalizeProvider\(body\?\.provider \|\| env\.AI_IMAGE_PROVIDER\)/);
  assert.match(source, /function normalizeProvider/);
});

test('openai provider requires OPENAI_API_KEY but skips google credential check', () => {
  const source = readImagenSource();
  assert.match(source, /OPENAI_API_KEY/);
  assert.match(source, /Missing OPENAI_API_KEY/);
  assert.match(source, /if \(provider === "openai"\)/);
});

test('google access token is optional so openai-only deploys can run without google creds', () => {
  const source = readImagenSource();
  assert.match(source, /\(clientEmail && privateKeyRaw\)\s*\?\s*await getGoogleAccessToken/);
});

test('GCS upload is skipped when no google access token is available', () => {
  const source = readImagenSource();
  assert.match(source, /if \(outParsed && accessToken\)/);
});

test('openai branch dispatches text-to-image to /v1/images/generations and image-to-image to /v1/images/edits', () => {
  const source = readImagenSource();
  assert.match(source, /https:\/\/api\.openai\.com\/v1\/images\/generations/);
  assert.match(source, /https:\/\/api\.openai\.com\/v1\/images\/edits/);
  assert.match(source, /const isEdit = allRefs\.length > 0;/);
});

test('openai edits request uses multipart form-data with image[] array', () => {
  const source = readImagenSource();
  assert.match(source, /new FormData\(\)/);
  assert.match(source, /fd\.append\("image\[\]"/);
});

test('aspectRatio is mapped to OpenAI size and imageSize hint is mapped to quality', () => {
  const source = readImagenSource();
  assert.match(source, /function mapAspectToOpenAISize/);
  assert.match(source, /"1024x1536"/);
  assert.match(source, /"1024x1024"/);
  assert.match(source, /"1536x1024"/);
  assert.match(source, /function mapImageSizeToOpenAIQuality/);
  assert.match(source, /return "low"/);
  assert.match(source, /return "high"/);
  assert.match(source, /return "medium"/);
});

test('openai response is parsed from data[0].b64_json and surfaces hint on common errors', () => {
  const source = readImagenSource();
  assert.match(source, /b64_json/);
  assert.match(source, /OPENAI_API_KEY가 유효하지 않거나/);
  assert.match(source, /OpenAI 요청 한도를 초과/);
});

test('response surfaces dynamic model and provider tag based on selected branch', () => {
  const source = readImagenSource();
  assert.match(source, /model: modelUsed,/);
  assert.match(source, /provider: provider === "openai" \? "openai-api" : "gemini-api"/);
});

test('openai default model is gpt-image-2 and is overridable via OPENAI_IMAGE_MODEL', () => {
  const source = readImagenSource();
  assert.match(source, /env\.OPENAI_IMAGE_MODEL/);
  assert.match(source, /"gpt-image-2"/);
});
