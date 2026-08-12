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
