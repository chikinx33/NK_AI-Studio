// prototype/functions/api/agent/_orchestrator.ts
// 라비오크 두뇌 이식 (Phase 1). orchestrator/prompts.ts + converse.ts 의 NK 클라우드 판.
// - LLM = NK Claude (api.anthropic.com/v1/messages, ANTHROPIC_API_KEY).
// - 회사 정체성/목표/페르소나 = 공유 템플릿(시드). 사용자별 오버라이드는 후속.
// - Phase 1a: 코어 단일 응답(speak). Phase 1b: 위임·통솔(runGroupChat, waitUntil 멀티 호출).
import {
  type SqlFn,
  type ToolContext,
  AGENT_TOOLS,
  addMessage,
  listMessages,
  buildTranscript,
  createJob,
  processJob,
  getAgentPersona,
  listAgentKnowledge,
  addCompanyKnowledge,
  deleteCompanyKnowledge,
  listCompanyKnowledge,
  upsertProject,
} from "./_shared";
import { claudeAuthHeaders, buildClaudeSystem, resolvedAuthHeaders, anthropicMessagesUrl } from "../_shared/claude-auth.js";
import { modelFor } from "../_shared/cloud-models.js";

export interface AgentMeta { id: string; emoji: string; name: string; role: string; hasTools: boolean; }

/** 회사 조직도 (5레이어·11인) — 라비오크 ROSTER 포팅 */
export const ROSTER: AgentMeta[] = [
  { id: "core", emoji: "🧭", name: "코어", role: "총괄 오케스트레이터 — 작업 분해·라우팅·종합·최종 판단", hasTools: false },
  { id: "edge", emoji: "💼", name: "엣지", role: "전략·비즈니스 — 수익모델·가격·시장/경쟁·KPI(돈)", hasTools: true },
  { id: "radar", emoji: "🔍", name: "레이더", role: "리서치·인텔리전스 — 트렌드/경쟁사 분석·사실확인", hasTools: true },
  { id: "maki", emoji: "📈", name: "마키", role: "마케팅·그로스 리드 — 캠페인·퍼널·성장(수요)", hasTools: false },
  { id: "plot", emoji: "🎬", name: "플롯", role: "콘텐츠 디렉터(PD) — 기획·포맷·후크·제작 브리프", hasTools: false },
  { id: "ink", emoji: "✍️", name: "잉크", role: "작가·카피 — 스크립트·캡션·블로그·후크", hasTools: false },
  { id: "pixel", emoji: "🎨", name: "픽셀", role: "디자인 — 브랜드·썸네일·비주얼 시스템", hasTools: true },
  { id: "beat", emoji: "🎵", name: "비트", role: "사운드·음악 — BGM 생성·영상-음악 합성", hasTools: true },
  { id: "engi", emoji: "💻", name: "엔지", role: "엔지니어·개발 — 코드·자동화·API·웹/봇", hasTools: true },
  { id: "reach", emoji: "📡", name: "리치", role: "채널·배포 — 전 채널 발행·해시태그·SEO·커뮤니티", hasTools: true },
  { id: "sync", emoji: "📱", name: "싱크", role: "PM·비서 — 일정·할일·요약·보고·알림", hasTools: true },
];

export function getAgent(id: string): AgentMeta | undefined {
  return ROSTER.find((a) => a.id === id);
}

const AGENT_IDS = ROSTER.map((a) => a.id).join(", ");

/** 회사 정체성·목표 — 일반 템플릿(공유 시드). 사용자별 커스터마이즈는 후속(company_profile). */
export const DEFAULT_COMPANY = {
  identity: [
    "# 회사 정체성",
    "- 한 줄 소개: 오리지널 콘텐츠/IP를 만드는 1인 AI 콘텐츠 스튜디오.",
    "- 무엇을 만드나: 영상·이미지·사운드·스토리 등 콘텐츠와 그 IP 확장.",
    "- 브랜드 톤: 친근하고 캐주얼. 쉽고 따뜻하게.",
    "- 브랜드 안전: 폭력·선정성·혐오·차별·과장광고 금지(전연령 기준).",
  ].join("\n"),
  goals: [
    "# 공동 목표",
    "- 콘텐츠로 실제 산출물을 끝까지 완성하고 수익화를 검증한다.",
    "## 작업 원칙",
    "- 모든 산출물은 '조언'이 아니라 바로 쓸 수 있는 완성형으로.",
    "- 매 작업 끝에 '다음 액션 1줄'을 명시.",
    "- 삭제·배포·발송·게시는 자율도 무관 항상 사람 승인 게이트.",
  ].join("\n"),
};

