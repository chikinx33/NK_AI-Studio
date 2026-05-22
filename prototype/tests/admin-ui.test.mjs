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
  // 낙관적 락 토큰 전달
  assert.match(src, /expectedUpdatedAt: state\.edit\.updatedAt/);
  // 권한 키가 서버와 동기화
  assert.match(src, /key: 'videogen'/);
  assert.match(src, /key: 'image'/);
  assert.match(src, /key: 'video'/);
  assert.match(src, /key: 'brand'/);
  // 관리자 전용 게이트
  assert.match(src, /NK\.auth\.isAdmin/);
  assert.match(src, /관리자만 접근할 수 있는/);
  // 저장(적용) 버튼
  assert.match(src, /저장\(적용\)/);
});

test("admin-users.js maps server errors to friendly messages", () => {
  const src = read("prototype/js/ui/admin-users.js");
  assert.match(src, /user_exists/);
  assert.match(src, /conflict/);
  assert.match(src, /cannot_delete_primary_admin/);
});
