// ai-company-app/src/lib/xlsxImport.ts
// 엑셀·CSV 입력 파서 — 설계서 docs/form_document_engine_design_v2_20260812.md §8.1.
//
// Claude 는 xlsx 바이너리를 읽지 못한다. 그래서 브라우저에서 파싱해 텍스트로 바꾼 뒤
// 메시지 본문에 붙인다. 서버를 고칠 필요가 없고, 텍스트가 되므로 그 턴의 모든 에이전트가
// 자연스럽게 같은 내용을 본다(§8.2 첨부 전파 문제도 함께 해결된다).
//
// ★조용한 절단 금지. 상한을 넘으면 몇 행을 생략했는지 반드시 본문에 남긴다 —
//   사용자가 "단가표 다 봤겠지" 하고 견적을 맡기는 상황을 막기 위한 장치다.

/** 시트당 상한(설계서 §8.1). 넘으면 자르고 그 사실을 본문에 적는다. */
export const MAX_ROWS_PER_SHEET = 200;
export const MAX_COLS_PER_SHEET = 40;
/** 파일 전체 상한(문자 수). 대화 한 턴의 토큰을 지키기 위한 선. */
export const MAX_TEXT_LENGTH = 60_000;

const SPREADSHEET_EXTENSIONS = [".xlsx", ".xls", ".csv", ".tsv"];
const SPREADSHEET_MIMES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/tab-separated-values",
];

export interface SheetImportResult {
  /** 메시지 본문 끝에 그대로 붙일 텍스트 */
  text: string;
  fileName: string;
  /** 실제로 읽어 들인 행 수(모든 시트 합계) */
  rowsRead: number;
  /** 상한 때문에 생략한 행 수 */
  rowsSkipped: number;
  sheetNames: string[];
}

/**
 * 스프레드시트 파일인지 판정.
 * ★일부 브라우저(특히 윈도우 크롬·사파리)는 xlsx 의 file.type 을 빈 문자열로 준다.
 *   그래서 MIME 만 보면 첨부가 조용히 무시된다 — 확장자로도 판정한다.
 */
export function isSpreadsheetFile(file: { name?: string; type?: string }): boolean {
  const type = String(file?.type || "").toLowerCase();
  if (SPREADSHEET_MIMES.includes(type)) return true;
  const name = String(file?.name || "").toLowerCase();
  return SPREADSHEET_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/** 셀 값 → 텍스트. 숫자는 서식 없는 원시값으로(3000000, "3,000,000원" 아님). */
export function cellText(value: any): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/[\r\n]+/g, " ").trim();
}

/** 오른쪽 끝의 빈 칸을 떼어낸다(엑셀은 빈 열을 길게 물고 오는 일이 잦다). */
function trimTrailing(cells: string[]): string[] {
  const copy = [...cells];
  while (copy.length && copy[copy.length - 1] === "") copy.pop();
  return copy;
}

/** 시트 하나(2차원 배열) → 설계서 §8.1 형식의 텍스트 블록. */
export function formatSheet(
  sheetName: string,
  rows: any[][],
  limits: { maxRows?: number; maxCols?: number } = {}
): { text: string; rowsRead: number; rowsSkipped: number } {
  const maxRows = limits.maxRows ?? MAX_ROWS_PER_SHEET;
  const maxCols = limits.maxCols ?? MAX_COLS_PER_SHEET;

  const cleaned = rows
    .map((row) => trimTrailing((row || []).slice(0, maxCols).map(cellText)))
    .filter((row) => row.length > 0);

  const totalRows = cleaned.length;
  const totalCols = cleaned.reduce((max, row) => Math.max(max, row.length), 0);
  const used = cleaned.slice(0, maxRows);
  const skipped = Math.max(0, totalRows - used.length);

  const lines = [
    `--- 시트: ${sheetName} (${totalRows}행 × ${totalCols}열) ---`,
    ...used.map((row) => row.join(" | ")),
  ];
  if (skipped > 0) {
    lines.push(`※ 이후 ${skipped}행 생략됨 — 필요한 범위를 알려주시면 그 부분만 다시 읽을게요.`);
  }
  lines.push("--- 시트 끝 ---");
  return { text: lines.join("\n"), rowsRead: used.length, rowsSkipped: skipped };
}

/**
 * File → 메시지 본문에 붙일 텍스트.
 * SheetJS 는 첨부를 실제로 붙일 때만 불러온다(초기 화면 로딩을 무겁게 하지 않기 위해).
 */
export async function importSpreadsheet(file: File): Promise<SheetImportResult> {
  const { read, utils } = await import("../vendor/sheetjs.bundle.js");
  const buffer = await file.arrayBuffer();
  // ★CSV·TSV 는 바이트로 넘기면 SheetJS 가 코드페이지로 읽어 한글이 깨진다.
  //   우리가 UTF-8 로 먼저 디코드해서 문자열로 넘긴다(엑셀이 붙이는 BOM 도 떼어낸다).
  const isText = /\.(csv|tsv|txt)$/i.test(file.name) || /csv|tab-separated/i.test(String(file.type || ""));
  const workbook = isText
    ? read(new TextDecoder("utf-8").decode(buffer).replace(/^﻿/, ""), { type: "string", cellDates: true, raw: false })
    : read(new Uint8Array(buffer), { type: "array", cellDates: true, raw: false });

  const blocks: string[] = [`[첨부파일: ${file.name}]`];
  const sheetNames: string[] = [];
  let rowsRead = 0;
  let rowsSkipped = 0;
  let truncatedByLength = false;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows: any[][] = utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: true, defval: "" });
    if (!rows.length) continue;

    const formatted = formatSheet(sheetName, rows);
    // 파일 전체 상한 — 넘어가면 이 시트부터는 넣지 않고 그 사실을 적는다.
    const projected = [...blocks, formatted.text].join("\n").length;
    if (projected > MAX_TEXT_LENGTH) {
      truncatedByLength = true;
      break;
    }
    blocks.push(formatted.text);
    sheetNames.push(sheetName);
    rowsRead += formatted.rowsRead;
    rowsSkipped += formatted.rowsSkipped;
  }

  if (truncatedByLength) {
    const remaining = workbook.SheetNames.filter((name: string) => !sheetNames.includes(name));
    blocks.push(
      `※ 분량이 커서 시트 ${remaining.length}개(${remaining.join(", ")})는 넣지 못했어요 — ` +
      "필요한 범위를 알려주시면 그 부분만 다시 읽을게요."
    );
  }
  if (sheetNames.length === 0 && !truncatedByLength) {
    blocks.push("※ 내용이 없는 파일이에요.");
  }

  return { text: blocks.join("\n"), fileName: file.name, rowsRead, rowsSkipped, sheetNames };
}
