// prototype/functions/api/agent/_render-xlsx.ts
// XLSX 렌더러 — 설계서 docs/form_document_engine_design_v2_20260812.md §6.3.
//
// 고객이 파일을 열어 수량 하나 바꿔 보는 일이 실제로 자주 있다. 그래서 값만 박아 넣지 않고
// ★진짜 엑셀 수식을 넣는다. 수식과 함께 서버가 계산한 값을 캐시로 저장해서,
// 수식을 계산하지 않는 뷰어에서도 서버와 같은 금액이 보이게 한다.
//
// ★이 파일에서 금액을 계산하지 않는다. 숫자는 전부 totals 에서 가져온다(_form-calc.ts 가 SSOT).
//   여기서 한 번이라도 더하기를 시작하면 DOCX·HWPX 와 금액이 갈라진다.
import { utils, write, read } from "./vendor/sheetjs.bundle.js";
// 타입만 가져온다(런타임 의존 없음) — 이 파일은 계산하지 않고 totals 를 옮겨 담기만 한다.
import type { Quote, QuoteRow, QuoteTotals } from "./_form-calc";

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const SHEET_NAME = "견적서";
const MONEY_FORMAT = "#,##0";
// A No · B 품명 · C 규격 · D 수량 · E 단위 · F 단가 · G 금액 · H 비고
// (설계서 §6.3 의 "D{r}*F{r}" 수식이 이 열 배치를 전제한다)
const COLUMN_WIDTHS = [5, 34, 16, 7, 6, 14, 15, 18];
const AMOUNT_COLUMN = "G";

type Cell = { t: string; v?: any; f?: string; z?: string; s?: any };
type SheetData = Record<string, any>;

const cellRef = (column: string, row: number) => `${column}${row}`;

function setText(sheet: SheetData, column: string, row: number, value: any) {
  const text = String(value ?? "");
  if (!text) return;
  sheet[cellRef(column, row)] = { t: "s", v: text } as Cell;
}

function setNumber(sheet: SheetData, column: string, row: number, value: number | null | undefined, money = true) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return;
  sheet[cellRef(column, row)] = { t: "n", v: Number(value), ...(money ? { z: MONEY_FORMAT } : {}) } as Cell;
}

/** 수식 + 서버가 계산한 값(캐시)을 함께 저장한다 — 뷰어가 계산을 안 해도 금액이 보인다. */
function setFormula(sheet: SheetData, column: string, row: number, formula: string, cached: number | null | undefined) {
  sheet[cellRef(column, row)] = {
    t: "n",
    f: formula,
    ...(cached === null || cached === undefined ? {} : { v: Number(cached) }),
    z: MONEY_FORMAT,
  } as Cell;
}

function mergeRow(merges: any[], startColumn: number, endColumn: number, row: number) {
  merges.push({ s: { r: row - 1, c: startColumn }, e: { r: row - 1, c: endColumn } });
}

/**
 * 기본 견적서 시트 생성 (manifest.templates.xlsx 가 없을 때).
 * 표의 행 구성은 DOCX·HWPX 와 같은 totals.rows 를 쓴다 — 세 포맷이 같은 표를 보여줘야 한다.
 */
