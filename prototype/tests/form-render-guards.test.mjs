// 렌더러 자체 방어 검증 — 설계서 docs/form_document_engine_design_v2_20260812.md §6.
// 위쪽(runFormFillTool)이 이미 막지만 그건 방어선 하나다. 렌더러를 직접 부르는 코드가
// 언젠가 생겨도 반쯤 빈 문서가 나가지 않아야 한다.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const agentDir = join(repoRoot, "prototype/functions/api/agent");
const { unzipSync, strFromU8 } = await import(pathToFileURL(join(agentDir, "vendor/fflate.bundle.js")).href);
const { PizZip } = await import(pathToFileURL(join(agentDir, "vendor/docxtemplater-pizzip.bundle.js")).href);
const { renderDocx } = await import(pathToFileURL(join(agentDir, "_render-docx.ts")).href);
const { renderHwpx } = await import(pathToFileURL(join(agentDir, "_render-hwpx.ts")).href);
const { renderXlsx } = await import(pathToFileURL(join(agentDir, "_render-xlsx.ts")).href);
const { computeQuoteTotals, buildQuoteView, assertRenderable } =
  await import(pathToFileURL(join(agentDir, "_form-calc.ts")).href);
const { parseManifest } = await import(pathToFileURL(join(agentDir, "_form-registry.ts")).href);

const zipPath = join(repoRoot, "docs/forms/견적서_표준서식_v3_20260812.zip");
const bundle = existsSync(zipPath) ? unzipSync(new Uint8Array(readFileSync(zipPath))) : null;
const entry = (suffix) => {
  if (!bundle) return null;
  const name = Object.keys(bundle).find((key) => key.endsWith(suffix));
  return name ? bundle[name] : null;
};
const docxTemplate = entry("quote-standard/template.docx");
const hwpxTemplate = entry("quote-standard/template.hwpx");
const manifestBytes = entry("quote-standard/manifest.json");
const skip = !docxTemplate || !hwpxTemplate || !manifestBytes ? "표준 서식 zip 이 없어 건너뜁니다" : false;
const manifest = manifestBytes ? parseManifest(strFromU8(manifestBytes), "견적서-표준") : null;

const BASE = {
  schema: "quote/v1",
  docNo: "Q-20260813-001",
  issuedAt: "2026-08-13",
  validUntil: "2026-09-12",
  title: "브랜드 영상 제작 견적서",
  // 스키마의 키를 모두 채운다(빈 문자열이라도) — runFormFillTool 이 만드는 모양과 같다.
  // 서식에 있는 태그의 값이 아예 '없는' 것과 '비어 있는' 것을 렌더러가 구분하기 때문이다.
  supplier: {
    name: "(주)엔케이스튜디오", bizNo: "123-45-67890", ceo: "홍길동", bizType: "정보통신업",
    bizItem: "영상 제작", address: "서울", tel: "02-000-0000", fax: "", email: "a@b.c",
    manager: "", managerTel: "", stampUrl: "",
  },
  client: { company: "(주)가나다", person: "", title: "", tel: "", email: "", address: "" },
  payment: {},
  delivery: {},
  currency: "KRW",
  items: [{ group: "", costType: "work", name: "메인 영상 제작", spec: "60초", qty: 1, unit: "편", unitPrice: 4500000, note: "" }],
  discount: { type: "amount", value: 0 },
  vat: { mode: "exclusive", rate: 0.1 },
  rounding: { unit: 1, mode: "floor" },
  terms: ["본 견적서의 유효기간은 발행일로부터 30일입니다."],
  notes: "",
};

function prepared(overrides = {}) {
  const quote = { ...BASE, ...overrides };
  const { totals, missing } = computeQuoteTotals(quote, { maxItemRows: manifest?.maxItemRows || 30 });
  const full = { ...quote, totals, missing };
  return { quote: full, missing, view: buildQuoteView(full) };
}

// ── ① 단가가 비면 렌더러 3종이 전부 거절한다 ────────────────────────────────

const INCOMPLETE = { items: [{ group: "", costType: "work", name: "메인 영상 제작", qty: 1, unit: "편", unitPrice: null, note: "" }] };

test("★단가가 null 이면 DOCX 렌더러가 스스로 거절한다", { skip }, () => {
  const { quote, missing } = prepared(INCOMPLETE);
  assert.ok(missing.length > 0, "테스트 전제가 깨졌다 — missing 이 비었다");
  assert.throws(() => renderDocx(docxTemplate, buildQuoteView(quote)), /단가.*비어 있어요/);
});

test("★단가가 null 이면 HWPX 렌더러가 스스로 거절한다", { skip }, () => {
  const { quote } = prepared(INCOMPLETE);
  assert.throws(
    () => renderHwpx(hwpxTemplate, buildQuoteView(quote), { repeaters: manifest.repeaters }),
    /단가.*비어 있어요/
  );
});

test("★단가가 null 이면 XLSX 렌더러가 스스로 거절한다", () => {
  const { quote, view } = prepared(INCOMPLETE);
  assert.throws(() => renderXlsx(quote, view, null), /단가.*비어 있어요/);
});

