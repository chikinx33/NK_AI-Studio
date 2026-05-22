import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("admin-users module exposes permission guards with safe defaults", () => {
  const src = read("prototype/functions/api/_shared/admin-users.ts");
  assert.match(src, /export async function getUserPermissions/);
  assert.match(src, /export async function hasPagePermission/);
  // 미등록/관리자/빈 권한 → 전체 접근(null)
  assert.match(src, /if \(!user\) return null;/);
  assert.match(src, /if \(user\.role === "admin"\) return null;/);
  // 비활성 → 권한 없음
  assert.match(src, /if \(!user\.active\) return \[\];/);
});

test("imagen endpoint enforces image permission", () => {
  const src = read("prototype/functions/api/imagen.ts");
  assert.match(src, /import \{ hasPagePermission \} from "\.\/_shared\/admin-users"/);
  assert.match(src, /hasPagePermission\(env, auth\.userId, "image"\)/);
  assert.match(src, /permission_denied/);
});

test("video endpoint enforces videogen/video permission by source", () => {
  const src = read("prototype/functions/api/video.ts");
  assert.match(src, /import \{ hasPagePermission \} from "\.\/_shared\/admin-users"/);
  assert.match(src, /hasPagePermission\(env, auth\.userId, isVideoGen \? "videogen" : "video"\)/);
  assert.match(src, /permission_denied/);
});

test("index.html exposes admin-only member management link", () => {
  const src = read("prototype/index.html");
  assert.match(src, /id="admin-link"/);
  assert.match(src, /href="admin\.html"/);
  assert.match(src, /admin-only hidden/);
  assert.match(src, /회원 관리/);
});

test("setUI reveals admin link only for admins", () => {
  const src = read("prototype/script.js");
  assert.match(src, /const adminLink = icons\.querySelector\('#admin-link'\)/);
  assert.match(src, /NK\.auth\.isAdmin\(\)/);
  assert.match(src, /adminLink\.classList\.toggle\('hidden', !showAdmin\)/);
});
