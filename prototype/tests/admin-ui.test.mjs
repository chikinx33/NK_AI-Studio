import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("admin.html loads required scripts and content shell", () => {
  const src = read("prototype/admin.html");
  assert.match(src, /js\/auth\.js/);
  assert.match(src, /api\.js/);
  assert.match(src, /js\/ui\/admin-users\.js/);
  assert.match(src, /<section class="content">/);
  assert.match(src, /id="auth-overlay"/);
});

test("admin-users.js renders list, modal, and wires CRUD actions", () => {
  const src = read("prototype/js/ui/admin-users.js");
  // 데이터 로드 + CRUD 클라이언트 호출
  assert.match(src, /NK\.api\.adminUsersList\(\)/);
  assert.match(src, /NK\.api\.adminUserCreate\(/);
  assert.match(src, /NK\.api\.adminUserUpdate\(/);
  assert.match(src, /NK\.api\.adminUserDelete\(/);
  assert.match(src, /NK\.api\.adminUserRestore\(/);
  // 낙관적 락 토큰 전달
  assert.match(src, /expectedUpdatedAt: state\.edit\.updatedAt/);
  // 권한 키가 서버와 동기화
  assert.match(src, /key: 'videogen'/);
  assert.match(src, /key: 'image'/);
  assert.match(src, /key: 'video'/);
  assert.match(src, /key: 'brand'/);
  assert.match(src, /key: 'doc'/);
  assert.match(src, /key: 'sound'/);
  // 마스터 전용 게이트 (문구는 중앙 i18n 사전 키로 참조)
  assert.match(src, /NK\.auth\.isMaster/);
  assert.match(src, /t\('admin_no_access'\)/);
  // 저장(적용) 버튼 (i18n 키)
  assert.match(src, /t\('admin_save_apply'\)/);
  // 홈(뒤로가기) 버튼
  assert.match(src, /data-action="go-home"/);
  assert.match(src, /function goHome/);
  assert.match(src, /window\.location\.href = 'app\.html'/);
});

test("admin-users.js shows deletion schedule and a restore action", () => {
  const src = read("prototype/js/ui/admin-users.js");
  assert.match(src, /formatDeleteAfter/);
  assert.match(src, /t\('admin_delete_at'\)/);
  assert.match(src, /data-action="restore-user"/);
  assert.match(src, /function restoreUser/);
  assert.match(src, /t\('admin_confirm_restore'\)/);
});

test("admin-users.js surfaces a primary-admin password-set affordance", () => {
  const ui = read("prototype/js/ui/admin-users.js");
  assert.match(ui, /buildPrimaryAdminRowIfNeeded/);
  assert.match(ui, /data-action="set-primary-pw"/);
  assert.match(ui, /function openPrimaryPwModal/);
  assert.match(ui, /t\('admin_m_set_master_pw'\)/);
  assert.match(ui, /state\.primaryAdminId/);
  // 서버 GET이 primaryAdminId를 내려준다
  const ep = read("prototype/functions/api/admin/users.ts");
  assert.match(ep, /primaryAdminId: primaryAdminId\(env\)/);
});

test("admin-users.js maps server errors to friendly messages", () => {
  const src = read("prototype/js/ui/admin-users.js");
  assert.match(src, /user_exists/);
  assert.match(src, /conflict/);
  assert.match(src, /cannot_delete_primary_admin/);
});
