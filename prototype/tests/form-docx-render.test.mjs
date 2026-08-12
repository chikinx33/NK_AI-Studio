// DOCX 렌더러 검증 — 설계서 docs/form_document_engine_design_v2_20260812.md §6.1 · §10(#11).
// 진짜 .docx(ZIP+XML)를 즉석에서 만들어 렌더링까지 돌린다. 번들한 docxtemplater 가
// Workers 런타임(브라우저 계열 API만 있는 환경)에서 동작하는지도 여기서 함께 걸린다.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const agentDir = join(repoRoot, "prototype/functions/api/agent");
const { PizZip } = await import(pathToFileURL(join(agentDir, "vendor/docxtemplater-pizzip.bundle.js")).href);
const { renderDocx, assertNoLeftoverTags } = await import(pathToFileURL(join(agentDir, "_render-docx.ts")).href);
const { computeQuoteTotals, buildQuoteView } = await import(pathToFileURL(join(agentDir, "_form-calc.ts")).href);

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const para = (text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = (text) => `<w:tc><w:tcPr/>${para(text)}</w:tc>`;
const row = (cells) => `<w:tr>${cells.map(cell).join("")}</w:tr>`;

/** 설계서 §9.1 의 규칙대로 태그를 심은 최소 견적서 템플릿을 만든다. */
function buildTemplateDocx() {
  const body = [
    para("{title}"),
    para("문서번호 {docNo} / 발행일 {issuedAt}"),
    para("{client.company} 귀중 · 담당 {client.person} {client.title}"),
    para("공급자 {supplier.name} ({supplier.bizNo})"),
    para("합계금액 {totals.grandTotalKo} (₩{totals.grandTotal})"),
    `<w:tbl>${row(["No", "품목", "규격", "수량", "단위", "단가", "금액"])}` +
      row(["{#items}{no}", "{name}", "{spec}", "{qty}", "{unit}", "{unitPrice}", "{amount}{/items}"]) +
      `</w:tbl>`,
    para("소계 {totals.subtotal}"),
    para("{#hasDiscount}할인 {totals.discountAmount}{/hasDiscount}"),
    para("부가세({vat.modeLabel}) {totals.vatAmount}"),
    para("{#hasRoundingAdj}단수조정 {totals.roundingAdj}{/hasRoundingAdj}"),
    para("합계 {totals.grandTotal}"),
    para("{#terms}{.}{/terms}"),
  ].join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;

  const zip = new PizZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", RELS);
  zip.file("word/document.xml", document);
  return zip.generate({ type: "uint8array" });
}

function docxText(bytes) {
  const xml = new PizZip(bytes).file("word/document.xml").asText();
  return (xml.match(/<w:t[^>]*>[\s\S]*?<\/w:t>/g) || []).map((n) => n.replace(/<[^>]+>/g, "")).join("\n");
}

const QUOTE = {
  schema: "quote/v1",
  docNo: "Q-20260812-001",
  issuedAt: "2026-08-12",
  validUntil: "2026-09-11",
  title: "브랜드 영상 제작 견적서",
  supplier: { name: "NK 스튜디오", bizNo: "123-45-67890" },
  client: { company: "(주)고객사", person: "홍길동", title: "부장" },
  currency: "KRW",
  items: [
    { name: "메인 영상 기획·연출", spec: "60초 / 1편", qty: 1, unit: "식", unitPrice: 3000000 },
    { name: "편집·색보정", spec: "", qty: 1, unit: "식", unitPrice: 500000 },
  ],
  discount: { type: "amount", value: 0 },
  vat: { mode: "exclusive", rate: 0.1 },
  rounding: { unit: 1, mode: "floor" },
  terms: ["본 견적서의 유효기간은 발행일로부터 30일입니다.", "상기 금액은 부가가치세 별도 금액입니다."],
  notes: "",
};

function renderQuote(overrides = {}) {
  const quote = { ...QUOTE, ...overrides };
  const { totals, missing } = computeQuoteTotals(quote, { maxItemRows: 20 });
  quote.totals = totals;
  quote.missing = missing;
  return { quote, bytes: renderDocx(buildTemplateDocx(), buildQuoteView(quote)) };
}

test("템플릿의 단순 태그와 항목 표가 값으로 채워진다", () => {
  const { bytes } = renderQuote();
  const text = docxText(bytes);
  assert.match(text, /브랜드 영상 제작 견적서/);
  assert.match(text, /Q-20260812-001/);
  assert.match(text, /\(주\)고객사/);
  assert.match(text, /메인 영상 기획·연출/);
  assert.match(text, /편집·색보정/);
  assert.match(text, /3,000,000/);
  assert.match(text, /금삼백팔십오만원정/);
  assert.match(text, /3,850,000/);
});

test("항목 수만큼 표 행이 생긴다 (행 수 제한 없음)", () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ name: `항목 ${i + 1}`, qty: 1, unit: "식", unitPrice: 1000 }));
  const { bytes } = renderQuote({ items: many });
  const rowCount = (new PizZip(bytes).file("word/document.xml").asText().match(/<w:tr>/g) || []).length;
  assert.equal(rowCount, 26); // 머리글 1 + 데이터 25
});

