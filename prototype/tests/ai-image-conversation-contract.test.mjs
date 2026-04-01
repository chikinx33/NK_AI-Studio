import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readAiImageSource() {
  const fullPath = path.join(process.cwd(), 'prototype/js/ui/ai-image.js');
  return fs.readFileSync(fullPath, 'utf8');
}

test('ai-image ui exposes single and conversational generation styles', () => {
  const source = readAiImageSource();
  assert.match(source, /generationStyle: 'single'/);
  assert.match(source, /generationStyleSingle/);
  assert.match(source, /generationStyleConversation/);
  assert.match(source, /id="ai-image-generation-style"/);
  assert.match(source, /<option value="single"/);
  assert.match(source, /<option value="conversation"/);
});

test('ai-image ui sends conversation history only through the dedicated generation style flow', () => {
  const source = readAiImageSource();
  assert.match(source, /function buildConversationHistory/);
  assert.match(source, /generationStyle: normalizeGenerationStyle\(state\.generationStyle\)/);
  assert.match(source, /conversationHistory: buildConversationHistory\(3\)/);
});

test('ai-image ui supports capped multi-source image-to-image references with ordering controls', () => {
  const source = readAiImageSource();
  assert.match(source, /var MAX_SOURCE_IMAGES = 4;/);
  assert.match(source, /sourceImages: \[\]/);
  assert.match(source, /id="ai-image-source-file" class="hidden" accept="image\/\*" multiple/);
  assert.match(source, /referenceImages: state\.mode === 'image-to-image' && getSourceImages\(\)\.length/);
  assert.match(source, /data-action="move-source-prev"/);
  assert.match(source, /data-action="move-source-next"/);
  assert.match(source, /data-action="remove-source"/);
});
