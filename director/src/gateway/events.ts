// Managed Agents 세션 이벤트 → 화면(SSE) 이벤트. 순수 함수라 단위 테스트한다.

export type ClientEvent =
  | { type: "text_start"; id: string }
  | { type: "text_delta"; id: string; text: string }
  | { type: "message"; id: string; text: string; at?: string }
  | { type: "user_message"; id: string; text: string; images: number; at?: string }
  | { type: "thinking" }
  | { type: "tool_use"; id: string; name: string; server: string; input: any; permission?: string; at?: string }
  | { type: "tool_result"; id: string; toolUseId: string; isError: boolean; preview: string }
  | { type: "approval_request"; eventId: string; tool: string; input: any; quote?: any }
  | { type: "question"; eventId: string; questions: Question[] }
  | { type: "question_answered"; toolUseId: string; text: string }
  | { type: "status"; status: string; stopReason?: string; eventIds?: string[] }
  | { type: "usage"; listCostCents: number; charged?: number; available?: number; owner?: boolean }
  | { type: "notice"; level: "info" | "warn" | "error"; text: string };

const TOOL_RESULT_PREVIEW = 1200;

/** 디렉터가 사용자에게 버튼으로 묻는 도구(Managed Agents custom tool). 화면이 답을 user.custom_tool_result 로 돌려준다. */
export const ASK_TOOL = "ask_user";
export interface QuestionOption { label: string; description?: string; recommended?: boolean }
export interface Question { question: string; header?: string; multiSelect?: boolean; options: QuestionOption[] }
export interface QuestionAnswer { question?: string; choices?: string[]; other?: string; skipped?: boolean }

const clip = (v: any, n: number) => String(v ?? "").trim().slice(0, n);

/** 에이전트가 준 질문 입력을 화면에 그릴 수 있는 모양으로 다듬는다(질문 1~4개, 선택지 2~6개). */
export function normalizeQuestions(input: any): Question[] {
  const raw = Array.isArray(input?.questions) ? input.questions : input?.question ? [input] : [];
  return raw.slice(0, 4).map((q: any) => ({
    question: clip(q?.question, 500),
    header: clip(q?.header, 24) || undefined,
    multiSelect: q?.multiSelect === true,
    options: (Array.isArray(q?.options) ? q.options : []).slice(0, 6)
      .map((o: any) => typeof o === "string" ? { label: clip(o, 120) } : { label: clip(o?.label, 120), description: clip(o?.description, 400) || undefined, recommended: o?.recommended === true || undefined })
      .filter((o: QuestionOption) => o.label),
  })).filter((q: Question) => q.question && q.options.length >= 1);
}

/** 화면에서 고른 답 → 에이전트가 읽을 결과 문장. 취소면 제안을 멈추게 한다. */
export function answerText(answers: QuestionAnswer[], cancelled: boolean): string {
  if (cancelled) return "사용자가 이 질문을 취소했다. 이 제안은 진행하지 말고, 아무것도 실행하지 말고, 사용자의 다음 지시를 기다린다.";
  const lines = (Array.isArray(answers) ? answers : []).slice(0, 4).map((a, i) => {
    const q = clip(a?.question, 300) || `질문 ${i + 1}`;
    if (a?.skipped) return `- ${q} → 건너뜀(사용자가 답하지 않았다. 권장안으로 정하지 말고, 필요하면 나중에 다시 묻는다)`;
    const picked = (Array.isArray(a?.choices) ? a.choices : []).map((c) => clip(c, 120)).filter(Boolean);
    const other = clip(a?.other, 2000);
    const parts = [...picked, ...(other ? [`직접 입력: ${other}`] : [])];
    return `- ${q} → ${parts.length ? parts.join(" / ") : "답 없음"}`;
  });
  return `사용자의 선택:\n${lines.join("\n") || "- 답 없음"}\n선택한 범위만 진행한다. 승인 선택지를 골랐다면 직전에 밝힌 범위의 유료 생성은 화면 승인 없이 바로 실행된다(범위를 넘으면 다시 묻는다).`;
}

