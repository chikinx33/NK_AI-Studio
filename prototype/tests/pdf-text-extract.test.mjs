// prototype/tests/pdf-text-extract.test.mjs
// 직원이 업무 파일의 한글 PDF 를 못 읽던 문제(2026-09-25, Shapes 소개서).
// 옛 추출기는 "(…)" 문자열만 보고 글꼴 표를 안 읽어 Type0(Identity-H)+ToUnicode+16진 문자열 PDF 를 통째로 놓쳤다.
// 여기서는 그 형태를 그대로 흉내 낸 작은 PDF 를 만들어 새 추출기(_pdf-text.js)가 제대로 읽는지 실제로 실행해 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const read = (p) => readFile(path.join(root, p), "utf8");
const { extractPdfText, extractPdfPages } = await import(pathToFileURL(path.join(root, "prototype/functions/api/agent/_pdf-text.js")).href);

/** 한글 PDF 의 일반 형태를 흉내 낸 PDF. 글꼴 사전은 객체 스트림(ObjStm) 안에 넣어 그 경로도 검사한다. */
function buildPdf({ compressedObjStm = false } = {}) {
  const toUnicode = [
    "/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap",
    "1 begincodespacerange", "<0000> <FFFF>", "endcodespacerange",
    "2 beginbfchar", "<0001> <C548>", "<0002> <B155>", "endbfchar",   // 안 녕
    "1 beginbfrange", "<0003> <0004> <D558>", "endbfrange",            // 하 ← 0003, 학 ← 0004
    "endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end",
  ].join("\n");
  // 객체 스트림: 5(Type0 글꼴) · 6(CID 하위 글꼴). 헤더는 "번호 오프셋" 쌍.
  const o5 = "<</Type/Font/Subtype/Type0/BaseFont/ABCDEF+MalgunGothic/Encoding/Identity-H/DescendantFonts[6 0 R]/ToUnicode 7 0 R>>";
  const o6 = "<</Type/Font/Subtype/CIDFontType2/BaseFont/ABCDEF+MalgunGothic/DW 1000/CIDToGIDMap/Identity>>";
  const header = `5 0 6 ${o5.length + 1} `;
  const objStmBody = `${header}${o5}\n${o6}`;
  // 콘텐츠: 한글(16진, Tj·TJ)·줄바꿈(Td)·영문(리터럴, 이스케이프)·같은 줄의 폭만큼 이동(공백 아님)·빈칸 이동(공백)
  const content = [
    "BT",
    "/F0 12 Tf 1 0 0 1 50 700 Tm",
    "<00010002> Tj",                 // 안녕
    "0 -14 Td [<0003> -300 <0004>] TJ", // 하 학 (TJ 커닝 -300 = 빈칸)
    "0 -14 Td <0001> Tj 12 0 Td <0002> Tj", // 안 + 폭(12)만큼 이동 → 붙여서 "안녕"
    "0 -14 Td <0001> Tj 24 0 Td <0002> Tj", // 안 + 폭보다 12 더 이동 → "안 녕"
    "/F1 12 Tf 0 -14 Td (Hello \\(World\\)) Tj",
    "ET",
  ].join("\n");
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F0 5 0 R/F1 8 0 R>>>>/Contents 4 0 R>>",
    `<</Length ${Buffer.byteLength(content)}>>\nstream\n${content}\nendstream`,
    null, null, // 5·6 은 객체 스트림 안
    `<</Length ${Buffer.byteLength(toUnicode)}>>\nstream\n${toUnicode}\nendstream`,
    "<</Type/Font/Subtype/TrueType/BaseFont/Arial/Encoding/WinAnsiEncoding/FirstChar 32/LastChar 126/Widths[278 278 355 556 556 889 667 191 333 333]>>",
    `<</Type/ObjStm/N 2/First ${header.length}/Length ${Buffer.byteLength(objStmBody)}>>\nstream\n${objStmBody}\nendstream`,
  ];
  let pdf = "%PDF-1.6\n";
  objects.forEach((body, index) => { if (body) pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  pdf += "trailer\n<</Root 1 0 R>>\n%%EOF\n";
  void compressedObjStm;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

test("Type0(Identity-H)+ToUnicode+16진 문자열 PDF 를 페이지 순서대로 읽는다(객체 스트림 안의 글꼴 포함)", async () => {
  const pages = await extractPdfPages(buildPdf());
  assert.equal(pages.length, 1);
  assert.equal(pages[0], "안녕\n하 학\n안녕\n안 녕\nHello (World)");
  const text = await extractPdfText(buildPdf());
  assert.equal(text, "[p.1]\n안녕\n하 학\n안녕\n안 녕\nHello (World)");
});

test("bfrange·배열형 bfrange·TJ 커닝 빈칸·같은 줄 이동 규칙", async () => {
  const src = await read("prototype/functions/api/agent/_pdf-text.js");
  assert.match(src, /beginbfrange\(\[\\s\\S\]\*\?\)endbfrange/);
  assert.match(src, /if \(item\.num < -180\) spaceIfNeeded\(\);/);
  assert.match(src, /else if \(tx - penAdvance > 0\.3 \* fontSize\) spaceIfNeeded\(\);/, "폭만큼 옮긴 Td 는 공백이 아니다");
  assert.match(src, /const simpleFont = \/\^\(TrueType\|Type1\|Type3\|MMType1\)\$\/\.test\(subtype\);/, "단순 글꼴은 ToUnicode 코드공간과 무관하게 1바이트");
  assert.match(src, /\/\\\/Type\\s\*\\\/ObjStm\\b\//, "객체 스트림을 펼친다");
  assert.match(src, /\/\\\/Subtype\\s\*\\\/Form\\b\//, "폼 XObject 안의 글도 읽는다");
});

test("그림만 있는 PDF 는 빈 문자열 → 문서 추출기가 스캔본 안내로 실패한다", async () => {
  const pdf = new Uint8Array(Buffer.from([
    "%PDF-1.4",
    "1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj",
    "2 0 obj\n<</Type/Pages/Kids[3 0 R]/Count 1>>\nendobj",
    "3 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]/Resources<</XObject<</Im0 4 0 R>>>>/Contents 5 0 R>>\nendobj",
    "4 0 obj\n<</Type/XObject/Subtype/Image/Width 1/Height 1/ColorSpace/DeviceGray/BitsPerComponent 8/Length 1>>\nstream\n\u0000\nendstream\nendobj",
    "5 0 obj\n<</Length 20>>\nstream\nq 100 0 0 100 0 0 cm /Im0 Do Q\nendstream\nendobj",
    "trailer\n<</Root 1 0 R>>\n%%EOF",
  ].join("\n"), "latin1"));
  assert.equal(await extractPdfText(pdf), "");
  const docText = await read("prototype/functions/api/agent/_doc-text.ts");
  assert.match(docText, /import \{ extractPdfText \} from "\.\/_pdf-text\.js";/);
  assert.match(docText, /const text = trimBlankLines\(await extractPdfText\(bytes\)\);/);
  assert.match(docText, /이 PDF는 글이 그림으로만 들어 있어\(스캔본\) 서버에서 읽을 본문이 없어요/);
  assert.doesNotMatch(docText, /function pdfStringsOf/, "옛 추출기는 사라졌다");
  assert.doesNotMatch(docText, /글꼴이 묶여 있어/, "한글 글꼴을 핑계 삼던 문구는 사라졌다");
});
