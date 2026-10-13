// NK 디렉터(Cloud Run nk-director) 클라이언트.
// main.tsx 의 fetch 래퍼는 /api/ 에만 토큰을 붙이므로, 디렉터 주소로는 여기서 직접 Bearer 를 붙인다.
import { readStorage } from "./safeStorage";

export const DIRECTOR_BASE = "https://nk-director-510034693257.asia-northeast3.run.app";

const token = () => String(readStorage("nk_auth_token") || "").replace(/^"|"$/g, "");

async function directorFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || undefined);
  headers.set("Authorization", `Bearer ${token()}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${DIRECTOR_BASE}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || (data?.error === "credit_insufficient" ? "크레딧이 부족합니다." : data?.error) || `디렉터 요청 실패(${res.status})`;
    throw new Error(String(msg));
  }
  return data as T;
}

export interface DirectorSessionInfo { id: string; title: string; createdAt: string }

export const listDirectorSessions = (projectId: string) =>
  directorFetch<{ sessions: DirectorSessionInfo[] }>(`/v1/projects/${encodeURIComponent(projectId)}/sessions`).then((r) => r.sessions || []);

export const createDirectorSession = (projectId: string, title: string) =>
  directorFetch<{ sessionId: string; title: string; isOwner: boolean; budgetCents: number }>("/v1/sessions", { method: "POST", body: JSON.stringify({ projectId, title }) });

/** resolveQuestions: 열려 있던 버튼 질문 — 채팅으로 답하면 서버가 그 질문부터 닫는다. */
export const sendDirectorMessage = (sessionId: string, text: string, images: Array<{ mediaType: string; data: string }>, resolveQuestions: string[] = []) =>
  directorFetch(`/v1/sessions/${sessionId}/messages`, { method: "POST", body: JSON.stringify({ text, images, resolveQuestions }) });

/** 디렉터 버튼 질문(ask_user, nk-director src/gateway/events.ts 와 같은 모양). */
export interface DirectorQuestionOption { label: string; description?: string; recommended?: boolean }
export interface DirectorQuestion { question: string; header?: string; multiSelect?: boolean; options: DirectorQuestionOption[] }
export interface DirectorQuestionAnswer { question: string; choices: string[]; other?: string; skipped?: boolean }

export const answerDirectorQuestion = (sessionId: string, eventId: string, answers: DirectorQuestionAnswer[], cancelled = false) =>
  directorFetch(`/v1/sessions/${sessionId}/answer`, { method: "POST", body: JSON.stringify({ eventId, answers, cancelled }) });

/** 질문 결과 문장(서버 answerText) → 대화창에 보일 짧은 문구. 채팅으로 대신 답한 경우는 빈 값(그 메시지가 따로 보인다). */
export function questionAnswerLabel(text: string): string {
  const t = String(text || "");
  if (/버튼 대신 채팅으로/.test(t)) return "";
  if (/질문을 취소했다/.test(t)) return "질문을 취소했어요";
  const lines = t.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).replace(/\(사용자가 답하지 않았다[^)]*\)/, "").trim());
  return lines.length ? lines.join("\n") : t.slice(0, 300);
}

export const confirmDirectorTool = (sessionId: string, eventId: string, allow: boolean, message?: string) =>
  directorFetch(`/v1/sessions/${sessionId}/confirm`, { method: "POST", body: JSON.stringify({ eventId, allow, message }) });

export const interruptDirector = (sessionId: string) =>
  directorFetch(`/v1/sessions/${sessionId}/interrupt`, { method: "POST", body: "{}" });

/** 디렉터가 화면으로 보내는 이벤트(nk-director src/gateway/events.ts 와 같은 모양). */
export type DirectorEvent =
  | { type: "history_start"; count: number }
  | { type: "history_end"; status: string; title?: string }
  | { type: "text_start"; id: string }
  | { type: "text_delta"; id: string; text: string }
  | { type: "message"; id: string; text: string; at?: string }
  | { type: "user_message"; id: string; text: string; images: number; at?: string }
  | { type: "thinking" }
  | { type: "tool_use"; id: string; name: string; server: string; input: any; permission?: string; at?: string }
  | { type: "tool_result"; id: string; toolUseId: string; isError: boolean; preview: string }
  | { type: "approval_request"; eventId: string; tool: string; input: any; quote?: any }
  | { type: "question"; eventId: string; questions: DirectorQuestion[] }
  | { type: "question_answered"; toolUseId: string; text: string }
  | { type: "status"; status: string; stopReason?: string }
  | { type: "usage"; listCostCents: number; charged?: number; available?: number; owner?: boolean }
  | { type: "notice"; level: "info" | "warn" | "error"; text: string };

/**
 * 세션 이벤트 구독. 연결이 끊기면 자동으로 다시 붙는다(서버가 매번 기록을 처음부터 다시 보내므로
 * history_start 를 받으면 화면 상태를 비우고 다시 그린다). 반환 함수로 구독을 끝낸다.
 */
export function subscribeDirector(sessionId: string, onEvent: (ev: DirectorEvent) => void, onConnection?: (state: "connecting" | "open" | "retrying") => void): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let attempt = 0;

  const run = async () => {
    while (!stopped) {
      controller = new AbortController();
      onConnection?.(attempt === 0 ? "connecting" : "retrying");
      try {
        const res = await fetch(`${DIRECTOR_BASE}/v1/sessions/${sessionId}/stream`, {
          headers: { Authorization: `Bearer ${token()}`, Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (res.status === 401 || res.status === 404) {
          onEvent({ type: "notice", level: "error", text: res.status === 401 ? "로그인이 만료됐습니다. 다시 로그인해 주세요." : "세션을 찾을 수 없습니다." });
          return;
        }
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        onConnection?.("open");
        attempt = 0;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              try { onEvent(JSON.parse(line.slice(6))); } catch { /* 깨진 줄은 건너뛴다 */ }
            }
          }
        }
      } catch (e) {
        if (stopped) return;
      }
      if (stopped) return;
      attempt += 1;
      await new Promise((r) => setTimeout(r, Math.min(15_000, 1_000 * 2 ** Math.min(attempt, 4))));
    }
  };
  void run();
  return () => { stopped = true; controller?.abort(); };
}

/** 사이트 API(같은 도메인, 토큰 자동) — 시퀀스·미디어 서명 URL. */
export async function getSequences(projectId: string): Promise<any[]> {
  const res = await fetch(`/api/project/sequences?projectId=${encodeURIComponent(projectId)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "시퀀스를 불러오지 못했어요.");
  return Array.isArray(data.sequences) ? data.sequences : [];
}

