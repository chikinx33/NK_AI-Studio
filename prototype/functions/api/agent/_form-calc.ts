// prototype/functions/api/agent/_form-calc.ts
// 서식 계산 엔진 — 설계서 docs/form_document_engine_design_v2_20260812.md §3·§4 의 구현체.
//
// ★ 금액의 단일 출처(SSOT). 계산은 오직 여기서만 한다.
//   - LLM 은 금액을 계산하지 않는다(§3.1). 서버가 모델 출력의 totals 를 지우고 이 결과로 덮어쓴다.
//   - 렌더러(DOCX·HWPX·…)는 여기서 나온 totals 를 '표시'만 한다.
//     포맷마다 계산하면 파일마다 금액이 갈라진다.
//   - 반올림은 Math.round 하나만 쓴다. 다른 반올림 헬퍼를 만들지 않는다(§4.2).
//
// 문서에 찍히는 '행'도 여기서 만든다(totals.rows·summaryRows·infoRows·termRows).
// 표준 서식(_서식/견적서-표준)이 이 배열들을 그대로 반복해 찍기 때문이다.
//
// calculator 는 manifest.json 의 이름으로 조회한다(§2.2). 계산이 필요 없는 서식은 "none".

// ── quote/v1 타입 (§3) ───────────────────────────────────────────────────────

export type QuoteVatMode = "exclusive" | "inclusive" | "exempt";
export type QuoteDiscountType = "amount" | "percent";
export type QuoteCostType = "work" | "expense";

export interface QuotePaymentInfo {
  bank?: string;
  accountHolder?: string;
  accountNo?: string;
  terms?: string;
}

export interface QuoteSupplier {
  name: string;
  bizNo?: string;
  ceo?: string;
  bizType?: string;   // 업태
  bizItem?: string;   // 종목
  address?: string;
  tel?: string;
  fax?: string;
  email?: string;
  manager?: string;
  managerTel?: string;
  stampUrl?: string;
  payment?: QuotePaymentInfo;
}

export interface QuoteClient {
  company: string;
  person?: string;
  title?: string;
  tel?: string;
  email?: string;
  address?: string;
}

export interface QuoteItem {
  no?: number;               // 코드가 채움
  group?: string;            // 구간(기획·제작·수정 …). 없으면 그룹 없이 나열
  costType?: QuoteCostType;  // expense = 실비. 표에서 따로 묶인다
  name?: string;             // 필수
  spec?: string;
  qty?: number | null;       // 필수
  unit?: string;             // 기본 "식"
  unitPrice?: number | null; // 필수. ★모르면 null (지어내기 금지)
  note?: string;
}

export interface QuoteDiscount { type: QuoteDiscountType; value: number; label?: string }
export interface QuoteVat { mode: QuoteVatMode; rate: number }
export interface QuoteRounding { unit: number; mode: "floor" }
export interface QuoteDelivery { dueDate?: string; place?: string }

/** 무엇이 비었는지. index 는 items 인덱스(항목 단위 결손일 때만). */
export interface FormMissing {
  index?: number;
  field: string;
  reason?: string;
}

/** 표의 한 줄. 값은 전부 서식이 입혀진 문자열(§9.3 — 템플릿에 서식 문자열을 넣지 않는다). */
export interface QuoteRow {
  kind: "item" | "group" | "subtotal" | "expenseHead";
  no: string;
  name: string;
  spec: string;
  qty: string;
  unit: string;
  unitPrice: string;
  amount: string;
  note: string;
}

export interface QuoteTotals {
  lineAmounts: (number | null)[]; // 결손 항목은 null (부분 계산)
  subtotal: number;
  discountAmount: number;
  taxBase: number;
  supplyAmount: number;
  vatAmount: number;
  roundingAdj: number;            // 0 이 아니면 문서에 '단수조정' 행을 반드시 표시
  grandTotal: number | null;      // missing 이 있으면 null
  grandTotalKo: string | null;    // "금삼백팔십오만원정"
  grandTotalText: string;         // "금삼백팔십오만원정  (₩3,850,000)"
  workAmount: number;
  expenseAmount: number;
  groupSubtotals: { group: string; amount: number }[];
  rows: QuoteRow[];
  summaryRows: { label: string; amount: string }[];
  infoRows: { label: string; value: string }[];
  termRows: { no: string; text: string }[];
}