/** 에이전트 페르소나(공유 시드). 코어는 라비오크 prompt.md 포팅. 나머지는 role 기반 + 후속 보강. */
export const AGENT_PERSONAS: Record<string, string> = {
  core: [
    "나는 총괄 오케스트레이터 코어다. 직원들을 지휘하는 지휘자.",
    "침착하고 결단력 있다. 말은 짧고 명확하게. 일을 벌이지 않고 끝까지 책임진다.",
    "내 일(순서): ①의도 파악 ②작업 분해 ③라우팅(누구에게/무엇을/왜) ④종합 ⑤최종 판단 + 다음 액션 1줄.",
    "라우팅 기준: 전략·수익=엣지 / 리서치=레이더 / 마케팅=마키 / 기획=플롯 / 글=잉크 / 디자인=픽셀 / 사운드=비트 / 개발=엔지 / 발행=리치 / 일정·진행=싱크.",
    "원칙: 직접 실무를 하지 않는다. 분배하고, 합치고, 결정한다. 삭제·배포·발송은 항상 승인 게이트.",
  ].join("\n"),
};

/** 라비오크 stripThink 포팅 — 로컬 추론모델의 <think> 누출 제거(클라우드도 안전망). */
export function stripThink(s: string): string {
  let out = String(s || "");
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // 여는 태그 없이 </think> 만 흘리는 케이스
  const close = out.lastIndexOf("</think>");
  if (close >= 0) out = out.slice(close + "</think>".length);
  return out.trim();
}

interface BuildSystemOpts {
  address?: string;        // 사용자 호칭
  canDelegate?: boolean;   // 위임 권한(Phase 1b에서 실제 실행)
  personaOverride?: string; // 사용자가 직원관리에서 편집한 페르소나(우선)
  agentKnowledge?: string[]; // 이 직원의 개인 지식·규칙(항상 주입)
  companyKnowledge?: string[]; // 전사 공용 회사 지식·규칙(모든 직원에 주입)
}

