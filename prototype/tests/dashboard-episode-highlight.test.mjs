import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("card ordering/highlight uses one 'last modified' criterion (modifiedAt → savedAt → lastUsedAt → id)", () => {
  const src = read("prototype/js/ui/dashboard.js");
  assert.match(src, /const draftModifiedTs = \(draft\) => \{/);
  assert.match(src, /at\(draft\.modifiedAt\)[\s\S]{0,200}at\(draft\.savedAt\)[\s\S]{0,200}at\(draft\.lastUsedAt\)/);
  // 정렬은 모듈 스코프 sortByRecency 하나만 존재해야 한다(렌더 내부 중복 정의 금지)
  assert.equal((src.match(/const sortByRecency = /g) || []).length, 1);
  assert.match(src, /const sortByRecency = \(a, b\) => \{\s*const ta = draftModifiedTs\(a\);/);
});

test("brand episode list highlights the most recently modified episode, not the stale current project", () => {
  const src = read("prototype/js/ui/dashboard.js");
  assert.match(src, /const latestModifiedId = filteredDrafts\.length > 0 \? String\(filteredDrafts\[0\]\.id\) : '';/);
  assert.match(src, /const isBrandEpisodeList = host === 'brand' && currentSeriesFilter !== '__all__';/);
  assert.match(src, /const selectedProjectId = isBrandEpisodeList\s*\n\s*\? latestModifiedId/);
});

test("brand primary episode uses the same last-modified criterion as the highlight", () => {
  const src = read("prototype/js/ui/dashboard.js");
  assert.match(src, /getPrimaryDraftForSeries = \(seriesId, drafts\) => \{[\s\S]{0,400}\.sort\(sortByRecency\)\[0\]/);
});

test("server savedAt is carried into drafts (owned, shared, and backfill for old cards)", () => {
  const src = read("prototype/js/ui/dashboard.js");
  assert.match(src, /savedAt: String\(data\.savedAt \|\| ''\)/);
  assert.match(src, /savedAt: String\(\(data && data\.savedAt\) \|\| ''\)/);
  assert.match(src, /const backfillSavedAt = async \(\) => \{/);
  // 한 번 확인한 카드는 다시 훑지 않는다
  assert.match(src, /!d\.__savedAtChecked/);
});

test("projectSave success stamps modifiedAt via project.markModified", () => {
  const api = read("prototype/api.js");
  assert.match(api, /api\.projectListInvalidate\(\);[\s\S]{0,400}NK\.service\.project\.markModified\(body\.projectId\)/);

  const svc = read("prototype/js/service/project.js");
  assert.match(svc, /project\.markModified = function \(projectId\) \{/);
  // 수정 stamp 는 현재 프로젝트 선택을 바꾸지 않는다(markUsed 와 달리 forceCurrent 없음)
  const body = svc.slice(svc.indexOf("project.markModified = function"), svc.indexOf("project.markUsed = function"));
  assert.doesNotMatch(body, /forceCurrent/);
  assert.match(body, /modifiedAt: nowIso/);
  // 잦은 저장에 대한 throttle
  assert.match(body, /_modifiedStampAt\[targetId\]/);
  // upsert 시 서버 응답에 없는 클라이언트 메타를 보존
  assert.match(svc, /if \(!normalized\.modifiedAt && existing\.modifiedAt\)/);
  assert.match(svc, /if \(!normalized\.savedAt && existing\.savedAt\)/);
});
