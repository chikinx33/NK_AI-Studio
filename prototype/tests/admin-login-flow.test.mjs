import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("login.ts treats registry as authoritative and verifies hashed passwords", () => {
  const src = read("prototype/functions/api/login.ts");
  assert.match(src, /loadRegistry\(env\)/);
  assert.match(src, /verifyPassword\(pw, user\.pwHash\)/);
  // 비활성 계정 차단(최고 관리자는 예외)
  assert.match(src, /account_disabled/);
  // 응답 role 결정
  assert.match(src, /isPrimary \? "admin" : \(user\.role \|\| "member"\)/);
});

test("login.ts keeps the primary admin un-lockable (active ignored, role forced)", () => {
  const src = read("prototype/functions/api/login.ts");
  assert.match(src, /const isPrimary = id === envId/);
  // 최고 관리자는 active 무시
  assert.match(src, /!isPrimary && !user\.active/);
  // 레지스트리 미등록(부트스트랩) 시 env 비번 허용
  assert.match(src, /if \(isPrimary && pw === envPw\)/);
  // 레지스트리 비번 불일치여도 최고 관리자는 잠기지 않도록 env 부트스트랩으로 폴백
  assert.match(src, /if \(!isPrimary\) return json\(\{ error: 'Invalid credentials' \}, 401/);
});

test("password hashing trims to match login's trimmed verification", () => {
  const adminUsers = read("prototype/functions/api/_shared/admin-users.ts");
  assert.match(adminUsers, /String\(input\.password \|\| ""\)\.trim\(\)/);
  const endpoint = read("prototype/functions/api/admin/users.ts");
  assert.match(endpoint, /hashPassword\(String\(body\.password\)\.trim\(\)\)/);
});

test("admin users endpoint forces primary admin to stay admin/active", () => {
  const src = read("prototype/functions/api/admin/users.ts");
  assert.match(src, /primaryAdminId\(env\)/);
  assert.match(src, /user\.role = "admin";/);
  assert.match(src, /user\.active = true;/);
});

test("login.ts migrates legacy users into the registry on first login", () => {
  const src = read("prototype/functions/api/login.ts");
  assert.match(src, /LEGACY_USERS/);
  assert.match(src, /createUserRecord\(/);
  assert.match(src, /reg\.users\.push\(record\)/);
  assert.match(src, /saveRegistry\(env, reg\)/);
  // GCS 장애 시 레거시 폴백이 동작하도록 try/catch 처리
  assert.match(src, /registryLoaded/);
});

test("auth.js stores role and exposes isAdmin/getRole", () => {
  const src = read("prototype/js/auth.js");
  assert.match(src, /auth\.getRole = function/);
  assert.match(src, /auth\.isAdmin = function/);
  assert.match(src, /KEYS\.ROLE/);
  // 로그인 시 role 전달
  assert.match(src, /auth\.setAuthed\(true, res\.user \|\| id, res\.token, res\.permissions \|\| \[\], res\.role \|\| ''\)/);
});

test("config.js defines ROLE storage key", () => {
  const src = read("prototype/js/config.js");
  assert.match(src, /ROLE: 'nk_user_role'/);
});
