import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readEndpointSource() {
  const fullPath = path.join(process.cwd(), 'prototype/functions/api/ai-image/session-delete.ts');
  return fs.readFileSync(fullPath, 'utf8');
}

test('ai-image session delete endpoint exists and targets session outputs prefix', () => {
  const src = readEndpointSource();
  assert.match(src, /buildAiImageSessionPrefix/);
  assert.match(src, /onRequestPost/);
  assert.match(src, /\/outputs\//);
  assert.match(src, /method: \"DELETE\"/);
});