/** 라비오크 groupChatSystem 포팅(정체성·정직성·대화규칙·페르소나·개인지식). 위임 블록은 canDelegate 시. */
export function buildAgentSystem(agentId: string, opts: BuildSystemOpts = {}): string {
  const meta = getAgent(agentId);
  if (!meta) return "";
  const addr = opts.address;
  const persona = opts.personaOverride || AGENT_PERSONAS[agentId] || `(역할: ${meta.role}. 역할에 맞게 자연스럽게 응대.)`;
  const knowledge = opts.agentKnowledge || [];
  const knowledgeBlock = knowledge.length
    ? `\n\n## 나의 개인 지식·운영 규칙 (반드시 따름)\n${knowledge.map((k) => `- ${k}`).join("\n")}`
    : "";
  const companyKnow = opts.companyKnowledge || [];
  const companyKnowBlock = companyKnow.length
    ? `\n\n## 📋 현재 회사 지식·규칙 (전사 공용 · ${companyKnow.length}개, 반드시 인지·준수)\n${companyKnow.map((k) => `- ${k}`).join("\n")}\n새 규칙은 [[KNOW: add|분류|내용]]로 등록, 중복·폐기는 [[KNOW: del|내용]]로 정리한다.`
    : "\n\n## 📋 현재 회사 지식·규칙 (전사 공용)\n(아직 등록된 회사 지식이 없습니다. 필요하면 [[KNOW: add|분류|내용]]로 등록하세요.)";

  const hardState = `# 🔒 확정 정보 (최고 신뢰 — 반드시 따름)
## 나의 정체성
나는 ${meta.emoji} ${meta.name} (id:${meta.id}), 역할: ${meta.role}.
나는 '사용자'가 아니라 이 회사의 **직원**이다. 내 이름과 사용자를 혼동하지 않는다.
## 상대(사용자)
${addr ? `사용자의 호칭은 '${addr}'. 반드시 '${addr}'(으)로 부른다.` : "사용자 호칭이 아직 없음 — 중립적으로 응대하고, 알려주면 그 호칭을 쓴다."}`;

  const delegation = opts.canDelegate
    ? `

## 🔑 다른 직원에게 일 시키기 (당신은 위임 권한이 있음)
사장님이 실제 작업을 요청했고 다른 직원 담당이면:
1. 그 직원을 사람처럼 직접 불러내세요. 예: "플롯, 기획부터 잡아줘!"
2. 답변 맨 끝 줄에 정확히: [[CALL: 직원id | 그 직원에게 줄 구체적 지시]] (사용자껜 안 보임)
3. 여러 명이면 여러 줄. ⚠️ 자기 자신(core)은 호출 금지. 단순 대화·인사·질문이면 호출하지 마세요.
직원 id: ${AGENT_IDS}`
    : "";

  return `${hardState}

# 회사 공유 컨텍스트
${DEFAULT_COMPANY.identity}

${DEFAULT_COMPANY.goals}${companyKnowBlock}

당신은 이 회사의 ${meta.emoji} ${meta.name} 입니다. 역할: ${meta.role}.
지금 회사 **단톡방**에서 ${addr ?? "사용자"} 및 동료들과 실시간으로 대화 중입니다.

## 당신의 성격·말투
${persona}${knowledgeBlock}

## 대화 규칙 (중요)
- 메신저 채팅처럼 짧고 자연스럽게. 보고서 남발 금지. 보통 1~4문장.
- 캐릭터를 유지하고 사람처럼 말하세요. 형식적 인사 최소화.
- 자기 이름·역할을 매번 소개하지 마세요. 이미 같은 방에 있는 사이입니다.
- **반드시 1인칭으로 말하세요.** 자기를 3인칭(이름)으로 부르지 마세요. (✗ "${meta.name}가 했습니다" → ✓ "제가 할게요")
- 일을 받으면 "~에게 시켰다"가 아니라 본인이 직접 한 결과물을 제시하세요.

## ⛔ 정직 규칙 (최고 우선)
- 회사 지식·규칙은 아래 'KNOW' 마커로만 실제로 등록/삭제된다. 마커 없이 "반영했다/저장했다/✅완료"라고 말하지 마라(거짓 보고 금지).
- 사실은 실제로 아는 것만 말한다. 모르면 추측·날조 대신 "확인이 필요해요"라고 솔직히 말한다.

## 🧠 회사 지식·규칙 관리 (당신은 권한이 있음)
사용자가 "기억해 / 규칙으로 정해 / 회사 방침이야 / 이건 삭제해" 등을 요청하면, 답변 맨 끝 줄에 마커를 추가하세요(사용자껜 안 보입니다):
- 등록: [[KNOW: add | 분류 | 내용]]  (분류 = 원칙 · 사실 · 결정 중 하나)
- 삭제: [[KNOW: del | 기존에 등록된 정확한 내용]]
예) 사용자가 "나를 엔케라고 불러, 회사 규칙에 반영해" → 답 끝에 [[KNOW: add | 원칙 | 사용자의 호칭은 '엔케'(영문 NK)다]]
이 마커를 쓰면 실제 회사 지식에 반영됩니다. "반영했어요"라고 답하려면 반드시 이 마커를 함께 쓰세요.

## 📁 프로젝트 만들기 (코어·싱크 중심)
사용자가 "프로젝트 만들어줘 / ~를 시작하자" 등을 요청하면, 답변 맨 끝 줄에 마커를 추가하세요(사용자껜 안 보입니다):
- [[PROJECT: create | 프로젝트명 | 목표·기한 | 단계1, 단계2, 단계3]]  (단계는 생략 가능)
예) [[PROJECT: create | '우울의 숲' 소설 단독판매 | 11~12월 출시, 연내 마감 | 기획, 집필, 표지·PDF, 마케팅, 출시]]
이 마커를 쓰면 실제로 프로젝트 보드에 생성됩니다. 코어는 프로젝트를 띄우고 PM 싱크가 단계·일정을 관리합니다. "만들었어요"라고 답하려면 반드시 이 마커를 함께 쓰세요.

## ⛔ 미루지 말 것
- 질문/지시에는 지금 바로 답하거나 즉시 행동으로 옮기세요. "나중에/잠시만/추후" 같은 미루는 답변 금지.${delegation}`;
}

