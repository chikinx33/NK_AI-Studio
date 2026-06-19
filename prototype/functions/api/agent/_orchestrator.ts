// prototype/functions/api/agent/_orchestrator.ts
// 라비오크 두뇌 이식 (Phase 1). orchestrator/prompts.ts + converse.ts 의 NK 클라우드 판.
// - LLM = NK Claude (api.anthropic.com/v1/messages, ANTHROPIC_API_KEY).
// - 회사 정체성/목표/페르소나 = 공유 템플릿(시드). 사용자별 오버라이드는 후속.
// - Phase 1a: 코어 단일 응답(speak). Phase 1b: 위임·통솔(runGroupChat, waitUntil 멀티 호출).
import {
  type SqlFn,
  type ToolContext,
  AGENT_TOOLS,
  parseToolInput,
  addMessage,
  listMessages,
  buildTranscript,
  createJob,
  processJob,
  setJobStatus,
  getAgentPersona,
  listAgentKnowledge,
  addCompanyKnowledge,
  deleteCompanyKnowledge,
  listCompanyKnowledge,
  listPendingReviewJobs,
  upsertProject,
  listProjects,
  deleteProjectByName,
  updateProjectStageByName,
  updateProjectStatus,
  updateProjectField,
  addProjectStage,
  removeProjectStage,
  updateCompanyKnowledge,
  addAgentKnowledgeRow,
  removeAgentKnowledgeRow,
  listSkills,
  createSkill,
  patchSkill,
  deleteSkill,
  setPinSkill,
  archiveSkillByName,
  restoreSkill,
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
  { id: "plot", emoji: "🎬", name: "플롯", role: "콘텐츠 디렉터(PD) — 기획·포맷·후크·제작 브리프", hasTools: true },
  { id: "ink", emoji: "✍️", name: "잉크", role: "작가·카피 — 스크립트·캡션·블로그·후크·PDF 문서", hasTools: true },
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
  companySkills?: { name: string; category: string; description: string }[]; // 보유 스킬 목록(Level 0)
  companyProjects?: { name: string; status: string; goal?: string; stages: { title: string; status: string }[] }[]; // 현재 프로젝트 목록
  pendingJobs?: { id: string; type: string; agentId: string; agentName: string; desc: string }[]; // 검수 대기 잡(취소 가능)
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
    ? `\n\n## 🧠 회사 지식·규칙 (당신의 축적된 배경 지식 — ${companyKnow.length}개)\n아래는 회사에 쌓여 온 규칙·사실·결정입니다. **항상 적극 활용해** 더 똑똑하고 맥락에 맞게 판단·답변하세요 — 이 지식을 잘 쓰는 것이 당신이 점점 더 유능해지는 방식입니다.\n` +
      `⚠️ 그중 호칭·말투·금지사항 같은 '행동 규칙'(특히 [원칙] 분류)은 배경 참고가 아니라 **매 답변에서 예외 없이 반드시 지켜야 하는 지침**입니다. 예: 사용자에게 존댓말로 답하라는 규칙이 있으면 항상 존댓말을 쓰고, 정해진 호칭을 씁니다. 사실·결정 같은 정보성 지식만 자연스럽게 녹여 쓰고, 직접 묻지 않으면 목록을 그대로 나열하지 마세요.\n${companyKnow.map((k) => `- ${k}`).join("\n")}`
    : "";
  const skillsList = opts.companySkills || [];
  const skillsBlock = skillsList.length
    ? `\n\n## 🛠️ 보유 스킬 (재사용 절차 — 비슷한 일에 적극 활용해 더 빠르고 정확하게)\n${skillsList.map((s) => `- ${s.category ? `[${s.category}] ` : ""}${s.name}: ${s.description}`).join("\n")}\n비슷한 작업이면 이 스킬의 절차를 따르세요. 절차가 부족하면 [[SKILL: patch ...]]로 개선하세요.`
    : "";
  const pendingJobsList = opts.pendingJobs || [];
  const pendingBlock = pendingJobsList.length
    ? `\n\n## 🗂️ 검수 대기 중인 작업 (취소 가능)\n` +
      pendingJobsList.map((j) => `- ID: \`${j.id}\` | 유형: ${j.type} | 담당: ${j.agentName} | 내용: ${j.desc}`).join("\n") +
      `\n사용자가 "취소/철회/없애줘"를 요청하면 즉시: [[CANCEL: ${pendingJobsList[0].id}]]\n` +
      `유형으로도 가능: [[CANCEL: ${pendingJobsList[0].type}]]`
    : "";

  const projectsList = opts.companyProjects || [];
  const projectsBlock = `\n\n## 📁 현재 프로젝트 현황 (${projectsList.length}개)\n` + (projectsList.length
    ? projectsList.map((p) => {
        const done = p.stages.filter((s) => s.status === "done").length;
        const total = p.stages.length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const stageList = total > 0 ? ` | 단계: ${p.stages.map((s) => `${s.title}(${s.status === "done" ? "완료" : s.status === "doing" ? "진행" : "대기"})`).join(" → ")}` : "";
        return `- **${p.name}** [${p.status === "active" ? "진행 중" : p.status === "done" ? "완료" : p.status}] ${total > 0 ? `${done}/${total}단계 (${pct}%)` : ""}${p.goal ? ` | 목표: ${p.goal}` : ""}${stageList}`;
      }).join("\n")
    : "- 등록된 프로젝트 없음. 사용자가 프로젝트를 시작하면 [[PROJECT: create ...]]로 만드세요.");

  // 이 에이전트가 실행 가능한 도구 목록 (AGENT_TOOLS 기준)
  const MY_TOOL_DESCRIPTIONS: Record<string, string> = {
    image: `[[RUN: image | {"prompt": "이미지 설명 (구체적으로)", "aspectRatio": "16:9"}]]  → 이미지 생성 (Gemini/GPT-4o)`,
    sound: `[[RUN: sound | {"prompt": "효과음 설명", "duration": 8}]]  → 효과음 생성 (ElevenLabs)`,
    video: `[[RUN: video | {"prompt": "장면 설명", "imageUrl": "기존이미지URL(선택)", "aspectRatio": "16:9"}]]  → 영상 생성 (Kling/Veo · 수분 소요)`,
    scenario: `[[RUN: scenario | {"topic": "에피소드 주제", "duration": 60, "tones": ["감동"], "styles": ["브이로그"]}]]  → 시나리오 생성 (씬분해·대사·카메라 지시)`,
    music: `[[RUN: music | {"topic": "음악 컨셉·분위기", "genre": "ambient", "duration": 60}]]  → BGM 생성 (ElevenLabs)`,
    publish: `[[RUN: publish | {"platforms": ["instagram"], "caption": "게시글 내용", "mediaUrl": "이미지/영상URL"}]]  → SNS 발행 ⚠️ 항상 사람 승인 필요`,
    ppt: `[[RUN: ppt | {"prompt": "발표 주제·목적·대상 구체적으로", "context": "추가 맥락(선택)"}]]  → PPT 슬라이드 생성 (브라우저에서 .pptx 다운로드)`,
    pdf: `[[RUN: pdf | {"prompt": "문서 주제·목적·내용 구체적으로", "context": "추가 맥락(선택)"}]]  → PDF 문서 생성 (브라우저 프린트로 저장)`,
    gmail_read: `[[RUN: gmail_read | {"max": 10}]]  → 받은 Gmail 최근 N통 제목·발신자·미리보기 (읽기 전용 · 구글 연결 필요)`,
    gmail_trash: `[[RUN: gmail_trash | {"query": "from:no-reply@x.com 또는 subject:광고 등 Gmail 검색어", "max": 5}]]  → 검색어에 맞는 메일을 휴지통으로(30일 복구 가능). ⚠️ 반드시 먼저 gmail_read 등으로 어떤 메일인지 사용자에게 보여주고 명확히 동의받은 뒤에만 실행. 광범위한 검색어로 한꺼번에 지우지 말 것.`,
    calendar_list: `[[RUN: calendar_list | {"max": 10, "days": 30}]]  → 향후 N일(기본 30) 구글 캘린더 일정 조회. "이번 주"면 days:7, "오늘"이면 days:1 로 조정 (읽기 전용 · 구글 연결 필요)`,
    calendar_create: `[[RUN: calendar_create | {"summary": "일정 제목", "start": "2026-06-20T15:00:00+09:00", "end": "(선택)", "description": "(선택)", "location": "(선택)"}]]  → 구글 캘린더 일정 추가 (구글 연결 필요)`,
  };
  // 코어 위임 라우팅용: 직원별 실행 도구 맵 — '이 작업은 누구 담당'인지 코어가 알게 해 자동 위임.
  const TOOL_LABELS: Record<string, string> = {
    image: "이미지 생성", video: "영상 생성", sound: "효과음 생성", scenario: "시나리오 생성",
    music: "BGM 생성", publish: "SNS 발행", ppt: "PPT 생성", pdf: "PDF 문서 생성",
    gmail_read: "Gmail 메일 조회", gmail_trash: "Gmail 메일 휴지통 이동", calendar_list: "구글 캘린더 일정 조회", calendar_create: "구글 캘린더 일정 추가",
  };
  const toolsByAgent: Record<string, string[]> = {};
  for (const [tname, td] of Object.entries(AGENT_TOOLS)) {
    (toolsByAgent[td.agentId] ??= []).push(TOOL_LABELS[tname] || tname);
  }
  const teamToolMap = Object.entries(toolsByAgent)
    .map(([aid, tools]) => `- ${getAgent(aid)?.name || aid}(${aid}): ${tools.join(", ")}`)
    .join("\n");

  const myTools = Object.entries(AGENT_TOOLS).filter(([, t]) => t.agentId === agentId);
  const toolsRunBlock = myTools.length > 0
    ? `\n\n## 🎬 내 담당 도구 (실행 권한 있음)\n실제 결과물을 만들 때 답변 끝에 RUN 마커 추가 (사용자껜 안 보임):\n${myTools.map(([name]) => `- ${MY_TOOL_DESCRIPTIONS[name] || `[[RUN: ${name} | {"prompt": "설명"}]]`}`).join("\n")}\n⚠️ 사용자가 실제 결과물 생성을 요청했을 때만 사용. 마커 없이 "만들었어요"라고 말하는 건 거짓 보고입니다.`
    : "";

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
직원 id: ${AGENT_IDS}

## 🛠️ 직원별 실행 도구 (이 작업이 오면 반드시 그 직원에게 [[CALL]] 위임)
${teamToolMap}
⚠️ 당신(코어)은 외부 도구 실행 권한이 없습니다. 특히 "달력/캘린더/일정/메일/Gmail 확인·조회·추가"는 전부 싱크(sync) 담당이에요. 사용자가 이런 걸 요청하면 "제가 직접 못 한다"거나 "시켜드릴까요?"라고 되묻지 말고, 곧바로 [[CALL: sync | 구체적 지시]]로 싱크를 호출해 처리하세요.`
    : "";

  return `${hardState}

# 회사 공유 컨텍스트
${DEFAULT_COMPANY.identity}

${DEFAULT_COMPANY.goals}${companyKnowBlock}${skillsBlock}${projectsBlock}${pendingBlock}

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
- 회사 지식은 KNOW 마커, 프로젝트 변경은 PROJECT 마커, 스킬은 SKILL 마커, 나의 개인 지식은 SELF_KNOW 마커로만 실제로 DB에 반영된다. 마커 없이 "반영했다/완료했다/저장했다"라고 말하지 마라(거짓 보고 금지).
- 사실은 실제로 아는 것만 말한다. 모르면 추측·날조 대신 "확인이 필요해요"라고 솔직히 말한다.
- **말투 = 실행 의사와 일치시켜라.** "다음 액션"이나 다른 직원에게 시키는 일을 말할 때: 이번 턴에 실제로 [[CALL]]·마커로 실행하는 경우에만 "~할게요/~했어요"처럼 단정형으로 말한다. 실제로 실행하지 않고 제안·예고만 하는 경우엔 반드시 조건부·제안형으로 말한다. (✗ "싱크한테 보드 반영 확인 요청할게요" → ✓ "필요하면 싱크한테 보드 반영 확인을 요청할게요" / "원하시면 싱크에게 확인 요청할까요?") 실행 안 할 일을 한다고 단정하지 마라(거짓 예고 금지).

## 🧠 회사 지식·규칙 관리 (당신은 권한이 있음)
사용자가 "기억해 / 규칙으로 정해 / 회사 방침이야 / 이건 삭제해 / 고쳐줘" 등을 요청하면, 답변 맨 끝 줄에 마커를 추가하세요(사용자껜 안 보입니다):
- 등록: [[KNOW: add | 분류 | 내용]]  (분류 = 원칙 · 사실 · 결정 중 하나)
- 삭제: [[KNOW: del | 기존에 등록된 정확한 내용]]
- 수정: [[KNOW: edit | 기존내용 | 새내용]]
예) [[KNOW: add | 원칙 | 사용자의 호칭은 '엔케'(영문 NK)다]]
예) [[KNOW: edit | 회의는 월요일마다 | 회의는 화요일마다]]
이 마커를 쓰면 실제 회사 지식에 반영됩니다. "반영했어요"라고 답하려면 반드시 이 마커를 함께 쓰세요.

