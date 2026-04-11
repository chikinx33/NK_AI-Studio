import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readSource(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('menu navigation preserves fullscreen restore state before shell transitions', () => {
  const source = readSource('prototype/script.js');
  assert.match(source, /const preserveFullscreenOnMenuNavigation = \(\) =>/);
  assert.match(source, /preserveFullscreenOnMenuNavigation\(\);\s*try \{\s*sessionStorage\.setItem\('nk_force_dashboard_entry', '1'\);/);
  assert.match(source, /preserveFullscreenOnMenuNavigation\(\);\s*if \(NK\.navigation && NK\.navigation\.loadStage\) \{/);
  assert.match(source, /preserveFullscreenOnMenuNavigation\(\);\s*persistCurrentProject\(\);\s*const url = currentProject\?\.id \? `scenario\.html\?projectId=\$\{encodeURIComponent\(currentProject\.id\)\}` : 'scenario\.html';/);
});

test('login shell links preserve fullscreen restore with exact destination selectors', () => {
  const source = readSource('prototype/script.js');
  assert.match(source, /const preserveFullscreenForTopLevelShellMove = \(\) =>/);
  assert.match(source, /const brandStudioLink = document\.querySelector\('#login-icons \.login-icon-link\[href="brand-studio\.html"\]'\);/);
  assert.match(source, /const aiVideoLink = document\.querySelector\('#login-icons \.login-icon-link\[href\^="ai-video\.html"\]'\);/);
  assert.match(source, /const aiImageLink = document\.querySelector\('#login-icons \.login-icon-link\[href\^="ai-image\.html"\]'\);/);
  assert.match(source, /brandStudioLink\.addEventListener\('click', \(\) => \{\s*preserveFullscreenForTopLevelShellMove\(\);/);
});

test('fullscreen restore flag is cleared when fullscreen is no longer active', () => {
  const source = readSource('prototype/js/ui/common.js');
  assert.match(source, /if \(!isFullscreen\) \{\s*clearFullscreenRestoreFlag\(\);\s*\}/);
});
