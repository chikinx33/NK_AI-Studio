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
  // 모달이 list API 사용 + 항상 에디터로 부여(역할 선택 없음)
  assert.match(src, /NK\.api\.projectShareList\(\)/);
  assert.match(src, /projectShareGrant\(pid, target, 'editor'/);
  assert.doesNotMatch(src, /id="nk-share-role"/);
});

test("dashboard merges shared projects into categories with a single share icon (no separate section, no role distinction)", () => {
  const src = read("prototype/js/ui/dashboard.js");
  // 별도 '공유받은 프로젝트' 섹션은 제거됨
  assert.doesNotMatch(src, /function appendSharedSection/);
  assert.doesNotMatch(src, /nk-shared-section/);
  // 공유 프로젝트를 소유 드래프트와 합본으로 카테고리에 통합
  assert.match(src, /function buildSharedDrafts/);
  assert.match(src, /function getViewDrafts/);
  assert.match(src, /drafts = getViewDrafts\(\)/);
  // 시리즈 칩 라벨 앞에 쉐어 아이콘만(뷰어/에디터 구분 없음)
  assert.match(src, /function sharedLabelIcons/);
  assert.match(src, /_sharedMeta\.get\(s\.id\)/);
  assert.match(src, /ICON_SHARE/);
  assert.doesNotMatch(src, /ICON_VIEWER/);
  assert.doesNotMatch(src, /ICON_EDITOR/);
  // 재공유 버튼은 소유 카테고리에서만
  assert.match(src, /!_sharedMeta\.has\(currentSeriesFilter\)/);
  // 공유받은 카드도 일반 카드와 동일 마크업(특수 분기 제거)
  assert.doesNotMatch(src, /const isShared = !!d\.__shared/);
});

test("shared project edits propagate both ways (collaboration sync)", () => {
  const src = read("prototype/js/ui/dashboard.js");
  // 제목 수정 시 공유 프로젝트는 합본에서 조회하고 소유자 서버에 저장(로컬 스토어 미사용)
  assert.match(src, /const draft = getViewDrafts\(\)\.find\(d => String\(d\.id\) === String\(id\)\)/);
  assert.match(src, /if \(draft\.__shared\) \{/);
  assert.match(src, /NK\.api\.projectSave\(String\(draft\.id\), \{ episodeTitle: newTitle, topic: newTitle \}, \[\], \{ title: newTitle \}\)/);
  // 소유자 측: 내가 공유한 프로젝트의 제목/대표이미지를 서버에서 다시 받아 반영
  assert.match(src, /function refreshOwnedSharedTitles/);
  assert.match(src, /res\.sharedByMe/);
  assert.match(src, /refreshOwnedSharedTitles\(\);/);
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
