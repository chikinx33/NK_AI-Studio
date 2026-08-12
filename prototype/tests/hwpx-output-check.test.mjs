// 생성된 HWPX 자체 검사 — docs/forms/견적서_표준서식_v3_20260812.zip 의 check_hwpx.py 를
// 우리 결과물에 대해 자동으로 돌리는 판(JS 이식). 파이썬 검사기는 '템플릿'을 보고, 이 테스트는
// '렌더 결과'를 본다. 둘 다 있어야 서식 교체와 렌더 버그를 각각 잡을 수 있다.
//
// 파이썬 검사기의 5번(반복 행 수)은 템플릿 전용이라 옮기지 않았다 — 렌더가 끝난 파일에는
// 자리표시자가 0개인 게 정상이기 때문이다.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const agentDir = join(repoRoot, "prototype/functions/api/agent");
const { unzipSync, strFromU8 } = await import(pathToFileURL(join(agentDir, "vendor/fflate.bundle.js")).href);
const { renderHwpx } = await import(pathToFileURL(join(agentDir, "_render-hwpx.ts")).href);
const { computeQuoteTotals, buildQuoteView } = await import(pathToFileURL(join(agentDir, "_form-calc.ts")).href);
const { parseManifest } = await import(pathToFileURL(join(agentDir, "_form-registry.ts")).href);

const zipPath = join(repoRoot, "docs/forms/견적서_표준서식_v3_20260812.zip");
const bundle = existsSync(zipPath) ? unzipSync(new Uint8Array(readFileSync(zipPath))) : null;
const pick = (suffix) => {
  if (!bundle) return null;
  const name = Object.keys(bundle).find((key) => key.endsWith(suffix));
  return name ? bundle[name] : null;
};
const template = pick("quote-standard/template.hwpx");
const manifestBytes = pick("quote-standard/manifest.json");
const skip = !template || !manifestBytes ? "표준 서식 zip 이 없어 건너뜁니다" : false;
const manifest = manifestBytes ? parseManifest(strFromU8(manifestBytes), "견적서-표준") : null;

const BASE = {
  schema: "quote/v1", docNo: "Q-20260813-001", issuedAt: "2026-08-13", validUntil: "2026-09-12",
  title: "브랜드 영상 제작 견적서",
  supplier: {
    name: "(주)엔케이스튜디오", bizNo: "123-45-67890", ceo: "홍길동", bizType: "정보통신업",
    bizItem: "영상 콘텐츠 제작", address: "서울특별시 강남구", tel: "02-000-0000", fax: "02-000-0001",
    email: "a@b.c", manager: "김담당", managerTel: "010-0000-0000", stampUrl: "",
    payment: { bank: "국민은행", accountHolder: "(주)엔케이스튜디오", accountNo: "123456-01-234567" },
  },
  client: { company: "(주)가나다", person: "이과장", title: "마케팅팀", tel: "02-111-2222", email: "b@c.d", address: "서울" },
  payment: { terms: "계약 시 50%" }, delivery: { dueDate: "2026-09-30", place: "클라우드" },
  currency: "KRW",
  items: [
    { group: "기획", costType: "work", name: "컨셉 기획", spec: "A안", qty: 1, unit: "식", unitPrice: 1200000, note: "" },
    { group: "제작", costType: "work", name: "메인 영상 제작", spec: "60초", qty: 1, unit: "편", unitPrice: 4500000, note: "" },
    { group: "", costType: "expense", name: "유료 폰트", spec: "1년", qty: 1, unit: "식", unitPrice: 150000, note: "실비" },
  ],
  discount: { type: "percent", value: 5 }, vat: { mode: "exclusive", rate: 0.1 },
  rounding: { unit: 1000, mode: "floor" },
  terms: ["본 견적서의 유효기간은 발행일로부터 30일입니다.", "상기 금액은 부가가치세 별도 금액입니다."],
  notes: "실사 촬영 별도",
};

/** 렌더 결과 bytes → 검사에 필요한 조각들. */
function render(overrides = {}) {
  const quote = { ...BASE, ...overrides };
  const { totals, missing } = computeQuoteTotals(quote, { maxItemRows: manifest.maxItemRows });
  assert.equal(missing.length, 0, `이 케이스는 결손 없이 렌더돼야 한다: ${JSON.stringify(missing)}`);
  const bytes = renderHwpx(template, buildQuoteView({ ...quote, totals, missing }), { repeaters: manifest.repeaters });
  const files = unzipSync(bytes);
  return {
    bytes,
    files,
    header: strFromU8(files["Contents/header.xml"]),
    body: strFromU8(files[Object.keys(files).find((key) => /section\d*\.xml$/.test(key))]),
  };
}

