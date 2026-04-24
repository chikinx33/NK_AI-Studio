/**
 * scenario/rules/audience.js
 *
 * Phase 0 Step 4 — 타겟(시청자) 블록.
 * 우선순위 70 (최상위). 이유: "영유아 안전" 같은 제약은 어떤 장르·톤·스타일로도 덮을 수 없어야 함.
 *
 * 우선순위 매핑 (schema.js):
 *   base 10 < style 15 < tone 20 < genre 30 < format 40 < subgenre 50 < purpose 60 < audience 70
 */

import { defineBlock, SEVERITY } from "../schema.js";

/* =========================================================================
 * 영유아 (0~3세) — 안전 규칙 최우선
 * ========================================================================= */
export const audienceInfant = defineBlock({
  id: "audience.infant",
  layer: "audience",
  labelKo: "영유아",
  labelEn: "Infants / Toddlers",
  signals: ["very_young", "simple_language", "repeat", "safety"],

  constraints: {
    narrationMaxChars: {
      max: 20,
      severity: SEVERITY.CRITICAL,
      labelKo: "영유아 나레이션 최대 글자",
      labelEn: "Max narration chars for infants",
    },
    shotLengthAvgSec: {
      min: 2.5,
      max: 6.0,
      severity: SEVERITY.HIGH,
      labelKo: "영유아용 평균 샷 길이",
      labelEn: "Infant avg shot length",
    },
    paletteColorsMax: {
      max: 5,
      severity: SEVERITY.MEDIUM,
      labelKo: "주요 색상 상한",
      labelEn: "Max palette colors",
    },
  },

  forbiddenTokens: [
    {
      pattern: /(공포|긴장감|잔혹|폭력|어두운\s*그림자|무서운|귀신|괴물|피|죽음|사망)/,
      severity: SEVERITY.CRITICAL,
      labelKo: "영유아 부적합 콘텐츠",
      labelEn: "Unsafe content for infants",
      suggestionKo: "모든 갈등/위기 표현을 제거하고 따뜻하고 안전한 상황으로 바꾸세요.",
      suggestionEn: "Remove conflict/danger and replace with warm safe situations.",
    },
    {
      pattern: /(급작스런\s*큰\s*소리|플래시|번쩍이는|섬광)/,
      severity: SEVERITY.CRITICAL,
      labelKo: "영유아 시청각 자극 위험",
      labelEn: "Infant-unsafe audiovisual stimuli",
    },
  ],

  promptFragments: {
    ko: `[타겟: 영유아]
- 모든 장면은 안전하고 따뜻해야 한다. 갈등/위기/공포 요소 완전 금지.
- 문장은 매우 짧게(최대 20자). 한 번에 하나의 개념만.
- 색감은 맑고 부드럽게, 급격한 전환이나 번쩍임 금지.
- 캐릭터는 친구/동물/가족 등 친숙한 존재로만 구성.`,
    en: `[Audience: Infants]
- Every scene must feel safe and warm. No conflict/danger/fear.
- Very short sentences (max 20 chars). One concept at a time.
- Clear gentle palette; no abrupt transitions or flashes.
- Characters stay within familiar beings (friend / animal / family).`,
  },
});

/* =========================================================================
 * 아동 (4~9세)
 * ========================================================================= */