export interface Quote {
  schema: "quote/v1";
  docNo: string;      // 코드가 채움. Q-YYYYMMDD-NNN
  issuedAt: string;   // 코드가 채움. Asia/Seoul 기준 YYYY-MM-DD
  validUntil: string;
  title: string;
  supplier: QuoteSupplier; // 코드가 채움(저장소에서 로드)
  client: QuoteClient;
  payment: QuotePaymentInfo;
  delivery: QuoteDelivery;
  currency: string;   // P0 는 KRW 고정
  items: QuoteItem[];
  discount: QuoteDiscount;
  vat: QuoteVat;
  rounding: QuoteRounding;
  terms: string[];
  notes: string;
  totals: QuoteTotals | null; // 계산엔진이 채움
  missing: FormMissing[];     // 계산엔진이 채움
}

/** 계산기 공통 계약 — manifest.calculator 이름으로 조회한다. */
export interface CalculatorResult {
  totals: QuoteTotals | null;
  missing: FormMissing[];
}
export type FormCalculator = (data: any, options: { maxItemRows: number }) => CalculatorResult;

// ── 입력 정규화 ──────────────────────────────────────────────────────────────

/**
 * "3,000,000" · "3000000원" 같은 표기를 숫자로 되돌린다.
 * 값이 없거나 숫자로 읽히지 않으면 null — ★없는 값을 만들어내지 않는다.
 */
export function toAmountNumber(value: any): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[,\s₩원]/g, "");
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeDiscount(raw: any): QuoteDiscount {
  const type: QuoteDiscountType = String(raw?.type || "amount") === "percent" ? "percent" : "amount";
  const value = toAmountNumber(raw?.value) ?? 0;
  return { type, value: value > 0 ? value : 0, label: String(raw?.label || "") };
}

export function normalizeVat(raw: any): QuoteVat {
  const modeRaw = String(raw?.mode || "exclusive").toLowerCase();
  const mode: QuoteVatMode =
    modeRaw === "inclusive" ? "inclusive" : modeRaw === "exempt" ? "exempt" : "exclusive";
  let rate = toAmountNumber(raw?.rate);
  if (rate === null || rate < 0 || rate > 1) rate = 0.1;
  return { mode, rate: mode === "exempt" ? 0 : rate };
}

export function normalizeRounding(raw: any): QuoteRounding {
  const unit = toAmountNumber(raw?.unit) ?? 1;
  const allowed = [1, 10, 100, 1000];
  return { unit: allowed.includes(unit) ? unit : 1, mode: "floor" };
}

// ── 금액 표기 ────────────────────────────────────────────────────────────────

/** 1234567 → "1,234,567". null 이면 "—" (아직 모르는 값이라는 표시). */
export function formatKrw(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return Math.round(Number(value)).toLocaleString("ko-KR");
}

const KO_DIGITS = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const KO_SMALL_UNITS = ["", "십", "백", "천"];
const KO_BIG_UNITS = ["", "만", "억", "조", "경"];

/**
 * 4자리 묶음 → 한글. 금액 표기라 '일'을 생략하지 않는다(일십오·일백만).
 * 생략하면 글자 사이에 숫자를 끼워 넣기 쉬워져서, 금액 한글 병기의 목적(위변조 방지)이 사라진다.
 */
function koreanGroup(group: number): string {
  const digits = String(group).split("").map(Number).reverse(); // 일의 자리부터
  let out = "";
  for (let i = digits.length - 1; i >= 0; i--) {
    const digit = digits[i];
    if (!digit) continue;
    out += KO_DIGITS[digit] + KO_SMALL_UNITS[i];
  }
  return out;
}

/** 3850000 → "금삼백팔십오만원정". 위변조 방지용 관행 표기. */
export function grandTotalKo(amount: number): string {
  const total = Math.round(Number(amount) || 0);
  if (total === 0) return "금영원정";
  const negative = total < 0;
  let rest = Math.abs(total);
  const groups: number[] = [];
  while (rest > 0) {
    groups.push(rest % 10000);
    rest = Math.floor(rest / 10000);
  }
  if (groups.length > KO_BIG_UNITS.length) return `금${Math.abs(total)}원정`; // 경 초과: 현실적으로 없음
  let text = "";
  for (let i = groups.length - 1; i >= 0; i--) {
    if (!groups[i]) continue;
    text += koreanGroup(groups[i]) + KO_BIG_UNITS[i];
  }
  return `금${negative ? "마이너스" : ""}${text}원정`;
}

