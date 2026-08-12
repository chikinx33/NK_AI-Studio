// HWPX 렌더러 검증 — 설계서 docs/form_document_engine_design_v2_20260812.md §6.2 · §10(#8,9,11).
// 한글이 실제로 저장하는 형태(글자를 여러 <hp:t> 로 쪼갠 run, rowCnt 를 가진 표)를 흉내 낸
// 템플릿을 만들어 돌린다. ★한컴오피스에서 열리는지는 사람이 확인해야 한다(설계서 §6.2.2 각주).
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const agentDir = join(repoRoot, "prototype/functions/api/agent");
const { unzipSync, zipSync, strFromU8, strToU8 } = await import(pathToFileURL(join(agentDir, "vendor/fflate.bundle.js")).href);
const { renderHwpx, mergeTextRuns, assertWellFormed } = await import(pathToFileURL(join(agentDir, "_render-hwpx.ts")).href);
const { computeQuoteTotals, buildQuoteView } = await import(pathToFileURL(join(agentDir, "_form-calc.ts")).href);

const MAX_ROWS = 20;

/** 한글은 서식 경계에서 글자를 쪼갠다 — 그 상황을 그대로 만든다. */
const splitRun = (text) => {
  const cut = Math.max(1, Math.floor(text.length / 2));
  return `<hp:run charPrIDRef="0"><hp:t>${text.slice(0, cut)}</hp:t><hp:t>${text.slice(cut)}</hp:t></hp:run>`;
};
const run = (text) => `<hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run>`;
const para = (inner) => `<hp:p paraPrIDRef="0">${inner}</hp:p>`;
const cell = (inner, col, row) =>
  `<hp:tc><hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:subList>${para(inner)}</hp:subList></hp:tc>`;
const tableRow = (cells, rowIndex) => `<hp:tr>${cells.map((inner, col) => cell(inner, col, rowIndex)).join("")}</hp:tr>`;

