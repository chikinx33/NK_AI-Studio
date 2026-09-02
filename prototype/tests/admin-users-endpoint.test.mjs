import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("admin users endpoint requires admin on every method", () => {
  const src = read("prototype/functions/api/admin/users.ts");
  // 인증 + 마스터 검증 공통 게이트 (회원관리는 마스터 전용)
  assert.match(src, /async function gate/);
  assert.match(src, /authorizeRequest\(request, env\)/);
  assert.match(src, /requireMaster\(env, auth\.userId\)/);
  assert.match(src, /master_required/);
  // 4개 메서드 핸들러 + OPTIONS 모두 노출
  assert.match(src, /export const onRequestGet/);
  assert.match(src, /export const onRequestPost/);
  assert.match(src, /export const onRequestPatch/);
  assert.match(src, /export const onRequestDelete/);
  assert.match(src, /export const onRequestOptions/);
  // 각 핸들러가 gate를 통과시키는지
  const gateCalls = src.match(/const g = await gate\(/g) || [];
  assert.equal(gateCalls.length, 4);
});

test("admin users endpoint enforces create/update/delete invariants", () => {
  const src = read("prototype/functions/api/admin/users.ts");
  assert.match(src, /user_exists/); // 생성 시 중복 검사
  assert.match(src, /password_required/); // 비밀번호 필수
  assert.match(src, /hashPassword\(/); // 비밀번호 해싱
  assert.match(src, /conflict/); // 낙관적 락
  assert.match(src, /expectedUpdatedAt/);
  assert.match(src, /cannot_delete_primary_admin/); // 1차 관리자 보호
  assert.match(src, /user\.active = false/); // 소프트 삭제
});

test("admin users endpoint reads resiliently for GET but strictly for writes", () => {
  const src = read("prototype/functions/api/admin/users.ts");
  // GET: 읽기 실패에 견디는 loadRegistry
  assert.match(src, /const reg = await loadRegistry\(env\);/);
  // 쓰기(생성/수정/삭제): 기존 데이터 보호용 loadRegistryStrict
  const strictCalls = src.match(/loadRegistryStrict\(env\)/g) || [];
  assert.equal(strictCalls.length, 3);
});

test("admin-users shared module exposes registry + guard helpers", () => {
  const src = read("prototype/functions/api/_shared/admin-users.ts");
  assert.match(src, /export async function loadRegistry/);
  assert.match(src, /export async function loadRegistryStrict/);
  assert.match(src, /export async function saveRegistry/);
  assert.match(src, /export function requireMaster/);
  assert.match(src, /export function findUser/);
  assert.match(src, /export function sanitizePermissions/);
  assert.match(src, /export function publicUser/);
  // publicUser는 비밀번호 해시를 제거해야 한다
  assert.match(src, /const \{ pwHash, \.\.\.rest \} = user/);
  // 권한 화이트리스트
  assert.match(src, /PERMISSION_PAGES = \["videogen", "image", "video", "brand", "doc", "sound", "ai_company", "admin"\]/);
});

test("client api exposes admin user CRUD wrappers", () => {
  const src = read("prototype/api.js");
  assert.match(src, /api\.adminUsersList = async function/);
  assert.match(src, /api\.adminUserCreate = async function/);
  assert.match(src, /api\.adminUserUpdate = async function/);
  assert.match(src, /api\.adminUserDelete = async function/);
  assert.match(src, /api\.adminUserRestore = async function/);
  assert.match(src, /restoreDeletion: true/);
  assert.match(src, /method: 'PATCH'/);
  assert.match(src, /method: 'DELETE'/);
  // 인증 헤더 사용
  assert.match(src, /fetch\(withBase\('\/api\/admin\/users'\), \{ headers: buildAuthHeaders\(\) \}\)/);
});