## 📁 프로젝트 관리 (코어·싱크 중심)
프로젝트 관련 요청 시 답변 맨 끝 줄에 마커를 추가하세요(사용자껜 안 보입니다):
- 생성: [[PROJECT: create | 프로젝트명 | 목표·기한 | 단계1, 단계2, 단계3]]
- 삭제: [[PROJECT: delete | 프로젝트명]]
- 단계 상태 변경: [[PROJECT: stage | 프로젝트명 | 단계명 | 상태]]  (상태: todo=예정, in_progress=진행 중, done=완료)
- 단계 추가: [[PROJECT: add_stage | 프로젝트명 | 새단계명]]
- 단계 삭제: [[PROJECT: remove_stage | 프로젝트명 | 단계명]]
- 프로젝트 상태 변경: [[PROJECT: status | 프로젝트명 | 상태]]  (상태: active=진행 중, done=완료, paused=보류)
- 필드 수정: [[PROJECT: edit | 프로젝트명 | 필드 | 새값]]  (필드: goal=목표, summary=요약, nextAction=다음액션)
예) [[PROJECT: stage | '우울의 숲' 소설 단독판매 | 기획 | in_progress]]
예) [[PROJECT: status | '우울의 숲' 소설 단독판매 | done]]
예) [[PROJECT: edit | '우울의 숲' 소설 단독판매 | goal | 10월 완성, 11~12월 출시]]
예) [[PROJECT: add_stage | '우울의 숲' 소설 단독판매 | 교정·퇴고]]
이 마커를 쓰면 실제로 프로젝트 보드에 반영됩니다. "변경했어요"라고 답하려면 반드시 이 마커를 함께 쓰세요.

