// 서식 계산 엔진 검증 — docs/form_document_engine_design_v2_20260812.md §4 의 계산 순서가 SSOT.
// 금액이 갈라지면 DOCX·HWPX·XLSX·PDF 네 파일이 서로 다른 총액을 보여주게 되므로 여기서 붙잡는다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const agentDir = join(repoRoot, "prototype/functions/api/agent");
const { computeQuoteTotals, grandTotalKo, defaultQuoteTerms, getCalculator, buildQuoteView, formatKrw } =
  await import(pathToFileURL(join(agentDir, "_form-calc.ts")).href);
const { parseManifest, renderOutputName } = await import(pathToFileURL(join(agentDir, "_form-registry.ts")).href);
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

test("부가세 별도 — 소계·부가세·합계가 설계서 §4.1 그대로다", () => {
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
  assert.deepEqual(computeQuoteTotals({ ...BASE, items: [] }).missing, [{ field: "items", reason: "empty" }]);
});

test("항목이 서식의 행 수를 넘으면 overflow 로 잡아 조용히 자르지 않는다", () => {
  const many = Array.from({ length: 21 }, (_, i) => ({ name: `항목 ${i + 1}`, qty: 1, unitPrice: 1000 }));
  const { missing, totals } = computeQuoteTotals({ ...BASE, items: many }, { maxItemRows: 20 });
  assert.deepEqual(missing, [{ field: "items", reason: "overflow" }]);
  assert.equal(totals.grandTotal, null);
  // 행이 넉넉하면 통과한다
  assert.equal(computeQuoteTotals({ ...BASE, items: many }, { maxItemRows: 30 }).missing.length, 0);
});

test("소수 수량이어도 항목 금액은 정수 원", () => {
  const { totals } = computeQuoteTotals({ ...BASE, items: [{ name: "반일 촬영", qty: 0.5, unitPrice: 1234567 }] });
  assert.equal(totals.lineAmounts[0], 617284);
});

test("한글 금액 표기", () => {
  assert.equal(grandTotalKo(0), "금영원정");
  assert.equal(grandTotalKo(15), "금일십오원정");     // 금액 표기는 일을 생략하지 않는다
  assert.equal(grandTotalKo(10000), "금일만원정");
  assert.equal(grandTotalKo(1000000), "금일백만원정");
  assert.equal(grandTotalKo(3850000), "금삼백팔십오만원정");
  assert.equal(grandTotalKo(123456789), "금일억이천삼백사십오만육천칠백팔십구원정");
});

test("P0 는 원화 전용 — 다른 통화는 에러", () => {
  assert.throws(() => computeQuoteTotals({ ...BASE, currency: "USD", items: ITEMS }), /KRW/);
});

test("계산기는 이름으로 조회하고, 계산 없는 서식은 none 으로 동작한다", () => {
  const quoteCalc = getCalculator("quote-calc-v1");
  assert.equal(quoteCalc({ ...BASE, items: ITEMS }, { maxItemRows: 20 }).totals.grandTotal, 3850000);

  const none = getCalculator("none");
  assert.deepEqual(none({}, { maxItemRows: 20 }), { totals: null, missing: [] });

  assert.throws(() => getCalculator("있지도-않은-계산기"), /calculator/);
});

test("표시용 뷰 — 금액은 한 곳에서만 포맷되고 조건부 플래그가 함께 나온다", () => {
  const quote = { ...BASE, items: ITEMS, docNo: "Q-20260812-001", issuedAt: "2026-08-12", title: "견적서", terms: [] };
  const { totals, missing } = computeQuoteTotals(quote);
  const view = buildQuoteView({ ...quote, totals, missing });
  assert.equal(view["totals.grandTotal"], "3,850,000");     // 점 표기(템플릿용)
  assert.equal(view.totals.grandTotal, "3,850,000");        // 중첩 표기
  assert.equal(view["client.company"], "(주)고객사");
  assert.equal(view.items[0].amount, "3,000,000");
  assert.equal(view.hasDiscount, false);
  assert.equal(view.hasRoundingAdj, false);
  assert.equal(formatKrw(null), "—");
});

