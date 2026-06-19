export interface StatusInfo {
  forbidden?: boolean; // AI 회사 이용 권한 없음(403)
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
  const r = await fetch("/api/agent/status");
  if (r.status === 403) return { forbidden: true } as unknown as StatusInfo; // AI 회사 권한 없음
  return r.json();
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
  // 날짜별 대화 목록(메시지가 쌓인 날) — 캘린더 점·리스트용.
  // 인증·서버 오류 시 배열이 아닌 {error} 가 올 수 있어 항상 배열로 정규화(렌더 .map 크래시 방지).
  const d = await (await fetch("/api/agent/conversations")).json();
  return Array.isArray(d) ? d : [];
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
export async function renameConversation(id: string, title: string): Promise<{ ok: boolean; title?: string }> {
  // 대화(날짜) 커스텀 제목 저장. 빈 title이면 서버가 기본 날짜 제목으로 복귀시킨다.
  return (
    await fetch(`/api/agent/conversation-title`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: id, title }),
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
  oauth?: "google"; // 사용자별 OAuth 연동(싱크 gmail·calendar) — env 공용키가 아님
  connectedAs?: string; // 연결된 구글 계정(연동됨일 때만)
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
  // 인증·서버 오류 시 {error} 가 올 수 있어 항상 배열로 정규화(렌더 .map/.filter 크래시 방지).
  const d = await (await fetch("/api/agent/projects")).json();
  return Array.isArray(d) ? d : [];
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
  kind: "image" | "video" | "audio" | "ppt" | "pdf";
  docData?: { title?: string; subtitle?: string; slides?: any[]; sections?: any[] };
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
  const all = ((d && d.items) || []).filter((j: any) => {
    if (j.status === "cancelled") return false;
    if (!j.output) return false;
    const o = j.output;
    return o.signedUrl || o.videoUrl || o.audioUrl || o.dataUrl || o.kind === "ppt" || o.kind === "pdf";
  });
  const items: ResultItem[] = all.map((j: any) => {
    const out = j.output || {};
    const isDoc = out.kind === "ppt" || out.kind === "pdf";
    return {
      id: j.id, agentId: j.agent_id, agentName: NK_AGENT_NAMES[j.agent_id] || j.agent_id,
      file: j.type,
      url: out.signedUrl || out.videoUrl || out.audioUrl || out.dataUrl || "",
      kind: (out.kind === "ppt" ? "ppt" : out.kind === "pdf" ? "pdf" : out.audioUrl ? "audio" : out.videoUrl ? "video" : "image") as ResultItem["kind"],
      docData: isDoc ? { title: out.title, subtitle: out.subtitle, slides: out.slides, sections: out.sections } : undefined,
      prompt: (j.input && j.input.prompt) || out.promptEcho || "", provider: out.provider || out.model || "",
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

export async function cancelResult(id: string): Promise<{ ok: boolean; message?: AgentMessage }> {
  const d = await (
    await fetch("/api/agent/cancel-job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
  ).json();
  // 서버 DB 행은 agent_id(snake_case) — 클라이언트 AgentMessage는 agentId(camelCase)로 매핑
  const raw = d.message;
  const message: AgentMessage | undefined = raw
    ? {
        role: "agent",
        agentId: raw.agent_id || raw.agentId,
        name: raw.name,
        emoji: AGENT_EMOJI[raw.agent_id || raw.agentId] || raw.emoji,
        text: raw.text,
      }
    : undefined;
  return { ok: !!d.ok, message };
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
  // agent_jobs에서 queued/working 상태 잡의 agent_id를 working 목록으로 반환
  try {
    const d = await (await fetch("/api/agent/jobs?limit=20")).json();
    const jobs: any[] = d?.items ?? [];
    const working = [
      ...new Set(
        jobs
          .filter((j) => j.status === "queued" || j.status === "working")
          .map((j) => j.agent_id)
          .filter(Boolean)
      ),
    ];
    return { seq: since, messages: [], working };
  } catch {
    return { seq: since, messages: [], working: [] };
  }
}

// 산출물(이미지·영상·문서 등)이 달린 잡인지 — 이런 잡은 '보고'(Results)에서 검토하므로 '승인'에선 제외.
function hasDeliverableOutput(j: any): boolean {
  const o = j?.output;
  if (!o) return false;
  return !!(o.signedUrl || o.videoUrl || o.audioUrl || o.dataUrl || o.kind === "ppt" || o.kind === "pdf");
}
// 승인 카드에 보여줄 작업 요약 만들기 — 잡 종류(type)+입력(input)으로 사람이 읽을 한 줄.
const APPROVAL_TOOL_LABEL: Record<string, string> = {
  calendar_create: "구글 캘린더 일정 추가", gmail_trash: "Gmail 메일 휴지통 이동", publish: "SNS 발행",
  image: "이미지 생성", video: "영상 생성", sound: "효과음 생성", music: "BGM 생성",
  scenario: "시나리오 생성", ppt: "PPT 생성", pdf: "PDF 문서 생성",
};
// 외부에 영향을 주는(되돌리기 어려운) 도구 — 카드에 'external' 배지로 강조.
const APPROVAL_EXTERNAL_TOOLS = new Set(["calendar_create", "gmail_trash", "publish"]);
function fmtWhen(s?: string): string {
  if (!s) return "";
  const m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s));
  return m ? `${m[2]}/${m[3]} ${m[4]}:${m[5]}` : String(s);
}
function summarizeApprovalJob(j: any) {
  const input = j.input || {};
  const label = APPROVAL_TOOL_LABEL[j.type] || j.type || "작업";
  const detail = input.summary || input.title || input.prompt || input.topic || input.caption || input.query || "";
  const when = fmtWhen(input.start);
  const title = `${label}${detail ? `: ${String(detail).slice(0, 60)}` : ""}${when ? ` (${when})` : ""}`;
  return {
    id: j.id,
    agentId: j.agent_id,
    agentName: NK_AGENT_NAMES[j.agent_id] || j.agent_id,
    title,
    tool: j.type,
    command: j.type,
    kind: APPROVAL_EXTERNAL_TOOLS.has(j.type) ? "external" : undefined,
    reason: input.description ? String(input.description).slice(0, 120) : undefined,
  };
}
export async function getApprovals(): Promise<{ pending: any[]; history: any[] }> {
  // agent_jobs에서 review_pending 잡을 승인 대기 목록으로 반환.
  // 역할 분리: 산출물이 있는 잡은 '보고'에서 검토 → 여기선 제외해 중복 표시를 막는다.
  // 따라서 '승인'에는 산출물 없이 실행 허가만 필요한 잡(외부/로컬 명령 등)만 남는다.
  try {
    const d = await (await fetch("/api/agent/jobs?limit=20")).json();
    const jobs: any[] = d?.items ?? [];
    const pending = jobs
      .filter((j) => j.status === "review_pending" && j.review_status === "pending" && !hasDeliverableOutput(j))
      .map(summarizeApprovalJob);
    return { pending, history: [] };
  } catch {
    return { pending: [], history: [] };
  }
}

// 승인 = 검수 게이트 통과(확정). 기존 검수 엔드포인트(/api/agent/review) 재사용.
export async function approveItem(id: string) {
  return (
    await fetch(`/api/agent/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, decision: "approved" }),
    })
  ).json();
}

// 거절 = 작업 취소. 담당 직원이 취소 멘트 + 관련 지식 정리.
export async function rejectItem(id: string) {
  return (
    await fetch(`/api/agent/cancel-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
  ).json();
}

const AGENT_EMOJI: Record<string, string> = {
  core: "🧭", edge: "💼", radar: "🔍", maki: "📈", plot: "🎬",
  ink: "✍️", pixel: "🎨", beat: "🎵", engi: "💻", reach: "📡", sync: "📱",
};

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
 * NK SSE 채팅. POST /api/agent/chat → text/event-stream 응답.
 * 에이전트가 발언을 완료하는 즉시 SSE 이벤트를 수신 → 실시간 순차 대화(진짜 티키타카).
 * Chat·VisualNovel 컴포넌트는 그대로 작동(turn_start/turn_end 이벤트 동일).
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
    imageBase64?: string;
    imageMimeType?: string;
  } = {}
): Promise<void> {
  const convId = opts.conversationId || "main";

  onEvent("status", { backend: "cloud", reason: "NK Claude" });

  const res = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      conversationId: convId,
      focusAgent: opts.focusAgent,
      imageBase64: opts.imageBase64,
      imageMimeType: opts.imageMimeType,
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    let errBody: any = {};
    try { errBody = await res.json(); } catch {}
    const err = errBody?.error || "전송 실패";
    onEvent("turn_start", { agentId: "core", name: "코어", emoji: "🧭" });
    onEvent("turn_end", { agentId: "core", text: `⚠️ ${err}` });
    onEvent("done", {});
    return;
  }

  // SSE 스트림 읽기 — 에이전트 발언이 완료될 때마다 즉시 수신해 표시.
  const reader = res.body?.getReader();
  if (!reader) {
    onEvent("turn_start", { agentId: "core", name: "코어", emoji: "" });
    onEvent("turn_end", { agentId: "core", text: "⚠️ 스트림 연결에 실패했어요." });
    onEvent("done", {});
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let agentEmitted = 0;

  try {
    outer: while (true) {
      if (opts.signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
        if (!dataLine) continue;
        let event: any;
        try { event = JSON.parse(dataLine.slice(6)); } catch { continue; }

        if (event.type === "msg" && event.msg?.role === "agent") {
          const m = event.msg;
          onEvent("turn_start", { agentId: m.agent_id, name: m.name, emoji: AGENT_EMOJI[m.agent_id] || "" });
          onEvent("turn_end", { agentId: m.agent_id, text: m.text });
          agentEmitted++;
        } else if (event.type === "job_ready") {
          onEvent("job_ready", {});
        } else if (event.type === "done") {
          break outer;
        }
      }
    }
  } finally {
    try { reader.cancel(); } catch {}
  }

  if (agentEmitted === 0 && !opts.signal?.aborted) {
    onEvent("turn_start", { agentId: "core", name: "코어", emoji: "" });
    onEvent("turn_end", {
      agentId: "core",
      text: "⚠️ 응답을 받지 못했어요. 가능한 원인: ① 모두 퇴근(휴식) 상태 — 출근시켜 주세요. ② 인증 문제 — 설정 → 🔍 인증 진단을 확인해 주세요. ③ 서버 처리 지연 — 잠시 후 다시 시도해 주세요.",
    });
  }
  onEvent("done", {});
}
