import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readApiSource() {
  return fs.readFileSync(path.join(process.cwd(), 'prototype/api.js'), 'utf8');
}

function readAiImageSource() {
  return fs.readFileSync(path.join(process.cwd(), 'prototype/js/ui/ai-image.js'), 'utf8');
}

test('imagen api client uses adaptive timeout for slower image generation requests', () => {
  const source = readApiSource();
  assert.match(source, /const getImagenTimeoutMs = function \(payload, opts\)/);
  assert.match(source, /if \(mode === 'image-to-image' \|\| referenceCount > 0\) timeoutMs \+= 60000;/);
  assert.match(source, /return Math\.min\(timeoutMs, 240000\);/);
  assert.match(source, /var timeoutMs = getImagenTimeoutMs\(payload, opts\);/);
  assert.match(source, /}, timeoutMs\);/);
  assert.match(source, /readTextWithTimeout\(res, timeoutMs\)/);
});

test('ai-image retries timeout-like imagen failures once before surfacing the error', () => {
  const source = readAiImageSource();
  assert.match(source, /function isTimeoutLikeImagenError\(err\)/);
  assert.match(source, /function shouldRetryImagenRequest\(err\)/);
  assert.match(source, /await generateImage\(tryCount \+ 1\);/);
  assert.match(source, /await generateImageCameraApply\(tryCount \+ 1\);/);
  assert.match(source, /request_timeout\|response_timeout\|timeout\|aborted\|network_error\|failed to fetch/i);
});
