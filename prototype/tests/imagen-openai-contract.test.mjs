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
  // URL 은 OPENAI_BASE_URL 오버라이드를 지원하도록 apiBase 템플릿으로 구성된다.
  assert.match(source, /\$\{apiBase\}\/v1\/images\/generations/);
  assert.match(source, /\$\{apiBase\}\/v1\/images\/edits/);
  assert.match(source, /const isEdit = allRefs\.length > 0;/);
  assert.match(source, /https:\/\/api\.openai\.com/); // 기본 베이스 URL
});

test('openai requests honor OPENAI_BASE_URL override to bypass region-blocked colos', () => {
  const source = readImagenSource();
  assert.match(source, /env\.OPENAI_BASE_URL/);
  assert.match(source, /const apiBase = String\(opts\.baseUrl/);
});

test('proxy shared secret header is sent only when using a non-default base url', () => {
  const source = readImagenSource();
  assert.match(source, /env\.OPENAI_PROXY_SECRET/);
  assert.match(source, /opts\.proxySecret && apiBase !== "https:\/\/api\.openai\.com"/);
  assert.match(source, /"x-nk-proxy-secret": opts\.proxySecret/);
});

test('empty-body 403 from a restricted colo is classified as region-blocked and retriable', () => {
  const source = readImagenSource();
  assert.match(source, /RESTRICTED_COLOS/);
  assert.match(source, /openai_region_blocked/);
  assert.match(source, /retriable = true/);
});

test('region-blocked GPT falls back to gemini so generation always completes (no infinite spin)', () => {
  const source = readImagenSource();
  // 지역 차단도 Gemini 폴백 대상(무한 스핀 방지). 폴백 사실은 regionBlocked 플래그로 노출.
  assert.match(source, /if \(isAccountError && geminiConfigured\)/);
  assert.match(source, /regionBlocked: isRegionBlocked/);
  assert.doesNotMatch(source, /isAccountError && !isRegionBlocked && geminiConfigured/);
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
  assert.match(source, /provider: providerUsed === "openai" \? "openai-api" : "gemini-api"/);
});

test('openai account-level errors fall back to gemini so cut-based reference consistency keeps working', () => {
  const source = readImagenSource();
  // OpenAI 계정/권한/결제 오류일 때 Gemini 로 자동 폴백하는 경로가 있어야 한다.
  assert.match(source, /const runGeminiGeneration = async/);
  assert.match(source, /oStatus === 401 \|\| oStatus === 403 \|\| oStatus === 429/);
  assert.match(source, /providerUsed = "gemini"/);
  assert.match(source, /providerFallbackFrom = "openai"/);
});

test('openai default model is gpt-image-2 and is overridable via OPENAI_IMAGE_MODEL', () => {
  const source = readImagenSource();
  assert.match(source, /env\.OPENAI_IMAGE_MODEL/);
  assert.match(source, /"gpt-image-2"/);
});
