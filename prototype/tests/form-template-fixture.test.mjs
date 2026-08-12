// 실제 표준 서식(_서식/견적서-표준)으로 끝까지 렌더 — docs/forms/견적서_표준서식_20260812.zip.
// 합성 템플릿은 우리가 만든 규칙만 확인한다. 이 테스트는 사람이 한글·워드로 만든 진짜 서식이
// 우리 렌더러로 채워지는지, 그리고 DOCX·HWPX 의 금액이 같은지를 본다(설계서 §10 #2·#8·#11).
//
// ※ 서식 zip 이 없으면 통째로 건너뛴다(자산은 회사 파일 GCS 에 두는 것이 본래 자리).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const agentDir = join(repoRoot, "prototype/functions/api/agent");
const zipPath = join(repoRoot, "docs/forms/견적서_표준서식_20260812.zip");

const { unzipSync, strFromU8 } = await import(pathToFileURL(join(agentDir, "vendor/fflate.bundle.js")).href);
const { PizZip } = await import(pathToFileURL(join(agentDir, "vendor/docxtemplater-pizzip.bundle.js")).href);
const { renderDocx } = await import(pathToFileURL(join(agentDir, "_render-docx.ts")).href);
const { renderHwpx } = await import(pathToFileURL(join(agentDir, "_render-hwpx.ts")).href);
const { renderXlsx } = await import(pathToFileURL(join(agentDir, "_render-xlsx.ts")).href);
const XLSX = await import(pathToFileURL(join(agentDir, "vendor/sheetjs.bundle.js")).href);
const { computeQuoteTotals, buildQuoteView } = await import(pathToFileURL(join(agentDir, "_form-calc.ts")).href);
const { parseManifest } = await import(pathToFileURL(join(agentDir, "_form-registry.ts")).href);

const bundle = existsSync(zipPath) ? unzipSync(new Uint8Array(readFileSync(zipPath))) : null;
const entry = (suffix) => {
  if (!bundle) return null;
  const name = Object.keys(bundle).find((key) => key.endsWith(suffix));
  return name ? bundle[name] : null;
};

const manifestBytes = entry("quote-standard/manifest.json");
const docxTemplate = entry("quote-standard/template.docx");
const hwpxTemplate = entry("quote-standard/template.hwpx");
const skip = !manifestBytes || !docxTemplate || !hwpxTemplate
  ? "표준 서식 zip(docs/forms/…)이 없어 건너뜁니다"
  : false;

const manifest = manifestBytes ? parseManifest(strFromU8(manifestBytes), "견적서-표준") : null;

const QUOTE = {
  schema: "quote/v1",
  docNo: "Q-20260812-001",
  issuedAt: "2026-08-12",
  validUntil: "2026-09-11",
  title: "브랜드 영상 제작 견적서",
  supplier: {
    name: "(주)엔케이스튜디오", bizNo: "123-45-67890", ceo: "홍길동",
    bizType: "정보통신업", bizItem: "영상 콘텐츠 제작",
    address: "서울특별시 강남구 테헤란로 000", tel: "02-000-0000", fax: "02-000-0001",
    email: "contact@example.com", manager: "김담당", managerTel: "010-0000-0000",
    payment: { bank: "국민은행", accountHolder: "(주)엔케이스튜디오", accountNo: "123456-01-234567" },
  },
  client: {
    company: "(주)가나다", person: "이과장", title: "마케팅팀",
    tel: "02-111-2222", email: "buyer@example.com", address: "서울시 마포구 ○○로 11",
  },
  payment: { terms: "계약 시 50%, 납품 완료 후 7일 이내 50%" },
  delivery: { dueDate: "2026-09-30", place: "발주처 지정 클라우드 스토리지" },
  currency: "KRW",
  items: [
    { group: "기획", costType: "work", name: "컨셉 기획 및 스토리보드", spec: "A안·B안", qty: 1, unit: "식", unitPrice: 1200000, note: "" },
    { group: "기획", costType: "work", name: "시나리오 작성", spec: "60초", qty: 1, unit: "식", unitPrice: 800000, note: "" },
    { group: "제작", costType: "work", name: "메인 영상 제작", spec: "60초 / 4K", qty: 1, unit: "편", unitPrice: 4500000, note: "" },
    { group: "제작", costType: "work", name: "숏폼 리사이즈", spec: "9:16 / 15초", qty: 3, unit: "편", unitPrice: 400000, note: "SNS용" },
    { group: "수정", costType: "work", name: "수정 (2회 포함)", spec: "회차당", qty: 2, unit: "회", unitPrice: 300000, note: "3회차부터 별도" },
    { group: "", costType: "expense", name: "유료 폰트 라이선스", spec: "1년", qty: 1, unit: "식", unitPrice: 150000, note: "실비" },
    { group: "", costType: "expense", name: "스톡 영상 소스", spec: "5컷", qty: 5, unit: "컷", unitPrice: 60000, note: "실비" },
  ],
  discount: { type: "percent", value: 5, label: "" },
  vat: { mode: "exclusive", rate: 0.1 },
  rounding: { unit: 1000, mode: "floor" },
  terms: [
    "본 견적서의 유효기간은 발행일로부터 30일입니다.",
    "상기 금액은 부가가치세 별도 금액입니다.",
    "대금 지급 조건은 계약 체결 시 50%, 납품 완료 시 50%입니다.",
    "작업 범위 변경 시 별도 협의 후 견적을 재산정합니다.",
    "본 견적에 명시되지 않은 항목은 포함되지 않습니다.",
  ],
  notes: "촬영 실사 촬영은 본 견적에 포함되지 않습니다.",
};