## 🛠️ 스킬 만들기·개선 (절차적 기억 — 일하며 똑똑해지기)
복잡한 작업(여러 단계·도구)을 끝냈거나, 막힌 걸 해결했거나, 사용자가 방식을 교정했거나, 재사용할 워크플로를 알아냈으면 그 절차를 스킬로 저장하세요(다음에 같은 일을 더 빠르고 정확하게 하기 위함):
- 새 스킬: [[SKILL: create | 이름 | 분류 | 한 줄 설명 | When to Use / Procedure(단계) / Pitfalls / Verification]]
- 개선: [[SKILL: patch | 이름 | 기존 문구 | 새 문구]]
- 삭제: [[SKILL: delete | 이름]]
- 고정(자주 쓰는 스킬): [[SKILL: pin | 이름]]  /  고정 해제: [[SKILL: unpin | 이름]]
- 아카이브(잘 안 쓰는 스킬 정리): [[SKILL: archive | 이름]]  /  복원: [[SKILL: restore | 이름]]
보유 스킬에 비슷한 게 있으면 새로 만들지 말고 그걸 활용하거나 patch로 보강하세요.

## 🔬 나의 개인 지식 관리 (나만 아는 규칙·메모)
내 역할에만 해당하거나 나만 기억해야 할 규칙을 저장하세요(회사 전체 지식과는 별개):
- 등록: [[SELF_KNOW: add | 분류 | 내용]]  (분류 = 원칙 · 사실 · 결정 중 하나)
- 삭제: [[SELF_KNOW: del | 기존에 등록된 정확한 내용]]
예) 픽셀이 "이미지는 항상 16:9로"라는 지시를 받으면 → [[SELF_KNOW: add | 원칙 | 이미지 생성 시 기본 비율은 16:9]]
이 마커로 저장된 내용은 나만 볼 수 있는 개인 지식으로, 다음 대화에서 자동으로 주입됩니다.

## ❌ 작업 취소 (CANCEL 마커)
사용자가 검수 대기 중인 작업을 "취소/철회/없애줘/지워줘"라고 요청하면, 위 "검수 대기 중인 작업" 목록에서 해당 항목을 찾아 답변 끝에 마커를 추가하세요(사용자껜 안 보임):
- ID로 취소: [[CANCEL: {작업ID}]]  예) [[CANCEL: a1b2c3d4-e5f6-7890-abcd-ef1234567890]]
- 유형으로 취소: [[CANCEL: ppt]] 또는 [[CANCEL: pdf]]
이 마커를 쓰면 실제로 해당 작업이 취소됩니다. 마커 없이 "취소했어요"라고 말하지 마세요(거짓 보고 금지).

