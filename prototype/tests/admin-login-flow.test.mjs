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
  // 응답 role 결정 — 마스터만 master, 그 외 member
  assert.match(src, /isPrimary \? "master" : "member"/);
});

test("login.ts keeps the primary admin un-lockable (active ignored, role forced)", () => {
  const src = read("prototype/functions/api/login.ts");
  assert.match(src, /const isPrimary = id === envId/);
  // 최고 관리자는 active 무시
  assert.match(src, /!isPrimary && !user\.active/);
  // 레지스트리 미등록(부트스트랩) 시 env 비번 허용 — env AUTH_PW 가 설정된 경우에만
  assert.match(src, /if \(isPrimary && envPw && pw === envPw\)/);
  assert.match(src, /const envPw = String\(env\.AUTH_PW \|\| ""\)\.trim\(\)/);
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

test("login.ts has no hardcoded passwords or seed accounts (public repo)", () => {
  const src = read("prototype/functions/api/login.ts");
  assert.doesNotMatch(src, /limfactory1234/);
  assert.doesNotMatch(src, /LEGACY_USERS|LEGACY_AUTH_PW/);
  assert.doesNotMatch(src, /hongdaeitacademy/);
});

test("session tokens are only signed/verified with secret env values", () => {
  const src = read("prototype/functions/api/_shared/auth.js");
  assert.doesNotMatch(src, /nk_studio_legacy_session_secret/);
  assert.doesNotMatch(src, /GOOGLE_PROJECT_ID/);
  for (const rel of ["prototype/functions/api/sns/publish.ts", "prototype/functions/api/sns/tiktok-media.ts", "prototype/functions/api/sns/tiktok/inbox.ts"]) {
    const sns = read(rel);
    assert.doesNotMatch(sns, /nk_studio_legacy_session_secret/, rel);
    assert.match(sns, /return readSecret\(env\);/, rel);
  }
});

test("auth.js stores role and exposes isAdmin/getRole", () => {
  const src = read("prototype/js/auth.js");
  assert.match(src, /auth\.getRole = function/);
  assert.match(src, /auth\.isAdmin = function/);
  assert.match(src, /KEYS\.ROLE/);
  // 로그인 시 role 전달
  assert.match(src, /auth\.setAuthed\(true, res\.user \|\| id, res\.token, res\.permissions \|\| \[\], res\.role \|\| '', \{/);
  assert.match(src, /rememberDevice: res\.persistent !== false/);
});

test("config.js defines ROLE storage key", () => {
  const src = read("prototype/js/config.js");
  assert.match(src, /ROLE: 'nk_user_role'/);
});
