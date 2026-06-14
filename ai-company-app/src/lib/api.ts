export interface StatusInfo {
  company: string;
  llmMode: "auto" | "cloud" | "local";
  workMode: "on" | "off";
  autonomous: boolean;
  resolvedBackend: "local" | "cloud";
  reason: string;
  localModel: string; // 전역 로컬 모델 설정 ("auto" 또는 모델명)
  ollama: {
    up: boolean;
    models: string[];
    chatModels: string[]; // 채팅 가능 모델(임베딩 전용 제외) — 선택 버튼용
    loaded: string[];
    autoModel: string | null; // auto 모드가 고를 모델
  };
  cloud: { configured: boolean };
  ceoModel: string;
  agentCount: number;
}

export interface AgentInfo {
  id: string;
  emoji: string;
  name: string;
  role: string;
  hasTools: boolean;
  tools: string[];
}

export async function getStatus(): Promise<StatusInfo> {
  return (await fetch("/api/agent/status")).json();
}

// 생존 신호 (브라우저가 열려 있는 동안 주기적으로 호출)
export async function ping(): Promise<void> {
  try {
    await fetch("/api/ping");
  } catch {
    /* 서버 종료/미기동 — 무시 */
  }
}

// 서버 종료 ('종료' 버튼)
export async function shutdownServer(): Promise<void> {
  try {
    await fetch("/api/shutdown", { method: "POST" });
  } catch {
    /* 종료되면서 연결이 끊길 수 있음 — 무시 */
  }
}

export async function getCompany() {
  return (await fetch("/api/company")).json();
}

export async function getAgents(): Promise<AgentInfo[]> {
  return (await fetch("/api/agent/agents")).json();
}

