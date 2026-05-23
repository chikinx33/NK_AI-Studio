import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("dashboard keeps the loading spinner until real project cards are loaded", () => {
  const src = read("prototype/js/ui/dashboard.js");
  // 로컬 카드가 없으면 즉시 스피너 표시(참조 카운트 기반)
  assert.match(src, /if \(!hasLocalDrafts\) \{\s*dashLoadingShow\(DASHBOARD_LOADING_TEXT\);/);
  // placeholder 렌더 직후 스피너를 해제하지 않는다(과거 버그)
  assert.doesNotMatch(src, /로딩 오버레이는 즉시 해제/);
  // 받아올 항목이 없을 때만 조기 해제, 그 외엔 finally에서 해제
  assert.match(src, /if \(!missingIds\.length \|\| !NK\.api\.projectGet\) \{\s*clearLoading\(\);/);
  assert.match(src, /finally \{\s*clearLoading\(\);\s*\}/);
});

test("dashboard shows the loading spinner while fetching shared (received) projects too", () => {
  const src = read("prototype/js/ui/dashboard.js");
  // 참조 카운트 기반 표시/해제 헬퍼
  assert.match(src, /const dashLoadingShow = /);
  assert.match(src, /const dashLoadingHide = /);
  // 공유 프로젝트 fetch 중 스피너 표시
  assert.match(src, /if \(!_sharedDrafts\.length\) \{ spinning = true; dashLoadingShow\(dt\('share_loading'\)\); \}/);
  assert.match(src, /finally \{ if \(spinning\) \{ spinning = false; dashLoadingHide\(\); \} \}/);
});

test("loading overlay container is positioned so the spinner covers cards in all dashboards", () => {
  const css = read("prototype/styles.css");
  assert.match(css, /\.projects \{\s*position: relative;\s*\}/);
});

test("episode title (.draft-title) stays on a single line (no 2-line wrap)", () => {
  const css = read("prototype/styles.dashboard-cards.css");
  // 폰트 축소 + 1행 말줄임
  assert.match(css, /\.draft-title \{[^}]*font-size: 14px;[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/s);
  // 편집 중에는 줄바꿈 허용
  assert.match(css, /\.draft-title\.editing \{[^}]*white-space: normal;/s);
});
