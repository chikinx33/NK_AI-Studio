import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("shares shared module exposes registry + grant helpers", () => {
  const src = read("prototype/functions/api/_shared/shares.ts");
  assert.match(src, /export async function loadShares\b/);
  assert.match(src, /export async function loadSharesStrict\b/);
  assert.match(src, /export async function saveShares\b/);
  assert.match(src, /export function upsertGrant\b/);
  assert.match(src, /export function removeGrant\b/);
  assert.match(src, /export function getGrantRole\b/);
  assert.match(src, /export function listSharedWith\b/);
  assert.match(src, /export function listSharedByOwner\b/);
  // 역할은 viewer|editor
  assert.match(src, /ShareRole = "viewer" \| "editor"/);
});

test("share endpoint enforces owner-only grant/revoke", () => {
  const src = read("prototype/functions/api/project/share.ts");
  assert.match(src, /export const onRequestGet/);
  assert.match(src, /export const onRequestPost/);
  assert.match(src, /export const onRequestDelete/);
  // ownerId는 항상 요청자 본인(소유자만 공유)
  assert.match(src, /upsertGrant\(reg, auth\.userId, projectId, targetUserId, role/);
  assert.match(src, /removeGrant\(reg, auth\.userId, projectId, targetUserId\)/);
  // 본인에게 공유 금지
  assert.match(src, /cannot_share_with_self/);
  // 마스터에게만 전체 현황 노출
  assert.match(src, /if \(requireMaster\(env, me\)\) result\.all = reg\.shares/);
  // 쓰기 경로는 strict 로딩(데이터 보호)
  assert.match(src, /loadSharesStrict\(env\)/);
});

test("client api exposes project share wrappers", () => {
  const src = read("prototype/api.js");
  assert.match(src, /api\.projectShareList = async function/);
  assert.match(src, /api\.projectShareGrant = async function/);
  assert.match(src, /api\.projectShareRevoke = async function/);
  assert.match(src, /method: 'DELETE'/);
});