function prepared(overrides = {}) {
  const quote = { ...QUOTE, ...overrides };
  const { totals, missing } = computeQuoteTotals(quote, { maxItemRows: manifest?.maxItemRows || 30 });
  return { quote: { ...quote, totals, missing }, totals, missing };
}

const docxText = (bytes) =>
  (new PizZip(bytes).file("word/document.xml").asText().match(/<w:t[^>]*>[\s\S]*?<\/w:t>/g) || [])
    .map((n) => n.replace(/<[^>]+>/g, "")).join("\n");
const hwpxSection = (bytes) => {
  const files = unzipSync(bytes);
  const name = Object.keys(files).find((key) => /section\d*\.xml$/.test(key));
  return strFromU8(files[name]);
};
const hwpxText = (xml) =>
  (xml.match(/<hp:t[^>]*>[\s\S]*?<\/hp:t>/g) || []).map((n) => n.replace(/<[^>]+>/g, "")).join("\n");

test("manifest 가 repeaters 와 행 상한을 읽어 온다", { skip }, () => {
  assert.equal(manifest.formId, "quote-standard");
  assert.equal(manifest.calculator, "quote-calc-v1");
  assert.equal(manifest.repeaters.row.source, "totals.rows");
  assert.equal(manifest.repeaters.row.maxRows, 30);
  assert.equal(manifest.maxItemRows, 30); // repeaters.row.maxRows 에서 유도
  assert.equal(manifest.templates.xlsx, null);
});

test("계산 결과가 서식 제작자가 만든 샘플 값과 일치한다", { skip }, () => {
  const { totals, missing } = prepared();
  assert.equal(missing.length, 0);
  assert.equal(totals.subtotal, 8750000);
  assert.equal(totals.discountAmount, 437500);
  assert.equal(totals.taxBase, 8312500);
  assert.equal(totals.vatAmount, 831250);
  assert.equal(totals.roundingAdj, -750);
  assert.equal(totals.grandTotal, 9143000);
  assert.equal(totals.workAmount, 8300000);
  assert.equal(totals.expenseAmount, 450000);
  assert.deepEqual(totals.groupSubtotals, [
    { group: "기획", amount: 2000000 },
    { group: "제작", amount: 5700000 },
    { group: "수정", amount: 600000 },
  ]);
  // 구간 머리행 3 + 항목 7 + 소계 3 + 실비 머리행 1 + 실비 소계 1 = 15행
  assert.equal(totals.rows.length, 15);
  assert.equal(totals.rows[0].name, "■ 기획");
  assert.equal(totals.rows[3].name, "소계");
  assert.equal(totals.rows[3].amount, "2,000,000");
  assert.equal(totals.rows[11].name, "■ 실비");
  assert.deepEqual(totals.summaryRows.map((row) => row.label), ["소계", "할인", "부가세", "단수조정", "합계"]);
  assert.equal(totals.summaryRows[1].amount, "-437,500");
  assert.deepEqual(totals.infoRows.map((row) => row.label), ["유효기간", "납기일", "납품장소", "결제조건", "입금계좌"]);
  assert.equal(totals.infoRows[4].value, "국민은행 123456-01-234567 (예금주 (주)엔케이스튜디오)");
  assert.equal(totals.termRows.length, 5);
});

