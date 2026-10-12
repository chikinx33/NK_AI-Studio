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
  | { type: "status"; status: string; stopReason?: string; eventIds?: string[] }
  | { type: "usage"; listCostCents: number; charged?: number; available?: number; owner?: boolean }
  | { type: "notice"; level: "info" | "warn" | "error"; text: string };

const TOOL_RESULT_PREVIEW = 1200;

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