## ⛔ 미루지 말 것
- 질문/지시에는 지금 바로 답하거나 즉시 행동으로 옮기세요. "나중에/잠시만/추후" 같은 미루는 답변 금지.${delegation}${toolsRunBlock}`;
}

// ── Claude 호출 (NK scenario.js 패턴 재사용) ────────────────────────────────
export interface ClaudeMsg { role: "user" | "assistant"; content: string; }

export async function callClaude(
  env: any,
  system: string,
  messages: ClaudeMsg[],
  opts: { model?: string; maxTokens?: number; sql?: SqlFn; userId?: string; imageBase64?: string; imageMimeType?: string; resolvedAuth?: any } = {}
): Promise<string> {
  // resolvedAuth가 이미 있으면 DB 재조회 없이 재사용 (runGroupChat 선취 캐시).
  const auth = opts.resolvedAuth || (opts.sql && opts.userId
    ? await resolvedAuthHeaders(opts.sql, opts.userId, env)
    : claudeAuthHeaders(env));
  // 이미지/파일 첨부 시 마지막 user 메시지를 멀티모달 content block으로 변환.
  const builtMessages = messages.map((m, idx) => {
    if (idx === messages.length - 1 && m.role === "user" && opts.imageBase64) {
      const mtype = opts.imageMimeType || "image/jpeg";
      const imageBlock = mtype === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: mtype, data: opts.imageBase64 } }
        : { type: "image", source: { type: "base64", media_type: mtype, data: opts.imageBase64 } };
      return { role: m.role, content: [imageBlock, { type: "text", text: m.content }] };
    }
    return m;
  });
  // 429 레이트리밋 자동 재시도: 최대 2회(총 3회), 2s → 4s 지수 백오프
  for (let attempt = 0; attempt <= 2; attempt++) {
    const res = await fetch(anthropicMessagesUrl(env), {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        model: opts.model || "claude-sonnet-4-6",
        max_tokens: opts.maxTokens || 1500,
        system: buildClaudeSystem(auth.subscription, system),
        messages: builtMessages,
      }),
    });
    const text = await res.text();
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
      continue;
    }
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
  throw new Error("Claude API 최대 재시도 초과");
}

export interface KnowOp { action: "add" | "del" | "edit"; type?: string; text: string; newText?: string; }
export interface ProjectOp { action: "create" | "delete" | "update_stage" | "update_status" | "update_field" | "add_stage" | "remove_stage"; name: string; goal?: string; stages: string[]; stageTitle?: string; stageStatus?: string; field?: string; value?: string; }
export interface SkillOp { action: "create" | "patch" | "delete" | "pin" | "unpin" | "archive" | "restore"; name: string; category?: string; description?: string; content?: string; oldStr?: string; newStr?: string; }
export interface CancelOp { jobId?: string; jobType?: string; hint?: string; }
export interface SpeakResult {
  text: string;
  calls: { agentId: string; instruction: string }[];
  runs: { tool: string; reason: string }[];
  knows: KnowOp[];
  projects: ProjectOp[];
  skills: SkillOp[];
  cancels: CancelOp[];
}

// 대괄호 1~2개 모두 허용 (작은/큰 모델이 형식을 흘리는 경우 대비). 라비오크 포팅.
const CALL_RE = /\[{1,2}\s*CALL\s*:\s*([^\|\]]+?)\s*\|\s*([\s\S]+?)\]{1,2}/gi;
const RUN_RE = /\[{1,2}\s*RUN\s*:\s*([^\|\]]+?)\s*\|\s*([\s\S]+?)\]{1,2}/gi;
// 회사 지식 관리 마커: [[KNOW: add | 분류 | 내용]] / [[KNOW: del | 내용]]
const KNOW_RE = /\[{1,2}\s*KNOW\s*:\s*([\s\S]+?)\]{1,2}/gi;
// 프로젝트 생성 마커: [[PROJECT: create | 이름 | 목표 | 단계1, 단계2, ...]]
const PROJECT_RE = /\[{1,2}\s*PROJECT\s*:\s*([\s\S]+?)\]{1,2}/gi;
// 스킬(절차적 기억) 마커: [[SKILL: create | 이름 | 분류 | 한줄설명 | 상세절차]] / [[SKILL: patch | 이름 | 기존 | 새내용]] / [[SKILL: delete | 이름]]
const SKILL_RE = /\[{1,2}\s*SKILL\s*:\s*([\s\S]+?)\]{1,2}/gi;
// 직원 개인 지식 마커: [[SELF_KNOW: add | 분류 | 내용]] / [[SELF_KNOW: del | 내용]]
const SELF_KNOW_RE = /\[{1,2}\s*SELF_KNOW\s*:\s*([\s\S]+?)\]{1,2}/gi;
// 작업 취소 마커: [[CANCEL: 작업ID]] 또는 [[CANCEL: 작업유형(ppt/pdf/...)]]
const CANCEL_RE = /\[{1,2}\s*CANCEL\s*:\s*([\s\S]+?)\]{1,2}/gi;

// 분류 정규화 — 회사 지식 칩(원칙/사실/결정)과 일치시킨다.
function normalizeKnowType(t: string): string {
  const s = String(t || "").trim();
  if (/규칙|원칙|rule|principle/i.test(s)) return "원칙";
  if (/결정|decision/i.test(s)) return "결정";
  return "사실";
}

/** 마커 추출 + 본문에서 숨김. (CALL 위임 · RUN 도구 · KNOW 회사지식 관리 · CANCEL 작업취소) */
function extractMarkers(raw: string): SpeakResult {
  const calls: { agentId: string; instruction: string }[] = [];
  const runs: { tool: string; reason: string }[] = [];
  const knows: KnowOp[] = [];
  const projects: ProjectOp[] = [];
  const skills: SkillOp[] = [];
  const cancels: CancelOp[] = [];
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
    } else if (/^(edit|update|수정|변경)$/.test(action) && parts[1] && parts[2]) {
      knows.push({ action: "edit", text: parts[1], newText: parts.slice(2).join(" | ") });
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
    } else if (/^(delete|del|remove|삭제|제거)$/.test(action) && parts[1]) {
      projects.push({ action: "delete", name: parts[1], stages: [] });
    } else if (/^(stage|단계|update_stage)$/.test(action) && parts[1] && parts[2] && parts[3]) {
      const rawStatus = parts[3].trim();
      // canonical은 프런트 어휘(doing). 입력은 in_progress/진행 등도 허용하되 저장값은 doing으로 통일.
      const stageStatus = /^(done|완료)$/i.test(rawStatus) ? "done"
        : /^(doing|in_progress|진행|진행중|진행 중)$/i.test(rawStatus) ? "doing"
        : "todo";
      projects.push({ action: "update_stage", name: parts[1], stages: [], stageTitle: parts[2], stageStatus });
    } else if (/^(status|상태)$/.test(action) && parts[1] && parts[2]) {
      const raw = parts[2].trim();
      const status = /^(done|완료)$/i.test(raw) ? "done"
        : /^(paused|보류|중단)$/i.test(raw) ? "paused"
        : "active";
      projects.push({ action: "update_status", name: parts[1], stages: [], value: status });
    } else if (/^(edit|update|수정|변경)$/.test(action) && parts[1] && parts[2] && parts[3] !== undefined) {
      const fieldMap: Record<string, string> = { goal: "goal", 목표: "goal", summary: "summary", 요약: "summary", nextaction: "nextAction", 다음액션: "nextAction" };
      const field = fieldMap[parts[2].toLowerCase().replace(/\s/g, "")] || parts[2];
      projects.push({ action: "update_field", name: parts[1], stages: [], field, value: parts.slice(3).join(" | ") });
    } else if (/^(add_stage|단계추가)$/.test(action) && parts[1] && parts[2]) {
      projects.push({ action: "add_stage", name: parts[1], stages: [], stageTitle: parts[2] });
    } else if (/^(remove_stage|단계삭제)$/.test(action) && parts[1] && parts[2]) {
      projects.push({ action: "remove_stage", name: parts[1], stages: [], stageTitle: parts[2] });
    }
  }
  SKILL_RE.lastIndex = 0;
  while ((m = SKILL_RE.exec(raw))) {
    const parts = String(m[1]).split("|").map((s) => s.trim());
    const action = (parts[0] || "").toLowerCase();
    const name = (parts[1] || "").trim();
    if (!name) continue;
    if (/^(create|new|만들|생성)$/.test(action)) {
      skills.push({ action: "create", name, category: parts[2] || "", description: parts[3] || "", content: parts.slice(4).join(" | ").trim() });
    } else if (/^(patch|edit|수정|개선)$/.test(action) && parts.length >= 4) {
      skills.push({ action: "patch", name, oldStr: parts[2], newStr: parts.slice(3).join(" | ") });
    } else if (/^(delete|remove|삭제|제거)$/.test(action)) {
      skills.push({ action: "delete", name });
    } else if (/^(pin|고정)$/.test(action)) {
      skills.push({ action: "pin", name });
    } else if (/^(unpin|고정해제)$/.test(action)) {
      skills.push({ action: "unpin", name });
    } else if (/^(archive|아카이브|보관)$/.test(action)) {
      skills.push({ action: "archive", name });
    } else if (/^(restore|복원|복구)$/.test(action)) {
      skills.push({ action: "restore", name });
    }
  }
  CANCEL_RE.lastIndex = 0;
  while ((m = CANCEL_RE.exec(raw))) {
    const parts = String(m[1]).split("|").map((s) => s.trim());
    const first = parts[0] || "";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(first)) {
      cancels.push({ jobId: first, hint: parts[1] });
    } else if (first) {
      cancels.push({ jobType: first.toLowerCase(), hint: parts[1] });
    }
  }
  const text = raw.replace(CALL_RE, "").replace(RUN_RE, "").replace(KNOW_RE, "").replace(PROJECT_RE, "").replace(SKILL_RE, "").replace(SELF_KNOW_RE, "").replace(CANCEL_RE, "").trim();
  return { text, calls, runs, knows, projects, skills, cancels };
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
  opts: BuildSystemOpts & { sql?: SqlFn; userId?: string; imageBase64?: string; imageMimeType?: string; model?: string; maxTokens?: number; resolvedAuth?: any } = {}
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
  // 보유 스킬(절차적 기억) 목록 주입 — 비슷한 일에 재사용(progressive disclosure Level 0).
  let companySkills = opts.companySkills;
  if (companySkills === undefined && opts.sql && opts.userId) {
    companySkills = await listSkills(opts.sql, opts.userId).catch(() => []);
  }
  // 현재 프로젝트 목록 주입 — 에이전트가 진행 현황을 실제로 파악하고 답할 수 있게.
  let companyProjects = opts.companyProjects;
  if (companyProjects === undefined && opts.sql && opts.userId) {
    companyProjects = await listProjects(opts.sql, opts.userId).catch(() => []);
  }
  const system = buildAgentSystem(agentId, { ...opts, personaOverride, agentKnowledge, companyKnowledge, companySkills, companyProjects });
  const userContent = `# 지금까지의 단톡방 대화\n${transcript}\n\n# 당신 차례\n${instruction}`;
  const raw = await callClaude(env, system, [{ role: "user", content: userContent }], { sql: opts.sql, userId: opts.userId, model: opts.model || modelFor(agentId), maxTokens: opts.maxTokens, imageBase64: opts.imageBase64, imageMimeType: opts.imageMimeType, resolvedAuth: opts.resolvedAuth });
  // SELF_KNOW: agentId 컨텍스트가 있는 speak() 안에서만 처리 (extractMarkers에는 agentId 없음)
  if (opts.sql && opts.userId) {
    SELF_KNOW_RE.lastIndex = 0;
    let sm: RegExpExecArray | null;
    while ((sm = SELF_KNOW_RE.exec(raw))) {
      const parts = String(sm[1]).split("|").map((s) => s.trim()).filter((s) => s.length > 0);
      const act = (parts[0] || "").toLowerCase();
      try {
        if (/^(add|remember|등록|추가)$/.test(act)) {
          const type = parts.length >= 3 ? normalizeKnowType(parts[1]) : "사실";
          const text = parts.length >= 3 ? parts.slice(2).join(" | ") : parts.slice(1).join(" | ");
          if (text) await addAgentKnowledgeRow(opts.sql, opts.userId, agentId, text, type);
        } else if (/^(del|delete|remove|삭제|제거)$/.test(act)) {
          const text = parts.slice(1).join(" | ");
          if (text) await removeAgentKnowledgeRow(opts.sql, opts.userId, agentId, text);
        }
      } catch { /* 개인 지식 반영 실패는 대화 흐름에 영향 없음 */ }
    }
  }
  const result = extractMarkers(raw);

  // ── 한 번에 실행 보정 ─────────────────────────────────────────────────────────
  // 문제: 모델이 "바꿀게요/반영할게요"처럼 변경을 말로만 하고 마커를 빠뜨리면 그 턴이 헛돈다
  //       (사용자가 "바꿨어?"라고 다시 물어야 그제서야 마커를 출력 → 한 번에 안 됨).
  // 해결: 변경을 분명히 말했는데(아래 정규식) DB 반영 마커가 하나도 없으면, 같은 턴에 마커만
  //       한 번 더 강제로 받아 즉시 반영한다. (프롬프트 규칙만으론 불안정해 서버에서 보정)
  if (opts.sql && opts.userId) {
    const claimedChange = /(바꿨|바꿀게|바꾸겠|수정했|수정할게|수정하겠|변경했|변경할게|변경하겠|반영했|반영할게|반영하겠|등록했|등록할게|등록하겠|저장했|저장할게|저장하겠)/.test(result.text);
    const hasDbMarker = result.knows.length > 0 || result.projects.length > 0 || result.skills.length > 0;
    if (claimedChange && !hasDbMarker) {
      const fixRaw = await callClaude(
        env,
        system,
        [
          { role: "user", content: userContent },
          { role: "assistant", content: raw },
          { role: "user", content: "방금 답에서 변경/반영을 말했지만 실제 반영 마커가 빠졌어요. 지금 이 턴에 그 변경을 실행하는 마커(KNOW/PROJECT/SKILL/SELF_KNOW)만 출력하세요. 인사·설명 없이 마커 줄만. 정말 변경할 게 없으면 빈 줄로 답하세요." },
        ],
        { sql: opts.sql, userId: opts.userId, model: opts.model || modelFor(agentId), maxTokens: 400, resolvedAuth: opts.resolvedAuth }
      ).catch(() => "");
      if (fixRaw) {
        // SELF_KNOW(개인 지식)는 extractMarkers가 다루지 않으므로 보정분에서도 직접 처리.
        SELF_KNOW_RE.lastIndex = 0;
        let sm2: RegExpExecArray | null;
        while ((sm2 = SELF_KNOW_RE.exec(fixRaw))) {
          const parts = String(sm2[1]).split("|").map((s) => s.trim()).filter((s) => s.length > 0);
          const act = (parts[0] || "").toLowerCase();
          try {
            if (/^(add|remember|등록|추가)$/.test(act)) {
              const type = parts.length >= 3 ? normalizeKnowType(parts[1]) : "사실";
              const text = parts.length >= 3 ? parts.slice(2).join(" | ") : parts.slice(1).join(" | ");
              if (text) await addAgentKnowledgeRow(opts.sql, opts.userId, agentId, text, type);
            } else if (/^(del|delete|remove|삭제|제거)$/.test(act)) {
              const text = parts.slice(1).join(" | ");
              if (text) await removeAgentKnowledgeRow(opts.sql, opts.userId, agentId, text);
            }
          } catch { /* 개인 지식 반영 실패는 대화 흐름에 영향 없음 */ }
        }
        // 회사 지식·프로젝트·스킬 마커만 보강(위임 CALL·도구 RUN은 보정 대상 아님 — 변경 누락만 메움).
        const extra = extractMarkers(fixRaw);
        result.knows.push(...extra.knows);
        result.projects.push(...extra.projects);
        result.skills.push(...extra.skills);
      }
    }
  }
  return result;
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

