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

test('gemini request sends the edit instruction text part before inline reference images', () => {
  const source = readImagenSource();
  assert.match(source, /const parts: Array<Record<string, unknown>> = \[\{ text: prompt \}\];/);
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
