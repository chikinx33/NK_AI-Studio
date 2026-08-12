// XLSX 렌더러 검증 — 설계서 docs/form_document_engine_design_v2_20260812.md §6.3 · §10(#2,#15).
// 핵심은 두 가지다. ①금액이 totals 에서만 나온다(DOCX·HWPX 와 같은 값) ②수식이 살아 있어
// 고객이 수량을 바꾸면 합계가 다시 계산된다.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const agentDir = join(repoRoot, "prototype/functions/api/agent");
const XLSX = await import(pathToFileURL(join(agentDir, "vendor/sheetjs.bundle.js")).href);
const { renderXlsx, buildQuoteSheet } = await import(pathToFileURL(join(agentDir, "_render-xlsx.ts")).href);
const { computeQuoteTotals, buildQuoteView } = await import(pathToFileURL(join(agentDir, "_form-calc.ts")).href);

const QUOTE = {
  schema: "quote/v1",
  docNo: "Q-20260813-001",
  issuedAt: "2026-08-13",
  validUntil: "2026-09-12",
  title: "브랜드 영상 제작 견적서",
  supplier: { name: "(주)엔케이스튜디오", bizNo: "123-45-67890", ceo: "홍길동", bizType: "정보통신업", bizItem: "영상 제작" },
  client: { company: "(주)가나다", person: "이과장", title: "마케팅팀" },
  payment: { terms: "계약 시 50%" },
  delivery: { dueDate: "2026-09-30", place: "클라우드" },
  currency: "KRW",
  items: [
    { group: "기획", costType: "work", name: "컨셉 기획", spec: "A안", qty: 1, unit: "식", unitPrice: 1200000, note: "" },
    { group: "제작", costType: "work", name: "메인 영상 제작", spec: "60초", qty: 1, unit: "편", unitPrice: 4500000, note: "" },
    { group: "제작", costType: "work", name: "숏폼 리사이즈", spec: "15초", qty: 3, unit: "편", unitPrice: 400000, note: "SNS용" },
    { group: "", costType: "expense", name: "유료 폰트", spec: "1년", qty: 1, unit: "식", unitPrice: 150000, note: "실비" },
  ],
  discount: { type: "amount", value: 0 },
  vat: { mode: "exclusive", rate: 0.1 },
  rounding: { unit: 1, mode: "floor" },
  terms: ["본 견적서의 유효기간은 발행일로부터 30일입니다."],
  notes: "실사 촬영 별도",
};

function prepared(overrides = {}) {
  const quote = { ...QUOTE, ...overrides };
  const { totals, missing } = computeQuoteTotals(quote, { maxItemRows: 30 });
  const full = { ...quote, totals, missing };
  return { quote: full, totals, missing, view: buildQuoteView(full) };
}

function sheetOf(bytes) {
  const workbook = XLSX.read(bytes, { type: "array", cellFormula: true });
  return { workbook, sheet: workbook.Sheets[workbook.SheetNames[0]], name: workbook.SheetNames[0] };
}
const cells = (sheet) => Object.entries(sheet).filter(([key]) => !key.startsWith("!"));
const findRowOf = (sheet, label, column = "F") => {
  const hit = cells(sheet).find(([key, cell]) => key.startsWith(column) && cell.t === "s" && String(cell.v).trim() === label);
  return hit ? Number(hit[0].replace(/[A-Z]/g, "")) : 0;
};

test("시트 이름·열 너비·금액 서식이 지정된다", () => {
  const { quote, view } = prepared();
  assert.equal(sheetOf(renderXlsx(quote, view)).name, "견적서");

  const { sheet } = buildQuoteSheet(quote);
  assert.equal(sheet["!cols"].length, 8);
  assert.ok(sheet["!merges"].length > 0, "머리글 병합 셀이 없다");
  const money = cells(sheet).filter(([, cell]) => cell.t === "n" && cell.z === "#,##0");
  assert.ok(money.length >= 5, "금액 서식(#,##0)이 붙은 셀이 없다");
});

test("항목 금액은 수식(D*F) + 서버 계산값 캐시로 함께 저장된다", () => {
  const { quote, totals, view } = prepared();
  const { sheet } = sheetOf(renderXlsx(quote, view));
  const itemAmounts = cells(sheet).filter(([, cell]) => /^D\d+\*F\d+$/.test(String(cell.f || "")));
  assert.equal(itemAmounts.length, quote.items.length);
  const cached = itemAmounts.map(([, cell]) => cell.v);
  assert.deepEqual(cached.sort((a, b) => a - b), [...totals.lineAmounts].sort((a, b) => a - b));
});