// ── 기본 거래 조건 (§5) ──────────────────────────────────────────────────────

/** 사용자가 조건을 말하지 않았을 때 넣는 기본 5개. 2번은 vat.mode 에 따라 치환된다. */
export function defaultQuoteTerms(mode: QuoteVatMode): string[] {
  const vatLine =
    mode === "inclusive" ? "상기 금액은 부가가치세 포함 금액입니다."
    : mode === "exempt" ? "상기 거래는 면세 대상 거래입니다."
    : "상기 금액은 부가가치세 별도 금액입니다.";
  return [
    "본 견적서의 유효기간은 발행일로부터 30일입니다.",
    vatLine,
    "대금 지급 조건은 계약 체결 시 50%, 납품 완료 시 50%입니다.",
    "작업 범위 변경 시 별도 협의 후 견적을 재산정합니다.",
    "본 견적에 명시되지 않은 항목은 포함되지 않습니다.",
  ];
}

// ── 문서에 찍히는 행 모델 ────────────────────────────────────────────────────
// 그룹 소계·실비 구분처럼 '어떻게 보일지'를 여기서 정한다. 렌더러는 배열을 행에 옮기기만 한다.

const emptyRow = (kind: QuoteRow["kind"], name: string, amount = ""): QuoteRow => ({
  kind, no: "", name, spec: "", qty: "", unit: "", unitPrice: "", amount, note: "",
});

function buildRows(items: QuoteItem[], lineAmounts: (number | null)[]): {
  rows: QuoteRow[];
  groupSubtotals: { group: string; amount: number }[];
  workAmount: number;
  expenseAmount: number;
} {
  const itemRow = (item: QuoteItem, index: number): QuoteRow => ({
    kind: "item",
    no: String(index + 1),
    name: String(item?.name || ""),
    spec: String(item?.spec || ""),
    qty: item?.qty === null || item?.qty === undefined ? "" : String(item.qty),
    unit: String(item?.unit || ""),
    unitPrice: formatKrw(toAmountNumber(item?.unitPrice)),
    amount: formatKrw(lineAmounts[index] ?? null),
    note: String(item?.note || ""),
  });

  const isExpense = (item: QuoteItem) => String(item?.costType || "work") === "expense";
  const groupNameOf = (item: QuoteItem) => String(item?.group || "").trim();

  const workIndexes = items.map((_, i) => i).filter((i) => !isExpense(items[i]));
  const expenseIndexes = items.map((_, i) => i).filter((i) => isExpense(items[i]));

  // 그룹은 처음 나온 순서를 지킨다(사용자가 말한 순서 = 견적서에 찍히는 순서).
  const groupOrder: string[] = [];
  for (const i of workIndexes) {
    const group = groupNameOf(items[i]);
    if (!groupOrder.includes(group)) groupOrder.push(group);
  }

  const rows: QuoteRow[] = [];
  const groupSubtotals: { group: string; amount: number }[] = [];
  let workAmount = 0;

  if (!groupOrder.some(Boolean)) {
    // 그룹을 안 쓰는 단순 견적서 — 머리행·소계행 없이 항목만 찍는다.
    for (const i of workIndexes) {
      rows.push(itemRow(items[i], i));
      workAmount += lineAmounts[i] ?? 0;
    }
  } else {
    for (const group of groupOrder) {
      const indexes = workIndexes.filter((i) => groupNameOf(items[i]) === group);
      if (!indexes.length) continue;
      const amount = indexes.reduce((sum, i) => sum + (lineAmounts[i] ?? 0), 0);
      if (group) {
        rows.push(emptyRow("group", `■ ${group}`));
        groupSubtotals.push({ group, amount });
      }
      for (const i of indexes) rows.push(itemRow(items[i], i));
      if (group) rows.push(emptyRow("subtotal", "소계", formatKrw(amount)));
      workAmount += amount;
    }
  }

  let expenseAmount = 0;
  if (expenseIndexes.length) {
    expenseAmount = expenseIndexes.reduce((sum, i) => sum + (lineAmounts[i] ?? 0), 0);
    rows.push(emptyRow("expenseHead", "■ 실비"));
    for (const i of expenseIndexes) rows.push(itemRow(items[i], i));
    rows.push(emptyRow("subtotal", "실비 소계", formatKrw(expenseAmount)));
  }

  return { rows, groupSubtotals, workAmount, expenseAmount };
}