export async function signedReadUrls(paths: string[]): Promise<Record<string, string>> {
  const list = paths.filter(Boolean).slice(0, 40);
  if (!list.length) return {};
  const res = await fetch("/api/director/media-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ read: list }) });
  const data = await res.json().catch(() => ({}));
  const out: Record<string, string> = {};
  for (const it of data?.items || []) if (it?.url) out[it.src] = it.url;
  return out;
}

export const TOOL_LABELS: Record<string, string> = {
  project_overview: "프로젝트 살펴보기", sequence_get: "시퀀스 읽기", sequence_save: "콘티 저장", take_save: "테이크 기록",
  timeline_apply: "편집기 타임라인 반영", media_urls: "미디어 주소 받기", media_upload_url: "파일 올리기 준비",
  video_quote: "견적 계산", video_submit: "영상 생성 제출", video_complete: "1080p 완성 제출", video_status: "영상 상태 확인",
  image_generate: "이미지 생성", image_status: "이미지 상태 확인", ask_user: "질문", bash: "샌드박스 명령", read: "파일 읽기", write: "파일 쓰기", edit: "파일 고치기", glob: "파일 찾기", grep: "내용 검색",
};

/**
 * 디렉터 답변 끝의 다음 메시지 제안(<!--next: …-->)을 떼어 낸다. 본문에는 보이지 않고, 입력창 흐린 글씨(Tab 으로 입력)로 쓴다.
 * 스트리밍 중 아직 닫히지 않은 꼬리(<!-- …)도 본문에서 숨긴다.
 */
export function splitSuggestion(text: string): { body: string; suggestion: string } {
  let suggestion = "";
  const body = String(text || "")
    .replace(/<!--\s*next:\s*([\s\S]*?)-->/gi, (_m, s: string) => { suggestion = s.replace(/\s+/g, " ").trim(); return ""; })
    .replace(/<!--[\s\S]*$/, "")
    .trimEnd();
  return { body, suggestion: suggestion.slice(0, 200) };
}
