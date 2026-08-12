// 엑셀·CSV 입력 파서 검증 — 설계서 docs/form_document_engine_design_v2_20260812.md §8 · §10(#16,#17).
// 핵심은 "조용히 자르지 않는다". 사용자가 300행 단가표를 붙였는데 200행만 읽고 말없이 지나가면
// 견적서가 통째로 틀린다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const appDir = join(repoRoot, "ai-company-app/src");
const XLSX = await import(pathToFileURL(join(appDir, "vendor/sheetjs.bundle.js")).href);
const { importSpreadsheet, isSpreadsheetFile, formatSheet, cellText, MAX_ROWS_PER_SHEET } =
  await import(pathToFileURL(join(appDir, "lib/xlsxImport.ts")).href);
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

/** 브라우저 File 을 흉내 낸다(Node 20+ 의 전역 File 사용). */
function fakeFile(name, bytes, type = "") {
  return new File([bytes], name, { type });
}

function workbookBytes(rows, sheetName = "단가표") {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}

test("★확장자만으로도 스프레드시트를 알아본다 (file.type 이 빈 브라우저 대응)", () => {
  assert.equal(isSpreadsheetFile({ name: "단가표.xlsx", type: "" }), true);
  assert.equal(isSpreadsheetFile({ name: "단가표.XLSX", type: "" }), true);
  assert.equal(isSpreadsheetFile({ name: "표.csv", type: "" }), true);
  assert.equal(isSpreadsheetFile({ name: "표.tsv", type: "" }), true);
  assert.equal(isSpreadsheetFile({ name: "구형.xls", type: "" }), true);
  assert.equal(
    isSpreadsheetFile({ name: "이름없음", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    true
  );
  assert.equal(isSpreadsheetFile({ name: "사진.png", type: "image/png" }), false);
  assert.equal(isSpreadsheetFile({ name: "문서.pdf", type: "application/pdf" }), false);
});

test("숫자 셀은 서식 없는 원시값으로 나온다", () => {
  assert.equal(cellText(3000000), "3000000");
  assert.equal(cellText("3,000,000원"), "3,000,000원"); // 문자열은 그대로(원본 보존)
  assert.equal(cellText(null), "");
  assert.equal(cellText(true), "TRUE");
});

test("시트 형식이 설계서 §8.1 그대로다", () => {
  const { text } = formatSheet("영상제작", [
    ["품목", "규격", "단위", "단가", "비고"],
    ["메인 영상 기획·연출", "60초", "식", 3000000, ""],
  ]);
  const lines = text.split("\n");
  assert.equal(lines[0], "--- 시트: 영상제작 (2행 × 5열) ---");
  assert.equal(lines[1], "품목 | 규격 | 단위 | 단가 | 비고");
  assert.equal(lines[2], "메인 영상 기획·연출 | 60초 | 식 | 3000000");
  assert.equal(lines[lines.length - 1], "--- 시트 끝 ---");
});

test("★300행 → 200행까지 읽고 '이후 100행 생략' 고지가 실제로 보인다 (§10 #16)", async () => {
  const rows = [["품목", "단가"]];
  for (let i = 1; i <= 299; i += 1) rows.push([`항목 ${i}`, 1000 * i]);
  const result = await importSpreadsheet(fakeFile("2026 단가표.xlsx", workbookBytes(rows)));

  assert.match(result.text, /^\[첨부파일: 2026 단가표\.xlsx\]/);
  assert.match(result.text, /--- 시트: 단가표 \(300행 × 2열\) ---/);
  assert.equal(result.rowsRead, MAX_ROWS_PER_SHEET);
  assert.equal(result.rowsSkipped, 100);
  assert.match(result.text, /※ 이후 100행 생략됨 — 필요한 범위를 알려주시면 그 부분만 다시 읽을게요\./);
  assert.match(result.text, /항목 199 \| 199000/);   // 200번째 줄(머리글 포함)까지는 들어간다
  assert.doesNotMatch(result.text, /항목 250/);       // 그 뒤는 잘렸다
});

test("CSV 도 같은 형식으로 읽힌다 (§10 #16)", async () => {
  const csv = ["품목,규격,단가", "메인 영상,60초,3000000", "편집,,500000"].join("\n");
  const result = await importSpreadsheet(fakeFile("단가.csv", new TextEncoder().encode(csv), "text/csv"));
  assert.match(result.text, /\[첨부파일: 단가\.csv\]/);
  assert.match(result.text, /메인 영상 \| 60초 \| 3000000/);
  assert.equal(result.rowsRead, 3);
  assert.equal(result.rowsSkipped, 0);
});

test("여러 시트를 모두 담고, 40열을 넘는 열은 자른다", async () => {
  const wide = [Array.from({ length: 50 }, (_, i) => `열${i + 1}`)];
  const sheet1 = XLSX.utils.aoa_to_sheet(wide);
  const sheet2 = XLSX.utils.aoa_to_sheet([["다른 시트"], ["값"]]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet1, "넓은표");
  XLSX.utils.book_append_sheet(workbook, sheet2, "메모");
  const bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));

  const result = await importSpreadsheet(fakeFile("다중.xlsx", bytes));
  assert.deepEqual(result.sheetNames, ["넓은표", "메모"]);
  assert.match(result.text, /열40/);
  assert.doesNotMatch(result.text, /열41/);
  assert.match(result.text, /--- 시트: 메모/);
});

test("Chat 은 스프레드시트를 base64 첨부가 아니라 본문 텍스트로 보낸다", () => {
  const chat = read("ai-company-app/src/components/Chat.tsx");
  assert.match(chat, /isSpreadsheetFile\(file\)/);
  assert.match(chat, /const body = \[t, \.\.\.sheets\.map\(\(sheet\) => sheet\.text\)\]/);
  assert.match(chat, /행 읽음/);
  // accept 와 MIME 목록에 스프레드시트가 들어 있다
  assert.match(chat, /accept="[^"]*\.xlsx,\.xls,\.csv,\.tsv"/);
  assert.match(chat, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.match(chat, /text\/tab-separated-values/);
});

test("★첨부가 그 턴의 여러 직원에게 전달된다 (코어→잉크 위임 · §10 #17)", () => {
  const orchestrator = read("prototype/functions/api/agent/_orchestrator.ts");
  // 1차 응답자와 위임받은 직원 모두 같은 함수로 첨부를 받는다
  const speakCalls = orchestrator.match(/images: imagesForNextSpeaker\(\)/g) || [];
  assert.ok(speakCalls.length >= 2, "첨부를 받는 발언 지점이 2곳 미만이다");
  assert.match(orchestrator, /const IMAGE_RECIPIENT_LIMIT = 4;/);
  assert.doesNotMatch(orchestrator, /첫 번째 에이전트에게만 전달/);
  // 상한을 넘으면 더 주지 않는다
  assert.match(orchestrator, /if \(imageRecipients >= IMAGE_RECIPIENT_LIMIT\) return undefined;/);
});