/** 합계 블록. 0원인 줄(할인·단수조정)은 넣지 않는다 — 없는 항목을 굳이 보여주지 않는다. */
function buildSummaryRows(
  amounts: { subtotal: number; discountAmount: number; supplyAmount: number; vatAmount: number; roundingAdj: number; grandTotal: number | null },
  vatMode: QuoteVatMode
): { label: string; amount: string }[] {
  const rows: { label: string; amount: string }[] = [{ label: "소계", amount: formatKrw(amounts.subtotal) }];
  if (amounts.discountAmount > 0) rows.push({ label: "할인", amount: `-${formatKrw(amounts.discountAmount)}` });
  if (vatMode === "inclusive") rows.push({ label: "공급가액", amount: formatKrw(amounts.supplyAmount) });
  rows.push({ label: vatMode === "exempt" ? "부가세 (면세)" : "부가세", amount: formatKrw(amounts.vatAmount) });
  if (amounts.roundingAdj !== 0) rows.push({ label: "단수조정", amount: formatKrw(amounts.roundingAdj) });
  rows.push({ label: "합계", amount: formatKrw(amounts.grandTotal) });
  return rows;
}

/** 특이사항 — 값이 있는 줄만. 빈 칸을 남기면 문서가 미완성으로 보인다. */
function buildInfoRows(data: any): { label: string; value: string }[] {
  const payment = data?.payment || {};
  const supplierPayment = data?.supplier?.payment || {};
  const bank = String(payment.bank || supplierPayment.bank || "").trim();
  const accountNo = String(payment.accountNo || supplierPayment.accountNo || "").trim();
  const holder = String(payment.accountHolder || supplierPayment.accountHolder || data?.supplier?.name || "").trim();
  const account = bank && accountNo ? `${bank} ${accountNo}${holder ? ` (예금주 ${holder})` : ""}` : "";

  return [
    { label: "유효기간", value: data?.validUntil ? `${data.validUntil} 까지` : "" },
    { label: "납기일", value: String(data?.delivery?.dueDate || "").trim() },
    { label: "납품장소", value: String(data?.delivery?.place || "").trim() },
    { label: "결제조건", value: String(payment.terms || "").trim() },
    { label: "입금계좌", value: account },
  ].filter((row) => !!row.value);
}

// ── quote-calc-v1 (§4.1) ─────────────────────────────────────────────────────

/**
 * 견적서 합계 계산. 계산 순서는 설계서 §4.1 그대로이며 한 단계도 바꾸지 않는다.
 * missing 이 하나라도 있으면 부분 계산까지만 하고 grandTotal 은 null 로 둔다(§4.4).
 */
