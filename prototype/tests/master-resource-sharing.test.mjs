import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

// 마스터 소유자 본인의 다른 계정(회사 계정 등)에 '마스터 자원 사용'을 켜면
// AI 키·구독 연결·크레딧을 마스터 것으로 쓴다(2026-10-17 소유자 지시). 저장소·권한은 본인 것 그대로.
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const esbuild = createRequire(import.meta.url)('../../ai-company-app/node_modules/esbuild');
function evaluate(source, deps = {}) {
  const module = { exports: {} };
  const code = esbuild.transformSync(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];[ \t]*$/gm, ''), { loader: 'ts', format: 'cjs' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, console, ...deps });
  return module.exports;
}

function registry(users, { fail = false } = {}) {
  const sanitizeUserId = v => String(v || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
  return evaluate(read('prototype/functions/api/_shared/admin-users.ts'), {
    sanitizeUserId, buildAdminObject: () => 'admin/users.json', resolveGcsEnv: () => ({ basePrefix: '' }),
    readGcsJson: async () => { if (fail) throw new Error('gcs_down'); return { found: true, data: { version: 1, users } }; },
    writeGcsJson: async () => {}, hashPassword: async v => 'hash:' + v,
  });
}

test('마스터 자원 사용을 켠 활성 회원만 마스터 ID 로 바뀐다', async () => {
  const env = { AUTH_ID: 'owner' };
  const m = registry([
    { id: 'raviok', useMasterResources: true, active: true },
    { id: 'staff', active: true },
    { id: 'off', useMasterResources: true, active: false },
    { id: 'leaving', useMasterResources: true, active: true, deletionRequestedAt: '2026-10-17T00:00:00Z' },
  ]);
  assert.equal(await m.resourceOwnerId(env, 'raviok'), 'owner');
  assert.equal(await m.resourceOwnerId(env, 'staff'), 'staff');
  assert.equal(await m.resourceOwnerId(env, 'off'), 'off', '비활성 계정은 마스터 자원을 못 쓴다');
  assert.equal(await m.resourceOwnerId(env, 'leaving'), 'leaving', '삭제 예정 계정은 마스터 자원을 못 쓴다');
  assert.equal(await m.resourceOwnerId(env, 'owner'), 'owner');
  assert.equal(await m.usesMasterResources(env, 'raviok'), true);
  assert.equal(await m.usesMasterResources(env, 'staff'), false);
  assert.equal(await m.usesMasterResources(env, 'owner'), true);
});

test('명부를 못 읽으면 본인 자원으로 둔다(장애 때 마스터 자원으로 넘어가지 않는다)', async () => {
  const m = registry([], { fail: true });
  assert.equal(await m.resourceOwnerId({ AUTH_ID: 'owner' }, 'raviok'), 'raviok');
});

test('자격증명·크레딧 해석 지점이 모두 같은 규칙을 쓰고, 마스터에겐 켤 수 없다', () => {
  const claude = read('prototype/functions/api/_shared/claude-auth.js');
  assert.match(claude, /const credentialUser = await credentialOwnerId\(env, userId\);\s*const owner = isOwnerAccount\(env, credentialUser\);\s*const row = await getSettingsRow\(sql, credentialUser\);/);
  assert.match(claude, /await import\("\.\/admin-users"\)[\s\S]{0,120}resourceOwnerId\(env, userId\)\) \|\| userId;\s*\} catch \(_\) \{\s*return userId;/);
  const generation = read('prototype/functions/api/_shared/generation-auth.ts');
  assert.match(generation, /const ownerId = await credentialOwnerId\(env, userId\);\s*const row = await getSettingsRow\(sql, ownerId\);/);
  assert.match(generation, /nk_image_connectors WHERE user_id=\$1', \[ownerId\]/);
  const credits = read('prototype/functions/api/_shared/credits.ts');
  assert.match(credits, /if \(await usesMasterResources\(env, auth\.userId\)\) return handler\(context\);/);
  // 디렉터가 신원으로 쓰는 summary.userId 는 본인 ID 로 남긴다.
  assert.match(read('prototype/functions/api/credits/me.ts'), /\{ \.\.\.await getCreditSummary\(env, owner\), userId: auth\.userId \}/);
  assert.match(read('prototype/functions/api/credits/quote.ts'), /\{ \.\.\.await getCreditSummary\(env, owner\), userId: auth\.userId \}/);
  const users = read('prototype/functions/api/admin/users.ts');
  assert.match(users, /useMasterResources: !isPrimaryTarget && body\.useMasterResources === true/);
  assert.match(users, /user\.active = true;\s*user\.useMasterResources = false;/);
  const ui = read('prototype/js/ui/admin-users.js');
  assert.match(ui, /id="admin-f-master-res"/);
  const core = read('prototype/core.js');
  for (const k of ['admin_use_master_resources', 'admin_hint_master_resources', 'admin_master_resources_badge']) {
    assert.ok((core.match(new RegExp('\\b' + k + ':', 'g')) || []).length >= 2, `${k} 는 ko/en 양쪽에 있어야 한다`);
  }
});
