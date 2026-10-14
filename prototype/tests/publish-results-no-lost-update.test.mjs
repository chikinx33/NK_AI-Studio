// 2026-10-14: 전체 배포에서 YouTube·X·TikTok·Facebook 발행 기록이 사라지고 마지막 Instagram 만 남았다.
// 기록은 목록 전체를 저장하는데, 렌더 때 받은 옛 목록(배포 중엔 다시 그리지 않는다)에 한 건씩 붙여 저장해
// 매 저장이 앞 기록을 지웠다. 배포 완료 배지(brandStudioDeployedFormats)는 따로 저장돼 '완료'로 남았다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const src = fs.readFileSync(path.join(root, "prototype/js/ui/brand-studio.js"), "utf8").split("\r\n").join("\n");

test("배포 이력은 저장 줄에서 차례로, 최신 로컬 목록에 덧붙여 저장한다", () => {
  assert.match(src, /var _publishResultsQueue = Promise\.resolve\(\);/);
  const fn = src.slice(src.indexOf("function updatePublishRows(edit)"), src.indexOf("function removePublishedResult"));
  assert.ok(fn.length > 0, "updatePublishRows 를 찾지 못함");
  // 직전 저장이 끝난 뒤 실행하고, 실패해도 다음 저장을 막지 않는다.
  assert.match(fn, /var run = _publishResultsQueue\.then\(function \(\) \{/);
  assert.match(fn, /_publishResultsQueue = run\.catch\(function \(\) \{ \}\);/);
  // 렌더 스냅숏이 아니라 저장 때마다 갱신되는 로컬 캐시에서 읽는다.
  assert.match(fn, /NK\.service\.project\.getDraftById\(projectId\)/);
  assert.match(fn, /NK\.service\.brand\.getById\(brandId\)/);
  // 렌더 스코프 사본도 맞춰 둔다.
  assert.match(fn, /payload\.brandStudioPublishResults = nextProjectRows;/);
});

test("발행 기록 추가·완료 해제 모두 같은 저장 줄을 쓴다(옛 목록으로 직접 저장하지 않는다)", () => {
  const persist = src.slice(src.indexOf("function persistPublishedResult("), src.indexOf("function updatePublishRows(edit)"));
  assert.match(persist, /return updatePublishRows\(function \(rows\) \{ return appendPublishResult\(rows, record\); \}\);/);
  assert.doesNotMatch(persist, /syncBrandAndProject\(/);
  const remove = src.slice(src.indexOf("function removePublishedResult("), src.indexOf("function removePublishedResult(") + 900);
  assert.match(remove, /return updatePublishRows\(function \(rows\) \{/);
  assert.doesNotMatch(remove, /syncBrandAndProject\(/);
});
