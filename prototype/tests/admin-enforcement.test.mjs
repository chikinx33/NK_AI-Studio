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
  assert.match(src, /import \{ hasPagePermission, requireMaster \} from "\.\/_shared\/admin-users"/);
  assert.match(src, /hasPagePermission\(env, auth\.userId, "image"\)/);
  assert.match(src, /permission_denied/);
});

test("video endpoint enforces videogen/video permission by source", () => {
  const src = read("prototype/functions/api/video.ts");
  assert.match(src, /import \{ hasPagePermission, requireMaster \} from "\.\/_shared\/admin-users"/);
  assert.match(src, /hasPagePermission\(env, auth\.userId, isVideoGen \? "videogen" : "video"\)/);
  assert.match(src, /permission_denied/);
});

test("app.html exposes admin-only member management button in login card toolbar", () => {
  // 로그인 런처는 app.html로 이동(루트 / 는 공개 랜딩 index.html)
  const src = read("prototype/app.html");
  assert.match(src, /id="admin-card-btn"/);
  assert.match(src, /class="btn-ghost admin-card-btn hidden"/);
  assert.match(src, /location\.href='admin\.html'/);
  assert.match(src, /회원 관리/);
  // 상단 아이콘 행에는 더 이상 관리자 링크가 없어야 한다
  assert.doesNotMatch(src, /id="admin-link"/);
});

test("setUI reveals member-management button only for the master", () => {
  const src = read("prototype/script.js");
  assert.match(src, /const adminCardBtn = document\.getElementById\('admin-card-btn'\)/);
  assert.match(src, /NK\.auth\.isMaster\(\)/);
  assert.match(src, /adminCardBtn\.classList\.toggle\('hidden', !showMaster\)/);
});
