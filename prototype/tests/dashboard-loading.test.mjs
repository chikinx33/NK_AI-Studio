import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("dashboard keeps the loading spinner until real project cards are loaded", () => {
  const src = read("prototype/js/ui/dashboard.js");
  // 로컬 카드가 없으면 즉시 스피너 표시(600ms 지연 제거)
  assert.match(src, /if \(!hasLocalDrafts\) \{\s*setDashLoading\(true, DASHBOARD_LOADING_TEXT\);\s*\}/);
  // placeholder 렌더 직후 스피너를 해제하지 않는다(과거 버그)
  assert.doesNotMatch(src, /로딩 오버레이는 즉시 해제/);
  // 받아올 항목이 없을 때만 조기 해제, 그 외엔 finally에서 해제
  assert.match(src, /if \(!missingIds\.length \|\| !NK\.api\.projectGet\) \{\s*clearLoading\(\);/);
  assert.match(src, /finally \{\s*clearLoading\(\);\s*\}/);
});
