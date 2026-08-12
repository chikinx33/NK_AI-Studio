// prototype/functions/api/agent/_quote-math.ts
// 견적서 계산 엔진 — 설계서 docs/quote_document_engine_design_20260812.md §2·§3 의 구현체.
//
// ★ 금액의 단일 출처(SSOT). 계산은 오직 여기서만 한다.
//   - LLM 은 금액을 계산하지 않는다(§2.1). 서버가 모델 출력의 totals 를 지우고 이 함수 결과로 덮어쓴다.
//   - 클라이언트는 totals 를 '표시'만 한다. PDF·XLSX·채팅 미리보기의 금액이 갈라지는 사고를 원천 차단.
//   - 반올림은 Math.round 하나만 쓴다. 다른 반올림 헬퍼를 만들지 않는다(§3.2).

// ── quote/v1 타입 (§2) ───────────────────────────────────────────────────────

export type QuoteVatMode = "exclusive" | "inclusive" | "exempt";
export type QuoteDiscountType = "amount" | "percent";

export interface QuoteSupplier {
  name: string;
  bizNo?: string;
  ceo?: string;
  address?: string;
  tel?: string;
  email?: string;
  stampUrl?: string;
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
  no?: number;          // 코드가 채움
  name?: string;        // 필수
  spec?: string;        // 규격·비고 (선택)
  qty?: number | null;  // 필수
  unit?: string;        // 기본 "식"
  unitPrice?: number | null; // 필수. ★모르면 null (지어내기 금지)
  note?: string;
}

export interface QuoteDiscount {
  type: QuoteDiscountType;
  value: number;
  label?: string;
}

export interface QuoteVat {
  mode: QuoteVatMode;
  rate: number;
}

export interface QuoteRounding {
  unit: number;   // 1 | 10 | 100 | 1000
  mode: "floor";  // P0 는 절사 고정(§3.1 6단계)
}

export interface QuoteMissing {
  index?: number; // items 인덱스 (항목 단위 누락일 때만)
  field: string;  // "name" | "qty" | "unitPrice" | "client.company" | "supplier.name" | "items"
}

export interface QuoteTotals {
  lineAmounts: (number | null)[]; // 누락 항목은 null (부분 계산)
  subtotal: number;
  discountAmount: number;
  taxBase: number;
  supplyAmount: number;
  vatAmount: number;
  roundingAdj: number;            // 0 이 아니면 문서에 '단수조정' 행을 반드시 표시
  grandTotal: number | null;      // missing 이 있으면 null
  grandTotalKo: string | null;    // "금삼백팔십오만원정"
}

export interface Quote {
  schema: "quote/v1";
  docNo: string;      // 코드가 채움. Q-YYYYMMDD-NNN
  issuedAt: string;   // 코드가 채움. Asia/Seoul 기준 YYYY-MM-DD
  validUntil: string;
  title: string;
  supplier: QuoteSupplier; // 저장소에서 로드
  client: QuoteClient;
  currency: string;   // P0 는 KRW 고정
  items: QuoteItem[];
  discount: QuoteDiscount;
  vat: QuoteVat;
  rounding: QuoteRounding;
  terms: string[];
  notes: string;
  totals: QuoteTotals | null; // 계산엔진이 채움
  missing: QuoteMissing[];    // 계산엔진이 채움
}

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

// ── 한글 금액 (§3.3 grandTotalKo) ────────────────────────────────────────────

const KO_DIGITS = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const KO_SMALL_UNITS = ["", "십", "백", "천"];
const KO_BIG_UNITS = ["", "만", "억", "조", "경"];

/** 4자리 묶음 → 한글. 십·백·천 앞의 1은 생략한다(십오·백이십). */
function koreanGroup(group: number): string {
  const digits = String(group).split("").map(Number).reverse(); // 일의 자리부터
  let out = "";
  for (let i = digits.length - 1; i >= 0; i--) {
    const digit = digits[i];
    if (!digit) continue;
    out += (digit === 1 && i > 0 ? "" : KO_DIGITS[digit]) + KO_SMALL_UNITS[i];
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
  if (groups.length > KO_BIG_UNITS.length) return `금${Math.abs(total)}원정`; // 경 초과: 표기 포기(현실적으로 없음)
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

// ── 계산 (§3.1) ──────────────────────────────────────────────────────────────

/**
 * 견적서 합계 계산. 계산 순서는 설계서 §3.1 그대로이며 한 단계도 바꾸지 않는다.
 * missing 이 하나라도 있으면 부분 계산까지만 하고 grandTotal 은 null 로 둔다(§3.4).
 */
export function computeQuoteTotals(quote: Quote | any): { totals: QuoteTotals; missing: QuoteMissing[] } {
  const currency = String(quote?.currency || "KRW").toUpperCase();
  if (currency !== "KRW") throw new Error(`견적서는 원화(KRW)만 지원해요. (currency: ${currency})`);

  const items: QuoteItem[] = Array.isArray(quote?.items) ? quote.items : [];
  const missing: QuoteMissing[] = [];

  // §3.4 — 계산 전에 검사한다. 모르는 값을 시세·경험으로 채우지 않고 되묻기 위한 장치.
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
  if (items.length === 0) missing.push({ field: "items" });
  if (!String(quote?.client?.company ?? "").trim()) missing.push({ field: "client.company" });
  if (!String(quote?.supplier?.name ?? "").trim()) missing.push({ field: "supplier.name" });

  // 1. 항목별 금액 — qty 가 소수(0.5식)여도 금액은 정수 원.
  const lineAmounts: (number | null)[] = items.map((_, i) =>
    qtys[i] === null || prices[i] === null ? null : Math.round((qtys[i] as number) * (prices[i] as number))
  );

  // 2. 소계
  const subtotal = lineAmounts.reduce((sum: number, amount) => sum + (amount ?? 0), 0);

  // 3. 할인 — 0 ≤ discountAmount ≤ subtotal 로 clamp
  const discount = normalizeDiscount(quote?.discount);
  const discountRaw = discount.type === "percent"
    ? Math.round((subtotal * discount.value) / 100)
    : Math.round(discount.value);
  const discountAmount = Math.min(Math.max(discountRaw, 0), Math.max(subtotal, 0));

  // 4. 과세표준
  const taxBase = subtotal - discountAmount;

  // 5. 부가세 분기
  const vat = normalizeVat(quote?.vat);
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
  const rounding = normalizeRounding(quote?.rounding);
  const grandTotal = Math.floor(grandTotalRaw / rounding.unit) * rounding.unit;
  const roundingAdj = grandTotal - grandTotalRaw; // 음수 또는 0

  const complete = missing.length === 0;
  const totals: QuoteTotals = {
    lineAmounts,
    subtotal,
    discountAmount,
    taxBase,
    supplyAmount,
    vatAmount,
    roundingAdj: complete ? roundingAdj : 0,
    grandTotal: complete ? grandTotal : null,
    grandTotalKo: complete ? grandTotalKo(grandTotal) : null,
  };
  return { totals, missing };
}
