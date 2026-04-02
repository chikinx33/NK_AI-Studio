import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readAiImageSource() {
  const fullPath = path.join(process.cwd(), 'prototype/js/ui/ai-image.js');
  return fs.readFileSync(fullPath, 'utf8');
}

test('camera apply suppresses preview reference in scene mode while keeping payload key', () => {
  const source = readAiImageSource();
  assert.match(source, /appliedCameraTargetMode = normalizeCameraTargetMode/);
  assert.match(source, /if \(previewTarget && previewTarget\.url && appliedCameraTargetMode === 'subject'\)/);
  assert.match(source, /referenceImages: previewReferenceImages/);
});
