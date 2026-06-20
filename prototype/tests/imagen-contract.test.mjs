import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readImagenSource() {
  const fullPath = path.join(process.cwd(), 'prototype/functions/api/imagen.ts');
  return fs.readFileSync(fullPath, 'utf8');
}

test('imagen source resolves relative proxy urls against the current request url', () => {
  const source = readImagenSource();
  assert.match(source, /new URL\(resolvedUrl, requestUrl\)/);
});

test('imagen source forwards caller auth when reading same-origin media proxy references', () => {
  const source = readImagenSource();
  assert.match(source, /targetUrl\.pathname === "\/api\/media\/proxy"/);
  assert.match(source, /headers\.Authorization = authHeader/);
});

test('image-to-image mode fails instead of silently falling back when all source references are lost', () => {
  const source = readImagenSource();
  assert.match(source, /generationMode === "image-to-image"/);
  assert.match(source, /!referenceImages\.length/);
  assert.match(source, /source_image_reference_unavailable/);
});

test('cut-based continuity reference keeps look but lets the prompt drive camera/composition', () => {
  const source = readImagenSource();
  // continuity 종류 인식
  assert.match(source, /rkRaw === "continuity" \|\| rkRaw === "cut"/);
  // 구도가 아니라 룩만 잇는 일관성 문구
  assert.match(source, /This reference governs LOOK ONLY, not composition\./);
  // 카메라/구도는 이 컷 프롬프트가 우선임을 강제
  assert.match(source, /do NOT reproduce the reference's composition, camera, or layout/);
  // 캐릭터 수 집계에서 continuity 는 제외(별도 인물로 렌더하지 않음)
  assert.match(source, /item\.referenceKind !== "environment" && item\.referenceKind !== "continuity"/);
});

test('frontend tags the cut reference as continuity (not a composition-locking environment ref)', () => {
  const fullPath = path.join(process.cwd(), 'prototype/ui/pipeline-image.js');
  const src = fs.readFileSync(fullPath, 'utf8');
  assert.match(src, /referenceKind: 'continuity'/);
  // 옛 "maintain the same ... environment" 구도 고정 문구가 사라졌는지
  assert.doesNotMatch(src, /maintain the same character appearance, costume, environment/);
});

test('gemini request sends the edit instruction text part before inline reference images', () => {
  const source = readImagenSource();
  assert.match(source, /const parts: Array<Record<string, unknown>> = \[\{ text: prompt \}\];/);
});

test('gemini interleaves a per-character label immediately before each reference image (multi-character binding)', () => {
  const source = readImagenSource();
  // buildGeminiParts 가 라벨 플래그를 받고, 라벨일 때 이미지 앞에 subjectDescription 텍스트를 push
  assert.match(source, /function buildGeminiParts\(referenceImages: NormalizedReferenceImage\[\], prompt: string, labelImages\?: boolean\)/);
  assert.match(source, /if \(labelImages\) \{/);
  assert.match(source, /Reference image \$\{index \+ 1\} \(immediately below\) is the registered/);
  // 텍스트→이미지 + 레퍼런스 2장 이상일 때만 라벨링 활성화
  assert.match(source, /generationMode === "text-to-image" && referenceImages\.length > 1/);
});

test('text-to-image prompt enforces rendering every distinct registered character (no merge/drop)', () => {
  const source = readImagenSource();
  assert.match(source, /different registered characters, each provided with its OWN labeled reference image/);
  assert.match(source, /do not merge, swap, duplicate, or omit any character/);
});

test('imagen source builds multi-turn conversational contents from prior prompts and generated images', () => {
  const source = readImagenSource();
  assert.match(source, /function buildGeminiContents/);
  assert.match(source, /role: "model"/);
  assert.match(source, /normalizeConversationHistory/);
  assert.match(source, /conversationTurnCount/);
});

test('imagen source strengthens image-to-image prompts for multi-reference editing', () => {
  const source = readImagenSource();
  assert.match(source, /normalizeCameraTargetMode/);
  assert.match(source, /(cameraTargetModeIncoming|const\s+cameraTargetMode\s*=)/);
  assert.match(source, /Reconstruct the entire frame from a new camera viewpoint\./);
  assert.match(source, /Rotate the whole scene perspective together, including the background, environment, depth, horizon, and subject placement\./);
  assert.match(source, /Rotate or re-pose only the main foreground subject relative to the camera\./);
  assert.match(source, /Use the uploaded source image set as a coordinated multi-reference pack\./);
  assert.match(source, /Reference image 1 .* primary anchor for composition, structure, and subject identity\./);
  assert.match(source, /supporting reference for style, details, materials, and consistency\./);
});
