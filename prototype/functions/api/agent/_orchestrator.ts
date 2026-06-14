// prototype/functions/api/agent/_orchestrator.ts
// 라비오크 두뇌 이식 (Phase 1). orchestrator/prompts.ts + converse.ts 의 NK 클라우드 판.
// - LLM = NK Claude (api.anthropic.com/v1/messages, ANTHROPIC_API_KEY).
// - 회사 정체성/목표/페르소나 = 공유 템플릿(시드). 사용자별 오버라이드는 후속.
// - Phase 1a: 코어 단일 응답(speak). 위임·통솔(멀티 호출)은 Phase 1b(Workflows).

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

export interface SpeakResult { text: string; calls: { agentId: string; instruction: string }[]; }

const CALL_RE = /\[\[CALL:\s*([a-z]+)\s*\|\s*([^\]]+)\]\]/gi;

/** 마커 추출 + 본문에서 숨김. (Phase 1a: CALL. RUN/RULE 등은 Phase 1b/2) */
function extractMarkers(raw: string): SpeakResult {
  const calls: { agentId: string; instruction: string }[] = [];
  let m: RegExpExecArray | null;
  CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(raw))) {
    const id = String(m[1]).toLowerCase();
    if (getAgent(id) && id !== "core") calls.push({ agentId: id, instruction: String(m[2]).trim() });
  }
  const text = raw.replace(CALL_RE, "").trim();
  return { text, calls };
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