export const audienceChild = defineBlock({
  id: "audience.child",
  layer: "audience",
  labelKo: "아동",
  labelEn: "Children (4~9)",
  signals: ["kid", "simple_language", "participation"],

  constraints: {
    narrationMaxChars: {
      max: 40,
      severity: SEVERITY.HIGH,
      labelKo: "아동 나레이션 최대 글자",
      labelEn: "Max narration chars for children",
    },
  },

  forbiddenTokens: [
    {
      pattern: /(공포|잔혹|폭력|피|죽음|사망|자살|흡연|음주|도박)/,
      severity: SEVERITY.CRITICAL,
      labelKo: "아동 부적합 콘텐츠",
      labelEn: "Unsafe content for children",
      suggestionKo: "아동에게 적합한 친화적 상황으로 대체하세요.",
      suggestionEn: "Replace with child-friendly situations.",
    },
    {
      pattern: /(전문\s*용어|어려운\s*한자어|복잡한\s*개념)/,
      severity: SEVERITY.MEDIUM,
      labelKo: "난이도 과도",
      labelEn: "Overly complex terminology",
    },
  ],

  promptFragments: {
    ko: `[타겟: 아동]
- 문장은 짧고 쉬운 단어로. 한 씬에 개념 1~2개까지.
- 약간의 가벼운 갈등(해결 가능한 상황) 은 허용, 공포/폭력은 완전 금지.
- 참여 유도(손뼉/따라 말하기/질문) 가 자연스럽게 포함되면 좋다.`,
    en: `[Audience: Children]
- Short sentences, easy vocabulary. At most 1~2 concepts per scene.
- Light resolvable conflict allowed, but no fear/violence.
- Gentle participation cues (clap / repeat / ask) are welcome.`,
  },
});

/* =========================================================================
 * 청소년 (10~19세)
 * ========================================================================= */
export const audienceTeen = defineBlock({
  id: "audience.teen",
  layer: "audience",
  labelKo: "청소년",
  labelEn: "Teens (10~19)",
  signals: ["teen", "trend"],

  forbiddenTokens: [
    {
      pattern: /(흡연|음주|도박|마약|성적\s*묘사|선정적)/,
      severity: SEVERITY.CRITICAL,
      labelKo: "청소년 부적합 콘텐츠",
      labelEn: "Content restricted for teens",
    },
  ],

  promptFragments: {
    ko: `[타겟: 청소년]
- 유행어/밈/SNS 레퍼런스 활용 가능하되, 부정적 스테레오타입 금지.
- 학업/진로/관계 주제는 공감 우선, 훈계 금지.
- 빠른 템포와 시각적 강조(자막/애니메이션 효과) 를 활용한다.`,
    en: `[Audience: Teens]
- Slang / memes / social references are OK but avoid negative stereotypes.
- For school / career / relationship topics, empathy first — no lecturing.
- Use faster tempo and visual emphasis (captions / animated effects).`,
  },
});

/* =========================================================================
 * 청년 (20~34세)
 * ========================================================================= */
export const audienceYoungAdult = defineBlock({
  id: "audience.young-adult",
  layer: "audience",
  labelKo: "청년",
  labelEn: "Young Adults (20~34)",
  signals: ["young_adult", "career", "lifestyle"],

  promptFragments: {
    ko: `[타겟: 청년]
- 자기계발/커리어/관계/소비 맥락에서 실용성을 우선.
- 꾸미지 않은 솔직한 톤 선호. 과장된 긍정/훈계 금지.
- 첫 3초 안에 "나에게 쓸모 있나?" 가 판별되도록 훅 배치.`,
    en: `[Audience: Young Adults]
- Prioritize practicality in self-growth / career / relationships / consumption contexts.
- Prefer an honest unpolished tone. No over-positivity or lecturing.
- Place a hook that answers "is this useful to me?" within the first 3 seconds.`,
  },
});

/* =========================================================================
 * 직장인
 * ========================================================================= */
export const audienceProfessional = defineBlock({
  id: "audience.professional",
  layer: "audience",
  labelKo: "직장인",
  labelEn: "Working Professionals",
  signals: ["professional", "practical", "time_efficient"],

  promptFragments: {
    ko: `[타겟: 직장인]
- 시간 대비 효용(무엇을 얻게 되는지) 을 첫 씬에 명시.
- 실무 적용 예시가 최소 1회 포함.
- 중요한 포인트는 자막/도식으로 병행 표시(소리 없이 봐도 이해 가능).`,
    en: `[Audience: Working Professionals]
- State the takeaway-per-time upfront in the first scene.
- Include at least one hands-on applied example.
- Support key points with caption / diagram (must be understandable on mute).`,
  },
});

/* =========================================================================
 * 중장년 (35~59세)
 * ========================================================================= */
