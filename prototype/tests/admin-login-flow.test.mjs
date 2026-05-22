import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("login.ts checks registry before legacy and verifies hashed passwords", () => {
  const src = read("prototype/functions/api/login.ts");
  assert.match(src, /loadRegistry\(env\)/);
  assert.match(src, /verifyPassword\(pw, user\.pwHash\)/);
  // 비활성 계정 차단
  assert.match(src, /account_disabled/);
  // role을 응답에 포함
  assert.match(src, /role: user\.role \|\| "member"/);
  assert.match(src, /role: "admin"/);
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
