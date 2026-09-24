// prototype/functions/api/agent/_doc-text.ts
// 회사 파일에 저장된 문서(.xlsx·.docx·.pptx·.pdf)를 직원이 읽을 수 있는 텍스트로 편다.
//
// 직원이 스스로 만든 견적서·기획서를 다시 열어보지 못하면 이어서 일할 수가 없다.
// 브라우저 첨부 경로(ai-company-app/src/lib/xlsxImport.ts)와 같은 결과를 서버에서도 낸다.
import { unzipSync, strFromU8 } from "./vendor/fflate.bundle.js";
import { extractPdfText } from "./_pdf-text.js";

export const DOCUMENT_EXTENSIONS = /\.(xlsx|xlsm|xltx|docx|dotx|pptx|potx|pdf)$/i;

/** 한 시트에서 읽을 최대 행·열. 브라우저 첨부 규칙(설계서 §10 #16)과 같은 값. */
const MAX_ROWS = 200;
const MAX_COLUMNS = 40;

function extensionOf(path: string) {
  const match = /\.([a-z0-9]+)$/i.exec(path.trim());
  return match ? match[1].toLowerCase() : "";
}

/** XML 조각에서 사람이 읽는 텍스트만 남긴다(태그 제거 + 엔티티 복원). */
function xmlText(xml: string) {
  return xml
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

function trimBlankLines(text: string) {
  return text.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** .docx — 문단(w:p)은 줄, 표 칸(w:tc)은 탭으로 끊는다. */
function readDocx(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  const parts = ["word/document.xml", ...Object.keys(files).filter((name) => /^word\/(header|footer)\d*\.xml$/.test(name))];
  const chunks: string[] = [];
  for (const name of parts) {
    const raw = files[name];
    if (!raw) continue;
    const xml = strFromU8(raw)
      .replace(/<w:tab\b[^>]*\/>/g, "\t")
      .replace(/<w:br\b[^>]*\/>/g, "\n")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<\/w:p>/g, "\n");
    const text = trimBlankLines(xmlText(xml));
    if (text) chunks.push(text);
  }
  if (!chunks.length) throw new Error("이 워드 문서에서 읽을 수 있는 본문을 찾지 못했어요.");
  return chunks.join("\n\n");
}

/** .pptx — 슬라이드 번호를 붙여 순서대로 편다. */
function readPptx(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  const slides = Object.keys(files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.replace(/\D+/g, "")) - Number(b.replace(/\D+/g, "")));
  const chunks: string[] = [];
  for (const name of slides) {
    const xml = strFromU8(files[name]).replace(/<\/a:p>/g, "\n");
    const text = trimBlankLines(xmlText(xml));
    chunks.push(`## 슬라이드 ${name.replace(/\D+/g, "")}\n${text || "(빈 슬라이드)"}`);
  }
  if (!chunks.length) throw new Error("이 프레젠테이션에서 슬라이드를 찾지 못했어요.");
  return chunks.join("\n\n");
}

/** .xlsx — 시트마다 탭으로 구분한 표. 숫자는 서식 없는 원시값으로 낸다. */
async function readSpreadsheet(bytes: Uint8Array) {
  const { read, utils } = await import("./vendor/sheetjs.bundle.js");
  const workbook: any = read(bytes, { type: "array" });
  const names: string[] = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames : [];
  if (!names.length) throw new Error("이 스프레드시트에서 시트를 찾지 못했어요.");
  const chunks: string[] = [];
  for (const name of names) {
    const sheet = workbook.Sheets?.[name];
    if (!sheet) continue;
    const rows: any[][] = utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
    const shown = rows.slice(0, MAX_ROWS).map((row) =>
      (Array.isArray(row) ? row : []).slice(0, MAX_COLUMNS)
        .map((cell) => (cell === null || cell === undefined ? "" : String(cell)))
        .join("\t"));
    const omittedRows = Math.max(0, rows.length - MAX_ROWS);
    const omittedColumns = Math.max(0, ...rows.map((row) => (Array.isArray(row) ? row.length : 0) - MAX_COLUMNS));
    const notes = [
      omittedRows ? `이후 ${omittedRows}행 생략` : "",
      omittedColumns ? `오른쪽 ${omittedColumns}열 생략` : "",
    ].filter(Boolean);
    chunks.push(`## 시트: ${name}\n${shown.join("\n")}${notes.length ? `\n(${notes.join(" · ")})` : ""}`);
  }
  return chunks.join("\n\n");
}

/**
 * .pdf — 글꼴의 ToUnicode 표까지 읽는 추출기(_pdf-text.js)로 본문을 편다.
 * 옛 구현은 "(…)" 문자열만 보고 글꼴 표를 안 읽어, 한글 PDF 의 일반 형태(Type0 글꼴 + 16진 문자열)를
 * 통째로 놓치고 "글꼴이 묶여 읽을 수 없다" 고 답했다(2026-09-25 Shapes 소개서). 이제 글이 하나도 없는
 * 스캔본만 실패로 알린다.
 */
async function readPdf(bytes: Uint8Array) {
  const text = trimBlankLines(await extractPdfText(bytes));
  if (!text) {
    throw new Error("이 PDF는 글이 그림으로만 들어 있어(스캔본) 서버에서 읽을 본문이 없어요. 채팅에 파일을 첨부해 주시면 그림에서 글자를 읽어 드릴 수 있어요.");
  }
  return text;
}

/** 확장자가 문서 형식이면 텍스트로 편다. 문서가 아니면 null. */
export async function extractDocumentText(path: string, bytes: Uint8Array): Promise<{ text: string; format: string } | null> {
  const extension = extensionOf(path);
  switch (extension) {
    case "xlsx": case "xlsm": case "xltx":
      return { text: await readSpreadsheet(bytes), format: extension };
    case "docx": case "dotx":
      return { text: readDocx(bytes), format: extension };
    case "pptx": case "potx":
      return { text: readPptx(bytes), format: extension };
    case "pdf":
      return { text: await readPdf(bytes), format: extension };
    default:
      return null;
  }
}
