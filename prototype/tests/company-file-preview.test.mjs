// 회사 파일 미리보기 — 실측: template.docx 를 누르니 바이너리가 글자로 쏟아졌다(2026-08-13).
// 원인은 docx 의 MIME("application/vnd.openxmlformats-…")에 'xml' 이 들어 있어
// 텍스트 파일로 오인한 것. 형식 판정 규칙을 여기서 고정한다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(join(repoRoot, "ai-company-app/src/components/CompanyFilePreview.tsx"), "utf8");

/** 컴포넌트에 있는 판정 규칙을 그대로 떼어 확인한다(.tsx 는 Node 에서 못 불러온다). */
const BINARY_EXTENSIONS = [".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".hwp", ".hwpx", ".zip", ".ttf", ".otf"];
const BINARY_MIME = /(officedocument|msword|ms-excel|ms-powerpoint|hancom|hwp|zip|octet-stream|font)/i;
const TEXT_MIME = /\b(json|xml|yaml|javascript|csv)\b/i;
const isBinary = (name, type) =>
  BINARY_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext)) || BINARY_MIME.test(type);

test("★docx·xlsx 는 텍스트로 열지 않는다 (깨진 글자의 원인)", () => {
  const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  assert.equal(isBinary("template.docx", docx), true);
  assert.equal(isBinary("견적서.xlsx", xlsx), true);
  // 예전 규칙(/xml/)이 왜 틀렸는지 — 단어 경계가 없어 'openxmlformats' 에 걸렸다
  assert.equal(/(json|xml|yaml|javascript|csv)/i.test(docx), true, "옛 규칙은 통과시켰다");
  assert.equal(TEXT_MIME.test(docx), false, "새 규칙은 걸러낸다");
});

test("진짜 텍스트 형식은 그대로 열린다", () => {
  assert.equal(isBinary("manifest.json", "application/json"), false);
  assert.equal(TEXT_MIME.test("application/json"), true);
  assert.equal(TEXT_MIME.test("application/xml"), true);
  assert.equal(TEXT_MIME.test("text/csv"), true);
});

test("컴포넌트가 바이너리 판정을 텍스트 판정보다 먼저 한다", () => {
  const classifyStart = source.indexOf("function classify(");
  const body = source.slice(classifyStart, source.indexOf("function formatPlainText"));
  const binaryAt = body.indexOf("isBinaryDocument(entry)");
  const textAt = body.indexOf('type.startsWith("text/")');
  assert.ok(binaryAt > 0 && textAt > 0, "판정 분기를 찾지 못했다");
  assert.ok(binaryAt < textAt, "텍스트 판정이 먼저라 바이너리가 새어 나간다");
  // 소스에 단어 경계(\b)가 들어 있는지 — 문자열로 확인한다(정규식으로 쓰면 \b 가 경계로 해석된다).
  assert.ok(source.includes("\\b(json|xml|yaml|javascript|csv)\\b"), "MIME 규칙에 단어 경계가 없다");
});

test("못 여는 형식이면 무엇을 하라고 알려준다", () => {
  assert.match(source, /다운로드'로 받아서 워드·엑셀·한글에서 열어 주세요/);
});

test("이미지가 없는 산출물에 깨진 이미지가 뜨지 않는다", () => {
  const results = readFileSync(join(repoRoot, "ai-company-app/src/components/Results.tsx"), "utf8");
  assert.match(results, /\{it\.url\s*\?\s*<img/, "썸네일에 이미지 유무 확인이 없다");
  assert.match(results, /\{item\.url\s*\n?\s*\?\s*<img/, "크게 보기에 이미지 유무 확인이 없다");
});
