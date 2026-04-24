/**
 * scenario/rules/tone.js
 *
 * Phase 0 Step 4 — 톤 블록.
 * 우선순위 20 (base 10 < style 15 < tone 20 < genre 30 ...).
 *
 * UI ALLOWED_TONES:
 *   차분 / 진지 / 유머 / 공감 / 전문 / 친근 / 설득 / 중립 / 풍자 / 스토리
 *
 * 톤은 "표현 방식" 을 바꾸는 얇은 레이어. genre/subgenre/purpose 가 제약을 먼저 깔고,
 * 톤은 그 위에서 문장 스타일과 분위기를 지정.
 */

import { defineBlock, SEVERITY } from "../schema.js";

export const toneCalm = defineBlock({
  id: "tone.calm",
  layer: "tone",
  labelKo: "차분",
  labelEn: "Calm",
  signals: ["calm"],
  promptFragments: {
    ko: `[톤: 차분]
- 과장된 감정 표현 자제, 안정적이고 평온한 어조.
- 문장은 짧은 호흡으로 끊어 배치.`,
    en: `[Tone: Calm]
- Suppress exaggerated emotion; keep a stable peaceful register.
- Break sentences into short breath-sized units.`,
  },
});

export const toneSerious = defineBlock({
  id: "tone.serious",
  layer: "tone",
  labelKo: "진지",
  labelEn: "Serious",
  signals: ["serious"],
  promptFragments: {
    ko: `[톤: 진지]
- 가벼운 유머/밈 사용 지양.
- 사안의 무게에 걸맞은 문장 속도와 음색을 유지.`,
    en: `[Tone: Serious]
- Avoid light humor / memes.
- Match sentence pacing and voice weight to the topic's gravity.`,
  },
});

export const toneHumor = defineBlock({
  id: "tone.humor",
  layer: "tone",
  labelKo: "유머",
  labelEn: "Humor",
  signals: ["humor"],
  mandatoryTokens: [
    {
      pattern: /(반전|유머|웃|실수|농담|재밌|엉뚱)/,
      severity: SEVERITY.MEDIUM,
      labelKo: "유머 포인트 마커",
      labelEn: "Humor beat marker",
      suggestionKo: "귀여운 실수, 상황 개그, 가벼운 반전 중 1개를 삽입하세요.",
      suggestionEn: "Insert a gentle mistake, situational gag, or light twist.",
    },
  ],
  promptFragments: {
    ko: `[톤: 유머]
- 귀여운 실수 / 상황 개그 / 가벼운 반전 중 최소 1개 포함.
- 조롱·비하·차별적 유머 금지.`,
    en: `[Tone: Humor]
- Include at least one gentle mistake / situational gag / light twist.
- No mockery / put-downs / discriminatory jokes.`,
  },
});

export const toneEmpathy = defineBlock({
  id: "tone.empathy",
  layer: "tone",
  labelKo: "공감",
  labelEn: "Empathy",
  signals: ["empathy"],
  promptFragments: {
    ko: `[톤: 공감]
- 평가·판단보다 경청과 수용의 표현.
- 시청자가 "이건 내 얘기다" 라고 느낄 구체적 장면을 포함.`,
    en: `[Tone: Empathy]
- Favor listening and acceptance over evaluation / judgment.
- Include a concrete moment viewers can recognize as their own.`,
  },
});

export const toneExpert = defineBlock({
  id: "tone.expert",
  layer: "tone",
  labelKo: "전문",
  labelEn: "Expert",
  signals: ["expert", "authority"],
  promptFragments: {
    ko: `[톤: 전문]
- 주장은 근거와 함께. 출처/데이터/경험을 명시.
- 정확한 용어 사용, 단 최소 1회는 일반 시청자용 풀이 병행.`,
    en: `[Tone: Expert]
- Claims must come with evidence. Cite source / data / experience.
- Use precise terminology, but paraphrase at least once for general viewers.`,
  },
});

