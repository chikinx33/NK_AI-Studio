/**
 * scenario/rules/purpose.js
 *
 * Phase 0 Step 4 — 시청 목적(need) 블록.
 * 우선순위 60 (audience 70 다음).
 *
 * UI ALLOWED_NEEDS:
 *   학습 / 놀이 / 엔터테인먼트 / 스토리 / 힐링 / 생활 정보 / 자기계발 / 커리어 /
 *   재테크 / 시사 / 건강 / 여가 / 가정 / 라이프스타일 / 광고
 *
 * 목적은 "결과물의 최종 쓸모" 를 결정하므로 genre 보다 우선한다. 예:
 *   genre=요리 + purpose=광고  → 레시피 영상의 내부 흐름은 요리지만 결말은 CTA 로 종결.
 */

import { defineBlock, SEVERITY } from "../schema.js";

export const purposeLearning = defineBlock({
  id: "purpose.learning",
  layer: "purpose",
  labelKo: "학습",
  labelEn: "Learning",
  signals: ["learning", "structured_progression"],
  constraints: {
    repetitionMin: { min: 1, severity: SEVERITY.HIGH, labelKo: "학습 반복", labelEn: "Learning repetition" },
  },
  promptFragments: {
    ko: `[목적: 학습]
- 학습 대상 제시 / 반복 / 복습 구조가 없으면 실패.
- 시청 후 "하나 이상 기억에 남는 것" 이 명확해야 한다.`,
    en: `[Purpose: Learning]
- Fail if teach / repeat / recap structure is missing.
- After watching, "at least one thing remembered" must be explicit.`,
  },
});

export const purposePlay = defineBlock({
  id: "purpose.play",
  layer: "purpose",
  labelKo: "놀이",
  labelEn: "Play",
  signals: ["play", "participation"],
  mandatoryTokens: [
    {
      pattern: /(함께|같이|따라\s*해|해\s*봐|놀아|박수|뛰)/,
      severity: SEVERITY.HIGH,
      labelKo: "참여 유도 표현",
      labelEn: "Participation prompt",
    },
  ],
  promptFragments: {
    ko: `[목적: 놀이]
- 설명형이 아니라 참여형으로 구성. 시청자가 몸/말로 함께할 수 있어야 한다.
- 최소 1회 이상 "같이 해보자" 류의 직접 유도.`,
    en: `[Purpose: Play]
- Build as participatory, not expository. Viewers must be able to join with body/voice.
- At least one direct "let's try together" prompt.`,
  },
});

export const purposeEntertainment = defineBlock({
  id: "purpose.entertainment",
  layer: "purpose",
  labelKo: "엔터테인먼트",
  labelEn: "Entertainment",
  signals: ["entertainment", "tempo"],
  promptFragments: {
    ko: `[목적: 엔터테인먼트]
- 재미 포인트(반전/유머/리액션) 가 최소 1회 명시되어야 한다.
- 결과물은 "정보" 보다 "경험" 이 되도록 구성.`,
    en: `[Purpose: Entertainment]
- At least one fun beat (twist / humor / reaction) must be explicit.
- The output should feel like an experience, not information.`,
  },
});

export const purposeStory = defineBlock({
  id: "purpose.story",
  layer: "purpose",
  labelKo: "스토리",
  labelEn: "Story",
  signals: ["story_arc"],
  promptFragments: {
    ko: `[목적: 스토리]
- 씬 간 인과를 반드시 유지. 시간/공간 점프가 있으면 명시.
- 마지막 씬이 앞 씬들의 축적 결과임이 드러나야 한다.`,
    en: `[Purpose: Story]
- Preserve causal continuity between scenes. Flag any time/space jump explicitly.
- The final scene must read as the accumulated result of prior scenes.`,
  },
});

export const purposeHealing = defineBlock({
  id: "purpose.healing",
  layer: "purpose",
  labelKo: "힐링",
  labelEn: "Healing",
  signals: ["healing", "slow_pace"],
  promptFragments: {
    ko: `[목적: 힐링]
- 빠른 컷/큰 소음/급격한 변화 지양.
- 자연 요소 또는 안정감 있는 공간을 유지.`,
    en: `[Purpose: Healing]
- Avoid fast cuts / loud sounds / abrupt changes.
- Keep natural elements or stabilizing spaces present.`,
  },
});

