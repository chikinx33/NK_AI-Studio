import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("dashboard renders a share button on owner cards and opens a share modal", () => {
  const src = read("prototype/js/ui/dashboard.js");
  assert.match(src, /data-action="share-project"/);
  assert.match(src, /function openShareModal/);
  assert.match(src, /if \(action === 'share-project'\)/);
  // 모달이 grant/revoke/list API를 사용
  assert.match(src, /NK\.api\.projectShareGrant\(projectId, target, role/);
  assert.match(src, /NK\.api\.projectShareRevoke\(projectId/);
  assert.match(src, /NK\.api\.projectShareList\(\)/);
  // 역할 선택(뷰어/에디터)
  assert.match(src, /value="viewer"/);
  assert.match(src, /value="editor"/);
});

test("dashboard renders a shared-with-me section and opens shared projects", () => {
  const src = read("prototype/js/ui/dashboard.js");
  assert.match(src, /function appendSharedSection/);
  assert.match(src, /function openSharedProject/);
  assert.match(src, /공유받은 프로젝트/);
  assert.match(src, /list\.shared/);
});

test("api propagates ownerId for shared projects via session map", () => {
  const src = read("prototype/api.js");
  assert.match(src, /SHARED_OWNERS_KEY = 'nk_shared_owner_map'/);
  assert.match(src, /api\.getSharedOwner = function/);
  // projectList가 shared 매핑을 기록
  assert.match(src, /parsed\.shared\)\) \{/);
  assert.match(src, /writeSharedOwners\(m\)/);
  // get/save가 자동으로 ownerId 사용
  assert.match(src, /var eff = ownerId \|\| api\.getSharedOwner\(projectId\)/);
  assert.match(src, /var effOwner = \(opts && opts\.ownerId\) \|\| api\.getSharedOwner\(projectId\)/);
});
