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

export interface AgentVoicePreset {
  key: string;
  label: string;
  provider: "gemini";
  geminiVoiceName: string;
  voiceId: "kr_female_narration" | "kr_male_narration";
  pitch: number;
  speakingRate: number;
  prompt: string;
}

export const AGENT_VOICE_PRESETS: AgentVoicePreset[] = [
  { key: "voice-01", label: "Gemini TTS · Achird (남)", provider: "gemini", geminiVoiceName: "Achird", voiceId: "kr_male_narration", pitch: 0, speakingRate: 1, prompt: "Say the following in a natural Korean voice." },
  { key: "voice-02", label: "Gemini TTS · Algenib (남)", provider: "gemini", geminiVoiceName: "Algenib", voiceId: "kr_male_narration", pitch: 0, speakingRate: 1, prompt: "Say the following in a natural Korean voice." },
  { key: "voice-03", label: "Gemini TTS · Algieba (남)", provider: "gemini", geminiVoiceName: "Algieba", voiceId: "kr_male_narration", pitch: 0, speakingRate: 1, prompt: "Say the following in a natural Korean voice." },
  { key: "voice-04", label: "Gemini TTS · Alnilam (남)", provider: "gemini", geminiVoiceName: "Alnilam", voiceId: "kr_male_narration", pitch: 0, speakingRate: 1, prompt: "Say the following in a natural Korean voice." },
  { key: "voice-05", label: "Gemini TTS · Enceladus (남)", provider: "gemini", geminiVoiceName: "Enceladus", voiceId: "kr_male_narration", pitch: 0, speakingRate: 1, prompt: "Say the following in a natural Korean voice." },
  { key: "voice-06", label: "Gemini TTS · Fenrir (남)", provider: "gemini", geminiVoiceName: "Fenrir", voiceId: "kr_male_narration", pitch: 0, speakingRate: 1, prompt: "Say the following in a natural Korean voice." },
  { key: "voice-07", label: "Gemini TTS · Orus (남)", provider: "gemini", geminiVoiceName: "Orus", voiceId: "kr_male_narration", pitch: 0, speakingRate: 1, prompt: "Say the following in a natural Korean voice." },
  { key: "voice-08", label: "Gemini TTS · Sadachbia (남)", provider: "gemini", geminiVoiceName: "Sadachbia", voiceId: "kr_male_narration", pitch: 0, speakingRate: 1, prompt: "Say the following in a natural Korean voice." },
  { key: "voice-09", label: "Gemini TTS · Achernar (여)", provider: "gemini", geminiVoiceName: "Achernar", voiceId: "kr_female_narration", pitch: 0, speakingRate: 1, prompt: "Say the following in a natural Korean voice." },
  { key: "voice-10", label: "Gemini TTS · Aoede (여)", provider: "gemini", geminiVoiceName: "Aoede", voiceId: "kr_female_narration", pitch: 0, speakingRate: 1, prompt: "Say the following in a natural Korean voice." },
  { key: "voice-11", label: "Gemini TTS · Autonoe (여)", provider: "gemini", geminiVoiceName: "Autonoe", voiceId: "kr_female_narration", pitch: 0, speakingRate: 1, prompt: "Say the following in a natural Korean voice." },
  { key: "voice-12", label: "Gemini TTS · Callirrhoe (여)", provider: "gemini", geminiVoiceName: "Callirrhoe", voiceId: "kr_female_narration", pitch: 0, speakingRate: 1, prompt: "Say the following in a natural Korean voice." },
  { key: "voice-13", label: "Gemini TTS · Gacrux (여)", provider: "gemini", geminiVoiceName: "Gacrux", voiceId: "kr_female_narration", pitch: 0, speakingRate: 1, prompt: "Say the following in a natural Korean voice." },
  { key: "voice-14", label: "Gemini TTS · Kore (여)", provider: "gemini", geminiVoiceName: "Kore", voiceId: "kr_female_narration", pitch: 0, speakingRate: 1, prompt: "Say the following in a natural Korean voice." },
  { key: "voice-15", label: "Gemini TTS · Vindemiatrix (여)", provider: "gemini", geminiVoiceName: "Vindemiatrix", voiceId: "kr_female_narration", pitch: 0, speakingRate: 1, prompt: "Say the following in a natural Korean voice." },
  { key: "voice-16", label: "Gemini TTS · Zephyr (여)", provider: "gemini", geminiVoiceName: "Zephyr", voiceId: "kr_female_narration", pitch: 0, speakingRate: 1, prompt: "Say the following in a natural Korean voice." },
];

