import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readUiSource() {
  const fullPath = path.join(process.cwd(), 'prototype/js/ui/ai-image.js');
  return fs.readFileSync(fullPath, 'utf8');
}

test('select-result does not trigger full history panel rerender', () => {
  const src = readUiSource();
  const blockStart = src.indexOf("if (action === 'select-result')");
  assert.ok(blockStart > 0, 'select-result block present');
  const blockEnd = src.indexOf('return;', blockStart);
  const snippet = src.slice(blockStart, blockEnd > blockStart ? blockEnd : blockStart + 1000);
  assert.match(snippet, /updateResultSelectionUI\(\)/);
  assert.match(snippet, /updatePromptPanelUI\(\)/);
  assert.doesNotMatch(snippet, /updateHistoryPanelUI\(\)/);
});