export const purposeLifeInfo = defineBlock({
  id: "purpose.life-info",
  layer: "purpose",
  labelKo: "생활 정보",
  labelEn: "Life Info",
  signals: ["practical", "informative"],
  promptFragments: {
    ko: `[목적: 생활 정보]
- 바로 적용 가능한 팁/방법을 우선. 이론 설명은 최소화.
- 한 씬에 한 가지 팁.`,
    en: `[Purpose: Life Info]
- Prioritize immediately applicable tips. Minimize theory.
- One tip per scene.`,
  },
});

export const purposeSelfImprovement = defineBlock({
  id: "purpose.self-improvement",
  layer: "purpose",
  labelKo: "자기계발",
  labelEn: "Self-improvement",
  signals: ["self_improvement", "actionable"],
  forbiddenTokens: [
    {
      pattern: /(무조건\s*성공|100%|반드시\s*부자|쉽게\s*부자|확실히\s*성공)/,
      severity: SEVERITY.HIGH,
      labelKo: "자기계발 과장 표현",
      labelEn: "Self-help hype",
      suggestionKo: "구체적 실행 단계와 조건으로 대체하세요.",
      suggestionEn: "Replace with specific actions and conditions.",
    },
  ],
  promptFragments: {
    ko: `[목적: 자기계발]
- 추상적 동기 부여보다 구체적 실행 단계(오늘 할 일 1개) 제시.
- 마지막 씬에 "첫 번째로 할 행동" 을 명시.`,
    en: `[Purpose: Self-improvement]
- Concrete action steps over abstract motivation (one thing to do today).
- The last scene must state "the first action to take".`,
  },
});

export const purposeCareer = defineBlock({
  id: "purpose.career",
  layer: "purpose",
  labelKo: "커리어",
  labelEn: "Career",
  signals: ["career", "professional"],
  promptFragments: {
    ko: `[목적: 커리어]
- 실제 업무 시나리오 또는 직장 맥락이 최소 1씬 이상.
- 판단 기준 / 단계 / 예시를 구조적으로 분리.`,
    en: `[Purpose: Career]
- At least one scene with a real work scenario or professional context.
- Separate decision criteria / steps / examples structurally.`,
  },
});

export const purposeFinance = defineBlock({
  id: "purpose.finance",
  layer: "purpose",
  labelKo: "재테크",
  labelEn: "Finance",
  signals: ["finance", "caution"],
  forbiddenTokens: [
    {
      pattern: /(무조건\s*오른다|반드시\s*수익|100%\s*수익|확실한\s*수익)/,
      severity: SEVERITY.CRITICAL,
      labelKo: "투자 권유 과장/오인 표현",
      labelEn: "Misleading investment claims",
      suggestionKo: "리스크와 조건을 수반한 중립적 표현으로 바꾸세요.",
      suggestionEn: "Replace with neutral phrasing that acknowledges risk and conditions.",
    },
  ],
  promptFragments: {
    ko: `[목적: 재테크]
- 수익 가능성을 언급할 때 반드시 리스크/조건을 함께 제시.
- 특정 종목·상품 추천 금지. 일반 원리와 사례 중심.`,
    en: `[Purpose: Finance]
- Any return mention must accompany risk and conditions.
- Do not recommend specific securities/products; stay on principles and cases.`,
  },
});

export const purposeNews = defineBlock({
  id: "purpose.news",
  layer: "purpose",
  labelKo: "시사",
  labelEn: "News / Current Affairs",
  signals: ["informative", "balance"],
  promptFragments: {
    ko: `[목적: 시사]
- 주장에는 근거/출처가 반드시 동반되어야 한다.
- 상반된 입장이 있다면 양쪽을 제시.`,
    en: `[Purpose: News]
- Any claim must carry evidence / source.
- When opposing views exist, present both.`,
  },
});

export const purposeHealth = defineBlock({
  id: "purpose.health",
  layer: "purpose",
  labelKo: "건강",
  labelEn: "Health",
  signals: ["health", "caution"],
  forbiddenTokens: [
    {
      pattern: /(만병통치|반드시\s*낫는|100%\s*치료|기적의\s*치료)/,
      severity: SEVERITY.CRITICAL,
      labelKo: "건강/의료 과장 표현",
      labelEn: "Health overclaim",
      suggestionKo: "전문가 상담 권고 또는 조건부 표현으로 바꾸세요.",
      suggestionEn: "Replace with a conditional statement or advice to consult a professional.",
    },
  ],
  promptFragments: {
    ko: `[목적: 건강]
- 의료 행위/진단/처방을 대체하는 표현 금지.
- 심각한 증상은 "전문가 상담" 권고를 명시.`,
    en: `[Purpose: Health]
- Do not substitute medical diagnosis / prescription / treatment.
- For serious symptoms, explicitly advise consulting a professional.`,
  },
});

