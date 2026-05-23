import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("dashboard shows the spinner immediately on entry (before cards) and keeps it until owned+shared sync done", () => {
  const src = read("prototype/js/ui/dashboard.js");
  // 진입 즉시 스피너 표시 헬퍼 + renderDrafts 시작부 호출
  assert.match(src, /const startInitialSpinner = /);
  assert.match(src, /if \(!container\) return;\s*\n[\s\S]{0,200}startInitialSpinner\(\);/);
  // 소유 + 공유 동기화가 모두 끝나야 해제
  assert.match(src, /const finishInitialLoadIfReady = \(\) => \{[\s\S]*serverMerged && _sharedSettled/);
});

test("dashboard load spinner waits for both owned (serverMerged) and shared (_sharedSettled) sync", () => {
  const src = read("prototype/js/ui/dashboard.js");
  // mergeFromServer 완료 시 초기 로딩 종료 확인
  assert.match(src, /const clearLoading = \(\) => \{ finishInitialLoadIfReady\(\); \}/);
  // 공유 동기화 완료 시 _sharedSettled 세팅 + 종료 확인
  assert.match(src, /finally \{ _sharedSettled = true; finishInitialLoadIfReady\(\); \}/);
  // placeholder 렌더 직후 스피너를 해제하지 않는다(과거 버그)
  assert.doesNotMatch(src, /로딩 오버레이는 즉시 해제/);
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
