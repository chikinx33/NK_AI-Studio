import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const policy = read('../functions/api/_shared/account-deletions.ts');
const users = read('../functions/api/admin/users.ts');
const cleanup = read('../functions/api/_shared/user-cleanup.ts');
const endpoint = read('../functions/api/admin/users-cleanup.ts');
const auth = read('../functions/api/_shared/auth.js');
const login = read('../functions/api/login.ts');
const workflow = read('../../.github/workflows/account-cleanup.yml');
const gcs = read('../functions/api/_shared/gcs.js');

test('회원 삭제는 7일 대기 레코드를 먼저 저장하고 즉시 자료를 지우지 않는다', () => {
  assert.match(policy, /7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(users, /requestAccountDeletion\(deletions, id\)/);
  assert.match(users, /deletionPending:\s*true/);
  assert.doesNotMatch(users, /deleteGcsPrefix|cleanupUserData/);
});

test('삭제 대기 계정은 로그인·재등록·기존 세션이 모두 차단된다', () => {
  assert.match(users, /isDeletionRegistrationBlocked/);
  assert.match(login, /account_deletion_pending/);
  assert.match(auth, /checkAccountSession/);
  assert.match(policy, /issuedAtMs > 0 && issuedAtMs <= record\.revokedBefore/);
  assert.match(auth, /iatMs: nowMs/);
});

test('7일 안에는 삭제 예약을 취소하고 기존 회원을 활성 상태로 복구한다', () => {
  assert.match(policy, /export function cancelAccountDeletion/);
  assert.match(policy, /record\.status = "cancelled"/);
  assert.match(policy, /Date\.parse\(record\.deleteAfter\) <= now\.getTime\(\)/);
  assert.match(users, /body\.restoreDeletion === true/);
  assert.match(users, /deletion_restore_window_expired/);
  assert.match(users, /await saveAccountDeletions\(env, deletions\)[\s\S]*user\.active = true/);
  assert.match(users, /user\.deletionRequestedAt = ""/);
  assert.match(users, /user\.deleteAfter = ""/);
});

test('만료 정리는 영상·오디오 GCS, Neon, 공유 권한을 끝낸 뒤 회원 레코드를 제거한다', () => {
  assert.match(cleanup, /AUDIO_OUTPUT_GCS_URI/);
  assert.match(cleanup, /cleanupAllStorage[\s\S]*cleanupDatabase[\s\S]*cleanupShares/);
  assert.match(cleanup, /usersRegistry\.users = usersRegistry\.users\.filter/);
  assert.match(cleanup, /record\.status = "completed"/);
  assert.ok(cleanup.indexOf('cleanupUserData(env, record.userId)') < cleanup.indexOf('usersRegistry.users = usersRegistry.users.filter'));
  assert.match(gcs, /batch_response_count_mismatch/);
  assert.match(cleanup, /listGcsObjects\(env, prefix\)/);
});

test('보호된 정리 엔드포인트를 15분 간격으로 실행하고 실패는 작업 실패로 노출한다', () => {
  assert.match(endpoint, /ACCOUNT_CLEANUP_TOKEN/);
  assert.match(endpoint, /cleanup_incomplete/);
  assert.match(workflow, /cron: "\*\/15 \* \* \* \*"/);
  assert.match(workflow, /secrets\.ACCOUNT_CLEANUP_TOKEN/);
  assert.match(workflow, /--fail-with-body/);
});