test("실제 DOCX 서식이 끝까지 채워진다 (미치환 태그 0개)", { skip }, () => {
  const { quote } = prepared();
  const text = docxText(renderDocx(docxTemplate, buildQuoteView(quote)));
  assert.match(text, /브랜드 영상 제작 견적서/);
  assert.match(text, /Q-20260812-001/);
  assert.match(text, /\(주\)가나다/);
  assert.match(text, /정보통신업/);            // supplier.bizType
  assert.match(text, /■ 기획/);
  assert.match(text, /■ 실비/);
  assert.match(text, /9,143,000/);
  assert.match(text, /금구백일십사만삼천원정/);
  assert.match(text, /단수조정/);
  assert.match(text, /입금계좌/);
  assert.match(text, /촬영 실사 촬영은 본 견적에 포함되지 않습니다/);
});

test("실제 HWPX 서식이 끝까지 채워지고 남는 행이 삭제된다", { skip }, () => {
  const { quote, totals } = prepared();
  const xml = hwpxSection(renderHwpx(hwpxTemplate, buildQuoteView(quote), { repeaters: manifest.repeaters }));
  const text = hwpxText(xml);
  assert.doesNotMatch(text, /\{\{/);            // §10 #11
  assert.match(text, /\(주\)가나다/);
  assert.match(text, /■ 제작/);
  assert.match(text, /9,143,000/);
  assert.match(text, /금구백일십사만삼천원정/);

  // 항목 표: 머리글 1 + 데이터 15행 = 16 (템플릿의 31행에서 15행이 지워짐)
  const rowCounts = (xml.match(/rowCnt="(\d+)"/g) || []).map((m) => Number(m.match(/\d+/)[0]));
  assert.ok(rowCounts.includes(totals.rows.length + 1), `표 행 수가 ${totals.rows.length + 1} 이어야 하는데 ${rowCounts}`);
  assert.ok(!rowCounts.includes(31), "미사용 행이 남아 있다");
});

test("DOCX·HWPX·XLSX 의 합계가 전부 같다 (§10 #2)", { skip }, () => {
  const { quote, totals } = prepared();
  const view = buildQuoteView(quote);
  const inDocx = docxText(renderDocx(docxTemplate, view));
  const inHwpx = hwpxText(hwpxSection(renderHwpx(hwpxTemplate, view, { repeaters: manifest.repeaters })));
  const grand = totals.grandTotal.toLocaleString("ko-KR");
  assert.ok(inDocx.includes(grand) && inHwpx.includes(grand), "두 포맷의 합계가 다르다");
  assert.ok(inDocx.includes(totals.grandTotalKo) && inHwpx.includes(totals.grandTotalKo));

  // XLSX 는 숫자 셀이라 캐시값으로 비교한다(수식은 엑셀이 다시 계산한다).
  const workbook = XLSX.read(renderXlsx(quote, view, null), { type: "array", cellFormula: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const totalCell = Object.entries(sheet).find(
    ([key, cell]) => key.startsWith("F") && cell.t === "s" && String(cell.v).trim() === "합계"
  );
  assert.ok(totalCell, "XLSX 에 합계 행이 없다");
  const amount = sheet[`G${totalCell[0].replace(/[A-Z]/g, "")}`];
  assert.equal(amount.v, totals.grandTotal, "XLSX 합계가 다른 포맷과 다르다");
  assert.ok(amount.f, "XLSX 합계가 수식이 아니다");
});

test("부가세 포함·면세도 실제 서식에서 렌더된다", { skip }, () => {
  for (const mode of ["inclusive", "exempt"]) {
    const { quote, totals } = prepared({ vat: { mode, rate: 0.1 } });
    const view = buildQuoteView(quote);
    assert.doesNotThrow(() => renderDocx(docxTemplate, view), `${mode} DOCX`);
    const xml = hwpxSection(renderHwpx(hwpxTemplate, view, { repeaters: manifest.repeaters }));
    assert.doesNotMatch(hwpxText(xml), /\{\{/, `${mode} HWPX 에 미치환 태그`);
    assert.ok(totals.summaryRows.length <= manifest.repeaters.sum.maxRows, "합계 행이 서식 행 수를 넘는다");
  }
});

test("항목이 서식 행 수를 넘으면 파일을 만들지 않는다 (§10 #9)", { skip }, () => {
  const many = Array.from({ length: 31 }, (_, i) => ({
    group: "", costType: "work", name: `항목 ${i + 1}`, qty: 1, unit: "식", unitPrice: 1000, note: "",
  }));
  const { missing } = prepared({ items: many });
  assert.deepEqual(missing, [{ field: "items", reason: "overflow" }]);

  // 계산 단계를 건너뛰어도 렌더러가 한 번 더 막는다(이중 방어).
  const { quote } = prepared({ items: many });
  assert.throws(
    () => renderHwpx(hwpxTemplate, buildQuoteView(quote), { repeaters: manifest.repeaters }),
    /행을 늘리거나 항목을 줄여/
  );
});
