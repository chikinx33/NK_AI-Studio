import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

/**
 * ★회귀: "배경 레퍼런스 + 컷 기반 생성" 조합이 실제로는 성립하지 않았다.
 *
 * 레퍼런스 상한은 우리가 정한 예산인데(모델 하드리밋이 아니다) 4장이었고, 컷 레퍼런스는
 * 항상 맨 뒤에 붙었다. 캐릭터가 한 명이면 그 시트가 4장을 채우고, 세 명이면 각자 한 장씩만
 * 넣어도 배경·컷이 들어갈 자리가 없었다. 서버도 앞에서 4장만 취하므로 뒤에 붙은
 * 컷 레퍼런스가 조용히 잘려 나갔다.
 *
 * 이제 ① 상한을 6으로 올리고 ② 넘칠 때 무엇을 남길지 우선순위로 정한다:
 *   각 캐릭터의 첫 시트 → 컷 레퍼런스 → 배경 플레이트 → 소품 → 캐릭터 추가 포즈
 */

function clientCap() {
  const src = read("prototype/ui/pipeline-image.js");
  const m = src.match(/var MAX_REFERENCE_IMAGES = (\d+);/);
  assert.ok(m, "클라이언트 상한 상수가 있어야 한다");
  return Number(m[1]);
}

function loadApplyReferenceBudget() {
  const src = read("prototype/ui/pipeline-image.js");
  const start = src.indexOf("  function applyReferenceBudget(list) {");
  assert.ok(start > -1, "applyReferenceBudget 가 있어야 한다");
  const tail = "\n  }\n";
  const end = src.indexOf(tail, start) + tail.length;
  const body = src.slice(start, end);
  // 상한은 실제 소스 값을 그대로 쓴다(하드코딩하면 상한을 바꿔도 테스트가 눈치채지 못한다).
  return new Function(`
    var MAX_REFERENCE_IMAGES = ${clientCap()};
    ${body}
    return applyReferenceBudget;
  `)();
}

const char = (id, sheet) => ({ referenceId: id, tag: "char" + id + "-" + sheet });
const plate = () => ({ referenceId: 90, referenceKind: "environment", tag: "plate" });
const cut = () => ({ referenceId: 80, referenceKind: "continuity", tag: "cut" });
const prop = () => ({ referenceId: 70, referenceKind: "prop", tag: "prop" });
const tags = (list) => list.map((r) => r.tag);
const sheetsFor = (id, n) => Array.from({ length: n }, (_, i) => char(id, i + 1));

test("★캐릭터 3명 + 컷 레퍼런스 + 배경이 한 컷에 모두 들어간다", () => {
  const budget = loadApplyReferenceBudget();
  // 예전 상한(4)에서는 캐릭터 3명만 돼도 배경이나 컷이 밀려났다.
  const kept = budget([char(1, 1), char(2, 1), char(3, 1), plate(), cut(), prop()]);

  assert.ok(tags(kept).includes("plate"), "배경 플레이트는 밀려나면 안 된다");
  assert.ok(tags(kept).includes("cut"), "사용자가 고른 컷 레퍼런스도 남아야 한다");
  ["char1-1", "char2-1", "char3-1"].forEach((t) => {
    assert.ok(tags(kept).includes(t), t + " 첫 시트는 반드시 남는다");
  });
});

test("★캐릭터 한 명이어도 배경 플레이트와 컷 레퍼런스가 살아남는다", () => {
  const budget = loadApplyReferenceBudget();
  const cap = clientCap();
  // 놀이터 컷2: 캐릭터 시트가 상한을 채운 상태 + 놀이터 플레이트 + 컷1(그네)
  const kept = budget(sheetsFor(1, cap).concat([plate(), cut()]));

  assert.equal(kept.length, cap);
  assert.ok(tags(kept).includes("cut"), "사용자가 직접 고른 컷 레퍼런스가 잘리면 안 된다");
  assert.ok(tags(kept).includes("plate"), "등록한 배경 플레이트도 남아야 한다");
  assert.ok(tags(kept).includes("char1-1"), "캐릭터 첫 시트는 반드시 남는다");
  // 버려지는 것은 캐릭터의 추가 포즈다.
  assert.ok(!tags(kept).includes("char1-" + cap));
});

test("★캐릭터가 여럿이면 각자의 첫 시트를 먼저 지킨다", () => {
  const budget = loadApplyReferenceBudget();
  const kept = budget(sheetsFor(1, 3).concat(sheetsFor(2, 3), [plate(), cut()]));

  assert.equal(kept.length, clientCap());
  ["char1-1", "char2-1", "plate", "cut"].forEach((t) => {
    assert.ok(tags(kept).includes(t), t + " 이 남아야 한다");
  });
});

test("★컷 레퍼런스가 없으면 그 자리를 배경·소품이 쓴다", () => {
  const budget = loadApplyReferenceBudget();
  const cap = clientCap();
  const kept = budget(sheetsFor(1, cap).concat([plate(), prop()]));

  assert.equal(kept.length, cap);
  assert.ok(tags(kept).includes("plate"));
  assert.ok(tags(kept).includes("prop"));
});

test("★상한 이하면 아무것도 버리지 않는다", () => {
  const budget = loadApplyReferenceBudget();
  const input = [char(1, 1), plate(), cut()];
  assert.deepEqual(tags(budget(input)), tags(input));
});

test("★붙이는 순서는 원래대로 유지된다 (이미지 옆 라벨 순서)", () => {
  const budget = loadApplyReferenceBudget();
  const kept = budget(sheetsFor(1, clientCap()).concat([plate(), cut()]));
  const order = tags(kept);
  assert.ok(order.indexOf("char1-1") < order.indexOf("plate"));
  assert.ok(order.indexOf("plate") < order.indexOf("cut"));
});

test("★클라이언트와 서버의 레퍼런스 상한이 같다", () => {
  // 서버가 더 작으면 뒤쪽(컷 레퍼런스)이 조용히 잘려 나간다 — 바로 이 버그의 원인이었다.
  const server = read("prototype/functions/api/imagen.ts");
  const m = server.match(/const MAX_REFERENCE_IMAGES = (\d+);/);
  assert.ok(m, "서버 상한 상수가 있어야 한다");
  assert.equal(Number(m[1]), clientCap());
  assert.match(server, /args\.items\.slice\(0, MAX_REFERENCE_IMAGES\)/);
});

test("★한 캐릭터가 슬롯을 전부 가져가지 않는다", () => {
  const src = read("prototype/ui/pipeline-image.js");
  const m = src.match(/var MAX_SHEETS_PER_CHARACTER = (\d+);/);
  assert.ok(m, "캐릭터별 시트 상한 상수가 있어야 한다");
  assert.ok(Number(m[1]) < clientCap(), "한 명이 상한 전부를 먹으면 배경·컷 자리가 없다");
  // 캐릭터 시트 수 계산이 전체 상한이 아니라 이 값을 쓴다.
  assert.doesNotMatch(src, /refsPerCharacter = \w+\.length <= 1 \? MAX_REFERENCE_IMAGES/);
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