const CASES = {
  일반: {},
  거래조건없음: { terms: [], validUntil: "" },
  특이사항없음: { payment: {}, delivery: {}, validUntil: "", terms: [] },
  면세: { vat: { mode: "exempt", rate: 0.1 } },
  항목30개: {
    items: Array.from({ length: 30 }, (_, index) => ({
      group: "", costType: "work", name: `항목 ${index + 1}`, spec: "", qty: 1, unit: "식", unitPrice: 1000, note: "",
    })),
  },
};

const idsOf = (xml, tag) =>
  new Set((xml.match(new RegExp(`<hh:${tag}\\b[^>]*>`, "g")) || [])
    .map((open) => (open.match(/\bid="(\d+)"/) || [])[1])
    .filter(Boolean));
const refsOf = (xml, attr) =>
  new Set((xml.match(new RegExp(`\\b${attr}="(\\d+)"`, "g")) || []).map((hit) => hit.match(/\d+/)[0]));

test("① 스타일 참조 무결성 — 본문이 가리키는 id 가 헤더에 전부 있다", { skip }, () => {
  // v2 서식이 여기서 깨졌다(헤더 스냅샷 시점 오류로 borderFill 유실 → 한컴이 파일을 못 엶).
  for (const [label, override] of Object.entries(CASES)) {
    const { header, body } = render(override);
    for (const [attr, tag, name] of [
      ["charPrIDRef", "charPr", "글자 모양"],
      ["paraPrIDRef", "paraPr", "문단 모양"],
      ["borderFillIDRef", "borderFill", "테두리·음영"],
    ]) {
      const have = idsOf(header, tag);
      const missing = [...refsOf(body, attr)].filter((id) => !have.has(id));
      assert.deepEqual(missing, [], `${label}: 헤더에 없는 ${name} id ${missing} 를 본문이 참조`);
    }
  }
});

test("② 글자 크기가 6~25pt 안에 있다 (900pt 사고 방지)", { skip }, () => {
  const { header } = render();
  const sizes = (header.match(/<hh:charPr\b[^>]*>/g) || [])
    .map((open) => Number((open.match(/\bheight="(\d+)"/) || [])[1]))
    .filter((value) => Number.isFinite(value));
  assert.ok(sizes.length > 0, "charPr 이 하나도 없다");
  const outOfRange = sizes.filter((height) => height < 600 || height > 2500);
  assert.deepEqual(outOfRange, [], `글자 크기가 범위 밖: ${outOfRange.map((h) => `${h / 100}pt`)}`);
});

test("③ 가운데·오른쪽 정렬 문단 모양이 살아 있다", { skip }, () => {
  const { header } = render();
  const aligns = new Set(
    [...header.matchAll(/<hh:align\b[^>]*horizontal="(\w+)"/g)].map((match) => match[1])
  );
  assert.ok(aligns.has("CENTER") && aligns.has("RIGHT"), `정렬 종류: ${[...aligns].join(",")}`);
});

test("④ 남은 자리표시자 0개 · 쪼개진 자리표시자 0개", { skip }, () => {
  for (const [label, override] of Object.entries(CASES)) {
    const { body } = render(override);
    const texts = [...body.matchAll(/<hp:t[^>]*>([\s\S]*?)<\/hp:t>/g)].map((match) => match[1]);
    assert.equal(texts.filter((text) => text.includes("{{")).length, 0, `${label}: 자리표시자가 남았다`);
    const split = texts.filter((text) => (text.match(/\{\{/g) || []).length !== (text.match(/\}\}/g) || []).length);
    assert.equal(split.length, 0, `${label}: 자리표시자가 쪼개졌다`);
  }
});

test("⑥ mimetype 이 첫 엔트리이고 압축되지 않았다", { skip }, () => {
  const { bytes } = render();
  assert.equal(strFromU8(bytes.slice(30, 38)), "mimetype", "첫 엔트리가 mimetype 이 아니다");
  assert.equal(bytes[8], 0, "로컬 헤더의 압축 방식이 STORED 가 아니다");
  assert.equal(bytes[9], 0);
});

test("⑦ ns0 오염이 없다 (네임스페이스가 재작성되지 않았다)", { skip }, () => {
  for (const [label, override] of Object.entries(CASES)) {
    const { header, body } = render(override);
    assert.doesNotMatch(body, /ns0:/, `${label}: 본문에 ns0 오염`);
    assert.doesNotMatch(header, /ns0:/, `${label}: 헤더에 ns0 오염`);
  }
});

test("⑧ 행이 0개인 표가 없다 (한컴이 파일을 거부한다)", { skip }, () => {
  for (const [label, override] of Object.entries(CASES)) {
    const { body } = render(override);
    assert.doesNotMatch(body, /<hp:tbl\b[^>]*rowCnt="0"/, `${label}: rowCnt=0 인 표가 남았다`);
    const empty = (body.match(/<hp:tbl[\s\S]*?<\/hp:tbl>/g) || []).filter((table) => !/<hp:tr[ >]/.test(table));
    assert.equal(empty.length, 0, `${label}: 행이 하나도 없는 표가 남았다`);
  }
});