export const audienceMidAdult = defineBlock({
  id: "audience.mid-adult",
  layer: "audience",
  labelKo: "중장년",
  labelEn: "Middle-aged (35~59)",
  signals: ["mid_adult", "life_context"],

  promptFragments: {
    ko: `[타겟: 중장년]
- 가정/건강/재테크/커리어 전환 등 생애 맥락 이슈에 민감하게 접근.
- 지나친 유행어 사용 자제, 신뢰감 있는 톤 유지.
- 시각 자료는 가독성 우선(큰 글자, 선명한 대비).`,
    en: `[Audience: Middle-aged]
- Be sensitive to life-context issues: family / health / finance / career shift.
- Limit trendy slang; keep a trustworthy tone.
- Prioritize legibility in visuals (large type, clear contrast).`,
  },
});

/* =========================================================================
 * 시니어 (60세 이상)
 * ========================================================================= */
export const audienceSenior = defineBlock({
  id: "audience.senior",
  layer: "audience",
  labelKo: "시니어",
  labelEn: "Seniors (60+)",
  signals: ["senior", "accessibility"],

  constraints: {
    shotLengthAvgSec: {
      min: 3.5,
      max: 9.0,
      severity: SEVERITY.HIGH,
      labelKo: "시니어용 평균 샷 길이",
      labelEn: "Senior avg shot length",
    },
    narrationMaxChars: {
      max: 50,
      severity: SEVERITY.MEDIUM,
      labelKo: "시니어 나레이션 최대 글자",
      labelEn: "Max narration chars for seniors",
    },
  },

  promptFragments: {
    ko: `[타겟: 시니어]
- 컷 전환은 여유롭게, 문장은 또박또박 명확하게.
- 화면 글자는 크고 대비가 강해야 한다.
- 건강/가족/일상 맥락에서 존중과 따뜻함을 유지.
- 빠른 유행어/신조어 사용 자제.`,
    en: `[Audience: Seniors]
- Use relaxed cut pacing and clearly enunciated sentences.
- On-screen text must be large with strong contrast.
- Maintain respect and warmth in health / family / daily contexts.
- Avoid rapid slang and neologisms.`,
  },
});

/* =========================================================================
 * 전 연령
 * ========================================================================= */
export const audienceAllAges = defineBlock({
  id: "audience.all-ages",
  layer: "audience",
  labelKo: "전 연령",
  labelEn: "All Ages",
  signals: ["family_safe"],

  forbiddenTokens: [
    {
      pattern: /(잔혹|폭력|성적\s*묘사|선정적|욕설|혐오)/,
      severity: SEVERITY.CRITICAL,
      labelKo: "가족 시청 부적합",
      labelEn: "Not family-safe",
    },
  ],

  promptFragments: {
    ko: `[타겟: 전 연령]
- 전 연령이 함께 볼 수 있는 가족 친화적 내용.
- 특정 세대 전용 유행어/은어 사용 자제.
- 갈등이 있다면 해결과 화해로 귀결.`,
    en: `[Audience: All Ages]
- Family-friendly content that all generations can watch together.
- Avoid generation-specific slang.
- If conflict appears, resolve it with resolution and reconciliation.`,
  },
});

/* =========================================================================
 * 매핑
 * UI 에서 넘어오는 target 문자열 (overview-suggest.ALLOWED_TARGETS) 기반.
 * ========================================================================= */
export const AUDIENCE_BLOCKS = Object.freeze({
  "영유아":    audienceInfant,
  "아동":      audienceChild,
  "청소년":    audienceTeen,
  "청년":      audienceYoungAdult,
  "직장인":    audienceProfessional,
  "중장년":    audienceMidAdult,
  "시니어":    audienceSenior,
  "전 연령":   audienceAllAges,
});

export function resolveAudienceBlock(target) {
  if (!target || typeof target !== "string") return null;
  return AUDIENCE_BLOCKS[target.trim()] || null;
}

export default { AUDIENCE_BLOCKS, resolveAudienceBlock };
