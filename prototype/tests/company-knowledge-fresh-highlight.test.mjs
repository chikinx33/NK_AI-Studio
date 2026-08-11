import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const approvals = () => read("ai-company-app/src/components/Approvals.tsx");

test("신규 지식이 들어온 분류 칩만 강조한다", () => {
  const src = approvals();
  // 분류별 개수 스냅샷을 비교해 늘어난 분류만 찾는다(수정·정리는 강조 대상 아님)
  assert.match(src, /prevCountsRef = useRef<Record<KnowKey, number> \| null>\(null\)/);
  assert.match(src, /const grown = KNOW_KEYS\.filter\(\(k\) => counts\[k\] > prevCounts\[k\]\)/);
  // 첫 조회는 기준선만 기록 — 기존 지식이 새 것으로 보이면 안 된다
  assert.match(src, /if \(prevCounts\) \{/);
  // 강조는 칩에 링으로 표시
  assert.match(src, /const FRESH_RING = "ring-2 ring-white\/70 animate-pulse"/);
  assert.match(src, /fresh \? FRESH_RING : ""/);
  assert.match(src, /freshTypes\.has\("스킬"\) \? FRESH_RING : ""/);
});

test("다음 신규 지식이 추가되면 이전 강조는 교체되어 사라진다", () => {
  const src = approvals();
  // 누적(add)이 아니라 새 Set 으로 교체해야 이전 강조가 해제된다
  assert.match(src, /if \(grown\.length\) setFreshTypes\(new Set\(grown\)\)/);
});

test("다른 페이지로 이동하면 강조가 해제된다", () => {
  const src = approvals();
  assert.match(src, /centerView\?: string/);
  assert.match(src, /setFreshTypes\(\(prev\) => \(prev\.size \? new Set<KnowKey>\(\) : prev\)\);[\s\S]{0,40}\}, \[centerView\]\)/);
  // App 이 현재 화면을 내려줘야 위 해제가 동작한다
  assert.match(read("ai-company-app/src/App.tsx"), /<Approvals\s*\n\s*centerView=\{centerView\}/);
});

test("해당 분류 칩을 누르면 그 강조가 해제된다", () => {
  const src = approvals();
  assert.match(src, /function pickCategory\(key: KnowKey\) \{[\s\S]*next\.delete\(key\)[\s\S]*onPickCategory\?\.\(key\)/);
  // 칩 클릭 핸들러가 pickCategory 를 거쳐야 해제가 걸린다
  assert.match(src, /onClick=\{\(\) => pickCategory\(key\)\}/);
  assert.match(src, /onClick=\{\(\) => pickCategory\("스킬"\)\}/);
});
