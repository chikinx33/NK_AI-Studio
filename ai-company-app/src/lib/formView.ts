// 서식 카드/미리보기의 순수 규칙 — 설계서 §6.5.
// 컴포넌트(.tsx)에서 떼어 둔 이유는 하나다: 여기만 테스트로 고정할 수 있기 때문이다.
import type { FormOutput } from "./api";

export type FormState = "needs_input" | "ready" | "error";

/**
 * 상태 판정 — ★서버가 준 output.status 하나만 본다.
 * files.length 같은 걸로 추측하면 "만들다 만 것"과 "다 만든 것"이 섞여 보인다.
 */
export function formState(output: Partial<FormOutput> | null | undefined): FormState {
  const status = String(output?.status || "");
  if (status === "needs_input") return "needs_input";
  if (status === "error") return "error";
  return "ready";
}

export const MISSING_LABEL: Record<string, string> = {
  name: "품명", qty: "수량", unitPrice: "단가",
  "client.company": "고객사 이름",
  "supplier.name": "우리 회사 정보 (공급자.json)",
  items: "견적 항목",
};

/** 이 값을 알려 달라고 물을 때 채팅에 채워 줄 문장 조각. */
const MISSING_PROMPT: Record<string, string> = {
  "client.company": "고객사는 (회사명)",
  "supplier.name": "우리 회사 정보는 상호 (), 사업자번호 (), 대표 ()",
  name: "품명은 ()",
  qty: "수량은 ()",
  unitPrice: "단가는 (원)",
  items: "견적 항목은 ()",
};

/**
 * 부족한 값 목록 — ★문장으로 합치지 않는다.
 * 한 줄로 이어 붙이면 무엇을 몇 개 알려줘야 하는지 눈으로 세기 어렵다(§6.5 A).
 * 목록은 반드시 실제 missing 에서 만든다 — 예전엔 "단가가 비어 있어요"가 앞머리에 박혀 있어
 * 단가는 멀쩡하고 고객사만 비었을 때도 단가를 탓했다.
 */
export function missingItems(missing?: FormOutput["missing"]): string[] {
  if (!missing?.length) return [];
  const byLabel = new Map<string, number[]>();
  for (const entry of missing) {
    const label = entry.reason === "overflow"
      ? "서식의 행 수보다 많은 항목 (행을 늘리거나 항목을 줄여 주세요)"
      : MISSING_LABEL[entry.field] || entry.field;
    const rows = byLabel.get(label) || [];
    if (typeof entry.index === "number") rows.push(entry.index + 1);
    byLabel.set(label, rows);
  }
  return [...byLabel.entries()].map(([label, rows]) => (rows.length ? `${label} (${rows.join("·")}번 항목)` : label));
}

/** 한 줄 요약이 필요한 곳에서 쓴다. 목록이 필요하면 missingItems 를 쓴다. */
export function describeMissing(missing?: FormOutput["missing"]): string {
  return missingItems(missing).join(", ");
}

/** 채팅 입력창에 채워 줄 문구 — 사용자가 빈칸만 채우면 되도록. */
export function continuePrompt(output: Partial<FormOutput>): string {
  const parts: string[] = [];
  for (const entry of output.missing || []) {
    if (entry.reason === "overflow") continue;
    const template = MISSING_PROMPT[entry.field] || `${entry.field} 은(는) ()`;
    parts.push(typeof entry.index === "number" ? `${entry.index + 1}번 항목 ${template}` : template);
  }
  const subject = output.data?.title || output.formName || "서식";
  if (!parts.length) return `${subject} 이어서 만들어줘.`;
  return `${parts.join(", ")} 야. 이대로 ${subject} 이어서 만들어줘.`;
}