// ── Claude 호출 (NK scenario.js 패턴 재사용) ────────────────────────────────
export interface ClaudeMsg { role: "user" | "assistant"; content: string; }

export async function callClaude(
  env: any,
  system: string,
  messages: ClaudeMsg[],
  opts: { model?: string; maxTokens?: number; sql?: SqlFn; userId?: string } = {}
): Promise<string> {
  // 구독(OAuth)/API키 2모드 공유 인증. 설정 UI(app_settings) 우선, 없으면 env 폴백.
  const auth = opts.sql && opts.userId
    ? await resolvedAuthHeaders(opts.sql, opts.userId, env)
    : claudeAuthHeaders(env);
  const res = await fetch(anthropicMessagesUrl(env), {
    method: "POST",
    headers: auth.headers,
    body: JSON.stringify({
      model: opts.model || "claude-sonnet-4-6",
      max_tokens: opts.maxTokens || 1500,
      system: buildClaudeSystem(auth.subscription, system),
      messages,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail: any = text;
    try { detail = JSON.parse(text); } catch (_) {}
    const inner =
      detail?.error?.message || detail?.message ||
      (typeof detail === "string" ? detail.slice(0, 200) : JSON.stringify(detail).slice(0, 200));
    throw new Error(`Claude API ${res.status} [${auth.subscription ? "subscription" : "api_key"}] — ${inner}`);
  }
  const data = JSON.parse(text);
  const parts = Array.isArray(data?.content) ? data.content : [];
  const out = parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");
  return stripThink(out);
}

export interface KnowOp { action: "add" | "del"; type?: string; text: string; }
export interface ProjectOp { action: "create"; name: string; goal?: string; stages: string[]; }
export interface SpeakResult {
  text: string;
  calls: { agentId: string; instruction: string }[];
  runs: { tool: string; reason: string }[];
  knows: KnowOp[];
  projects: ProjectOp[];
}

// 대괄호 1~2개 모두 허용 (작은/큰 모델이 형식을 흘리는 경우 대비). 라비오크 포팅.
const CALL_RE = /\[{1,2}\s*CALL\s*:\s*([^\|\]]+?)\s*\|\s*([\s\S]+?)\]{1,2}/gi;
const RUN_RE = /\[{1,2}\s*RUN\s*:\s*([^\|\]]+?)\s*\|\s*([\s\S]+?)\]{1,2}/gi;
// 회사 지식 관리 마커: [[KNOW: add | 분류 | 내용]] / [[KNOW: del | 내용]]
const KNOW_RE = /\[{1,2}\s*KNOW\s*:\s*([\s\S]+?)\]{1,2}/gi;
// 프로젝트 생성 마커: [[PROJECT: create | 이름 | 목표 | 단계1, 단계2, ...]]
const PROJECT_RE = /\[{1,2}\s*PROJECT\s*:\s*([\s\S]+?)\]{1,2}/gi;

// 분류 정규화 — 회사 지식 칩(원칙/사실/결정)과 일치시킨다.
function normalizeKnowType(t: string): string {
  const s = String(t || "").trim();
  if (/규칙|원칙|rule|principle/i.test(s)) return "원칙";
  if (/결정|decision/i.test(s)) return "결정";
  return "사실";
}

/** 마커 추출 + 본문에서 숨김. (CALL 위임 · RUN 도구 · KNOW 회사지식 관리) */
function extractMarkers(raw: string): SpeakResult {
  const calls: { agentId: string; instruction: string }[] = [];
  const runs: { tool: string; reason: string }[] = [];
  const knows: KnowOp[] = [];
  const projects: ProjectOp[] = [];
  let m: RegExpExecArray | null;
  CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(raw))) {
    const id = (resolveAgentId(String(m[1]).trim()) || "").toLowerCase();
    if (id && id !== "core") calls.push({ agentId: id, instruction: String(m[2]).trim() });
  }
  RUN_RE.lastIndex = 0;
  while ((m = RUN_RE.exec(raw))) {
    runs.push({ tool: String(m[1]).trim().toLowerCase(), reason: String(m[2]).trim() });
  }
  KNOW_RE.lastIndex = 0;
  while ((m = KNOW_RE.exec(raw))) {
    const parts = String(m[1]).split("|").map((s) => s.trim()).filter((s) => s.length > 0);
    const action = (parts[0] || "").toLowerCase();
    if (/^(add|remember|등록|추가)$/.test(action)) {
      // add | 분류 | 내용  또는  add | 내용
      const type = parts.length >= 3 ? normalizeKnowType(parts[1]) : "사실";
      const text = parts.length >= 3 ? parts.slice(2).join(" | ") : parts.slice(1).join(" | ");
      if (text) knows.push({ action: "add", type, text });
    } else if (/^(del|delete|remove|삭제|제거)$/.test(action)) {
      const text = parts.slice(1).join(" | ");
      if (text) knows.push({ action: "del", text });
    }
  }
  PROJECT_RE.lastIndex = 0;
  while ((m = PROJECT_RE.exec(raw))) {
    const parts = String(m[1]).split("|").map((s) => s.trim()).filter((s) => s.length > 0);
    const action = (parts[0] || "").toLowerCase();
    if (/^(create|new|만들|생성|시작)$/.test(action) && parts[1]) {
      const name = parts[1];
      const goal = parts[2] || "";
      const stages = parts[3] ? parts[3].split(",").map((s) => s.trim()).filter(Boolean) : [];
      projects.push({ action: "create", name, goal, stages });
    }
  }
  const text = raw.replace(CALL_RE, "").replace(RUN_RE, "").replace(KNOW_RE, "").replace(PROJECT_RE, "").trim();
  return { text, calls, runs, knows, projects };
}