export const DEFAULT_AGENT_VOICE: Record<string, string> = {
  core: "voice-07",
  edge: "voice-04",
  radar: "voice-01",
  maki: "voice-10",
  plot: "voice-12",
  ink: "voice-15",
  pixel: "voice-16",
  beat: "voice-14",
  engi: "voice-05",
  reach: "voice-11",
  sync: "voice-03",
};

export const AGENT_VOICE_TEST_LINES = [
  "좋습니다. 지금부터 핵심만 차분히 정리해 드릴게요.",
  "잠깐만요, 이 부분은 숫자보다 맥락을 먼저 봐야 합니다.",
  "아이디어는 좋아요. 이제 실행 순서를 세 단계로 나눠볼게요.",
  "이 문장은 조금 딱딱하니까, 사람 말처럼 부드럽게 풀어보겠습니다.",
  "자료를 확인해 보니, 지금 가장 중요한 신호는 방향성입니다.",
  "오늘 할 일은 많지만, 우선순위를 잡으면 충분히 끝낼 수 있어요.",
  "브랜드 톤은 유지하면서도, 첫 문장은 더 강하게 가보죠.",
  "사용자님, 이건 급하게 고치기보다 원인을 먼저 보는 게 맞습니다.",
  "좋아요. 화면 구성은 단순하게, 행동 버튼은 더 분명하게 잡겠습니다.",
  "이 장면은 소리의 여백이 중요해요. 말보다 분위기가 먼저 와야 합니다.",
  "마감 전에 필요한 건 완벽함보다 테스트 가능한 상태입니다.",
  "지금 흐름이면, 홍보 문구는 짧고 기억하기 쉬운 쪽이 낫습니다.",
  "회의록은 제가 정리해 둘게요. 결정 사항만 따로 표시하겠습니다.",
  "잠시만 기다려 주세요. 가능한 선택지를 비교해서 가져오겠습니다.",
  "이 표현은 좋지만, 마지막 한 줄에서 감정이 더 살아나면 좋겠어요.",
  "문제는 기능 자체보다 사용자가 어디서 멈추는지에 있습니다.",
  "이제 충분히 괜찮습니다. 다음 단계로 넘겨도 되는 상태예요.",
  "조금 더 선명하게 말하면, 지금 필요한 건 확장보다 정리입니다.",
  "콘텐츠의 첫 3초는 설명이 아니라 호기심으로 열어야 합니다.",
  "알겠습니다. 제가 조용히 이어받아서 마무리해 보겠습니다.",
];

const AGENT_VOICE_STORAGE_KEY = "agentVoiceSelections";
const AGENT_VOICE_SPEED_STORAGE_KEY = "agentVoiceSpeeds";
export const AGENT_VOICE_SPEEDS = [0.5, 1, 1.2, 1.5] as const;
export type AgentVoiceSpeed = typeof AGENT_VOICE_SPEEDS[number];

export function getAgentVoiceKey(agentId?: string): string {
  const id = String(agentId || "");
  try {
    const saved = JSON.parse(localStorage.getItem(AGENT_VOICE_STORAGE_KEY) || "{}");
    if (saved && typeof saved[id] === "string" && AGENT_VOICE_PRESETS.some((v) => v.key === saved[id])) return saved[id];
  } catch {
    /* ignore */
  }
  return DEFAULT_AGENT_VOICE[id] || "voice-01";
}

export function setAgentVoiceKey(agentId: string, voiceKey: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(AGENT_VOICE_STORAGE_KEY) || "{}");
    saved[agentId] = voiceKey;
    localStorage.setItem(AGENT_VOICE_STORAGE_KEY, JSON.stringify(saved));
  } catch {
    /* ignore */
  }
}