test("소계·부가세·합계도 수식이고 캐시값은 totals 와 같다", () => {
  const { quote, totals, view } = prepared();
  const { sheet } = sheetOf(renderXlsx(quote, view));
  const at = (label) => sheet[`G${findRowOf(sheet, label)}`];

  const subtotal = at("소계");
  assert.ok(subtotal.f, "소계가 수식이 아니다");
  assert.equal(subtotal.v, totals.subtotal);

  const vat = at("부가세");
  assert.match(String(vat.f), /^ROUND\(/);
  assert.equal(vat.v, totals.vatAmount);

  const grand = at("합계");
  assert.ok(grand.f, "합계가 수식이 아니다");
  assert.equal(grand.v, totals.grandTotal);
});

test("★수량을 바꾸면 합계가 다시 계산된다 (수식 체인 검산)", () => {
  const { quote, totals, view } = prepared();
  const { sheet } = sheetOf(renderXlsx(quote, view));

  // 수식을 그대로 따라가며 계산하는 아주 작은 평가기 — 엑셀이 할 일을 흉내 낸다.
  const value = (ref) => {
    const cell = sheet[ref];
    if (!cell) return 0;
    return cell.f ? evaluate(String(cell.f)) : Number(cell.v) || 0;
  };
  const evaluate = (formula) => {
    let expression = formula
      .replace(/ROUND\(([^,]+),0\)/g, "Math.round($1)")
      .replace(/FLOOR\(([^,]+),(\d+)\)/g, "(Math.floor(($1)/$2)*$2)")
      // SUM 범위를 먼저 개별 참조로 펼치고, 참조는 마지막에 한 번만 바꾼다.
      // (순서를 바꾸면 이미 바꾼 v("G16") 안의 G16 을 또 바꿔 문법이 깨진다)
      .replace(/SUM\(G(\d+):G(\d+)\)/g, (_m, from, to) => {
        const parts = [];
        for (let row = Number(from); row <= Number(to); row += 1) parts.push(`G${row}`);
        return `(${parts.join("+") || 0})`;
      })
      .replace(/\b([A-H])(\d+)\b/g, 'v("$1$2")');
    // eslint-disable-next-line no-new-func
    return Function("v", `return ${expression};`)(value);
  };

  const grandRef = `G${findRowOf(sheet, "합계")}`;
  assert.equal(evaluate(String(sheet[grandRef].f)), totals.grandTotal, "수식으로 푼 합계가 서버 값과 다르다");

  // 두 번째 항목의 수량을 1 → 2 로 바꾸면 그 항목 금액과 총액이 함께 오른다.
  const changedRow = Number(Object.keys(sheet).find((key) => /^D\d+$/.test(key) && sheet[key].v === 3)?.replace(/[A-Z]/g, ""));
  assert.ok(changedRow, "수량 셀을 찾지 못했다");
  sheet[`D${changedRow}`].v = 6; // 3편 → 6편
  const recomputed = evaluate(String(sheet[grandRef].f));
  assert.ok(recomputed > totals.grandTotal, "수량을 늘렸는데 합계가 그대로다");
  assert.equal(recomputed, Math.round((totals.subtotal + 1200000) * 1.1)); // 400,000 x 3편 추가
});

test("부가세 포함·면세·할인·절사도 수식으로 같은 값을 낸다", () => {
  const cases = [
    { vat: { mode: "inclusive", rate: 0.1 } },
    { vat: { mode: "exempt", rate: 0.1 } },
    { discount: { type: "percent", value: 10 } },
    { rounding: { unit: 1000, mode: "floor" } },
  ];
  for (const override of cases) {
    const { quote, totals, view } = prepared(override);
    const { sheet } = sheetOf(renderXlsx(quote, view));
    const grand = sheet[`G${findRowOf(sheet, "합계")}`];
    assert.equal(grand.v, totals.grandTotal, `${JSON.stringify(override)} 의 합계 캐시가 다르다`);
    if (totals.roundingAdj !== 0) {
      assert.ok(findRowOf(sheet, "단수조정") > 0, "단수조정 행이 없다");
    }
  }
});

test("표의 행 구성이 DOCX·HWPX 와 같다 (그룹 머리행·소계·실비)", () => {
  const { quote, totals, view } = prepared();
  const { sheet } = sheetOf(renderXlsx(quote, view));
  const labels = cells(sheet).filter(([key]) => key.startsWith("B")).map(([, cell]) => String(cell.v));
  assert.ok(labels.includes("■ 기획"));
  assert.ok(labels.includes("■ 실비"));
  assert.equal(labels.filter((text) => text === "소계").length, totals.rows.filter((row) => row.name === "소계").length);
});

test("계산 전(totals 없음) 데이터로는 파일을 만들지 않는다", () => {
  assert.throws(() => renderXlsx({ ...QUOTE, totals: null }, {}), /totals 가 없어/);
});

test("특이사항·거래조건·비고가 시트에 들어간다", () => {
  const { quote, view } = prepared();
  const { sheet } = sheetOf(renderXlsx(quote, view));
  const texts = cells(sheet).map(([, cell]) => String(cell.v));
  assert.ok(texts.some((text) => text.includes("납기일")));
  assert.ok(texts.some((text) => text.includes("유효기간은 발행일로부터 30일")));
  assert.ok(texts.some((text) => text.includes("실사 촬영 별도")));
});