export function computeQuoteTotals(
  data: any,
  options: { maxItemRows?: number } = {}
): CalculatorResult {
  const currency = String(data?.currency || "KRW").toUpperCase();
  if (currency !== "KRW") throw new Error(`견적서는 원화(KRW)만 지원해요. (currency: ${currency})`);

  const maxItemRows = Math.max(1, Number(options.maxItemRows || 0) || 20);
  const items: QuoteItem[] = Array.isArray(data?.items) ? data.items : [];
  const missing: FormMissing[] = [];

  // §4.4 — 계산 전에 검사한다. 모르는 값을 시세·경험으로 채우지 않고 되묻기 위한 장치.
  const qtys: (number | null)[] = [];
  const prices: (number | null)[] = [];
  items.forEach((item, index) => {
    if (!String(item?.name ?? "").trim()) missing.push({ index, field: "name" });

    const qty = toAmountNumber(item?.qty);
    if (qty === null || Number.isNaN(qty) || qty < 0) {
      missing.push({ index, field: "qty" });
      qtys.push(null);
    } else qtys.push(qty);

    const unitPrice = toAmountNumber(item?.unitPrice);
    if (unitPrice === null || Number.isNaN(unitPrice) || unitPrice < 0) {
      missing.push({ index, field: "unitPrice" });
      prices.push(null);
    } else prices.push(unitPrice);
  });
  // 항목이 하나도 없으면 0원짜리 견적서가 만들어진다 — 그것도 되물어야 할 결손이다.
  if (items.length === 0) missing.push({ field: "items", reason: "empty" });
  if (!String(data?.client?.company ?? "").trim()) missing.push({ field: "client.company" });
  if (!String(data?.supplier?.name ?? "").trim()) missing.push({ field: "supplier.name" });

  // 1. 항목별 금액 — qty 가 소수(0.5식)여도 금액은 정수 원.
  const lineAmounts: (number | null)[] = items.map((_, i) =>
    qtys[i] === null || prices[i] === null ? null : Math.round((qtys[i] as number) * (prices[i] as number))
  );

  // 2. 소계
  const subtotal = lineAmounts.reduce((sum: number, amount) => sum + (amount ?? 0), 0);

  // 3. 할인 — 0 ≤ discountAmount ≤ subtotal 로 clamp
  const discount = normalizeDiscount(data?.discount);
  const discountRaw = discount.type === "percent"
    ? Math.round((subtotal * discount.value) / 100)
    : Math.round(discount.value);
  const discountAmount = Math.min(Math.max(discountRaw, 0), Math.max(subtotal, 0));

  // 4. 과세표준
  const taxBase = subtotal - discountAmount;

  // 5. 부가세 분기
  const vat = normalizeVat(data?.vat);
  let supplyAmount = taxBase;
  let vatAmount = 0;
  let grandTotalRaw = taxBase;
  if (vat.mode === "exclusive") {
    vatAmount = Math.round(taxBase * vat.rate);
    supplyAmount = taxBase;
    grandTotalRaw = taxBase + vatAmount;
  } else if (vat.mode === "inclusive") {
    supplyAmount = Math.round(taxBase / (1 + vat.rate));
    vatAmount = taxBase - supplyAmount;
    grandTotalRaw = taxBase;
  } else {
    vatAmount = 0;
    supplyAmount = taxBase;
    grandTotalRaw = taxBase;
  }

  // 6·7. 원단위 절사와 단수조정
  const rounding = normalizeRounding(data?.rounding);
  const grandTotal = Math.floor(grandTotalRaw / rounding.unit) * rounding.unit;
  const roundingAdj = grandTotal - grandTotalRaw; // 음수 또는 0

  // 표에 찍을 행 — 그룹 머리행·소계행까지 포함해서 서식의 행 수와 비교해야 한다.
  const { rows, groupSubtotals, workAmount, expenseAmount } = buildRows(items, lineAmounts);
  if (rows.length > maxItemRows) missing.push({ field: "items", reason: "overflow" });

  const complete = missing.length === 0;
  const finalGrandTotal = complete ? grandTotal : null;
  const finalRoundingAdj = complete ? roundingAdj : 0;
  const ko = complete ? grandTotalKo(grandTotal) : null;

  const totals: QuoteTotals = {
    lineAmounts,
    subtotal,
    discountAmount,
    taxBase,
    supplyAmount,
    vatAmount,
    roundingAdj: finalRoundingAdj,
    grandTotal: finalGrandTotal,
    grandTotalKo: ko,
    grandTotalText: ko ? `${ko}  (₩${formatKrw(grandTotal)})` : "—",
    workAmount,
    expenseAmount,
    groupSubtotals,
    rows,
    summaryRows: buildSummaryRows(
      { subtotal, discountAmount, supplyAmount, vatAmount, roundingAdj: finalRoundingAdj, grandTotal: finalGrandTotal },
      vat.mode
    ),
    infoRows: buildInfoRows(data),
    termRows: (Array.isArray(data?.terms) ? data.terms : [])
      .map((term: any) => String(term || "").trim())
      .filter(Boolean)
      .map((text: string, index: number) => ({ no: String(index + 1), text })),
  };
  return { totals, missing };
}