function textOf(content: any): string {
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b && b.type === "text").map((b) => String(b.text || "")).join("\n");
}

/** 한글 오류 문구. 화면에 원문 영어를 그대로 띄우지 않는다. */
export function errorText(err: any): string {
  const t = String(err?.type || "");
  const map: Record<string, string> = {
    model_overloaded_error: "모델이 일시적으로 붐빕니다. 자동으로 다시 시도합니다.",
    model_rate_limited_error: "요청 한도에 걸렸습니다. 잠시 뒤 자동으로 다시 시도합니다.",
    mcp_authentication_failed_error: "nk-studio 도구 인증이 실패했습니다. 세션을 새로 만들어 주세요.",
    mcp_connection_failed_error: "nk-studio 도구 서버에 연결하지 못했습니다.",
    billing_error: "Anthropic 결제(잔액) 문제로 모델을 호출하지 못했습니다. 관리자에게 알려 주세요.",
  };
  return map[t] || `오류가 발생했습니다(${t || "unknown"}): ${String(err?.message || "").slice(0, 300)}`;
}

export function mapEvent(ev: any): ClientEvent[] {
  if (!ev || typeof ev !== "object") return [];
  switch (ev.type) {
    case "event_start":
      return ev.event?.type === "agent.message" ? [{ type: "text_start", id: String(ev.event.id) }]
        : ev.event?.type === "agent.thinking" ? [{ type: "thinking" }] : [];
    case "event_delta": {
      const text = ev.delta?.content?.type === "text" ? String(ev.delta.content.text || "") : "";
      return text ? [{ type: "text_delta", id: String(ev.event_id), text }] : [];
    }
    case "agent.message":
      return [{ type: "message", id: ev.id, text: textOf(ev.content), at: ev.processed_at }];
    case "user.message": {
      const images = Array.isArray(ev.content) ? ev.content.filter((b: any) => b?.type === "image").length : 0;
      return [{ type: "user_message", id: ev.id, text: textOf(ev.content), images, at: ev.processed_at }];
    }
    case "agent.thinking":
      return [{ type: "thinking" }];
    case "agent.tool_use":
    case "agent.mcp_tool_use":
      return [{ type: "tool_use", id: ev.id, name: String(ev.name || ""), server: ev.type === "agent.mcp_tool_use" ? String(ev.mcp_server_name || "mcp") : "sandbox",
        input: ev.input, permission: ev.evaluated_permission, at: ev.processed_at }];
    case "agent.tool_result":
    case "agent.mcp_tool_result":
      return [{ type: "tool_result", id: ev.id, toolUseId: String(ev.tool_use_id || ev.mcp_tool_use_id || ""), isError: !!ev.is_error,
        preview: textOf(ev.content).slice(0, TOOL_RESULT_PREVIEW) }];
    case "agent.custom_tool_use":
      return ev.name === ASK_TOOL ? [{ type: "question", eventId: String(ev.id), questions: normalizeQuestions(ev.input) }] : [];
    case "user.custom_tool_result":
      return [{ type: "question_answered", toolUseId: String(ev.custom_tool_use_id || ""), text: textOf(ev.content) }];
    case "session.status_running":
      return [{ type: "status", status: "running" }];
    case "session.status_rescheduled":
      return [{ type: "status", status: "rescheduling" }];
    case "session.status_terminated":
      return [{ type: "status", status: "terminated" }];
    case "session.status_idle":
      return [{ type: "status", status: "idle", stopReason: ev.stop_reason?.type, eventIds: ev.stop_reason?.event_ids }];
    case "session.error":
      return [{ type: "notice", level: "error", text: errorText(ev.error) }];
    case "agent.thread_context_compacted":
      return [{ type: "notice", level: "info", text: "대화가 길어져 앞부분을 요약했습니다(프로젝트 메모리는 그대로 유지)." }];
    default:
      return [];
  }
}

/** 승인을 기다리는 도구 호출인가. */
export function isPendingApproval(ev: any): boolean {
  return (ev?.type === "agent.mcp_tool_use" || ev?.type === "agent.tool_use") && ev?.evaluated_permission === "ask";
}
