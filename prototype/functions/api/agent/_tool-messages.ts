// prototype/functions/api/agent/_tool-messages.ts
// 도구 실행 결과를 사람에게 보여줄 문구. 의존성이 없어야 테스트에서 바로 불러올 수 있다.

/**
 * 도구 실패 문구 — ★이유를 그대로 싣는다.
 *
 * 실측(2026-08-13, job 77a627f3): 서버는 "'standard-quote' 서식을 찾지 못했어요… 현재 등록:
 * quote-standard" 라는 정확한 이유를 만들었는데 화면엔 "오류가 발생했어요" 만 나왔다.
 * 사용자도 직원도 원인을 못 봐서 같은 실수를 반복했다.
 *
 * 이 문구는 대화 기록에 남아 다음 턴 컨텍스트로 들어간다 — 그래야 직원이 스스로 고쳐 재시도한다.
 */
export function toolFailureText(tool: string, reason: any): string {
  const raw = String(reason ?? "").trim();
  if (!raw) return `❌ ${tool} 생성 중 오류가 발생했어요. 다시 요청해 주세요.`;
  // 길면 자르되 자른 사실을 남긴다(조용한 절단 금지 — 뒤가 잘렸는지 모르면 진단이 어긋난다).
  const shown = raw.length > 300 ? `${raw.slice(0, 300)}… (이하 생략)` : raw;
  return `❌ ${tool} 실패: ${shown}`;
}

/**
 * 도구 성공 문구.
 * ★"완료"는 정말로 결과물이 생겼을 때만 쓴다. 서식이 값이 모자라 멈춘 경우(needs_input)는
 *   아무것도 만들어지지 않았으므로 '완료'라고 하면 안 되고, 검수(보고)로 보내서도 안 된다.
 *   진행 허락·정보 요청은 '승인', 끝난 결과물은 '보고' — 이 구분이 흐려지면 사람이 길을 잃는다.
 */
export function toolDoneText(tool: string, output: any, extra = ""): string {
  if (output?.kind === "form" && output?.status === "needs_input") {
    return "⏸ 아직 만들지 않았어요. 오른쪽 '승인'에서 부족한 값을 알려주시면 이어서 만들게요.";
  }
  if (output?.kind === "form") {
    return `✅ ${output?.formName || "서식"} 작성 완료. 오른쪽 '보고'에서 미리보기·내려받기 하세요.${extra}`;
  }
  if (tool === "ppt") return "✅ PPT 완성! 오른쪽 **검수 패널**에서 .pptx 다운로드 버튼을 눌러주세요.";
  if (tool === "pdf") return "✅ PDF 완성! 오른쪽 **검수 패널**에서 PDF 프린트 버튼을 눌러주세요.";
  return `✅ ${tool} 작업 완료. 검수 패널에서 확인하세요.${extra}`;
}