export const purposeLeisure = defineBlock({
  id: "purpose.leisure",
  layer: "purpose",
  labelKo: "여가",
  labelEn: "Leisure",
  signals: ["leisure", "relax"],
  promptFragments: {
    ko: `[목적: 여가]
- 의무감보다 호기심/즐거움을 자극하는 구성.
- 정보 밀도는 낮게, 분위기를 우선.`,
    en: `[Purpose: Leisure]
- Spark curiosity / joy rather than obligation.
- Keep information density low; prioritize mood.`,
  },
});

export const purposeFamily = defineBlock({
  id: "purpose.family",
  layer: "purpose",
  labelKo: "가정",
  labelEn: "Family",
  signals: ["family", "warm"],
  promptFragments: {
    ko: `[목적: 가정]
- 가족 구성원 간의 따뜻한 상호작용을 중심에.
- 갈등이 있더라도 해결과 화해로 귀결.`,
    en: `[Purpose: Family]
- Center on warm interactions between family members.
- Any conflict must resolve in resolution and reconciliation.`,
  },
});

export const purposeLifestyle = defineBlock({
  id: "purpose.lifestyle",
  layer: "purpose",
  labelKo: "라이프스타일",
  labelEn: "Lifestyle",
  signals: ["lifestyle"],
  promptFragments: {
    ko: `[목적: 라이프스타일]
- 특정 삶의 방식/취향을 보여 주되, 강요하거나 비교·경멸하지 않는다.
- 디테일(소품/음식/공간) 이 메시지를 대신 말하게 한다.`,
    en: `[Purpose: Lifestyle]
- Show a specific way of living without forcing / comparing / demeaning.
- Let details (props / food / space) carry the message.`,
  },
});

export const purposeAd = defineBlock({
  id: "purpose.ad",
  layer: "purpose",
  labelKo: "광고",
  labelEn: "Advertisement",
  signals: ["ad", "cta", "persuasion"],
  constraints: {
    // 광고는 마지막 비트가 반드시 CTA 여야 함 — format 블록이 이미 비트를 가지고 있어도
    // 이 제약은 compose 단계에서 "마지막 씬 = CTA" 로 강제되도록 신호만 남긴다.
  },
  mandatoryTokens: [
    {
      pattern: /(지금|오늘|바로|클릭|방문|구매|다운로드|신청|체험)/,
      severity: SEVERITY.HIGH,
      labelKo: "CTA 표현",
      labelEn: "CTA marker",
      suggestionKo: "마지막 씬에 시청자가 바로 할 수 있는 행동을 명시하세요.",
      suggestionEn: "The last scene must state an immediate viewer action.",
    },
  ],
  promptFragments: {
    ko: `[목적: 광고]
- 마지막 씬은 반드시 구체적 CTA(구매/방문/신청/체험 등) 로 종결.
- 제품/서비스의 이점은 "추상 형용사" 가 아니라 구체 결과로 표현.
- 첫 3초 안에 "이 광고는 무엇을 파는가" 가 판별되어야 한다.`,
    en: `[Purpose: Ad]
- The final scene must end with a concrete CTA (buy / visit / sign up / try).
- Express product benefits as concrete outcomes, not abstract adjectives.
- "What is being sold" must be clear within the first 3 seconds.`,
  },
});

export const PURPOSE_BLOCKS = Object.freeze({
  "학습":         purposeLearning,
  "놀이":         purposePlay,
  "엔터테인먼트": purposeEntertainment,
  "스토리":       purposeStory,
  "힐링":         purposeHealing,
  "생활 정보":    purposeLifeInfo,
  "자기계발":     purposeSelfImprovement,
  "커리어":       purposeCareer,
  "재테크":       purposeFinance,
  "시사":         purposeNews,
  "건강":         purposeHealth,
  "여가":         purposeLeisure,
  "가정":         purposeFamily,
  "라이프스타일": purposeLifestyle,
  "광고":         purposeAd,
});

export function resolvePurposeBlock(need) {
  if (!need || typeof need !== "string") return null;
  return PURPOSE_BLOCKS[need.trim()] || null;
}

export default { PURPOSE_BLOCKS, resolvePurposeBlock };