/** 읽기 도구(gmail_read·calendar_list) 결과를 채팅용 한국어 요약 텍스트로. */
export function formatReadResult(toolName: string, out: any): string {
  if (toolName === "gmail_read") {
    const emails: any[] = out?.emails || [];
    if (!emails.length) return "📭 받은메일함에 표시할 메일이 없어요.";
    const lines = emails.map((e, i) => {
      const snip = e.snippet ? `\n   ${String(e.snippet).slice(0, 120)}` : "";
      return `${i + 1}. **${e.subject || "(제목 없음)"}**\n   - 보낸이: ${e.from || "?"}${e.date ? ` · ${e.date}` : ""}${snip}`;
    });
    return `📥 받은메일 최근 ${emails.length}통이에요.\n\n${lines.join("\n\n")}`;
  }
  if (toolName === "gmail_trash") {
    const items: any[] = out?.items || [];
    const q = out?.query || "";
    if (!items.length) return `🗑️ "${q}" 에 해당하는 메일을 찾지 못했어요. 옮긴 메일이 없어요.`;
    const lines = items.map((e, i) => `${i + 1}. ${e.subject || "(제목 없음)"} — ${e.from || ""}`);
    return `🗑️ 메일 ${items.length}통을 휴지통으로 보냈어요. (Gmail 휴지통에서 30일 내 복구 가능)\n\n${lines.join("\n")}`;
  }
  if (toolName === "calendar_list") {
    const events: any[] = out?.events || [];
    const days = out?.days || 30;
    if (!events.length) return `📅 앞으로 ${days}일 안에 등록된 일정이 없어요.`;
    const lines = events.map((ev, i) => {
      const where = ev.location ? ` · 📍${ev.location}` : "";
      return `${i + 1}. **${ev.summary || "(제목 없음)"}**\n   - ${ev.start || "?"}${where}`;
    });
    return `📅 앞으로 ${days}일 일정 ${events.length}개예요.\n\n${lines.join("\n")}`;
  }
  return "조회를 완료했어요.";
}

// 코어가 "종합/취합"을 예고했는지 — 통솔 마무리 턴 발동 신호.
const SYNTH_CUE = /종합|취합|정리해서|합쳐서|모아서|모아|취합해|종합해|결론을/;

// ── 마커 적용 — worker-step.ts에서도 재사용하므로 모듈 레벨로 추출 ─────────────────
export async function applyKnows(sql: SqlFn, userId: string, knows: KnowOp[] | undefined, who: string) {
  for (const k of knows || []) {
    try {
      if (k.action === "add") await addCompanyKnowledge(sql, userId, k.text, k.type || "사실", `${who} 등록`);
      else if (k.action === "del") await deleteCompanyKnowledge(sql, userId, k.text);
      else if (k.action === "edit" && k.newText) await updateCompanyKnowledge(sql, userId, k.text, k.newText);
    } catch {}
  }
}