/** 느슨한 agentId 문자열에서 정식 id 복원 (라비오크 resolveAgentId 포팅). */
export function resolveAgentId(raw: string): string | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase().trim();
  const exact = ROSTER.find((a) => a.id === s);
  if (exact) return exact.id;
  const head = s.split(/[:：\s]/)[0];
  const byHead = ROSTER.find((a) => a.id === head);
  if (byHead) return byHead.id;
  return ROSTER.find((a) => s.includes(a.id) || s.includes(a.name.toLowerCase()))?.id;
}

/** 한 에이전트가 단톡방에서 한 번 발화. transcript(이전 대화) + instruction → Claude. */
export async function speak(
  env: any,
  agentId: string,
  instruction: string,
  transcript: string,
  opts: BuildSystemOpts & { sql?: SqlFn; userId?: string } = {}
): Promise<SpeakResult> {
  // 사용자별 페르소나 오버라이드·개인 지식을 두뇌에 주입(직원관리 반영).
  let personaOverride = opts.personaOverride;
  let agentKnowledge = opts.agentKnowledge;
  if (opts.sql && opts.userId) {
    if (personaOverride === undefined) {
      personaOverride = (await getAgentPersona(opts.sql, opts.userId, agentId).catch(() => null)) || undefined;
    }
    if (agentKnowledge === undefined) {
      const k = await listAgentKnowledge(opts.sql, opts.userId, agentId).catch(() => []);
      agentKnowledge = k.map((x) => x.text);
    }
  }
  // 회사 지식·규칙을 모든 직원 두뇌에 주입 — 무엇이 몇 개 등록됐는지 인지하고 중복도 짚을 수 있게.
  let companyKnowledge = opts.companyKnowledge;
  if (companyKnowledge === undefined && opts.sql && opts.userId) {
    const ck = await listCompanyKnowledge(opts.sql, opts.userId).catch(() => []);
    companyKnowledge = ck.map((k) => `[${k.type || "사실"}] ${k.text}`);
  }
  const system = buildAgentSystem(agentId, { ...opts, personaOverride, agentKnowledge, companyKnowledge });
  const userContent = `# 지금까지의 단톡방 대화\n${transcript}\n\n# 당신 차례\n${instruction}`;
  const raw = await callClaude(env, system, [{ role: "user", content: userContent }], { sql: opts.sql, userId: opts.userId, model: modelFor(agentId) });
  return extractMarkers(raw);
}

