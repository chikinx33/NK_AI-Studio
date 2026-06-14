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
} from "./_shared";

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
}

/** 라비오크 groupChatSystem 포팅(Phase 1a 핵심: 정체성·정직성·대화규칙). 위임 블록은 canDelegate 시. */
export function buildAgentSystem(agentId: string, opts: BuildSystemOpts = {}): string {
  const meta = getAgent(agentId);
  if (!meta) return "";
  const addr = opts.address;
  const persona = AGENT_PERSONAS[agentId] || `(역할: ${meta.role}. 역할에 맞게 자연스럽게 응대.)`;

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

${DEFAULT_COMPANY.goals}

당신은 이 회사의 ${meta.emoji} ${meta.name} 입니다. 역할: ${meta.role}.
지금 회사 **단톡방**에서 ${addr ?? "사용자"} 및 동료들과 실시간으로 대화 중입니다.

## 당신의 성격·말투
${persona}

## 대화 규칙 (중요)
- 메신저 채팅처럼 짧고 자연스럽게. 보고서 남발 금지. 보통 1~4문장.
- 캐릭터를 유지하고 사람처럼 말하세요. 형식적 인사 최소화.
- 자기 이름·역할을 매번 소개하지 마세요. 이미 같은 방에 있는 사이입니다.
- **반드시 1인칭으로 말하세요.** 자기를 3인칭(이름)으로 부르지 마세요. (✗ "${meta.name}가 했습니다" → ✓ "제가 할게요")
- 일을 받으면 "~에게 시켰다"가 아니라 본인이 직접 한 결과물을 제시하세요.

## ⛔ 정직 규칙 (최고 우선)
- 파일·메모리·규칙을 직접 쓰거나 고칠 수 없다. "반영했다/저장했다/✅완료"처럼 하지 않은 행동을 했다고 말하지 마라.
- 사실은 실제로 아는 것만 말한다. 모르면 추측·날조 대신 "확인이 필요해요"라고 솔직히 말한다.

## ⛔ 미루지 말 것
- 질문/지시에는 지금 바로 답하거나 즉시 행동으로 옮기세요. "나중에/잠시만/추후" 같은 미루는 답변 금지.${delegation}`;
}

// ── Claude 호출 (NK scenario.js 패턴 재사용) ────────────────────────────────
export interface ClaudeMsg { role: "user" | "assistant"; content: string; }

export async function callClaude(
  env: any,
  system: string,
  messages: ClaudeMsg[],
  opts: { model?: string; maxTokens?: number } = {}
): Promise<string> {
  const apiKey = String(env?.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model || "claude-sonnet-4-6",
      max_tokens: opts.maxTokens || 1500,
      system,
      messages,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail: any = text;
    try { detail = JSON.parse(text); } catch (_) {}
    const msg = detail?.error?.message || detail?.message || `Claude 호출 실패 (${res.status})`;
    throw new Error(msg);
  }
  const data = JSON.parse(text);
  const parts = Array.isArray(data?.content) ? data.content : [];
  const out = parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");
  return stripThink(out);
}

export interface SpeakResult {
  text: string;
  calls: { agentId: string; instruction: string }[];
  runs: { tool: string; reason: string }[];
}

// 대괄호 1~2개 모두 허용 (작은/큰 모델이 형식을 흘리는 경우 대비). 라비오크 포팅.
const CALL_RE = /\[{1,2}\s*CALL\s*:\s*([^\|\]]+?)\s*\|\s*([\s\S]+?)\]{1,2}/gi;
const RUN_RE = /\[{1,2}\s*RUN\s*:\s*([^\|\]]+?)\s*\|\s*([\s\S]+?)\]{1,2}/gi;

/** 마커 추출 + 본문에서 숨김. (Phase 1b: CALL 위임 + RUN 도구. RULE/RETRACT 등은 후속) */
function extractMarkers(raw: string): SpeakResult {
  const calls: { agentId: string; instruction: string }[] = [];
  const runs: { tool: string; reason: string }[] = [];
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
  const text = raw.replace(CALL_RE, "").replace(RUN_RE, "").trim();
  return { text, calls, runs };
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
  opts: BuildSystemOpts = {}
): Promise<SpeakResult> {
  const system = buildAgentSystem(agentId, opts);
  const userContent = `# 지금까지의 단톡방 대화\n${transcript}\n\n# 당신 차례\n${instruction}`;
  const raw = await callClaude(env, system, [{ role: "user", content: userContent }]);
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
export async function runGroupChat(env: any, deps: OrchestratorDeps): Promise<void> {
  const { sql, userId, conversationId, toolCtx } = deps;
  const addr = "사용자";

  const msgs = await listMessages(sql, userId, conversationId);
  const lastUser = [...msgs].reverse().find((m) => m.role === "user");
  const message = lastUser?.text || "";
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

  // 위임받은 직원이 실제로 일하고 단톡방에 보고.
  const runWorker = async (workerId: string, instruction: string) => {
    if (workerId === "core" || !getAgent(workerId)) return;
    const meta = getAgent(workerId)!;
    const t = buildTranscript(await listMessages(sql, userId, conversationId), addr);
    const trigger =
      `${addr} 원문: "${message}"\n당신(${meta.name})이 직접 처리할 일: ${instruction}\n\n` +
      `⚠️ 당신이 직접 결과물을 만들어 보여주세요. "~에게 시켰다" 같은 3인칭 전달 보고 금지. 길면 핵심부터.`;
    const res = await speak(env, workerId, trigger, t, { address: addr, canDelegate: false });
    await addMessage(sql, { userId, conversationId, role: "agent", agentId: workerId, name: meta.name, text: res.text });
    await runTools(res.runs, workerId);
  };

  // 1) 1차 응답자
  for (const agentId of primary) {
    const canDelegate = agentId === "core";
    const meta = getAgent(agentId);
    if (!meta) continue;
    const instruction = canDelegate
      ? "사용자의 마지막 메시지에 코어(팀장)로서 답하세요. 실제 작업이 필요하면 담당 직원을 [[CALL: id | 지시]]로 호출하세요. 간단한 대화면 호출하지 마세요."
      : `사용자가 당신(${meta.name})을 불렀어요. 직접 처리해 결과물을 보여주세요.`;
    const t = buildTranscript(await listMessages(sql, userId, conversationId), addr);
    const res = await speak(env, agentId, instruction, t, { address: addr, canDelegate });
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
    const wrap = await speak(env, "core", wrapTrigger, t, { address: addr, canDelegate: false });
    await addMessage(sql, { userId, conversationId, role: "agent", agentId: "core", name: "코어", text: wrap.text });
  }
}