export function buildQuoteSheet(quote: Quote): { sheet: SheetData; lastRow: number } {
  const totals = quote.totals as QuoteTotals;
  const sheet: SheetData = {};
  const merges: any[] = [];
  let row = 1;

  // 제목
  setText(sheet, "A", row, "견 적 서");
  mergeRow(merges, 0, 7, row);
  row += 1;
  setText(sheet, "A", row, `문서번호 ${quote.docNo}`);
  setText(sheet, "F", row, `발행일 ${quote.issuedAt}`);
  row += 2;

  // 공급받는자 / 공급자
  const supplier = quote.supplier || ({} as any);
  const client = quote.client || ({} as any);
  const infoLines: [string, string][] = [
    [`${client.company || ""} 귀중`, `상호  ${supplier.name || ""}`],
    [`담당  ${[client.person, client.title].filter(Boolean).join(" ")}`, `등록번호  ${supplier.bizNo || ""}`],
    [`연락처  ${client.tel || ""}`, `대표  ${supplier.ceo || ""}`],
    [`이메일  ${client.email || ""}`, `업태/종목  ${[supplier.bizType, supplier.bizItem].filter(Boolean).join(" / ")}`],
    [`주소  ${client.address || ""}`, `주소  ${supplier.address || ""}`],
    ["", `전화  ${[supplier.tel, supplier.fax && `팩스 ${supplier.fax}`].filter(Boolean).join("  ")}`],
  ];
  setText(sheet, "A", row, "공급받는자");
  setText(sheet, "E", row, "공급자");
  row += 1;
  for (const [left, right] of infoLines) {
    setText(sheet, "A", row, left);
    mergeRow(merges, 0, 3, row);
    setText(sheet, "E", row, right);
    mergeRow(merges, 4, 7, row);
    row += 1;
  }
  row += 1;

  // 합계금액 (한글 병기)
  setText(sheet, "A", row, "합계금액");
  setText(sheet, "B", row, totals.grandTotalText);
  mergeRow(merges, 1, 7, row);
  row += 2;

  // 항목 표 머리글
  const headerRow = row;
  ["No", "품명", "규격", "수량", "단위", "단가", "금액", "비고"].forEach((label, index) => {
    setText(sheet, String.fromCharCode(65 + index), headerRow, label);
  });
  row += 1;

  // 항목 행 — 금액은 수식(D*F) + 서버 계산값
  const itemRows: number[] = [];
  const subtotalRows: number[] = [];
  let itemCursor = 0; // totals.lineAmounts 인덱스
  let groupStart = 0;
  totals.rows.forEach((entry: QuoteRow) => {
    if (entry.kind === "item") {
      setText(sheet, "A", row, entry.no);
      setText(sheet, "B", row, entry.name);
      setText(sheet, "C", row, entry.spec);
      setNumber(sheet, "D", row, Number(entry.qty) || 0, false);
      setText(sheet, "E", row, entry.unit);
      setNumber(sheet, "F", row, totals.lineAmounts[itemCursor] === null ? null : Number(String(entry.unitPrice).replace(/[^0-9.-]/g, "")));
      setFormula(sheet, AMOUNT_COLUMN, row, `D${row}*F${row}`, totals.lineAmounts[itemCursor]);
      setText(sheet, "H", row, entry.note);
      itemRows.push(row);
      if (!groupStart) groupStart = row;
      itemCursor += 1;
    } else if (entry.kind === "subtotal") {
      setText(sheet, "B", row, entry.name);
      const first = groupStart || row;
      const last = itemRows[itemRows.length - 1] || row;
      setFormula(sheet, AMOUNT_COLUMN, row, `SUM(${AMOUNT_COLUMN}${first}:${AMOUNT_COLUMN}${last})`, toNumber(entry.amount));
      subtotalRows.push(row);
      groupStart = 0;
    } else {
      // 그룹 머리행(■ 기획 / ■ 실비)
      setText(sheet, "B", row, entry.name);
      groupStart = 0;
    }
    row += 1;
  });
  const lastItemRow = itemRows[itemRows.length - 1] || headerRow;
  row += 1;

  // 합계 블록 — 전부 수식. 수량을 바꾸면 여기까지 다시 계산된다.
  const summaryRefs: Record<string, string> = {};
  const summaryStart = row;
  const subtotalFormula = subtotalRows.length
    ? subtotalRows.map((line) => `${AMOUNT_COLUMN}${line}`).join("+")
    : `SUM(${AMOUNT_COLUMN}${itemRows[0] || headerRow + 1}:${AMOUNT_COLUMN}${lastItemRow})`;

  setText(sheet, "F", row, "소계");
  setFormula(sheet, AMOUNT_COLUMN, row, subtotalFormula, totals.subtotal);
  summaryRefs.subtotal = cellRef(AMOUNT_COLUMN, row);
  row += 1;

  if (totals.discountAmount > 0) {
    setText(sheet, "F", row, "할인");
    const discount = quote.discount || ({} as any);
    const formula = discount.type === "percent"
      ? `-ROUND(${summaryRefs.subtotal}*${discount.value}/100,0)`
      : `-${totals.discountAmount}`;
    // 부호만 뒤집어 담는다(계산이 아니라 표기 — 아래 합계 수식이 전부 더하기가 되도록).
    setFormula(sheet, AMOUNT_COLUMN, row, formula, -totals.discountAmount);
    summaryRefs.discount = cellRef(AMOUNT_COLUMN, row);
    row += 1;
  }

  const vat = quote.vat || ({ mode: "exclusive", rate: 0.1 } as any);
  const taxBaseFormula = summaryRefs.discount
    ? `(${summaryRefs.subtotal}+${summaryRefs.discount})`
    : `${summaryRefs.subtotal}`;

  if (vat.mode === "inclusive") {
    setText(sheet, "F", row, "공급가액");
    setFormula(sheet, AMOUNT_COLUMN, row, `ROUND(${taxBaseFormula}/(1+${vat.rate}),0)`, totals.supplyAmount);
    summaryRefs.supply = cellRef(AMOUNT_COLUMN, row);
    row += 1;
    setText(sheet, "F", row, "부가세");
    setFormula(sheet, AMOUNT_COLUMN, row, `${taxBaseFormula}-${summaryRefs.supply}`, totals.vatAmount);
    summaryRefs.vat = cellRef(AMOUNT_COLUMN, row);
    row += 1;
  } else if (vat.mode === "exempt") {
    setText(sheet, "F", row, "부가세 (면세)");
    setNumber(sheet, AMOUNT_COLUMN, row, 0);
    summaryRefs.vat = cellRef(AMOUNT_COLUMN, row);
    row += 1;
  } else {
    setText(sheet, "F", row, "부가세");
    setFormula(sheet, AMOUNT_COLUMN, row, `ROUND(${taxBaseFormula}*${vat.rate},0)`, totals.vatAmount);
    summaryRefs.vat = cellRef(AMOUNT_COLUMN, row);
    row += 1;
  }

  // 부가세 포함이면 총액에 부가세를 다시 더하지 않는다(이미 taxBase 안에 있다).
  const beforeRounding = vat.mode === "inclusive"
    ? taxBaseFormula
    : `${taxBaseFormula}+${summaryRefs.vat}`;

  if (totals.roundingAdj !== 0) {
    const unit = quote.rounding?.unit || 1;
    setText(sheet, "F", row, "단수조정");
    setFormula(sheet, AMOUNT_COLUMN, row, `FLOOR(${beforeRounding},${unit})-(${beforeRounding})`, totals.roundingAdj);
    summaryRefs.rounding = cellRef(AMOUNT_COLUMN, row);
    row += 1;
  }

  setText(sheet, "F", row, "합계");
  setFormula(
    sheet,
    AMOUNT_COLUMN,
    row,
    summaryRefs.rounding ? `${beforeRounding}+${summaryRefs.rounding}` : beforeRounding,
    totals.grandTotal
  );
  const grandTotalRow = row;
  row += 2;

  // 특이사항 · 거래 조건 · 비고
  if (totals.infoRows.length) {
    setText(sheet, "A", row, "특이사항");
    row += 1;
    for (const info of totals.infoRows) {
      setText(sheet, "A", row, info.label);
      setText(sheet, "B", row, info.value);
      mergeRow(merges, 1, 7, row);
      row += 1;
    }
    row += 1;
  }
  if (totals.termRows.length) {
    setText(sheet, "A", row, "거래 조건");
    row += 1;
    for (const term of totals.termRows) {
      setText(sheet, "A", row, `${term.no}.`);
      setText(sheet, "B", row, term.text);
      mergeRow(merges, 1, 7, row);
      row += 1;
    }
    row += 1;
  }
  if (String(quote.notes || "").trim()) {
    setText(sheet, "A", row, "비고");
    setText(sheet, "B", row, quote.notes);
    mergeRow(merges, 1, 7, row);
    row += 1;
  }

  sheet["!ref"] = `A1:H${Math.max(row, grandTotalRow, summaryStart)}`;
  sheet["!cols"] = COLUMN_WIDTHS.map((wch) => ({ wch }));
  sheet["!merges"] = merges;
  return { sheet, lastRow: row };
}