export const toneFriendly = defineBlock({
  id: "tone.friendly",
  layer: "tone",
  labelKo: "친근",
  labelEn: "Friendly",
  signals: ["friendly"],
  promptFragments: {
    ko: `[톤: 친근]
- 대화체와 일상 어휘 사용. 딱딱한 문어체 지양.
- 시청자를 "당신/너/우리" 로 호명하는 표현을 자연스럽게 포함.`,
    en: `[Tone: Friendly]
- Use conversational, everyday vocabulary. Avoid stiff written register.
- Address the viewer directly ("you / we") naturally.`,
  },
});

export const tonePersuasive = defineBlock({
  id: "tone.persuasive",
  layer: "tone",
  labelKo: "설득",
  labelEn: "Persuasive",
  signals: ["persuasion"],
  promptFragments: {
    ko: `[톤: 설득]
- 논리 흐름: 문제 제시 → 근거 → 반론 해소 → 결론.
- 공격적 어조 금지. 수치/사례/비교로 납득시킨다.`,
    en: `[Tone: Persuasive]
- Logic flow: problem → evidence → objection handling → conclusion.
- No aggressive register. Persuade via numbers / cases / comparisons.`,
  },
});

export const toneNeutral = defineBlock({
  id: "tone.neutral",
  layer: "tone",
  labelKo: "중립",
  labelEn: "Neutral",
  signals: ["neutral"],
  forbiddenTokens: [
    {
      pattern: /(무조건|절대|당연히|누구나\s*알\s*듯이)/,
      severity: SEVERITY.MEDIUM,
      labelKo: "중립 톤에서 피할 단정 표현",
      labelEn: "Absolute assertions",
    },
  ],
  promptFragments: {
    ko: `[톤: 중립]
- 단정적 표현 자제, 객관적 진술 유지.
- 가치 판단이 필요한 경우 "A 관점에서는 / B 관점에서는" 구조로 분리.`,
    en: `[Tone: Neutral]
- Avoid absolute assertions; keep objective phrasing.
- When value judgments are needed, separate "from A's view / from B's view".`,
  },
});

export const toneSatire = defineBlock({
  id: "tone.satire",
  layer: "tone",
  labelKo: "풍자",
  labelEn: "Satire",
  signals: ["satire", "irony"],
  forbiddenTokens: [
    {
      pattern: /(특정\s*인물\s*비하|혐오|인종|성별\s*차별)/,
      severity: SEVERITY.CRITICAL,
      labelKo: "풍자가 넘어서는 안 되는 선",
      labelEn: "Lines satire must not cross",
    },
  ],
  promptFragments: {
    ko: `[톤: 풍자]
- 권력/구조/현상을 겨냥. 개인에 대한 인신공격/혐오 금지.
- 상황의 모순을 보여 주는 장면 구성을 활용.`,
    en: `[Tone: Satire]
- Target power / structures / phenomena — never personal attacks or hate speech.
- Rely on staging the contradictions of the situation.`,
  },
});

export const toneStorytelling = defineBlock({
  id: "tone.storytelling",
  layer: "tone",
  labelKo: "스토리",
  labelEn: "Storytelling",
  signals: ["story_arc"],
  promptFragments: {
    ko: `[톤: 스토리]
- 정보 전달도 서사 구조(누가/언제/어디서/왜/결과) 로 풀어낸다.
- 감정 변화 1회 이상, 씬 사이 인과 유지.`,
    en: `[Tone: Storytelling]
- Frame information as narrative (who / when / where / why / result).
- Include at least one emotion shift and causal continuity between scenes.`,
  },
});

export const TONE_BLOCKS = Object.freeze({
  "차분":   toneCalm,
  "진지":   toneSerious,
  "유머":   toneHumor,
  "공감":   toneEmpathy,
  "전문":   toneExpert,
  "친근":   toneFriendly,
  "설득":   tonePersuasive,
  "중립":   toneNeutral,
  "풍자":   toneSatire,
  "스토리": toneStorytelling,
});

export function resolveToneBlock(tone) {
  if (!tone || typeof tone !== "string") return null;
  return TONE_BLOCKS[tone.trim()] || null;
}

export default { TONE_BLOCKS, resolveToneBlock };