export function getAgentVoiceSpeed(agentId?: string): AgentVoiceSpeed {
  const id = String(agentId || "");
  try {
    const saved = JSON.parse(localStorage.getItem(AGENT_VOICE_SPEED_STORAGE_KEY) || "{}");
    const n = Number(saved?.[id]);
    if (AGENT_VOICE_SPEEDS.includes(n as AgentVoiceSpeed)) return n as AgentVoiceSpeed;
  } catch {
    /* ignore */
  }
  return 1;
}

export function setAgentVoiceSpeed(agentId: string, speed: AgentVoiceSpeed) {
  try {
    const saved = JSON.parse(localStorage.getItem(AGENT_VOICE_SPEED_STORAGE_KEY) || "{}");
    saved[agentId] = speed;
    localStorage.setItem(AGENT_VOICE_SPEED_STORAGE_KEY, JSON.stringify(saved));
  } catch {
    /* ignore */
  }
}

export function nextAgentVoiceSpeed(current: number): AgentVoiceSpeed {
  const idx = AGENT_VOICE_SPEEDS.findIndex((s) => s === current);
  return AGENT_VOICE_SPEEDS[(idx + 1) % AGENT_VOICE_SPEEDS.length];
}

export function applyAudioPlaybackRate(audio: HTMLAudioElement, speed: number) {
  const rate = AGENT_VOICE_SPEEDS.includes(speed as AgentVoiceSpeed) ? speed : 1;
  audio.playbackRate = rate;
  (audio as any).preservesPitch = true;
  (audio as any).mozPreservesPitch = true;
  (audio as any).webkitPreservesPitch = true;
}

export function getAgentVoicePreset(agentId?: string, voiceKey?: string): AgentVoicePreset {
  const key = voiceKey || getAgentVoiceKey(agentId);
  return AGENT_VOICE_PRESETS.find((v) => v.key === key) || AGENT_VOICE_PRESETS[0];
}