export async function applySkills(sql: SqlFn, userId: string, skills: SkillOp[] | undefined) {
  for (const s of skills || []) {
    try {
      if (s.action === "create") await createSkill(sql, userId, { name: s.name, category: s.category, description: s.description, content: s.content });
      else if (s.action === "patch") await patchSkill(sql, userId, s.name, s.oldStr || "", s.newStr || "");
      else if (s.action === "delete") await deleteSkill(sql, userId, s.name);
      else if (s.action === "pin") await setPinSkill(sql, userId, s.name, true);
      else if (s.action === "unpin") await setPinSkill(sql, userId, s.name, false);
      else if (s.action === "archive") await archiveSkillByName(sql, userId, s.name);
      else if (s.action === "restore") await restoreSkill(sql, userId, s.name);
    } catch {}
  }
}

export async function applyProjects(sql: SqlFn, userId: string, projects: ProjectOp[] | undefined) {
  if (!projects || projects.length === 0) return;
  const existing = await listProjects(sql, userId).catch(() => []);
  const existingNames = new Set(existing.map((e) => e.name));
  for (const p of projects) {
    try {
      if (p.action === "delete") {
        await deleteProjectByName(sql, userId, p.name);
        existingNames.delete(p.name);
      } else if (p.action === "update_stage") {
        if (p.stageTitle && p.stageStatus !== undefined) await updateProjectStageByName(sql, userId, p.name, p.stageTitle, p.stageStatus);
      } else if (p.action === "update_status") {
        if (p.value) await updateProjectStatus(sql, userId, p.name, p.value);
      } else if (p.action === "update_field") {
        if (p.field && p.value !== undefined) await updateProjectField(sql, userId, p.name, p.field, p.value);
      } else if (p.action === "add_stage") {
        if (p.stageTitle) await addProjectStage(sql, userId, p.name, p.stageTitle);
      } else if (p.action === "remove_stage") {
        if (p.stageTitle) await removeProjectStage(sql, userId, p.name, p.stageTitle);
      } else {
        if (existingNames.has(p.name)) continue;
        const id = globalThis.crypto?.randomUUID?.() || `proj_${Math.random().toString(36).slice(2, 10)}`;
        const stages = (p.stages || []).map((title) => ({ title, status: "todo" }));
        await upsertProject(sql, userId, id, { name: p.name, goal: p.goal || "", summary: "", status: "active", stages, nextAction: "" });
        existingNames.add(p.name);
      }
    } catch {}
  }
}

/**
 * 직원 1명을 실행하고 발언·마커를 DB에 반영. worker-step.ts에서 각 CF invocation마다 호출.
 */
export async function runWorkerStep(
  env: any,
  opts: { sql: SqlFn; userId: string; conversationId: string; message: string; address: string; agentId: string; instruction: string }
): Promise<void> {
  const { sql, userId, conversationId, message, address: addr, agentId, instruction } = opts;
  const meta = getAgent(agentId);
  if (!meta || agentId === "core") return;
  const t = buildTranscript(await listMessages(sql, userId, conversationId), addr);
  const trigger =
    `${addr} 원문: "${message}"\n당신(${meta.name})이 직접 처리할 일: ${instruction}\n\n` +
    `⚠️ 당신이 직접 결과물을 만들어 보여주세요. "~에게 시켰다" 같은 3인칭 전달 보고 금지. 길면 핵심부터.`;
  const res = await speak(env, agentId, trigger, t, { address: addr, canDelegate: false, sql, userId });
  await addMessage(sql, { userId, conversationId, role: "agent", agentId, name: meta.name, text: res.text });
  await applyKnows(sql, userId, res.knows, meta.name);
  await applyProjects(sql, userId, res.projects);
  await applySkills(sql, userId, res.skills);
}

// ── 오케스트레이션 (라비오크 runGroupChat 포팅, Phase 1b) ─────────────────────
export interface OrchestratorDeps {
  sql: SqlFn;
  userId: string;
  conversationId: string;
  toolCtx: ToolContext; // 도구(RUN) 실행용 컨텍스트
  firstMessage?: string; // 방금 저장한 사용자 메시지(조회 타이밍 의존 제거)
  focusAgent?: string;   // 1:1 단독 대화 모드 — 이 직원만 응답, 위임·통솔·다른 직원 개입 전면 차단
  imageBase64?: string;  // 첨부 이미지 base64 (첫 번째 에이전트에게만 전달)
  imageMimeType?: string;
  onMessage?: (msg: any) => Promise<void>; // SSE 콜백: 발언 저장 즉시 클라이언트에 전송
  onJobReady?: () => void; // SSE 콜백: 도구 잡 완료 시 Results 패널 즉시 갱신
}

/**
 * 단톡방 한 턴 처리: 1차 응답 → 위임(CALL) → 직원 작업·보고(+RUN 도구) → 코어 통솔 마무리.
 * waitUntil 백그라운드에서 멀티 Claude 호출(30초 응답 제약 회피). 각 발언은 agent_messages 로 영속.
 */