function buildTemplateHwpx({ dataRows = MAX_ROWS } = {}) {
  const header = tableRow([run("No"), run("품목"), run("수량"), run("단가"), run("금액")], 0);
  const rows = Array.from({ length: dataRows }, (_, i) =>
    tableRow(
      [run("{{item.no}}"), splitRun("{{item.name}}"), run("{{item.qty}}"), run("{{item.unitPrice}}"), run("{{item.amount}}")],
      i + 1
    )
  );
  const section = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
${para(splitRun("{{title}}"))}
${para(run("문서번호 {{docNo}} / 발행일 {{issuedAt}}"))}
${para(splitRun("{{client.company}} 귀중"))}
${para(run("공급자 {{supplier.name}}"))}
${para(run("합계금액 {{totals.grandTotalKo}} ({{totals.grandTotal}})"))}
<hp:tbl rowCnt="${dataRows + 1}" colCnt="5">${header}${rows.join("")}</hp:tbl>
${para(run("소계 {{totals.subtotal}} / 부가세 {{totals.vatAmount}} / 합계 {{totals.grandTotal}}"))}
</hs:sec>`;

  return zipSync({
    mimetype: [strToU8("application/hwp+zip"), { level: 0 }],
    "version.xml": strToU8('<?xml version="1.0" encoding="UTF-8"?><hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version"/>'),
    "Contents/content.hpf": strToU8('<?xml version="1.0" encoding="UTF-8"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf/"/>'),
    "Contents/section0.xml": strToU8(section),
  });
}

const QUOTE = {
  schema: "quote/v1",
  docNo: "Q-20260812-001",
  issuedAt: "2026-08-12",
  validUntil: "2026-09-11",
  title: "브랜드 영상 제작 견적서",
  supplier: { name: "NK 스튜디오" },
  client: { company: "(주)고객사 & 파트너스" }, // XML 이스케이프까지 함께 확인
  currency: "KRW",
  items: [
    { name: "메인 영상 기획·연출", qty: 1, unit: "식", unitPrice: 3000000 },
    { name: "편집·색보정", qty: 1, unit: "식", unitPrice: 500000 },
    { name: "성우 녹음", qty: 2, unit: "회", unitPrice: 150000 },
  ],
  discount: { type: "amount", value: 0 },
  vat: { mode: "exclusive", rate: 0.1 },
  rounding: { unit: 1, mode: "floor" },
  terms: [],
  notes: "",
};

function viewOf(overrides = {}) {
  const quote = { ...QUOTE, ...overrides };
  const { totals, missing } = computeQuoteTotals(quote, { maxItemRows: MAX_ROWS });
  quote.totals = totals;
  quote.missing = missing;
  return buildQuoteView(quote);
}

const sectionOf = (bytes) => strFromU8(unzipSync(bytes)["Contents/section0.xml"]);
const textOf = (xml) => (xml.match(/<hp:t[^>]*>[\s\S]*?<\/hp:t>/g) || []).map((n) => n.replace(/<[^>]+>/g, "")).join("\n");
const countRows = (xml) => (xml.match(/<hp:tr>/g) || []).length;

test("★쪼개진 <hp:t> 를 합친 뒤 치환한다 — 이 단계를 빼면 전부 실패한다", () => {
  const merged = mergeTextRuns('<hp:run><hp:t>{{client.</hp:t><hp:t>company}}</hp:t></hp:run>');
  assert.equal(merged, "<hp:run><hp:t>{{client.company}}</hp:t></hp:run>");

  // 다른 run 의 글자는 합치지 않는다.
  const twoRuns = '<hp:run><hp:t>가</hp:t></hp:run><hp:run><hp:t>나</hp:t></hp:run>';
  assert.equal(mergeTextRuns(twoRuns), twoRuns);
});

test("단순 필드가 채워지고 XML 특수문자는 이스케이프된다", () => {
  const xml = sectionOf(renderHwpx(buildTemplateHwpx(), viewOf(), { maxItemRows: MAX_ROWS }));
  const text = textOf(xml);
  assert.match(text, /브랜드 영상 제작 견적서/);
  assert.match(text, /Q-20260812-001/);
  assert.match(xml, /&amp; 파트너스/);                  // ★XML 이스케이프 — 안 하면 한글이 파일을 거부한다
  assert.doesNotMatch(xml.replace(/&amp;/g, ""), /&/);  // 이스케이프되지 않은 & 가 없어야 한다
  assert.match(text, /금사백일십팔만원정/);                // 3,800,000 + 부가세 380,000
});

test("항목 3개 → 남은 17행이 삭제되고 표가 4행(머리글+3)만 남는다", () => {
  const xml = sectionOf(renderHwpx(buildTemplateHwpx(), viewOf(), { maxItemRows: MAX_ROWS }));
  assert.equal(countRows(xml), 4);
  assert.match(xml, /rowCnt="4"/);
  const text = textOf(xml);
  assert.match(text, /메인 영상 기획·연출/);
  assert.match(text, /성우 녹음/);
  assert.match(text, /3,000,000/);
  assert.doesNotMatch(text, /\{\{/); // 빈 행이 남으면 여기서 걸린다
});

test("항목 21개 → 조용히 자르지 않고 에러로 멈춘다", () => {
  const many = Array.from({ length: 21 }, (_, i) => ({ name: `항목 ${i + 1}`, qty: 1, unit: "식", unitPrice: 1000 }));
  assert.throws(
    () => renderHwpx(buildTemplateHwpx(), viewOf({ items: many }), { maxItemRows: MAX_ROWS }),
    /행을 늘리거나 항목을 줄여/
  );
});

test("결과에 {{ 잔여가 0개 — 모르는 태그면 실패로 막는다", () => {
  const bytes = zipSync({
    mimetype: [strToU8("application/hwp+zip"), { level: 0 }],
    "Contents/section0.xml": strToU8(
      `<?xml version="1.0"?><hs:sec xmlns:hs="s" xmlns:hp="p">${para(run("{{알수없는.태그}}"))}</hs:sec>`
    ),
  });
  assert.throws(() => renderHwpx(bytes, viewOf(), { maxItemRows: MAX_ROWS }), /채워지지 않은 자리표시자/);
});

test("mimetype 은 압축하지 않고 맨 앞에 둔다 (한글이 못 여는 원인)", () => {
  const bytes = renderHwpx(buildTemplateHwpx(), viewOf(), { maxItemRows: MAX_ROWS });
  const head = strFromU8(bytes.slice(30, 38));
  assert.equal(head, "mimetype", "첫 엔트리가 mimetype 이 아니다");
  // 로컬 헤더의 압축 방식 필드(offset 8~9)가 0(STORED)이어야 한다.
  assert.equal(bytes[8], 0);
  assert.equal(bytes[9], 0);
  assert.equal(strFromU8(unzipSync(bytes).mimetype), "application/hwp+zip");
});

test("ZIP 무결성 — 원본 엔트리가 그대로 유지된다", () => {
  const template = buildTemplateHwpx();
  const before = Object.keys(unzipSync(template)).sort();
  const after = Object.keys(unzipSync(renderHwpx(template, viewOf(), { maxItemRows: MAX_ROWS }))).sort();
  assert.deepEqual(after, before);
});

test("XML 구조 검사기가 깨진 태그를 잡는다", () => {
  assert.throws(() => assertWellFormed("<a><b></a>", "section0.xml"), /XML 구조가 깨졌어요/);
  assert.throws(() => assertWellFormed("<a><b/>", "section0.xml"), /닫히지 않았습니다/);
  assert.doesNotThrow(() => assertWellFormed('<?xml version="1.0"?><a x="1"><b/><c>글</c></a>', "section0.xml"));
});

test("표가 없는 서식(계산 없는 문서)도 그대로 렌더된다", () => {
  const bytes = zipSync({
    mimetype: [strToU8("application/hwp+zip"), { level: 0 }],
    "Contents/section0.xml": strToU8(
      `<?xml version="1.0"?><hs:sec xmlns:hs="s" xmlns:hp="p">${para(splitRun("{{title}}"))}</hs:sec>`
    ),
  });
  const xml = sectionOf(renderHwpx(bytes, viewOf(), { maxItemRows: MAX_ROWS }));
  assert.match(textOf(xml), /브랜드 영상 제작 견적서/);
});
