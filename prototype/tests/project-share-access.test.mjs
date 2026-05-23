import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("project/get honors ownerId with viewer/editor grant check", () => {
  const src = read("prototype/functions/api/project/get.ts");
  assert.match(src, /import \{ loadShares, getGrantRole \} from "\.\.\/_shared\/shares"/);
  assert.match(src, /const ownerParam = sanitizeUserId\(url\.searchParams\.get\("ownerId"\)/);
  assert.match(src, /getGrantRole\(sharesReg, ownerParam, projectId, requesterId\)/);
  assert.match(src, /if \(!role\) return send\(\{ error: "forbidden" \}, 403/);
  // 권한 통과 시 소유자 경로로 읽음
  assert.match(src, /userId = ownerParam;/);
});

test("project/save requires editor grant for shared projects", () => {
  const src = read("prototype/functions/api/project/save.ts");
  assert.match(src, /import \{ loadShares, getGrantRole \} from "\.\.\/_shared\/shares"/);
  assert.match(src, /const ownerParam = sanitizeUserId\(body\.ownerId/);
  assert.match(src, /if \(role !== "editor"\) return send\(\{ error: "forbidden_not_editor" \}, 403/);
  assert.match(src, /userId = ownerParam;/);
});

test("project/list returns projects shared with the requester", () => {
  const src = read("prototype/functions/api/project/list.ts");
  assert.match(src, /import \{ loadShares, listSharedWith \} from "\.\.\/_shared\/shares"/);
  assert.match(src, /listSharedWith\(sharesReg, auth\.userId\)/);
  assert.match(src, /return send\(\{ ok: true, ids, shared \}/);
});

test("client projectGet/projectSave forward ownerId", () => {
  const src = read("prototype/api.js");
  assert.match(src, /api\.projectGet = async function \(projectId, ownerId\)/);
  assert.match(src, /&ownerId=' \+ encodeURIComponent/);
  assert.match(src, /if \(opts && opts\.ownerId\) body\.ownerId = String\(opts\.ownerId\)/);
});
