import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { generateKeyPairSync, webcrypto } from 'node:crypto';
const require = createRequire(import.meta.url);
const ts = require('../../ai-company-app/node_modules/typescript');
const source = fs.readFileSync('prototype/functions/api/media/proxy.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = { VIDEO_OUTPUT_GCS_URI: 'gs://images/root', GOOGLE_CLIENT_EMAIL: 'test@example.test',
  GOOGLE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }), GOOGLE_PROJECT_ID: 'billing-project' };
function load(fetch) {
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: () => ({ authorizeRequest: async () => ({ ok: true, userId: 'test' }) }),
    fetch, Request, Response, URL, URLSearchParams, TextEncoder, Uint8Array, Date, Set, crypto: webcrypto, atob, btoa });
  return exports.onRequestGet;
}
test('media retries billing rejection on the same bucket and preserves Range and image bytes', async () => {
  const calls = [];
  const handler = load(async (url, options) => {
    calls.push({ url: new URL(url), options });
    return calls.length === 1 ? new Response('billing denied', { status: 403 })
      : new Response('image bytes', { status: 206, headers: { 'Content-Type': 'image/png', 'Content-Range': 'bytes 0-10/11' } });
  });
  const response = await handler({ env, request: new Request('https://test/api/media/proxy?objectName=root/image.png', { headers: { Range: 'bytes=0-10' } }) });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.searchParams.get('x-goog-user-project'), 'billing-project');
  assert.equal(calls[1].url.searchParams.has('x-goog-user-project'), false);
  assert.equal(calls[1].url.pathname, calls[0].url.pathname);
  assert.equal(calls[1].options.headers.Range, 'bytes=0-10');
  assert.equal(response.status, 206);
  assert.equal(await response.text(), 'image bytes');
});
test('missing images are not retried as billing failures', async () => {
  let calls = 0;
  const handler = load(async () => { calls++; return new Response('missing', { status: 404 }); });
  const response = await handler({ env, request: new Request('https://test/api/media/proxy?objectName=root/missing.png') });
  assert.equal(calls, 1);
  assert.equal(response.status, 404);
});
test('a missing fallback bucket does not hide the primary storage permission error', async () => {
  const handler = load(async (url) => new URL(url).pathname.startsWith('/images/')
    ? new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 })
    : new Response('missing in audio bucket', { status: 404 }));
  const response = await handler({ env: { ...env, AUDIO_OUTPUT_GCS_URI: 'gs://audio/root' }, request: new Request('https://test/api/media/proxy?objectName=root/image.png') });
  assert.equal(response.status, 403);
  assert.match((await response.json()).detail, /AccessDenied/);
});