test("manifest 는 필수 키가 없으면 어떤 키인지 알려주며 거부한다", () => {
  const good = parseManifest(JSON.stringify({
    formId: "quote-standard", name: "견적서 (표준)", dataSchema: "quote/v1",
    calculator: "quote-calc-v1", templates: { docx: "template.docx", xlsx: null },
  }), "견적서-표준");
  assert.equal(good.formId, "quote-standard");
  assert.equal(good.maxItemRows, 20);        // 기본값
  assert.equal(good.pdfFrom, "docx");        // 기본값
  assert.equal(good.templates.xlsx, null);
  assert.equal(good.folder, "견적서-표준");

  assert.throws(
    () => parseManifest(JSON.stringify({ formId: "x", name: "y" }), "깨진서식"),
    /필수 항목이 없어요: dataSchema, calculator, templates/
  );
  assert.throws(() => parseManifest("{not json", "깨진서식"), /올바른 JSON/);
});

test("출력 파일 이름은 데이터로 채우고 경로 문자를 지운다", () => {
  const name = renderOutputName("견적서_{client.company}_{issuedAt}", {
    client: { company: "(주)고객사/파트너" }, issuedAt: "2026-08-12",
  });
  assert.equal(name, "견적서_(주)고객사파트너_2026-08-12");
});

test("서버가 모델의 totals·docNo·issuedAt·supplier 를 지우고 자기 값으로 덮어쓴다", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  const tool = shared.slice(shared.indexOf("export async function runFormFillTool"));
  assert.match(
    tool,
    /for \(const key of \["totals", "missing", "docNo", "issuedAt", "supplier"\]\) delete parsed/,
    "모델 출력의 서버 소유 키 삭제가 사라졌다"
  );
  assert.match(tool, /getCalculator\(manifest\.calculator\)/, "금액은 계산 엔진만 만든다");
  assert.doesNotMatch(tool.slice(0, tool.indexOf("getCalculator")), /\.\.\.parsed/,
    "모델 출력을 통째로 펼치면 서버 소유 키가 되살아난다");
});

test("missing 이 있으면 파일을 하나도 만들지 않고 되묻는다", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  const tool = shared.slice(shared.indexOf("export async function runFormFillTool"));
  const needsInput = tool.indexOf('status: "needs_input"');
  const firstRender = Math.min(
    ...["renderDocx(", "renderHwpx(", "saveCompanyBinary("].map((needle) => {
      const at = tool.indexOf(needle);
      return at === -1 ? Number.MAX_SAFE_INTEGER : at;
    })
  );
  assert.ok(needsInput > 0, "needs_input 반환이 없다");
  assert.ok(needsInput < firstRender, "렌더링보다 먼저 needs_input 으로 빠져나가야 한다");
  assert.match(tool.slice(needsInput - 400, needsInput), /missing\.length > 0/);
});

test("QUOTE_SYSTEM 은 단가 추정 금지와 totals 금지를 못 박는다", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  const system = shared.slice(shared.indexOf("const QUOTE_SYSTEM"), shared.indexOf("FORM_SYSTEM_PROMPTS"));
  assert.match(system, /모르면 반드시 null 로 둔다/);
  assert.match(system, /시세·경험·유사 사례로 추정하지 않는다/);
  assert.match(system, /totals, docNo, issuedAt, supplier 는 절대 쓰지 않는다/);
});

test("렌더러에 표현식 파서를 붙이지 않는다 (템플릿 주입 방지)", () => {
  const docx = read("prototype/functions/api/agent/_render-docx.ts");
  const code = docx.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /parser\s*:/);          // 커스텀 파서 주입 금지
  assert.doesNotMatch(code, /angularParser|expressions|new Function|eval\(/);
  assert.match(docx, /nullGetter/); // 값이 없을 때 "undefined" 가 찍히지 않게
});
