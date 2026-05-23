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