// ── 계산기 레지스트리 ────────────────────────────────────────────────────────
// manifest.json 의 calculator 이름으로 찾는다. 계산이 필요 없는 서식은 "none" —
// 그때는 코드 수정 없이 템플릿 + manifest 만으로 새 서식이 동작한다(§2.3).

const CALCULATORS: Record<string, FormCalculator> = {
  "quote-calc-v1": (data, options) => computeQuoteTotals(data, options),
  none: () => ({ totals: null, missing: [] }),
};

export function getCalculator(name: string): FormCalculator {
  const key = String(name || "none").trim() || "none";
  const calculator = CALCULATORS[key];
  if (!calculator) {
    throw new Error(
      `서식 manifest 의 calculator "${key}" 를 모릅니다. 계산이 필요 없는 서식이면 "none" 으로 두세요. ` +
      `(사용 가능: ${Object.keys(CALCULATORS).join(", ")})`
    );
  }
  return calculator;
}

export function knownCalculators(): string[] {
  return Object.keys(CALCULATORS);
}

// ── 렌더 차단 (§6 공통 규칙) ─────────────────────────────────────────────────
// "missing 이 있으면 렌더러 진입 즉시 return" 은 렌더러 4곳 모두에 있어야 한다.
// 위쪽(runFormFillTool)에서 이미 막지만 그건 방어선 하나다. 렌더러를 직접 부르는 코드가
// 하나라도 생기면 반쯤 빈 견적서가 고객에게 나갈 수 있어서, 렌더러 자체도 거절하게 만든다.

const MISSING_FIELD_LABELS: Record<string, string> = {
  name: "품명",
  qty: "수량",
  unitPrice: "단가",
  "client.company": "고객사 이름",
  "supplier.name": "우리 회사 정보(_회사정보/공급자.json)",
  items: "견적 항목",
};

/** 무엇이 비었는지 사람 말로 한 줄. 항목마다 따로 나열하지 않고 필드별로 묶는다. */
export function describeMissing(missing: FormMissing[] | undefined | null): string {
  if (!missing?.length) return "";
  const byLabel = new Map<string, number[]>();
  for (const entry of missing) {
    const label = entry.reason === "overflow"
      ? "서식의 행 수보다 많은 항목"
      : MISSING_FIELD_LABELS[entry.field] || entry.field;
    const rows = byLabel.get(label) || [];
    if (typeof entry.index === "number") rows.push(entry.index + 1);
    byLabel.set(label, rows);
  }
  return [...byLabel.entries()]
    .map(([label, rows]) => (rows.length ? `${label}(${rows.join("·")}번 항목)` : label))
    .join(", ");
}

/**
 * 부족한 값이 있으면 문서를 만들지 않는다. 렌더러 맨 앞에서 부른다.
 * quote 든 view 든 missing 배열만 있으면 된다.
 */
export function assertRenderable(source: any, formatLabel: string): void {
  const missing: FormMissing[] | undefined = Array.isArray(source?.missing)
    ? source.missing
    : Array.isArray(source?.data?.missing)
      ? source.data.missing
      : undefined;
  if (!missing?.length) return;
  // 행 넘침은 '비어 있음'이 아니라 '너무 많음'이다 — 할 일이 다르니 문구도 다르게.
  const overflow = missing.find((entry) => entry.reason === "overflow");
  if (overflow) {
    throw new Error(
      `${formatLabel}: 항목이 서식의 행 수를 넘습니다. 서식의 행을 늘리거나 항목을 줄여 주세요.`
    );
  }
  throw new Error(
    `아직 ${formatLabel} 를 만들 수 없어요 — ${describeMissing(missing)}이(가) 비어 있어요. ` +
    "부족한 값을 알려주시면 바로 만들어 드릴게요."
  );
}

// ── 템플릿에 넘길 뷰 ─────────────────────────────────────────────────────────
// 템플릿 작성자가 알아야 할 키는 설계서 §9 와 이 함수뿐이다.
//   단순 값   {docNo} {client.company} {supplier.bizType} {totals.grandTotalText} {notes}
//   항목 표   {#totals.rows} … {no} {name} {spec} {qty} {unit} {unitPrice} {amount} {note}
//   합계      {#totals.summaryRows} … {label} {amount}
//   특이사항  {#totals.infoRows} … {label} {value}
//   거래조건  {#totals.termRows} … {no} {text}
// (HWPX 는 같은 자료를 {{row.*}} {{sum.*}} {{info.*}} {{term.*}} 로 쓴다 — manifest.repeaters)

