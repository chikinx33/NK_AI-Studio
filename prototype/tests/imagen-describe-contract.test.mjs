import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readApiSource() {
  return fs.readFileSync(path.join(process.cwd(), 'prototype/api.js'), 'utf8');
}

function readDescribeSource() {
  return fs.readFileSync(path.join(process.cwd(), 'prototype/functions/api/imagen-describe.ts'), 'utf8');
}

test('api client exposes imagen describe endpoint wrapper', () => {
  const source = readApiSource();
  assert.match(source, /api\.imagenDescribe = async function/);
  assert.match(source, /withBase\('\/api\/imagen-describe'\)/);
});

test('imagen describe endpoint analyzes one image into reusable prompt text', () => {
  const source = readDescribeSource();
  assert.match(source, /buildAnalysisInstruction/);
  assert.match(source, /responseMimeType: "text\/plain"/);
  assert.match(source, /inlineData/);
  assert.match(source, /같은 피사체와 분위기의 일관성/);
  assert.match(source, /extractGeminiText/);
});

test('imagen describe endpoint supports same-origin media proxy auth forwarding', () => {
  const source = readDescribeSource();
  assert.match(source, /targetUrl\.pathname === "\/api\/media\/proxy"/);
  assert.match(source, /headers\.Authorization = authHeader/);
});
