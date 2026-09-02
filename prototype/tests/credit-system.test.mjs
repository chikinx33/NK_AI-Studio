import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const prototype = path.resolve(here, '..');
const read = (relative) => fs.readFile(path.join(prototype, relative), 'utf8');

test('credit rate card calculates deterministic server quotes', async () => {
  const source = await read('functions/api/_shared/credit-rates.js');
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  assert.equal(module.quoteCredits('video', { videoModel: 'veo', durationSeconds: 5 }, {}).credits, 40);
  assert.equal(module.quoteCredits('video', { videoModel: 'kling-final', durationSeconds: 10 }, {}).credits, 6);
  assert.equal(module.quoteCredits('image_generation', {}, {}).credits, 20);
  assert.equal(module.quoteCredits('voice', { segments: [{ text: 'a'.repeat(101) }] }, {}).credits, 2);
  assert.equal(module.quoteCredits('sfx', { duration: 2 }, {}).credits, 8);
});

test('credit ledger uses per-user transactional locking and idempotency', async () => {
  const source = await read('functions/api/_shared/credits.ts');
  assert.match(source, /pg_advisory_xact_lock\(hashtext\(p_user_id\)\)/);
  assert.match(source, /UNIQUE \(user_id, idempotency_key\)/);
  assert.match(source, /available_credits >= p_cost/);
  assert.match(source, /status IN \('reserved','committed','released'\)/);
  assert.match(source, /'duplicate_' \|\| o\.status/);
  assert.match(source, /credit_duplicate_request/);
  assert.match(source, /credit_service_unavailable/);
});

test('platform-funded generation endpoints are protected by the credit wrapper', async () => {
  const endpoints = [
    'functions/api/video.ts',
    'functions/api/video/lipsync.ts',
    'functions/api/imagen.ts',
    'functions/api/imagen-describe.ts',
    'functions/api/ip/analyze.ts',
    'functions/api/upscale.ts',
    'functions/api/music.ts',
    'functions/api/sfx.ts',
    'functions/api/tts.ts',
    'functions/api/sound/voice-generate.ts',
    'functions/api/sound/sfx-generate.ts',
    'functions/api/knowledge/index.ts',
  ];
  for (const endpoint of endpoints) {
    assert.match(await read(endpoint), /withCreditCharge/, endpoint);
  }
  const status = await read('functions/api/video/status.ts');
  assert.match(status, /settleDeferredCreditFromResponse/);
});

test('credit UI and account deletion cleanup are connected', async () => {
  const common = await read('js/ui/common.js');
  const admin = await read('js/ui/admin-users.js');
  const cleanup = await read('functions/api/_shared/user-cleanup.ts');
  assert.match(common, /initCreditGauge/);
  assert.match(common, /nk:credits-changed/);
  assert.match(admin, /credit-grant/);
  assert.match(admin, /credit-revoke/);
  assert.match(admin, /credit-history/);
  const adminApi = await read('functions/api/admin/credits.ts');
  assert.match(adminApi, /requireMaster/);
  assert.match(adminApi, /action !== "grant" && action !== "revoke"/);
  assert.match(cleanup, /"credit_transactions"/);
  assert.match(cleanup, /"credit_operations"/);
  assert.match(cleanup, /"credit_accounts"/);
});