test("PDF 경로도 변환을 시작하기 전에 거절한다", () => {
  const shared = readFileSync(join(repoRoot, "prototype/functions/api/agent/_shared.ts"), "utf8");
  const convert = shared.slice(shared.indexOf("async function convertDocxToPdf"));
  assert.match(convert.slice(0, 400), /assertRenderable\(source, "PDF"\)/);
  // 호출부가 실제 데이터를 넘겨야 검사가 의미 있다
  assert.match(shared, /convertDocxToPdf\(ctx\.env, source, sourceFormat, data\)/);
});

test("어떤 필드가 비었는지 사람 말로 알려준다", () => {
  assert.throws(
    () => assertRenderable({ missing: [{ index: 1, field: "unitPrice" }, { field: "client.company" }] }, "DOCX"),
    /단가\(2번 항목\), 고객사 이름/
  );
  // 행 넘침은 '비어 있음'이 아니라 '너무 많음' — 다른 안내를 준다
  assert.throws(
    () => assertRenderable({ missing: [{ field: "items", reason: "overflow" }] }, "HWPX"),
    /행을 늘리거나 항목을 줄여/
  );
  assert.doesNotThrow(() => assertRenderable({ missing: [] }, "DOCX"));
  assert.doesNotThrow(() => assertRenderable(undefined, "DOCX"));
});

// ── ② 배열이 빈 반복 표는 표째 사라진다 ─────────────────────────────────────

test("★거래 조건이 없으면 빈 표를 남기지 않는다 (한컴이 파일을 거부한다 — 실측 확인)", { skip }, () => {
  // 근거: docs/forms/한컴확인용_빈표케이스.hwpx (rowCnt="0" 표가 든 옛 결과물)를 한컴에서 열면
  // 오류가 난다. 사용자가 직접 확인했다. 같은 데이터의 수정본(…_빈표케이스_v2.hwpx)은 정상.
  const { quote, missing } = prepared({ terms: [], validUntil: "" });
  assert.equal(missing.length, 0, "이 케이스는 결손 없이 렌더돼야 한다");

  const files = unzipSync(renderHwpx(hwpxTemplate, buildQuoteView(quote), { repeaters: manifest.repeaters }));
  const name = Object.keys(files).find((key) => /section\d*\.xml$/.test(key));
  const xml = strFromU8(files[name]);
  const tables = xml.match(/<hp:tbl[\s\S]*?<\/hp:tbl>/g) || [];

  assert.doesNotMatch(xml, /rowCnt="0"/, "rowCnt=0 인 표가 남았다");
  assert.equal(tables.filter((table) => !/<hp:tr[ >]/.test(table)).length, 0, "행이 하나도 없는 표가 남았다");

  // 표가 통째로 사라졌는지 — 템플릿보다 <hp:tbl> 이 줄어야 한다
  const templateXml = strFromU8(unzipSync(hwpxTemplate)[name]);
  const count = (text) => (text.match(/<hp:tbl[\s\S]/g) || []).length;
  assert.equal(count(xml), count(templateXml) - 1, "머리행 없는 빈 표(거래조건) 하나만 사라져야 한다");

  // 남은 표들은 rowCnt 와 실제 행 수가 맞는다
  for (const table of tables) {
    const declared = table.match(/rowCnt="(\d+)"/);
    if (!declared) continue;
    assert.equal(Number(declared[1]), (table.match(/<hp:tr[ >]/g) || []).length);
  }
});

test("머리행이 있는 표(특이사항)는 데이터가 비어도 남는다", { skip }, () => {
  // 머리행은 반복 행이 아니라 지워지지 않는다 → 표가 사라지는 경로를 타지 않는다.
  const { quote } = prepared({ payment: {}, delivery: {}, validUntil: "", terms: [] });
  const files = unzipSync(renderHwpx(hwpxTemplate, buildQuoteView(quote), { repeaters: manifest.repeaters }));
  const name = Object.keys(files).find((key) => /section\d*\.xml$/.test(key));
  const xml = strFromU8(files[name]);
  assert.match(xml, /특 이 사 항|특이사항/, "머리행만 남은 특이사항 표가 사라졌다");
  assert.doesNotMatch(xml, /rowCnt="0"/);
});

test("DOCX 는 루프가 0회면 행이 알아서 사라진다 (별도 조치 불필요)", { skip }, () => {
  const { quote } = prepared({ terms: [], validUntil: "" });
  const bytes = renderDocx(docxTemplate, buildQuoteView(quote));
  const xml = new PizZip(bytes).file("word/document.xml").asText();
  const text = (xml.match(/<w:t[^>]*>[\s\S]*?<\/w:t>/g) || []).map((n) => n.replace(/<[^>]+>/g, "")).join("\n");
  assert.doesNotMatch(text, /\{/, "미치환 태그가 남았다");
  assert.doesNotMatch(text, /유효기간/, "빈 거래조건 행이 남았다");
  assert.match(text, /메인 영상 제작/);
});