// 직원 상세(페르소나) + 개인 지식·규칙 관리
export interface AgentBrain {
  meta: AgentInfo;
  prompt: string;
  memory: string;
  goal: string;
  tools: string[];
}
export async function getAgentDetail(id: string): Promise<AgentBrain> {
  return (await fetch(`/api/agent/detail?id=${encodeURIComponent(id)}`)).json();
}
export async function getAgentKnowledge(id: string): Promise<KnowledgeItem[]> {
  return (await fetch(`/api/agent/knowledge?id=${encodeURIComponent(id)}`)).json();
}
export async function addAgentKnowledge(id: string, text: string, type: KnowledgeType) {
  return (
    await fetch(`/api/agent/knowledge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, text, type }),
    })
  ).json();
}
export async function deleteAgentKnowledge(id: string, text: string) {
  return (
    await fetch(`/api/agent/knowledge`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, text }),
    })
  ).json();
}
export async function saveAgentPersona(id: string, prompt: string) {
  return (
    await fetch(`/api/agent/persona`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, prompt }),
    })
  ).json();
}

export async function getHistory(): Promise<HistoryTurn[]> {
  return (await fetch("/api/history")).json();
}

// 대화(스레드)
export interface Conversation {
  id: string;
  title: string;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
}
export async function getConversations(): Promise<Conversation[]> {
  // NK: 단톡방 단계는 단일 스레드(날짜 기반). 목록은 비움.
  return [];
}
export async function createConversation(title?: string, projectId?: string): Promise<Conversation> {
  return (
    await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, projectId }),
    })
  ).json();
}
export async function renameConversation(id: string, title: string): Promise<Conversation> {
  return (
    await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    })
  ).json();
}
export async function getConversationMessages(id: string): Promise<HistoryTurn[]> {
  const d = await (await fetch(`/api/agent/messages?conversationId=${encodeURIComponent(id)}`)).json();
  return ((d && d.items) || []).map((m: any) => ({
    role: m.role, agentId: m.agent_id || undefined, name: m.name || undefined, text: m.text,
  }));
}
export async function ensureDateConversation(date: string): Promise<Conversation> {
  // NK: 대화 id = 날짜 그대로. 서버 생성 불필요(메시지 첫 저장 시 생김).
  return { id: date, title: date, createdAt: "", updatedAt: "" };
}

export async function getSettings() {
  // app_settings(user_id별) 기반. 구독↔API 인증 모드를 설정에서 전환.
  return (await fetch("/api/agent/settings")).json();
}

export async function setMode(llmMode: string) {
  return (
    await fetch("/api/agent/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "mode", llmMode }),
    })
  ).json();
}

export interface LogStats { dates: number; oldest: string | null; newest: string | null }
export async function getLogStats(): Promise<LogStats> {
  return { dates: 0, oldest: null, newest: null };
}
export async function setLogRetention(_days: number) {
  return { ok: true, deleted: 0 } as any;
}
export async function cleanupLogs() {
  return { ok: true, deleted: 0 } as any;
}

export interface IntegrationField {
  key: string;
  type: "text" | "password" | "number" | "select";
  label: string;
  hint?: string;
  required: boolean;
  options?: (string | number | { value: string | number; label: string })[];
  widget?: "toggle";
  secret: boolean;
  hasValue: boolean;
  value?: string | number;
}
export interface ToolIntegration {
  agentId: string;
  agentName: string;
  emoji: string;
  tool: string;
  fields: IntegrationField[];
  configured: boolean;
}
export async function getIntegrations(): Promise<ToolIntegration[]> {
  return (await fetch("/api/agent/integrations")).json();
}
export async function saveIntegration(agentId: string, tool: string, values: Record<string, string>) {
  return (
    await fetch("/api/agent/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, tool, values }),
    })
  ).json();
}

// 스킬 연동 준비도 (비밀값 미포함 — 상태/누락 키 이름만)
export type SkillStatus = "ready" | "needs_config" | "no_tool";
export interface SkillReadiness {
  agentId: string;
  agentName: string;
  skill: string;
  file: string;
  requiredTools: string[];
  status: SkillStatus;
  missing: { tool: string; keys: string[] }[];
}
export async function getSkillReadiness(): Promise<SkillReadiness[]> {
  // NK: 라비오크식 스킬 파일이 없으므로 준비도 목록은 비움(연동 상태는 getIntegrations 로 표시).
  return [];
}

// ── 헤르메스 스킬(절차적 기억) — 에이전트가 축적한 재사용 절차 ──
export interface AgentSkill { name: string; category: string; description: string; pinned?: boolean; }
export interface AgentSkillDetail extends AgentSkill {
  content: string; tags: string; useCount: number; updatedAt: string;
}
export async function getSkills(): Promise<{ active: AgentSkill[]; archived: AgentSkill[] }> {
  return (await fetch("/api/agent/skills")).json();
}
export async function getSkillDetail(name: string): Promise<{ skill: AgentSkillDetail | null }> {
  return (await fetch(`/api/agent/skills?name=${encodeURIComponent(name)}`)).json();
}
export async function skillAction(action: "delete" | "pin" | "unpin" | "restore", name: string) {
  return (
    await fetch("/api/agent/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, name }),
    })
  ).json();
}

// 연동 "연결 테스트" — NK 키 설정 여부 확인
export async function testIntegration(agentId: string, tool: string): Promise<{ ok: boolean; message: string }> {
  return (
    await fetch("/api/agent/integration-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, tool }),
    })
  ).json();
}

export async function setLocalModel(_localModel: string) {
  return { ok: true }; // NK: 로컬 모델 미사용(클라우드 고정)
}

export async function setApiKey(_apiKey: string) {
  return { ok: true }; // NK: 키는 스튜디오 공용 env 관리
}

export type ClaudeAuthMode = "subscription" | "api_key";
export interface ClaudeAuthStatus {
  mode: ClaudeAuthMode;
  configured: boolean;
  oauthSet: boolean;
  apiKeySet: boolean;
}
// 인증 모드 설정 (+ 선택적으로 토큰/키 동시 저장). app_settings(user_id별)에 영속.
export async function setClaudeAuth(payload: {
  authMode: ClaudeAuthMode;
  oauthToken?: string;
  apiKey?: string;
}) {
  return (
    await fetch("/api/agent/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload }),
    })
  ).json();
}

// 인증 진단 — 현재 키 종류 + 라이브 테스트 결과(비밀값 미노출)
export interface AuthDiag {
  mode: ClaudeAuthMode;
  source: string;
  oauthSet: boolean;
  apiKeySet: boolean;
  apiKeyKind: string;
  oauthKind: string;
  gateway: boolean;
  test: { ok: boolean; status: number; detail: string } | null;
}
export async function authDiag(): Promise<{ ok: boolean; diag?: AuthDiag; error?: string }> {
  return (
    await fetch("/api/agent/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "diag" }),
    })
  ).json();
}

export async function setAutonomous(enabled: boolean) {
  // 토글 상태 저장(영속). 실제 자율 스텝 실행은 autonomousStep 폴링이 담당.
  return (
    await fetch("/api/agent/autonomous", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    })
  ).json();
}

// 자율 근무 한 스텝 진행(출근+자율일 때만 서버가 실제 진행). 프런트가 주기 폴링으로 호출.
export async function autonomousStep(conversationId: string) {
  return (
    await fetch("/api/agent/autonomous-step", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId }),
    })
  ).json();
}

export async function autonomousStepNow() {
  return { ok: false, message: "자율 근무 자동 실행은 NK 클라우드에서 준비 중이에요." };
}

export async function setWork(workMode: "on" | "off") {
  return (
    await fetch("/api/agent/work", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workMode }),
    })
  ).json();
}

export interface KnowledgeItem {
  text: string;
  source: string;
  type?: KnowledgeType;
}

export async function getKnowledge(): Promise<KnowledgeItem[]> {
  return (await fetch("/api/agent/company-knowledge")).json();
}

export type KnowledgeType = "원칙" | "사실" | "결정";
export interface GraphNode { id: number; text: string; origin: string; type: KnowledgeType; degree: number; }
export interface GraphEdge { source: number; target: number; weight: number; }
export async function getKnowledgeGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  return (await fetch("/api/agent/knowledge-graph")).json();
}

export async function addKnowledge(text: string, type?: KnowledgeType) {
  return (
    await fetch("/api/agent/company-knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(type ? { text, type } : { text }),
    })
  ).json();
}

export async function updateKnowledge(oldText: string, newText: string) {
  return (
    await fetch("/api/agent/company-knowledge", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldText, newText }),
    })
  ).json();
}

export async function deleteKnowledge(text: string) {
  return (
    await fetch("/api/agent/company-knowledge", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
  ).json();
}

// 회사 지식의 똑같은 중복 항목을 1개만 남기고 정리.
export async function consolidateDecisions(): Promise<{ removed: number; keptSnapshots: number }> {
  const d = await (
    await fetch("/api/agent/company-knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dedupe" }),
    })
  ).json();
  return { removed: d?.removed ?? 0, keptSnapshots: 0 };
}

// 진행 중 프로젝트 보드 (홈)
export type StageStatus = "todo" | "doing" | "done";
export interface ProjectStage { title: string; status: StageStatus }
export interface Project {
  id: string;
  name: string;
  summary?: string;
  status: "active" | "paused" | "done";
  goal?: string;
  stages: ProjectStage[];
  nextAction?: string;
  updatedAt: string;
}
export async function getProjects(): Promise<Project[]> {
  return (await fetch("/api/agent/projects")).json();
}
export async function setProjectStage(projectId: string, index: number, status: StageStatus) {
  return (
    await fetch("/api/agent/project-stage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, index, status }),
    })
  ).json();
}

// 결과(산출물) 리스트
export interface ResultItem {
  id: string;
  agentId: string;
  agentName: string;
  file: string;
  url: string;
  prompt?: string;
  provider?: string;
  note?: string;
  reviewStatus: "pending" | "approved" | "revise";
  createdAt: number;
}
// NK: 검수 결과 = 잡(agent_jobs) 중 산출물 있는 것. /api/agent/jobs 를 ResultItem 으로 변환.
const NK_AGENT_NAMES: Record<string, string> = {
  core: "코어", edge: "엣지", radar: "레이더", maki: "마키", plot: "플롯", ink: "잉크",
  pixel: "픽셀", beat: "비트", engi: "엔지", reach: "리치", sync: "싱크",
};
export async function getResults(limit = 30): Promise<{ items: ResultItem[]; total: number }> {
  const d = await (await fetch(`/api/agent/jobs?limit=${limit}`)).json();
  const all = ((d && d.items) || []).filter((j: any) => j.output && (j.output.signedUrl || j.output.videoUrl || j.output.audioUrl || j.output.dataUrl));
  const items: ResultItem[] = all.map((j: any) => {
    const out = j.output || {};
    return {
      id: j.id, agentId: j.agent_id, agentName: NK_AGENT_NAMES[j.agent_id] || j.agent_id,
      file: j.type, url: out.signedUrl || out.videoUrl || out.audioUrl || out.dataUrl || "",
      prompt: (j.input && j.input.prompt) || "", provider: out.provider || out.model || "",
      note: j.review_note || "", reviewStatus: j.review_status || "pending",
      createdAt: Date.parse(j.created_at) || 0,
    };
  });
  return { items, total: items.length };
}
export interface AgentMessage {
  role: "agent";
  agentId?: string;
  name?: string;
  emoji?: string;
  text: string;
}
export async function reviewResult(
  id: string,
  action: "approve" | "revise",
  note?: string
): Promise<{ ok: boolean; reviewStatus?: string; message?: AgentMessage }> {
  const d = await (
    await fetch("/api/agent/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, decision: action === "approve" ? "approved" : "revise", note }),
    })
  ).json();
  return { ok: !!d.ok, reviewStatus: d.job?.review_status };
}

export async function openResultFolder(_id: string) {
  // NK: 클라우드 저장이라 로컬 폴더 열기는 미지원.
  return { ok: false, message: "클라우드에서는 폴더 열기를 지원하지 않아요." };
}

// 서버 → 클라이언트 폴링: 백그라운드 보고 메시지 + 작업중 에이전트
export interface LiveEvents {
  seq: number;
  messages: { seq: number; turn: HistoryTurn }[];
  working: string[];
}
export async function getEvents(since: number): Promise<LiveEvents> {
  // NK: 라이브 이벤트(백그라운드 보고) 폴링은 후속 포팅. 지금은 빈 이벤트.
  return { seq: since, messages: [], working: [] };
}

export async function getApprovals(): Promise<{ pending: any[]; history: any[] }> {
  // NK: 승인 큐는 검수(잡) 시스템으로 대체 예정. 지금은 빈 목록.
  return { pending: [], history: [] };
}

export async function approveItem(id: string) {
  return (await fetch(`/api/approvals/${id}/approve`, { method: "POST" })).json();
}

export async function rejectItem(id: string) {
  return (await fetch(`/api/approvals/${id}/reject`, { method: "POST" })).json();
}

export type SSEHandler = (event: string, data: any) => void;

/** SSE 채팅 스트림. fetch + ReadableStream 으로 직접 파싱 (POST 본문 필요하므로 EventSource 불가) */
export interface HistoryTurn {
  role: "user" | "agent";
  agentId?: string;
  name?: string;
  emoji?: string;
  text: string;
}

/**
 * NK 폴링 기반 채팅. 라비오크는 SSE(fetch+ReadableStream)였지만, 클라우드 30초 제약상
 * 멀티에이전트 위임이 끊기므로: POST /api/agent/chat(즉시 응답, 백그라운드 오케스트레이션)
 * + /api/agent/messages 폴링으로 새 에이전트 발언을 turn_start/turn_end 이벤트로 합성한다.
 * Chat·VisualNovel 컴포넌트는 그대로 작동(타자기 토큰 대신 메시지 단위 표시).
 */
export async function streamChat(
  message: string,
  onEvent: SSEHandler,
  opts: {
    apiKey?: string;
    history?: HistoryTurn[];
    focusAgent?: string;
    conversationId?: string;
    signal?: AbortSignal;
  } = {}
): Promise<void> {
  const convId = opts.conversationId || "main";
  const fetchMsgs = async (): Promise<any[]> => {
    const d = await (await fetch(`/api/agent/messages?conversationId=${encodeURIComponent(convId)}`)).json();
    return (d && d.items) || [];
  };

  onEvent("status", { backend: "cloud", reason: "NK Claude" });
  const before = (await fetchMsgs().catch(() => [])).length;

  const res = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, conversationId: convId, focusAgent: opts.focusAgent }),
    signal: opts.signal,
  });
  let chatBody: any = {};
  try { chatBody = await res.clone().json(); } catch { /* ignore */ }
  if (!res.ok) {
    const err = chatBody?.error || "전송 실패";
    onEvent("turn_start", { agentId: "core", name: "코어", emoji: "🧭" });
    onEvent("turn_end", { agentId: "core", text: `⚠️ ${err}` });
    onEvent("done", {});
    return;
  }

  // 동기 실행: chat 응답에 생성된 발언이 직접 실려 오면 폴링 없이 즉시 표시(조회 의존 제거).
  if (Array.isArray(chatBody?.messages) && chatBody.messages.length) {
    for (const m of chatBody.messages) {
      if (m.role === "agent") {
        onEvent("turn_start", { agentId: m.agent_id, name: m.name, emoji: "" });
        onEvent("turn_end", { agentId: m.agent_id, text: m.text });
      }
    }
    onEvent("done", {});
    return;
  }

  // 새 에이전트 발언을 1.5초마다 폴링해 SSE 이벤트로 합성.
  // 코어가 위임하면 직원이 일하는 동안 메시지가 잠시 안 늘어나므로(이때 종료하면 위임 답변을
  // 놓침) 안정 판정을 넉넉히 18초(12×1.5s)로 둔다. 최대 약 3분(120×1.5s).
  let emitted = before;
  let agentEmitted = 0; // 실제로 받은 에이전트 발언 수
  let lastLen = -1, stable = 0;
  for (let i = 0; i < 120; i++) {
    if (opts.signal?.aborted) break;
    await new Promise((r) => setTimeout(r, 1500));
    let msgs: any[];
    try { msgs = await fetchMsgs(); } catch { continue; }
    for (let j = emitted; j < msgs.length; j++) {
      const m = msgs[j];
      if (m.role === "agent") {
        onEvent("turn_start", { agentId: m.agent_id, name: m.name, emoji: "" });
        onEvent("turn_end", { agentId: m.agent_id, text: m.text });
        agentEmitted++;
      }
    }
    emitted = msgs.length;
    if (msgs.length === lastLen) { if (++stable >= 12) break; } else { stable = 0; lastLen = msgs.length; }
  }
  // 에이전트 발언을 하나도 못 받았으면(무응답) 원인을 보이게 안내.
  if (agentEmitted === 0 && !opts.signal?.aborted) {
    onEvent("turn_start", { agentId: "core", name: "코어", emoji: "" });
    onEvent("turn_end", {
      agentId: "core",
      text: "⚠️ 응답을 받지 못했어요. 가능한 원인: ① 모두 퇴근(휴식) 상태 — 출근시켜 주세요. ② 인증 문제 — 설정 → 🔍 인증 진단을 확인해 주세요. ③ 서버 처리 지연 — 잠시 후 다시 시도해 주세요.",
    });
  }
  onEvent("done", {});
}