export function buildQuoteView(quote: Quote | any): Record<string, any> {
  const view = buildQuoteViewNested(quote);
  // 템플릿의 {client.company} 는 docxtemplater 기본 파서가 "client.company" 라는 이름 하나로 찾는다.
  // 점 표기를 쓰려면 표현식 파서를 붙이거나(§6.1에서 금지) 키를 펼쳐 두거나 둘 중 하나인데,
  // 펼치는 쪽은 실행 코드가 전혀 늘지 않는다. 그래서 중첩 구조와 펼친 키를 함께 넘긴다.
  return { ...view, ...flattenView(view) };
}

/** {a.b} 형태로도 찾을 수 있게 중첩 객체를 점 표기 키로 펼친다(배열은 통째로 둔다). */
function flattenView(source: Record<string, any>, prefix = "", out: Record<string, any> = {}): Record<string, any> {
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) flattenView(value, path, out);
    else if (prefix) out[path] = value;
  }
  return out;
}

function buildQuoteViewNested(quote: Quote | any): Record<string, any> {
  const totals: QuoteTotals | null = quote?.totals || null;
  const vat = normalizeVat(quote?.vat);
  const discount = normalizeDiscount(quote?.discount);

  return {
    // 렌더러가 스스로 "이건 못 만든다"를 판단할 수 있게 결손 목록도 함께 넘긴다(§6 이중 방어).
    missing: Array.isArray(quote?.missing) ? quote.missing : [],
    docNo: String(quote?.docNo || ""),
    issuedAt: String(quote?.issuedAt || ""),
    validUntil: String(quote?.validUntil || ""),
    title: String(quote?.title || ""),
    notes: String(quote?.notes || ""),
    supplier: { ...(quote?.supplier || {}) },
    client: { ...(quote?.client || {}) },
    payment: { ...(quote?.payment || {}) },
    delivery: { ...(quote?.delivery || {}) },
    // 항목 표는 totals.rows 를 쓴다. items 는 원자료라 그룹·소계 행이 없다.
    items: totals?.rows || [],
    terms: (Array.isArray(quote?.terms) ? quote.terms : []).map((term: any) => String(term || "")),
    vat: {
      mode: vat.mode,
      modeLabel: vat.mode === "inclusive" ? "부가가치세 포함" : vat.mode === "exempt" ? "면세" : "부가가치세 별도",
      ratePercent: `${Math.round(vat.rate * 100)}%`,
    },
    discount: {
      // 조건부 표시({#discount.value})가 0원에서 꺼지도록 숫자를 그대로 둔다.
      value: totals?.discountAmount ?? 0,
      label: String(discount.label || (discount.type === "percent" ? `할인 ${discount.value}%` : "할인")),
      text: formatKrw(totals?.discountAmount ?? 0),
    },
    totals: {
      rows: totals?.rows || [],
      summaryRows: totals?.summaryRows || [],
      infoRows: totals?.infoRows || [],
      termRows: totals?.termRows || [],
      subtotal: formatKrw(totals?.subtotal ?? null),
      discountAmount: formatKrw(totals?.discountAmount ?? null),
      taxBase: formatKrw(totals?.taxBase ?? null),
      supplyAmount: formatKrw(totals?.supplyAmount ?? null),
      vatAmount: formatKrw(totals?.vatAmount ?? null),
      roundingAdj: formatKrw(totals?.roundingAdj ?? 0),
      workAmount: formatKrw(totals?.workAmount ?? null),
      expenseAmount: formatKrw(totals?.expenseAmount ?? null),
      grandTotal: formatKrw(totals?.grandTotal ?? null),
      grandTotalKo: String(totals?.grandTotalKo || ""),
      grandTotalText: String(totals?.grandTotalText || ""),
    },
    hasDiscount: Boolean(totals?.discountAmount),
    hasRoundingAdj: Boolean(totals?.roundingAdj),
    hasExpense: Boolean(totals?.expenseAmount),
    hasNotes: Boolean(String(quote?.notes || "").trim()),
  };
}
