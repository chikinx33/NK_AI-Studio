// 일괄 승인: 사용자가 채팅(또는 버튼 질문)에서 "승인"이라고 답하면, 그 답에 이어지는 디렉터 작업의
// 유료 호출(이미지·영상 생성)을 호출마다 승인 카드를 띄우지 않고 바로 실행한다(사용자 결정 2026-10-14).
// 스틸 8장이면 승인 카드 8개를 눌러야 했고, 대화가 카드로 길어졌다.
//
// 범위: 승인한 메시지 다음부터, 디렉터가 그 차례를 마칠 때(status_idle · end_turn)까지. 최대 60분.
// 사용자가 승인이 아닌 새 메시지를 보내면 바로 풀린다. 상태는 세션 metadata.autoApproveAt 에 둔다
// (Cloud Run 은 무상태이고, 메시지 요청과 스트림 중계가 다른 요청이라서).

export const AUTO_APPROVE_KEY = "autoApproveAt";
export const AUTO_APPROVE_MAX_MS = 60 * 60 * 1000;

// "승인 안 해", "미승인", "진행하지 마", "승인 보류", "승인하면 어떻게 돼?" 같은 부정·질문은 승인이 아니다.
const NEGATED = /미\s*승인|(승인|진행)\s*(은|는)?\s*(안|않|하지|말|못|보류|취소|전|대기|멈)|(안|못)\s*(승인|진행)|(승인|진행)\s*하면|[?？]\s*$/;
// "진행 상황", "진행 중" 같은 명사 쓰임은 빼고 "진행해/진행하자/진행 ㄱ" 같은 지시만 승인으로 본다.
const APPROVE = /승인|진행\s*(해|하자|하세요|합시다|시켜|ㄱ)/;

/** 사용자 글이 승인인지. 짧은 동의만이 아니라 "승인, 8장 다 가자" 같은 문장도 승인으로 본다. */
export function isApprovalText(text: unknown): boolean {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 300) return false;
  return APPROVE.test(t) && !NEGATED.test(t);
}

/** 버튼 질문 답 중 하나라도 승인 선택지(라벨에 "승인"·"진행")를 골랐는지. 건너뜀·취소는 승인이 아니다. */
export function answersApprove(answers: Array<{ choices?: string[]; other?: string; skipped?: boolean }>, cancelled: boolean): boolean {
  if (cancelled) return false;
  return (Array.isArray(answers) ? answers : []).some((a) => !a?.skipped &&
    [...(Array.isArray(a?.choices) ? a.choices : []), String(a?.other || "")].some(isApprovalText));
}

/** 세션 metadata 로 지금 일괄 승인이 살아 있는지. */
export function autoApproveActive(metadata: any, now = Date.now()): boolean {
  const at = Date.parse(String(metadata?.[AUTO_APPROVE_KEY] || ""));
  return Number.isFinite(at) && now - at >= 0 && now - at < AUTO_APPROVE_MAX_MS;
}

/** 디렉터가 차례를 마쳤는지(일괄 승인을 푸는 시점). 승인·질문 대기(requires_action)는 차례가 끝난 것이 아니다. */
export function turnEnded(ev: any): boolean {
  if (ev?.type === "session.status_terminated") return true;
  return ev?.type === "session.status_idle" && ev?.stop_reason?.type !== "requires_action";
}
