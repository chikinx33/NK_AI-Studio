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
 * 지금은 프로바이더 공식 상한(OpenAI gpt-image-2 16장 / Gemini 3.1 Flash Image 14장)을
 * 확인해 그 최대치까지 열어 두고, 넘칠 때 무엇을 남길지 우선순위로 정한다:
 *   각 캐릭터의 첫 시트 → 컷 레퍼런스 → 배경 플레이트 → 소품 → 캐릭터 추가 포즈
 */

function constOf(name) {
  const src = read("prototype/ui/pipeline-image.js");
  const m = src.match(new RegExp("var " + name + " = (\\d+);"));
  assert.ok(m, name + " 상수가 있어야 한다");
  return Number(m[1]);
}

const clientCap = () => constOf("MAX_REFERENCE_IMAGES");
const charCap = () => constOf("MAX_CHARACTER_REFERENCES");

function loadApplyReferenceBudget() {
  const src = read("prototype/ui/pipeline-image.js");
  const start = src.indexOf("  function applyReferenceBudget(list) {");
  assert.ok(start > -1, "applyReferenceBudget 가 있어야 한다");
  const tail = "\n  }\n";
  const end = src.indexOf(tail, start) + tail.length;
  const body = src.slice(start, end);
  // 상수는 실제 소스 값을 그대로 쓴다(하드코딩하면 값을 바꿔도 테스트가 눈치채지 못한다).
  return new Function(`
    var MAX_REFERENCE_IMAGES = ${clientCap()};
    var MAX_CHARACTER_REFERENCES = ${charCap()};
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
const charCount = (kept) => tags(kept).filter((t) => t.startsWith("char")).length;

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
  // 놀이터 컷2: 캐릭터 시트가 예산을 채운 상태 + 놀이터 플레이트 + 컷1(그네)
  const kept = budget(sheetsFor(1, clientCap()).concat([plate(), cut()]));

  assert.ok(tags(kept).includes("cut"), "사용자가 직접 고른 컷 레퍼런스가 잘리면 안 된다");
  assert.ok(tags(kept).includes("plate"), "등록한 배경 플레이트도 남아야 한다");
  assert.ok(tags(kept).includes("char1-1"), "캐릭터 첫 시트는 반드시 남는다");
  assert.ok(kept.length <= clientCap());
  // 버려지는 것은 캐릭터의 추가 포즈다.
  assert.ok(!tags(kept).includes("char1-" + clientCap()));
});

test("★캐릭터가 여럿이면 각자의 첫 시트를 먼저 지킨다", () => {
  const budget = loadApplyReferenceBudget();
  const kept = budget(sheetsFor(1, 3).concat(sheetsFor(2, 3), [plate(), cut()]));

  assert.ok(kept.length <= clientCap());
  ["char1-1", "char2-1", "plate", "cut"].forEach((t) => {
    assert.ok(tags(kept).includes(t), t + " 이 남아야 한다");
  });
});

test("★컷 레퍼런스가 없으면 그 자리를 배경·소품이 쓴다", () => {
  const budget = loadApplyReferenceBudget();
  const kept = budget(sheetsFor(1, clientCap()).concat([plate(), prop()]));

  assert.ok(kept.length <= clientCap());
  assert.ok(tags(kept).includes("plate"));
  assert.ok(tags(kept).includes("prop"));
});

test("★예산 이하면 아무것도 버리지 않는다", () => {
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

test("★캐릭터 레퍼런스 상한은 막지 않되 배경·컷 자리는 지킨다", () => {
  // Gemini 문서는 캐릭터 일관성용으로 4장까지를 권하지만, 상한을 코드로 막지는 않는다
  // (권장치는 이미지 모델 안내 모달에 적어 사용자가 판단한다).
  const budget = loadApplyReferenceBudget();
  const kept = budget(sheetsFor(1, 6).concat([plate(), cut()]));
  assert.ok(charCount(kept) <= charCap());
  // 캐릭터를 아무리 많이 붙여도 배경·컷은 남는다.
  assert.ok(tags(kept).includes("plate"));
  assert.ok(tags(kept).includes("cut"));
});

test("★캐릭터가 권장치보다 많아도 아무도 빠뜨리지 않는다", () => {
  // 인물이 5명 나오는 컷이면 각자의 첫 시트는 모두 넣는다(빠지면 그 인물이 안 그려진다).
  const budget = loadApplyReferenceBudget();
  const kept = budget([char(1, 1), char(2, 1), char(3, 1), char(4, 1), char(5, 1), plate()]);
  [1, 2, 3, 4, 5].forEach((i) => {
    assert.ok(tags(kept).includes("char" + i + "-1"), i + "번 캐릭터가 빠지면 안 된다");
  });
});

test("★서버 안전망이 클라이언트 예산보다 작지 않다", () => {
  // 서버가 더 작게 자르면 뒤쪽(컷 레퍼런스)이 조용히 사라진다 — 이 버그의 원인이었다.
  const server = read("prototype/functions/api/imagen.ts");
  const m = server.match(/const MAX_REFERENCE_IMAGES = (\d+);/);
  assert.ok(m, "서버 상한 상수가 있어야 한다");
  assert.ok(Number(m[1]) >= clientCap(), "서버가 클라이언트 예산보다 작게 자르면 안 된다");
  assert.match(server, /args\.items\.slice\(0, MAX_REFERENCE_IMAGES\)/);
});

test("★프로바이더 공식 상한을 넘지 않는다", () => {
  // OpenAI gpt-image-2 /v1/images/edits 는 16장, Gemini 3.1 Flash Image 는 14장.
  // 받아들이는 상한은 큰 쪽(16)에 맞추고, Gemini 로 호출할 때만 14장으로 줄인다.
  const server = read("prototype/functions/api/imagen.ts");
  assert.ok(Number(server.match(/const MAX_REFERENCE_IMAGES = (\d+);/)[1]) <= 16);
  assert.ok(clientCap() <= 16);
  assert.equal(Number(server.match(/const GEMINI_MAX_REFERENCE_IMAGES = (\d+);/)[1]), 14);
  // 확인한 근거를 코드에 남겨 둔다(다음 사람이 다시 추측하지 않도록).
  assert.match(server, /OpenAI gpt-image-2/);
  assert.match(server, /Gemini 3\.1 Flash Image/);
});

test("★Gemini 로 폴백할 때 뒤쪽 레퍼런스부터 줄여 보낸다", () => {
  const server = read("prototype/functions/api/imagen.ts");
  // 호출 직전에 줄여야 OpenAI → Gemini 폴백에서도 안전하다.
  assert.match(server, /const geminiRefs = referenceImages\.length > GEMINI_MAX_REFERENCE_IMAGES/);
  assert.match(server, /referenceImages\.slice\(0, GEMINI_MAX_REFERENCE_IMAGES\)/);
  // 잘렸으면 프롬프트도 그 목록으로 다시 만든다(없는 이미지를 가리키지 않게).
  assert.match(server, /const geminiPrompt = geminiRefs === referenceImages/);
  assert.match(server, /buildGeminiContents\(\s*conversationHistory,\s*geminiRefs,\s*geminiPrompt,/);
});

test("★한 캐릭터가 슬롯을 전부 가져가지 않는다", () => {
  const src = read("prototype/ui/pipeline-image.js");
  assert.ok(constOf("MAX_SHEETS_PER_CHARACTER") < clientCap(), "한 명이 예산 전부를 먹으면 안 된다");
  // 캐릭터 시트 수 계산이 전체 예산이 아니라 이 값을 쓴다.
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