test("조건부 블록 — 할인 0원이면 할인 행이 안 나오고, 단수조정도 0이면 숨는다", () => {
  const plain = docxText(renderQuote().bytes);
  assert.doesNotMatch(plain, /할인/);
  assert.doesNotMatch(plain, /단수조정/);

  const { bytes } = renderQuote({
    items: [{ name: "촬영", qty: 3, unit: "일", unitPrice: 1234567 }],
    discount: { type: "percent", value: 10 },
    rounding: { unit: 1000, mode: "floor" },
  });
  const text = docxText(bytes);
  assert.match(text, /할인 370,370/);      // 3,703,701 의 10%
  assert.match(text, /단수조정 -664/);     // 3,666,664 → 3,666,000 절사분
});

test("거래 조건 목록이 줄마다 렌더된다", () => {
  const text = docxText(renderQuote().bytes);
  assert.match(text, /유효기간은 발행일로부터 30일/);
  assert.match(text, /부가가치세 별도 금액입니다/);
});

test("미치환 태그가 남으면 실패로 막는다", () => {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", RELS);
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${para("{client.company}")}</w:body></w:document>`
  );
  assert.throws(() => assertNoLeftoverTags(zip.generate({ type: "uint8array" })), /채워지지 않은 태그/);
});

test("템플릿이 .docx 가 아니면 사람이 읽을 수 있는 오류", () => {
  assert.throws(() => renderDocx(new Uint8Array([1, 2, 3, 4]), {}), /DOCX 템플릿을 열지 못했어요/);
});

test("번들한 라이브러리가 Workers 에서 못 쓰는 코드를 담고 있지 않다", async () => {
  const { readFileSync } = await import("node:fs");
  const bundle = readFileSync(join(agentDir, "vendor/docxtemplater-pizzip.bundle.js"), "utf8");
  assert.doesNotMatch(bundle, /\beval\(/, "Workers 는 eval 을 금지한다");
  assert.doesNotMatch(bundle, /require\("fs"\)|require\("path"\)|process\.binding/, "Node 전용 API 가 섞였다");
  // 유료 모듈(xlsx·image·html·chart)은 쓰지 않는다 — MIT 코어만.
  assert.doesNotMatch(bundle, /docxtemplater\/(xlsx|image|html|chart)-module/);
});

test("깨진 태그(짝이 맞지 않는 루프)는 어떤 태그가 문제인지 알려준다", () => {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", RELS);
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${para("{#items}{name}")}</w:body></w:document>`
  );
  assert.throws(() => renderDocx(zip.generate({ type: "uint8array" }), { items: [] }), /DOCX/);
});
