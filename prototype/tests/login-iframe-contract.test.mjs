import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readScriptSource() {
  const fullPath = path.join(process.cwd(), 'prototype/script.js');
  return fs.readFileSync(fullPath, 'utf8');
}

test('auth overlay login links are rewritten to top-level index with a return target', () => {
  const source = readScriptSource();
  assert.match(source, /const LOGIN_RETURN_PARAM = 'returnTo';/);
  assert.match(source, /const buildLoginPageHref = \(\) =>/);
  assert.match(source, /const syncAuthOverlayLoginLinks = \(\) =>/);
  assert.match(source, /#auth-overlay a\[href\], \[data-ai-image-auth-link\]/);
  assert.match(source, /link\.setAttribute\('href', buildLoginPageHref\(\)\);/);
  assert.match(source, /link\.setAttribute\('target', '_top'\);/);
});

test('embedded landing page breaks out of the stage iframe and login success restores the requested target', () => {
  const source = readScriptSource();
  assert.match(source, /const breakoutEmbeddedLoginPage = \(urlParams\) =>/);
  assert.match(source, /window\.top\.location\.replace\(loginUrl\.toString\(\)\);/);
  assert.match(source, /syncAuthOverlayLoginLinks\(\);/);
  assert.match(source, /if \(breakoutEmbeddedLoginPage\(urlParams\)\) return;/);
  assert.match(source, /const requestedReturnTarget = readRequestedLoginReturnTarget\(new URLSearchParams\(window\.location\.search\)\);/);
  assert.match(source, /window\.top\.location\.replace\(requestedReturnTarget\);/);
});