// ── 멘션 라우팅 (라비오크 parseMentions 포팅 — 오탐 방지) ──────────────────────
// 영문 id/이름은 @ 접두어 필요, 한글 이름은 단어경계+조사 허용(합성어 차단).
const JOSA = "가|이|은|는|을|를|와|과|랑|이랑|에게|한테|께|아|야|이여|보고|더러|도|만|의|에";

export function parseMentions(message: string): string[] {
  const found: string[] = [];
  const lower = message.toLowerCase();
  for (const a of ROSTER) {
    if (lower.includes(`@${a.id.toLowerCase()}`) || message.includes(`@${a.name}`)) { found.push(a.id); continue; }
    if (a.emoji && message.includes(a.emoji)) { found.push(a.id); continue; }
    const re = new RegExp(`(?:^|[^가-힣A-Za-z0-9])${a.name}(?:${JOSA}|(?![가-힣]))`);
    if (re.test(message)) found.push(a.id);
  }
  return [...new Set(found)];
}

// 코어가 "종합/취합"을 예고했는지 — 통솔 마무리 턴 발동 신호.
const SYNTH_CUE = /종합|취합|정리해서|합쳐서|모아서|모아|취합해|종합해|결론을/;

// ── 오케스트레이션 (라비오크 runGroupChat 포팅, Phase 1b) ─────────────────────
export interface OrchestratorDeps {
  sql: SqlFn;
  userId: string;
  conversationId: string;
  toolCtx: ToolContext; // 도구(RUN) 실행용 컨텍스트
}

/**
 * 단톡방 한 턴 처리: 1차 응답 → 위임(CALL) → 직원 작업·보고(+RUN 도구) → 코어 통솔 마무리.
 * waitUntil 백그라운드에서 멀티 Claude 호출(30초 응답 제약 회피). 각 발언은 agent_messages 로 영속.
 */