export async function runGroupChat(
  env: any,
  deps: OrchestratorDeps,
  opts: { autoTrigger?: string } = {}
): Promise<any[]> {
  const { sql, userId, conversationId, toolCtx } = deps;
  const addr = "사용자";

  // DB 선취 캐시 — company knowledge·skills·projects·auth·pendingJobs를 한 번만 읽고 전 직원이 공유.
  // 직원당 4회 DB 왕복(×10명 = 40회) → 4회로 단축 → CF 30초 안에 10명 전원 완주.
  const [cachedCompanyKnowledge, cachedSkills, cachedProjects, cachedPendingJobsRaw] = await Promise.all([
    listCompanyKnowledge(sql, userId).catch(() => []).then((ck: any[]) => ck.map((k) => `[${k.type || "사실"}] ${k.text}`)),
    listSkills(sql, userId).catch(() => [] as any[]),
    listProjects(sql, userId).catch(() => [] as any[]),
    listPendingReviewJobs(sql, userId).catch(() => [] as any[]),
  ]);
  const cachedAuth = await resolvedAuthHeaders(sql, userId, env).catch(() => null);
  // 취소 가능한 대기 잡 컨텍스트 — 에이전트 시스템 프롬프트에 주입해 취소 마커를 쓸 수 있게 함
  const pendingJobsCtx = cachedPendingJobsRaw.map((j: any) => ({
    id: j.id as string,
    type: j.type as string,
    agentId: j.agent_id as string,
    agentName: getAgent(j.agent_id)?.name || j.agent_id,
    desc: String(j.input?.prompt || j.input?.topic || j.type).slice(0, 100),
  }));
  const sharedOpts = {
    companyKnowledge: cachedCompanyKnowledge as string[],
    companySkills: cachedSkills as any[],
    companyProjects: cachedProjects as any[],
    pendingJobs: pendingJobsCtx,
    resolvedAuth: cachedAuth || undefined,
  };

  // 생성된 에이전트 발언을 모은다 — 동기 호출 시 chat 응답에 직접 실어 보내 조회 의존을 없앤다.
  const produced: any[] = [];
  const emit = async (msg: any) => {
    const r = await addMessage(sql, msg);
    produced.push(r);
    if (deps.onMessage) { try { await deps.onMessage(r); } catch {} }
    return r;
  };

  // 자율 근무: 사용자 메시지 대신 자율 트리거로 코어를 깨운다(자발적 프로젝트 진행).
  let message: string;
  if (opts.autoTrigger) {
    message = opts.autoTrigger;
  } else {
    const msgs = await listMessages(sql, userId, conversationId);
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    // 조회에서 못 찾으면(쓰기 직후 타이밍) chat이 넘겨준 방금 메시지로 폴백
    message = lastUser?.text || deps.firstMessage || "";
  }
  if (!message) return produced;

  // 1:1 단독 대화 모드: focusAgent 만 응답. 멘션·위임·통솔 전부 무시(다른 직원 개입 차단).
  const soloAgent = deps.focusAgent && getAgent(deps.focusAgent) ? deps.focusAgent : "";
  let primary: string[];
  if (soloAgent) {
    primary = [soloAgent];
  } else {
    const mentions = parseMentions(message);
    const explicitCore = mentions.includes("core");
    const others = mentions.filter((id) => id !== "core");
    primary = others.length > 0 && !explicitCore ? others : ["core"];
  }

  let coreDelegateCount = 0;
  let synthCue = false;

  // 직원이 찍은 RUN 마커 → 본인 도구만 실행.
  //  - 읽기 도구(kind=read, 예: gmail_read·calendar_list): 검수 게이트 없이 결과를 채팅에 바로 출력.
  //  - 생성/외부 도구(image·video·calendar_create 등): 잡+검수 패널 흐름 유지.
  const runTools = async (runs: { tool: string; reason: string }[], agentId: string) => {
    for (const r of runs) {
      const tool = AGENT_TOOLS[r.tool];
      if (!tool || tool.agentId !== agentId) continue; // 본인 도구만
      const parsedInput = parseToolInput(r.reason); // JSON or { prompt: reason }
      const meta = getAgent(agentId)!;

      // 읽기 전용 조회: 검수 없이 즉시 실행 → 결과를 채팅 메시지로 요약 출력.
      if (tool.kind === "read") {
        await emit({
          userId, conversationId, role: "agent", agentId, name: meta.name,
          text: `🔎 ${r.tool} 조회 중이에요…`,
        });
        try {
          const output = await tool.run(parsedInput, toolCtx);
          await emit({
            userId, conversationId, role: "agent", agentId, name: meta.name,
            text: formatReadResult(r.tool, output),
          });
        } catch (e: any) {
          await emit({
            userId, conversationId, role: "agent", agentId, name: meta.name,
            text: `❌ 조회에 실패했어요: ${String(e?.message || e)}`,
          });
        }
        continue;
      }

      // PPT/PDF: 대화 컨텍스트 자동 주입 — 에이전트가 context를 생략한 경우 최근 대화로 보완
      if ((r.tool === "ppt" || r.tool === "pdf") && !parsedInput.context) {
        const msgs = await listMessages(sql, userId, conversationId);
        const ctxLines = msgs.slice(-20)
          .map((m) => `[${m.name ?? (m.role === "user" ? "사용자" : m.role)}]: ${m.text.slice(0, 600)}`)
          .join("\n");
        if (ctxLines) parsedInput.context = ctxLines;
      }
      const job = await createJob(sql, { userId, type: r.tool, agentId, input: parsedInput });
      await emit({
        userId, conversationId, role: "agent", agentId, name: meta.name,
        text: `🛠️ ${r.tool} 작업을 시작했어요. 잠시 기다려주세요…`,
      });
      const result = await processJob(toolCtx, sql, job.id, r.tool, parsedInput);
      if (result.ok) {
        const doneText =
          r.tool === "ppt" ? "✅ PPT 완성! 오른쪽 **검수 패널**에서 .pptx 다운로드 버튼을 눌러주세요."
          : r.tool === "pdf" ? "✅ PDF 완성! 오른쪽 **검수 패널**에서 PDF 프린트 버튼을 눌러주세요."
          : r.tool === "calendar_create" ? "✅ 일정을 만들었어요. 오른쪽 **검수 패널**에서 승인하면 캘린더에 반영돼요."
          : `✅ ${r.tool} 작업 완료. 검수 패널에서 확인하세요.`;
        await emit({ userId, conversationId, role: "agent", agentId, name: meta.name, text: doneText });
        try { deps.onJobReady?.(); } catch {}
      } else {
        await emit({
          userId, conversationId, role: "agent", agentId, name: meta.name,
          text: `❌ ${r.tool} 생성 중 오류가 발생했어요. 다시 요청해 주세요.`,
        });
      }
    }
  };

  // 마커 적용 — 모듈 레벨 함수에 sql/userId를 미리 바인딩한 단축 alias
  const _applyKnows    = (knows: KnowOp[]    | undefined, who: string) => applyKnows   (sql, userId, knows,    who);
  const _applySkills   = (skills: SkillOp[]  | undefined)              => applySkills  (sql, userId, skills       );
  const _applyProjects = (projects: ProjectOp[]| undefined)            => applyProjects(sql, userId, projects    );

  // CANCEL 마커 적용 — 에이전트가 [[CANCEL: id|type]]를 쓰면 해당 잡을 DB에서 바로 취소
  const _applyCancel = async (cancels: CancelOp[] | undefined) => {
    if (!cancels || cancels.length === 0) return;
    let anyDone = false;
    for (const c of cancels) {
      const job = c.jobId
        ? pendingJobsCtx.find((j) => j.id === c.jobId)
        : pendingJobsCtx.find((j) => j.type === c.jobType);
      if (!job) continue;
      try {
        await setJobStatus(sql, job.id, userId, { status: "cancelled" });
        // 로컬 목록에서 제거 — 같은 턴에 중복 취소 방지
        const idx = pendingJobsCtx.findIndex((j) => j.id === job.id);
        if (idx >= 0) pendingJobsCtx.splice(idx, 1);
        anyDone = true;
      } catch {}
    }
    // 취소 후 Results 패널 즉시 갱신 트리거
    if (anyDone) { try { deps.onJobReady?.(); } catch {} }
  };

  // 위임받은 직원이 실제로 일하고 단톡방에 보고.
  const runWorker = async (workerId: string, instruction: string, workerModel?: string, workerMaxTokens?: number) => {
    if (workerId === "core" || !getAgent(workerId)) return;
    const meta = getAgent(workerId)!;
    const t = buildTranscript(await listMessages(sql, userId, conversationId), addr);
    const trigger =
      `${addr} 원문: "${message}"\n당신(${meta.name})이 직접 처리할 일: ${instruction}\n\n` +
      `⚠️ 당신이 직접 결과물을 만들어 보여주세요. "~에게 시켰다" 같은 3인칭 전달 보고 금지. 길면 핵심부터.`;
    const res = await speak(env, workerId, trigger, t, { address: addr, canDelegate: false, sql, userId, model: workerModel, maxTokens: workerMaxTokens, ...sharedOpts });
    await emit({ userId, conversationId, role: "agent", agentId: workerId, name: meta.name, text: res.text });
    await runTools(res.runs, workerId);
    await _applyKnows(res.knows, meta.name);
    await _applyProjects(res.projects);
    await _applySkills(res.skills);
    await _applyCancel(res.cancels);
  };

  // 1) 1차 응답자
  for (const agentId of primary) {
    const canDelegate = !soloAgent && agentId === "core"; // 단독 모드면 위임 금지
    const meta = getAgent(agentId);
    if (!meta) continue;
    const instruction = canDelegate
      ? (opts.autoTrigger
          ? opts.autoTrigger
          : "사용자의 마지막 메시지에 코어(팀장)로서 답하세요. 실제 작업이 필요하면 담당 직원을 [[CALL: id | 지시]]로 호출하세요.\n" +
            "★ 특히 사용자가 '전원/다같이/모두/같이' 또는 게임·회의·브레인스토밍·끝말잇기처럼 여러 명이 함께하는 걸 시키면, 참여가 필요한 직원을 각각 [[CALL: id | 그 직원이 지금 할 구체적 행동(규칙·맥락 포함)]]로 불러 직접 참여시키세요. '전원 참여'·끝말잇기·라운드게임처럼 11명 모두가 한 명씩 차례로 해야 하는 경우엔 10명 전원(코어 제외: edge, radar, maki, plot, ink, pixel, beat, engi, reach, sync)을 모두 호출하세요. 끝말잇기라면 각 직원에게 '앞 사람 단어의 끝 글자로 시작하는 단어를 말하라'는 규칙을 함께 전달하세요. 당신 혼자 답하고 끝내지 말고 동료들을 실제로 끌어들이세요.\n" +
            "단순 인사·잡담·1:1 질문이면 호출하지 마세요.")
      : `사용자가 당신(${meta.name})을 불렀어요. 직접 처리해 결과물을 보여주세요.`;
    const t = buildTranscript(await listMessages(sql, userId, conversationId), addr);
    // 이미지는 1차 응답자에게만 전달 (transcript에 포함 안 되므로 worker/wrap에는 미전달)
    // 코어 위임 계획은 Sonnet으로 충분 — Opus는 25s+ 걸릴 수 있어 waitUntil 30초를 초과함
    const res = await speak(env, agentId, instruction, t, { address: addr, canDelegate, sql, userId, imageBase64: deps.imageBase64, imageMimeType: deps.imageMimeType, model: canDelegate ? "claude-sonnet-4-6" : undefined, ...sharedOpts });
    await _applyKnows(res.knows, meta.name);
    await _applyProjects(res.projects);
    await _applySkills(res.skills);
    await _applyCancel(res.cancels);
    // 자율 근무 중 코어가 호출할 직원이 없으면(할 일 없음) 조용히 대기 — 단톡방 노이즈 방지
    if (opts.autoTrigger && canDelegate && res.calls.length === 0) return produced;
    await emit({ userId, conversationId, role: "agent", agentId, name: meta.name, text: res.text });
    await runTools(res.runs, agentId);

    if (canDelegate) {
      const calls = res.calls.slice(0, 10); // 전원 참여 활동(끝말잇기·게임·회의 등) — 최대 10명(전 직원)
      coreDelegateCount += calls.length;
      if (SYNTH_CUE.test(res.text)) synthCue = true;
      // 대규모 그룹(5명+): Haiku(~0.5s/명)로 전환 → Core(10s) + 10명×0.5s = 15s → CF 30s 안에 전원 완주
      const groupIsLarge = calls.length >= 5;
      const groupModel = groupIsLarge ? "claude-haiku-4-5-20251001" : undefined;
      const groupMaxTokens = groupIsLarge ? 400 : undefined;
      for (let ci = 0; ci < calls.length; ci++) {
        if (ci > 0) await new Promise((r) => setTimeout(r, 50)); // 연속 API 호출 간격(캐시 덕에 단축)
        try {
          await runWorker(calls[ci].agentId, calls[ci].instruction, groupModel, groupMaxTokens);
        } catch {
          /* 개별 직원 응답 실패 시 조용히 다음으로 이어감 — 루프 유지 */
        }
      }
    }
  }

  // 2) 코어 통솔 마무리 — 다수 위임(≥2)이거나 종합 예고 시 코어가 종합·결론.
  //    단, 대규모 그룹 활동(5명 이상 위임)은 게임·끝말잇기 등 흐름 활동이므로 wrap 불필요.
  //    wrap·회고 Claude 호출을 아끼면 CF 백그라운드 시간을 남은 직원에게 더 줄 수 있다.
  const isLargeGroup = coreDelegateCount >= 5;
  if (!soloAgent && !isLargeGroup && primary.includes("core") && (coreDelegateCount >= 2 || (coreDelegateCount >= 1 && synthCue))) {
    const t = buildTranscript(await listMessages(sql, userId, conversationId), addr);
    const wrapTrigger =
      `${addr} 요청: "${message}"\n\n방금 직원들이 각자 보고했어요. 팀장(코어)으로서 종합해 결론을 내고, ` +
      `다음 액션 1줄을 제시하세요. "~할게요"로 끝내지 말고 실제 결론을 내세요.`;
    const wrap = await speak(env, "core", wrapTrigger, t, { address: addr, canDelegate: false, sql, userId, ...sharedOpts });
    await emit({ userId, conversationId, role: "agent", agentId: "core", name: "코어", text: wrap.text });
    await _applyKnows(wrap.knows, "코어");
    await _applyProjects(wrap.projects);
    await _applySkills(wrap.skills);
    await _applyCancel(wrap.cancels);
  }

  // 3) 자동 회고 (헤르메스 자기개선: 복잡 작업 뒤 새 교훈을 스스로 지식으로 축적 = persist durable knowledge).
  //    위임이 한 번이라도 일어난 '복잡 작업'에서만 1회 회고한다. 회고 발언은 단톡방에 노출하지 않고(조용히)
  //    KNOW 마커로 회사 지식만 늘린다. 중복은 add 단계에서 자동 차단됨.
  //    대규모 그룹 활동(끝말잇기·게임 등)은 배울 게 없으므로 회고도 생략한다.
  if (!opts.autoTrigger && !isLargeGroup && coreDelegateCount >= 1) {
    try {
      const t = buildTranscript(await listMessages(sql, userId, conversationId), addr);
      const reviewTrigger =
        "방금의 대화·작업을 회고하세요(이건 내부 회고 — 사용자에게 보이지 않습니다). " +
        "회사가 앞으로 계속 기억하고 활용하면 좋을 '새로' 배운 규칙·사실·결정이 있으면 [[KNOW: add | 분류 | 내용]]로 저장하세요(분류=원칙·사실·결정). " +
        "이미 등록된 회사 지식과 겹치면 저장하지 말고, 정말 새로 배운 핵심만 1~3개 이내로 간결하게. 확실하지 않은 건 저장하지 마세요. " +
        "또한 이번에 재사용할 만한 작업 절차(워크플로)를 익혔다면 [[SKILL: create | 이름 | 분류 | 한 줄 설명 | 단계별 절차]]로 저장하세요. 기존 스킬을 개선했으면 [[SKILL: patch | 이름 | 기존 | 새내용]]. " +
        "저장할 게 없으면 마커 없이 '없음'이라고만 답하세요.";
      const review = await speak(env, "core", reviewTrigger, t, { address: addr, canDelegate: false, sql, userId, ...sharedOpts });
      await _applyKnows(review.knows, "코어(회고)");
      await _applyProjects(review.projects);
      await _applySkills(review.skills);
      // review.text(회고 내용)는 produced에 넣지 않음 — 사용자 화면에는 표시하지 않는다.
    } catch { /* 회고 실패는 대화 흐름에 영향 없음 */ }
  }
  return produced;
}