/** "1,200,000" → 1200000. 표시 문자열에서 캐시값을 되찾을 때만 쓴다(계산 아님). */
function toNumber(text: any): number | null {
  const cleaned = String(text ?? "").replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * 템플릿(.xlsx)이 있으면 셀의 {{자리표시자}} 를 값으로 바꾼다.
 * ★행 반복({{row.*}})은 아직 지원하지 않는다 — 표 행 삽입은 병합·수식 참조까지 흔들어서,
 *   지금은 기본 표 생성 경로가 더 안전하다. 그런 템플릿이면 그렇다고 말하고 멈춘다.
 */
function fillTemplate(templateBytes: Uint8Array, view: Record<string, any>): Uint8Array {
  const workbook = read(templateBytes, { type: "array", cellFormula: true, cellStyles: true });
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    for (const key of Object.keys(sheet)) {
      if (key.startsWith("!")) continue;
      const cell = sheet[key];
      if (!cell || cell.t !== "s" || typeof cell.v !== "string" || !cell.v.includes("{{")) continue;
      if (/\{\{(row|sum|info|term|item)\./.test(cell.v)) {
        throw new Error(
          "이 XLSX 서식은 행 반복({{row.*}})을 쓰고 있는데 아직 지원하지 않아요. " +
          "manifest 의 templates.xlsx 를 null 로 두면 표를 자동으로 만들어 드려요."
        );
      }
      cell.v = cell.v.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (match: string, path: string) => {
        const value = path.split(".").reduce((acc: any, part: string) => (acc == null ? acc : acc[part]), view);
        return value === undefined || value === null ? match : String(value);
      });
    }
  }
  return new Uint8Array(write(workbook, { type: "array", bookType: "xlsx" }));
}

/**
 * 견적서 XLSX 생성. templateBytes 가 있으면 그 템플릿에 값을 넣고, 없으면 기본 표를 만든다.
 * quote.totals 가 없으면(=계산 전) 만들지 않는다 — 금액 없는 견적서를 내보내지 않기 위해.
 */
export function renderXlsx(
  quote: Quote,
  view: Record<string, any>,
  templateBytes?: Uint8Array | null
): Uint8Array {
  if (!quote?.totals) throw new Error("totals 가 없어 XLSX 를 만들 수 없어요. 계산 엔진을 먼저 실행하세요.");
  if (templateBytes && templateBytes.byteLength) return fillTemplate(templateBytes, view);

  const { sheet } = buildQuoteSheet(quote);
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, sheet, SHEET_NAME);
  return new Uint8Array(write(workbook, { type: "array", bookType: "xlsx" }));
}
