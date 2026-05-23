import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("dashboard share button shares the whole series (all episodes), not a single one", () => {
  const src = read("prototype/js/ui/dashboard.js");
  assert.match(src, /function openShareModal/);
  // 시리즈 단위 공유 액션 + 모든 에피소드 id 수집
  assert.match(src, /data-action="share-series"/);
  assert.match(src, /if \(action === 'share-series'\)/);
  assert.match(src, /filter\(\(d\) => String\(d\.seriesId\) === sid\)\.map\(\(d\) => String\(d\.id\)\)/);
  // 모달이 모든 에피소드에 권한 부여/회수
  assert.match(src, /for \(const pid of projectIds\) \{\s*await NK\.api\.projectShareGrant/);
  assert.match(src, /for \(const pid of projectIds\) \{ await NK\.api\.projectShareRevoke/);
  // 브랜드 스튜디오 카테고리 선택 시 노출
  assert.match(src, /series-share-btn/);
  assert.match(src, /host === 'brand' && currentSeriesFilter !== '__all__'/);
  // 카드의 공유 버튼은 제거됨
  assert.doesNotMatch(src, /class="share-btn"/);
  // 모달이 list API + 역할 선택(뷰어/에디터) 사용
  assert.match(src, /NK\.api\.projectShareList\(\)/);
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
