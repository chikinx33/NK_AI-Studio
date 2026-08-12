// 견적서 계산 엔진 검증 — docs/quote_document_engine_design_20260812.md §3 의 계산 순서가 SSOT.
// 금액이 갈라지면 PDF·엑셀·채팅 미리보기가 서로 다른 총액을 보여주게 되므로 여기서 붙잡는다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const mathPath = join(repoRoot, "prototype/functions/api/agent/_quote-math.ts");
const { computeQuoteTotals, grandTotalKo, defaultQuoteTerms } = await import(pathToFileURL(mathPath).href);
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

const BASE = {
  currency: "KRW",
  supplier: { name: "NK 스튜디오" },
  client: { company: "(주)고객사" },
  discount: { type: "amount", value: 0 },
  vat: { mode: "exclusive", rate: 0.1 },
  rounding: { unit: 1, mode: "floor" },
};
const ITEMS = [
  { name: "메인 영상 기획·연출", qty: 1, unitPrice: 3000000 },
  { name: "편집·색보정", qty: 1, unitPrice: 500000 },
];

test("부가세 별도 — 소계·부가세·합계가 설계서 §3.1 그대로다", () => {
  const { totals, missing } = computeQuoteTotals({ ...BASE, items: ITEMS });
  assert.equal(missing.length, 0);
  assert.deepEqual(totals.lineAmounts, [3000000, 500000]);
  assert.equal(totals.subtotal, 3500000);
  assert.equal(totals.taxBase, 3500000);
  assert.equal(totals.supplyAmount, 3500000);
  assert.equal(totals.vatAmount, 350000);
  assert.equal(totals.grandTotal, 3850000);
  assert.equal(totals.grandTotalKo, "금삼백팔십오만원정");
  assert.equal(totals.roundingAdj, 0);
});

test("부가세 포함 — 공급가액 + 부가세 = 사용자가 말한 총액", () => {
  const { totals } = computeQuoteTotals({
    ...BASE,
    vat: { mode: "inclusive", rate: 0.1 },
    items: [{ name: "제작 패키지", qty: 1, unitPrice: 3300000 }],
  });
  assert.equal(totals.supplyAmount, 3000000);
  assert.equal(totals.vatAmount, 300000);
  assert.equal(totals.grandTotal, 3300000);
  assert.equal(totals.supplyAmount + totals.vatAmount, totals.grandTotal);
});

test("면세 — 부가세 0이고 거래조건 2번이 면세 문구로 바뀐다", () => {
  const { totals } = computeQuoteTotals({ ...BASE, vat: { mode: "exempt", rate: 0.1 }, items: ITEMS });
  assert.equal(totals.vatAmount, 0);
  assert.equal(totals.grandTotal, 3500000);
  assert.equal(defaultQuoteTerms("exempt")[1], "상기 거래는 면세 대상 거래입니다.");
  assert.equal(defaultQuoteTerms("inclusive")[1], "상기 금액은 부가가치세 포함 금액입니다.");
  assert.equal(defaultQuoteTerms("exclusive")[1], "상기 금액은 부가가치세 별도 금액입니다.");
});

test("할인 — percent 는 소계 기준이고 0 ≤ 할인 ≤ 소계 로 잘린다", () => {
  const percent = computeQuoteTotals({ ...BASE, discount: { type: "percent", value: 10 }, items: ITEMS }).totals;
  assert.equal(percent.discountAmount, 350000);
  assert.equal(percent.taxBase, 3150000);
  assert.equal(percent.grandTotal, 3465000);

  const overflow = computeQuoteTotals({ ...BASE, discount: { type: "amount", value: 99999999 }, items: ITEMS }).totals;
  assert.equal(overflow.discountAmount, 3500000);
  assert.equal(overflow.grandTotal, 0);
});

test("원단위 절사(unit=1000) — 단수조정이 음수로 남아 문서에 보인다", () => {
  const { totals } = computeQuoteTotals({
    ...BASE,
    rounding: { unit: 1000, mode: "floor" },
    items: [{ name: "촬영", qty: 3, unitPrice: 1234567 }],
  });
  assert.equal(totals.grandTotal, 4074000);
  assert.equal(totals.roundingAdj, 4074000 - (3703701 + 370370));
  assert.ok(totals.roundingAdj < 0);
});

test("단가·수량이 비면 총액을 만들지 않고 어디가 비었는지 모아 돌려준다", () => {
  const { totals, missing } = computeQuoteTotals({
    ...BASE,
    items: [
      { name: "기획", qty: 1, unitPrice: null },
      { name: "", qty: null, unitPrice: 500000 },
    ],
  });
  assert.equal(totals.grandTotal, null);
  assert.equal(totals.grandTotalKo, null);
  assert.deepEqual(totals.lineAmounts, [null, null]);
  assert.deepEqual(missing, [
    { index: 0, field: "unitPrice" },
    { index: 1, field: "name" },
    { index: 1, field: "qty" },
  ]);
});

test("고객사·공급자·항목이 비어도 missing 으로 잡힌다", () => {
  const parties = computeQuoteTotals({ ...BASE, supplier: { name: "" }, client: { company: "" }, items: ITEMS }).missing;
  assert.deepEqual(parties, [{ field: "client.company" }, { field: "supplier.name" }]);
  assert.deepEqual(computeQuoteTotals({ ...BASE, items: [] }).missing, [{ field: "items" }]);
});

test("소수 수량이어도 항목 금액은 정수 원", () => {
  const { totals } = computeQuoteTotals({ ...BASE, items: [{ name: "반일 촬영", qty: 0.5, unitPrice: 1234567 }] });
  assert.equal(totals.lineAmounts[0], 617284);
});

test("한글 금액 표기", () => {
  assert.equal(grandTotalKo(0), "금영원정");
  assert.equal(grandTotalKo(15), "금십오원정");
  assert.equal(grandTotalKo(10000), "금일만원정");
  assert.equal(grandTotalKo(1000000), "금백만원정");
  assert.equal(grandTotalKo(3850000), "금삼백팔십오만원정");
  assert.equal(grandTotalKo(123456789), "금일억이천삼백사십오만육천칠백팔십구원정");
});

test("P0 는 원화 전용 — 다른 통화는 에러", () => {
  assert.throws(() => computeQuoteTotals({ ...BASE, currency: "USD", items: ITEMS }), /KRW/);
});

test("서버가 모델의 totals·docNo·issuedAt·supplier 를 지우고 자기 값으로 덮어쓴다", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  const quoteTool = shared.slice(shared.indexOf("export async function runQuoteTool"));
  assert.match(
    quoteTool,
    /for \(const key of \["totals", "missing", "docNo", "issuedAt", "supplier"\]\) delete parsed/,
    "모델 출력의 서버 소유 키 삭제가 사라졌다"
  );
  assert.match(quoteTool, /computeQuoteTotals\(quote\)/, "금액은 계산 엔진만 만든다");
  assert.doesNotMatch(quoteTool.slice(0, quoteTool.indexOf("computeQuoteTotals(quote)")), /\.\.\.parsed/,
    "모델 출력을 통째로 펼치면 서버 소유 키가 되살아난다");
});

test("QUOTE_SYSTEM 은 단가 추정 금지와 totals 금지를 못 박는다", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  const system = shared.slice(shared.indexOf("const QUOTE_SYSTEM"), shared.indexOf("async function loadQuoteSupplier"));
  assert.match(system, /모르면 반드시 null 로 둔다/);
  assert.match(system, /시세·경험·유사 사례로 추정하지 않는다/);
  assert.match(system, /totals, docNo, issuedAt 은 절대 쓰지 않는다/);
});