export async function synthesizeAgentSpeech(input: {
  agentId?: string;
  text: string;
  voiceKey?: string;
}): Promise<{ voiceUrl: string; format?: string; objectName?: string }> {
  const script = String(input.text || "").trim();
  if (!script) throw new Error("script is required");
  const sceneId = `chat_${String(input.agentId || "agent").replace(/[^a-z0-9_-]/gi, "_")}_${Date.now()}`;
  const voice = getAgentVoicePreset(input.agentId, input.voiceKey);
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: "ai-company-chat",
      sceneId,
      script,
      voiceId: voice.voiceId,
      speakingRate: voice.speakingRate,
      pitch: voice.pitch,
      prompt: voice.prompt,
      geminiVoiceName: voice.geminiVoiceName,
      strictCloudGeminiTts: true,
    }),
  });
  const raw = await res.text().catch(() => "");
  let data: any = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }
  if (!res.ok || data?.error || !data?.voiceUrl) {
    const hint = data?.hint || data?.detail?.error?.message || data?.detail?.message || data?.error || data?.raw;
    const cloudError = data?.cloud_error ? `상세: ${data.cloud_error}` : "";
    const category = data?.category ? `분류: ${data.category}` : "";
    const detail = [hint, category, cloudError].filter(Boolean).join("\n");
    throw new Error(detail || `tts_failed_${res.status}`);
  }
  return { voiceUrl: data.voiceUrl, format: data.format, objectName: data.objectName };
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
    ts: m.created_at ? (Date.parse(m.created_at) || undefined) : undefined,
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
  gmail_send: "메일 발송", calendar_create: "구글 캘린더 일정 추가", calendar_delete: "구글 캘린더 일정 삭제", gmail_trash: "Gmail 메일 휴지통 이동", publish: "SNS 발행",
  image: "이미지 생성", video: "영상 생성", sound: "효과음 생성", music: "BGM 생성",
  scenario: "시나리오 생성", ppt: "PPT 생성", pdf: "PDF 문서 생성",
};
// 외부에 영향을 주는(되돌리기 어려운) 도구 — 카드에 'external' 배지로 강조.
const APPROVAL_EXTERNAL_TOOLS = new Set(["gmail_send", "calendar_create", "calendar_delete", "gmail_trash", "publish"]);
function fmtWhen(s?: string): string {
  if (!s) return "";
  const m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s));
  return m ? `${m[2]}/${m[3]} ${m[4]}:${m[5]}` : String(s);
}
function summarizeApprovalJob(j: any) {
  const input = j.input || {};
  const label = APPROVAL_TOOL_LABEL[j.type] || j.type || "작업";
  let title: string;
  let reason: string | undefined = input.description ? String(input.description).slice(0, 120) : undefined;
  if (j.type === "gmail_send") {
    // 메일은 받는사람·제목을 카드에 명시(오발송 방지) + 본문 일부를 reason으로.
    title = `${label}: ${input.subject || "(제목 없음)"} → ${input.to || "?"}`;
    reason = input.body ? String(input.body).slice(0, 160) : undefined;
  } else {
    const detail = input.summary || input.title || input.prompt || input.topic || input.caption || input.query || "";
    const when = fmtWhen(input.start);
    title = `${label}${detail ? `: ${String(detail).slice(0, 60)}` : ""}${when ? ` (${when})` : ""}`;
  }
  return {
    id: j.id,
    agentId: j.agent_id,
    agentName: NK_AGENT_NAMES[j.agent_id] || j.agent_id,
    title,
    tool: j.type,
    command: j.type,
    kind: APPROVAL_EXTERNAL_TOOLS.has(j.type) ? "external" : undefined,
    reason,
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

// 승인 = 검수 게이트 통과(확정) + 게이트 도구면 실제 실행. 실패 시 throw(원인을 화면에 드러냄).
export async function approveItem(id: string) {
  const res = await fetch(`/api/agent/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, decision: "approved" }),
  });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok || data?.error) throw new Error(data?.error || `승인 실패 (HTTP ${res.status})`);
  return data;
}

// 알람(리마인더) 한 건.
export interface DueReminder { id: string; fire_at: string; text: string }
// 알람 폴링: due(경과/실행 → 서버가 삭제하며 반환, 울림용) + upcoming(예정 목록, 예약 패널용).
export async function getReminders(): Promise<{ due: DueReminder[]; upcoming: DueReminder[] }> {
  try {
    const d = await (await fetch("/api/agent/reminders")).json();
    return { due: Array.isArray(d?.due) ? d.due : [], upcoming: Array.isArray(d?.upcoming) ? d.upcoming : [] };
  } catch {
    return { due: [], upcoming: [] };
  }
}
// 예약 직접 삭제(사용자 삭제 지시).
export async function deleteReminder(id: string): Promise<{ ok: boolean }> {
  try {
    const d = await (await fetch("/api/agent/reminder-delete", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    })).json();
    return { ok: !!d?.ok };
  } catch {
    return { ok: false };
  }
}

// 승인 대기(실행 전) 잡을 일괄 정리(취소). 테스트로 쌓인 잔여 승인 비우기용.
export async function clearApprovals(): Promise<{ ok: boolean; cleared: number }> {
  const res = await fetch(`/api/agent/clear-approvals`, { method: "POST" });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok || data?.error) throw new Error(data?.error || `정리 실패 (HTTP ${res.status})`);
  return data;
}

// 거절 = 작업 취소. 담당 직원이 취소 멘트 + 관련 지식 정리. 실패 시 throw.
export async function rejectItem(id: string) {
  const res = await fetch(`/api/agent/cancel-job`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok || data?.error) throw new Error(data?.error || `거절 실패 (HTTP ${res.status})`);
  return data;
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
  ts?: number; // 메시지 시각(ms) — 채팅 시각 표시용
}

// 브라우저 로컬 현재시각을 시간대 오프셋 포함 ISO8601로. (예: 2026-06-20T11:30:00-05:00)
// 서버(UTC)는 사용자 시간대를 모르므로 이 값을 보내 "오늘"·캘린더 시각을 정확히 맞춘다.
function localNowISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset(); // 분, UTC 기준 동(+)/서(-)
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${p(Math.floor(a / 60))}:${p(a % 60)}`;
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
      clientNow: localNowISO(), // 브라우저 로컬 현재시각(시간대 오프셋 포함) → 에이전트가 "오늘"을 정확히 알게
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
