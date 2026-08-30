import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

/**
 * ★회귀: "배경 레퍼런스 + 컷 기반 생성" 조합이 실제로는 성립하지 않았다.
 *
 * 레퍼런스는 컷당 4장이 상한이고 서버는 앞에서 4장만 취한다. 그런데 컷 레퍼런스는
 * 항상 맨 뒤에 붙었다. 캐릭터가 한 명이면 그 캐릭터 시트가 4장을 채우므로,
 * 사용자가 직접 고른 컷 레퍼런스(예: 그네가 있는 컷1)가 조용히 잘려 나갔다.
 * 배경 플레이트까지 붙으면 더 확실히 잘렸다.
 *
 * 이제 무엇을 남길지 우선순위로 정한다:
 *   각 캐릭터의 첫 시트 → 컷 레퍼런스 → 배경 플레이트 → 소품 → 캐릭터 추가 포즈
 */

function loadApplyReferenceBudget() {
  const src = read("prototype/ui/pipeline-image.js");
  const start = src.indexOf("  function applyReferenceBudget(list) {");
  assert.ok(start > -1, "applyReferenceBudget 가 있어야 한다");
  const end = src.indexOf("\n  }\n", start) + "\n  }\n".length;
  const body = src.slice(start, end);
  return new Function(`
    var MAX_REFERENCE_IMAGES = 4;
    ${body}
    return applyReferenceBudget;
  `)();
}

const char = (id, sheet) => ({ referenceId: id, tag: "char" + id + "-" + sheet });
const plate = () => ({ referenceId: 9, referenceKind: "environment", tag: "plate" });
const cut = () => ({ referenceId: 8, referenceKind: "continuity", tag: "cut" });
const prop = () => ({ referenceId: 7, referenceKind: "prop", tag: "prop" });
const tags = (list) => list.map((r) => r.tag);

test("★캐릭터 한 명이어도 배경 플레이트와 컷 레퍼런스가 살아남는다", () => {
  const budget = loadApplyReferenceBudget();
  // 놀이터 컷2: 캐릭터 시트 4장 + 놀이터 플레이트 + 컷1(그네)
  const kept = budget([char(1, 1), char(1, 2), char(1, 3), plate(), cut()]);

  assert.equal(kept.length, 4);
  assert.ok(tags(kept).includes("cut"), "사용자가 직접 고른 컷 레퍼런스가 잘리면 안 된다");
  assert.ok(tags(kept).includes("plate"), "등록한 배경 플레이트도 남아야 한다");
  assert.ok(tags(kept).includes("char1-1"), "캐릭터 첫 시트는 반드시 남는다");
  // 버려지는 것은 캐릭터의 추가 포즈다.
  assert.deepEqual(tags(kept), ["char1-1", "char1-2", "plate", "cut"]);
});

test("★캐릭터가 여럿이면 각자의 첫 시트를 먼저 지킨다", () => {
  const budget = loadApplyReferenceBudget();
  const kept = budget([char(1, 1), char(1, 2), char(2, 1), char(2, 2), plate(), cut()]);

  assert.equal(kept.length, 4);
  assert.deepEqual(tags(kept), ["char1-1", "char2-1", "plate", "cut"]);
});

test("★컷 레퍼런스가 없으면 그 자리를 배경·소품이 쓴다", () => {
  const budget = loadApplyReferenceBudget();
  const kept = budget([char(1, 1), char(1, 2), char(1, 3), char(1, 4), plate(), prop()]);

  assert.equal(kept.length, 4);
  assert.ok(tags(kept).includes("plate"));
  assert.ok(tags(kept).includes("prop"));
  assert.deepEqual(tags(kept), ["char1-1", "char1-2", "plate", "prop"]);
});

test("★4장 이하면 아무것도 버리지 않는다", () => {
  const budget = loadApplyReferenceBudget();
  const input = [char(1, 1), plate(), cut()];
  assert.deepEqual(tags(budget(input)), tags(input));
});

test("★붙이는 순서는 원래대로 유지된다 (이미지 옆 라벨 순서)", () => {
  const budget = loadApplyReferenceBudget();
  const kept = budget([char(1, 1), char(1, 2), char(1, 3), plate(), cut()]);
  const order = tags(kept);
  assert.ok(order.indexOf("char1-1") < order.indexOf("plate"));
  assert.ok(order.indexOf("plate") < order.indexOf("cut"));
});

test("★생성 직전에 예산이 실제로 적용된다", () => {
  const src = read("prototype/ui/pipeline-image.js");
  const call = src.slice(
    src.indexOf("var budgetedRefs = applyReferenceBudget(referencePayload.referenceImages);"),
    src.indexOf("console.log('Image prompt (scene ")
  );
  assert.ok(call, "이미지 생성 직전에 예산을 적용해야 한다");
  assert.match(call, /referenceImages: budgetedRefs/);
  // 컷 레퍼런스를 붙인 뒤에 적용돼야 의미가 있다.
  const cutRefAt = src.indexOf("cutRefImageObj.referenceId = baseRefs.length + 1;");
  const budgetAt = src.indexOf("var budgetedRefs = applyReferenceBudget(");
  assert.ok(cutRefAt > -1 && budgetAt > cutRefAt, "컷 레퍼런스 첨부 이후에 예산을 적용해야 한다");
});