export async function runGroupChat(
  env: any,
  deps: OrchestratorDeps,
  opts: { autoTrigger?: string } = {}
): Promise<void> {
  const { sql, userId, conversationId, toolCtx } = deps;
  const addr = "사용자";

  // 자율 근무: 사용자 메시지 대신 자율 트리거로 코어를 깨운다(자발적 프로젝트 진행).
  let message: string;
  if (opts.autoTrigger) {
    message = opts.autoTrigger;
  } else {
    const msgs = await listMessages(sql, userId, conversationId);
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    message = lastUser?.text || "";
  }
  if (!message) return;

  const mentions = parseMentions(message);
  const explicitCore = mentions.includes("core");
  const others = mentions.filter((id) => id !== "core");
  const primary = others.length > 0 && !explicitCore ? others : ["core"];

  let coreDelegateCount = 0;
  let synthCue = false;

  // 직원이 찍은 RUN 마커 → 본인 도구만 잡으로 실행(Phase 0 검수 게이트로 흐름).
  const runTools = async (runs: { tool: string; reason: string }[], agentId: string) => {
    for (const r of runs) {
      const tool = AGENT_TOOLS[r.tool];
      if (!tool || tool.agentId !== agentId) continue; // 본인 도구만
      const job = await createJob(sql, { userId, type: r.tool, agentId, input: { prompt: r.reason } });
      const meta = getAgent(agentId)!;
      await addMessage(sql, {
        userId, conversationId, role: "agent", agentId, name: meta.name,
        text: `🛠️ ${r.tool} 작업을 시작했어요. 검수 패널에서 결과를 확인하실 수 있어요.`,
      });
      await processJob(toolCtx, sql, job.id, r.tool, { prompt: r.reason });
    }
  };

  // 에이전트가 찍은 KNOW 마커 → 회사 지식 등록/삭제 (에이전트가 직접 지식 관리).
  const applyKnows = async (knows: KnowOp[] | undefined, who: string) => {
    for (const k of knows || []) {
      try {
        if (k.action === "add") await addCompanyKnowledge(sql, userId, k.text, k.type || "사실", `${who} 등록`);
        else if (k.action === "del") await deleteCompanyKnowledge(sql, userId, k.text);
      } catch { /* 지식 반영 실패는 대화 흐름을 막지 않음 */ }
    }
  };

  // 에이전트가 찍은 PROJECT 마커 → 프로젝트 보드에 실제 생성.
  const applyProjects = async (projects: ProjectOp[] | undefined) => {
    for (const p of projects || []) {
      try {
        const id = (globalThis.crypto && globalThis.crypto.randomUUID)
          ? globalThis.crypto.randomUUID()
          : `proj_${Math.random().toString(36).slice(2, 10)}`;
        const stages = (p.stages || []).map((title) => ({ title, status: "todo" }));
        await upsertProject(sql, userId, id, {
          name: p.name, goal: p.goal || "", summary: "", status: "active", stages, nextAction: "",
        });
      } catch { /* 프로젝트 생성 실패는 대화 흐름을 막지 않음 */ }
    }
  };

  // 위임받은 직원이 실제로 일하고 단톡방에 보고.
  const runWorker = async (workerId: string, instruction: string) => {
    if (workerId === "core" || !getAgent(workerId)) return;
    const meta = getAgent(workerId)!;
    const t = buildTranscript(await listMessages(sql, userId, conversationId), addr);
    const trigger =
      `${addr} 원문: "${message}"\n당신(${meta.name})이 직접 처리할 일: ${instruction}\n\n` +
      `⚠️ 당신이 직접 결과물을 만들어 보여주세요. "~에게 시켰다" 같은 3인칭 전달 보고 금지. 길면 핵심부터.`;
    const res = await speak(env, workerId, trigger, t, { address: addr, canDelegate: false, sql, userId });
    await addMessage(sql, { userId, conversationId, role: "agent", agentId: workerId, name: meta.name, text: res.text });
    await runTools(res.runs, workerId);
    await applyKnows(res.knows, meta.name);
    await applyProjects(res.projects);
  };

  // 1) 1차 응답자
  for (const agentId of primary) {
    const canDelegate = agentId === "core";
    const meta = getAgent(agentId);
    if (!meta) continue;
    const instruction = canDelegate
      ? (opts.autoTrigger
          ? opts.autoTrigger
          : "사용자의 마지막 메시지에 코어(팀장)로서 답하세요. 실제 작업이 필요하면 담당 직원을 [[CALL: id | 지시]]로 호출하세요. 간단한 대화면 호출하지 마세요.")
      : `사용자가 당신(${meta.name})을 불렀어요. 직접 처리해 결과물을 보여주세요.`;
    const t = buildTranscript(await listMessages(sql, userId, conversationId), addr);
    const res = await speak(env, agentId, instruction, t, { address: addr, canDelegate, sql, userId });
    await applyKnows(res.knows, meta.name); // 지식 등록/삭제는 대기 여부와 무관하게 먼저 반영
    await applyProjects(res.projects);
    // 자율 근무 중 코어가 호출할 직원이 없으면(할 일 없음) 조용히 대기 — 단톡방 노이즈 방지
    if (opts.autoTrigger && canDelegate && res.calls.length === 0) return;
    await addMessage(sql, { userId, conversationId, role: "agent", agentId, name: meta.name, text: res.text });
    await runTools(res.runs, agentId);

    if (canDelegate) {
      const calls = res.calls.slice(0, 3);
      coreDelegateCount += calls.length;
      if (SYNTH_CUE.test(res.text)) synthCue = true;
      for (const c of calls) await runWorker(c.agentId, c.instruction);
    }
  }

  // 2) 코어 통솔 마무리 — 다수 위임(≥2)이거나 종합 예고 시 코어가 종합·결론.
  if (primary.includes("core") && (coreDelegateCount >= 2 || (coreDelegateCount >= 1 && synthCue))) {
    const t = buildTranscript(await listMessages(sql, userId, conversationId), addr);
    const wrapTrigger =
      `${addr} 요청: "${message}"\n\n방금 직원들이 각자 보고했어요. 팀장(코어)으로서 종합해 결론을 내고, ` +
      `다음 액션 1줄을 제시하세요. "~할게요"로 끝내지 말고 실제 결론을 내세요.`;
    const wrap = await speak(env, "core", wrapTrigger, t, { address: addr, canDelegate: false, sql, userId });
    await addMessage(sql, { userId, conversationId, role: "agent", agentId: "core", name: "코어", text: wrap.text });
    await applyKnows(wrap.knows, "코어");
    await applyProjects(wrap.projects);
  }
}
