import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Cloudflare Pages invokes Functions only for backend routes', () => {
  const routes = JSON.parse(read('prototype/_routes.json'));
  assert.equal(routes.version, 1);
  assert.deepEqual(routes.include, ['/api/*', '/auth/*']);
  assert.deepEqual(routes.exclude, []);

  const functionRoot = path.join(root, 'prototype/functions');
  const roots = fs.readdirSync(functionRoot, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(roots, ['api', 'auth']);
});

test('app bootstrap retries once and then shows a themed recovery modal', () => {
  const html = read('prototype/app.html');
  const script = read('prototype/script.js');
  const guardAt = html.indexOf("var RETRY_KEY = 'nk_boot_retry_at'");
  const coreAt = html.indexOf('src="core.js?');

  assert.ok(guardAt >= 0 && coreAt > guardAt, 'bootstrap guard must run before core.js');
  assert.match(html, /data-nk-critical src="core\.js\?/);
  assert.match(html, /window\.__nkReportBootFailure = recoverBoot;/);
  assert.match(html, /window\.__nkMarkAppReady = function \(\)/);
  assert.match(html, /window\.location\.replace\(retryUrl\.toString\(\)\)/);
  assert.match(html, /id = 'nk-boot-recovery-modal'/);
  assert.match(html, /role', 'alertdialog'/);
  assert.match(script, /if \(!NK\.core \|\| !NK\.config\)/);
  assert.match(script, /window\.__nkMarkAppReady/);
  assert.doesNotMatch(html, /\b(?:alert|confirm|prompt)\s*\(/);
});
