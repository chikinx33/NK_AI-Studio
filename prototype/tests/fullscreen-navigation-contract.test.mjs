import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readSource(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('fullscreen restore flag is cleared when fullscreen is no longer active', () => {
  const source = readSource('prototype/js/ui/common.js');
  assert.match(source, /if \(!isFullscreen\) \{\s*clearFullscreenRestoreFlag\(\);\s*\}/);
});
