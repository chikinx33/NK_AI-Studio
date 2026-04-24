/**
 * scenario/rules/subgenre.js
 *
 * Phase 0 Step 3 — purposeTag (세부 장르) 별 블록.
 * 우선순위 50 (genre 30 < subgenre 50 < purpose 60 < audience 70)
 *
 * 설계: 세부 장르가 선택된 경우에만 상위 클래스 규칙을 구체적 비트/토큰으로 강화.
 * 여기서는 UI 카탈로그(overview-suggest.ALLOWED_PURPOSE_CATEGORIES)에 정의된
 * 세부 장르 중 "품질 편차가 크고 효과가 확실한" 것들에 집중해 22개를 저자.
 * 나머지 세부 장르는 상위 genre 블록만으로 충분.
 */

import { defineBlock, SEVERITY } from "../schema.js";

/* =========================================================================
 * 키즈 · 영유아 계열
 * ========================================================================= */

export const subgenreNurseryRhyme = defineBlock({
  id: "subgenre.nursery-rhyme",
  layer: "subgenre",
  labelKo: "동요",
  labelEn: "Nursery Rhyme",
  signals: ["song", "repeat", "hook"],

  constraints: {
    repetitionMin: {
      min: 3,
      severity: SEVERITY.CRITICAL,
      labelKo: "후렴 반복 최소 횟수",
      labelEn: "Minimum chorus repetitions",
    },
  },

  mandatoryTokens: [
    {
      pattern: /(후렴|리듬|노래|따라\s*부르)/,
      severity: SEVERITY.HIGH,
      labelKo: "노래/후렴 표현",
      labelEn: "Song/chorus marker",
      suggestionKo: "후렴 또는 따라 부르는 씬이 1회 이상 드러나야 합니다.",
      suggestionEn: "A chorus or sing-along scene must appear at least once.",
    },
  ],

  promptFragments: {
    ko: `[세부 장르: 동요]
- 후렴/반복 구절이 씬 구조에 명시되어야 한다. 최소 3회 반복.
- 각 씬의 내레이션은 노래하듯 따라 부를 수 있는 짧은 가사여야 한다.
- 아이들이 박자에 맞춰 손뼉/몸짓을 할 수 있는 큐를 포함한다.`,
    en: `[Subgenre: Nursery Rhyme]
- A chorus / repeated hook must be explicit, repeated at least 3 times.
- Each scene's narration should be a short, singable lyric.
- Include cues for kids to clap or move along on beat.`,
  },

  progressLabelKo: "후렴과 리듬을 붙이는 중…",
  progressLabelEn: "Locking the chorus and rhythm…",
});

export const subgenreMovementSong = defineBlock({
  id: "subgenre.movement-song",
  layer: "subgenre",
  labelKo: "율동",
  labelEn: "Movement Song",
  signals: ["song", "movement", "participation"],

  mandatoryTokens: [
    {
      pattern: /(손뼉|박수|발구르|뛰|돌|흔들|동작|따라\s*해)/,
      severity: SEVERITY.HIGH,
      labelKo: "몸동작 유도 표현",
      labelEn: "Body-motion cue",
    },
  ],

  promptFragments: {
    ko: `[세부 장르: 율동]
- 각 씬에 구체적인 몸동작 큐 1개 이상(손뼉/발구르기/돌기/흔들기 등).
- 동작은 어른이 시연하고 아이가 따라하는 구조로 배치.
- 리듬은 일정하게 유지, 동작 전환은 비트 단위로 정렬.`,
    en: `[Subgenre: Movement Song]
- Each scene must contain at least one explicit body cue (clap / stomp / spin / shake).
- Structure: adult demonstrates, child follows.
- Keep rhythm consistent; align motion changes with the beat.`,
  },

  progressLabelKo: "율동 동작을 배치하는 중…",
  progressLabelEn: "Placing movement cues…",
});

export const subgenreKidsEdu = defineBlock({
  id: "subgenre.kids-edu",
  layer: "subgenre",
  labelKo: "유아 교육",
  labelEn: "Early Childhood Education",
  signals: ["learning", "simple_language"],

  constraints: {
    narrationMaxChars: {
      max: 24,
      severity: SEVERITY.CRITICAL,
      labelKo: "유아용 나레이션 최대 글자",
      labelEn: "Max narration chars for very young",
    },
  },

  promptFragments: {
    ko: `[세부 장르: 유아 교육]
- 한 영상에 핵심 개념은 1~2개까지만.
- 개념 제시 직후 바로 시각적 예시를 보여 준다(말로만 설명 금지).
- 씬 끝에는 아이가 따라 말하거나 손가락으로 짚을 수 있는 순간을 포함.`,
    en: `[Subgenre: Early Childhood Education]
- Only 1~2 core concepts per video.
- Each concept must be followed immediately by a visual example (no verbal-only explanation).
- End each scene with a moment the child can repeat or point to.`,
  },

  progressLabelKo: "아이 눈높이에 맞추는 중…",
  progressLabelEn: "Matching the child's eye level…",
});

export const subgenreKidsPlay = defineBlock({
  id: "subgenre.kids-play",
  layer: "subgenre",
  labelKo: "키즈 놀이",
  labelEn: "Kids Play",
  signals: ["play", "participation"],

  mandatoryTokens: [
    {
      pattern: /(함께|같이|따라\s*해|해\s*봐|할\s*수\s*있어)/,
      severity: SEVERITY.HIGH,
      labelKo: "참여 유도 표현",
      labelEn: "Participation prompt",
    },
  ],

  promptFragments: {
    ko: `[세부 장르: 키즈 놀이]
- "함께/같이/해 봐" 같은 참여 유도 표현이 반드시 1회 이상.
- 놀이 규칙이 매우 단순해야 하고, 도구도 일상 소품 위주.
- 성공 경험(박수/환호) 을 엔딩에 배치.`,
    en: `[Subgenre: Kids Play]
- A participation prompt ("together/let's/try it") must appear at least once.
- Play rules must be very simple; use everyday props.
- End on a success moment (clap/cheer).`,
  },

  progressLabelKo: "참여 포인트를 넣는 중…",
  progressLabelEn: "Adding participation cues…",
});

/* =========================================================================
 * 교육 · 학습 계열
 * ========================================================================= */

export const subgenreTutorial = defineBlock({
  id: "subgenre.tutorial",
  layer: "subgenre",
  labelKo: "튜토리얼",
  labelEn: "Tutorial",
  signals: ["tutorial", "step_by_step"],

  promptFragments: {
    ko: `[세부 장르: 튜토리얼]
- 각 씬은 "단계 번호 + 해야 할 행동 하나" 구조.
- 첫 씬에 "최종 결과물/도달 지점" 을 먼저 보여 준다(후크).
- 실패하기 쉬운 포인트를 1회 이상 경고/강조.
- 마지막 씬에는 전체 과정을 빠르게 되짚는 재압축 씬.`,
    en: `[Subgenre: Tutorial]
- Each scene = "step number + one concrete action".
- The first scene must reveal the final result / destination (hook).
- Warn about at least one common mistake.
- End with a fast-recap scene compressing the whole process.`,
  },

  progressLabelKo: "단계 흐름을 다듬는 중…",
  progressLabelEn: "Refining step-by-step flow…",
});

export const subgenreLanguageLearning = defineBlock({
  id: "subgenre.language-learning",
  layer: "subgenre",
  labelKo: "언어 학습",
  labelEn: "Language Learning",
  signals: ["learning", "pronunciation", "repeat"],

  constraints: {
    repetitionMin: {
      min: 2,
      severity: SEVERITY.HIGH,
      labelKo: "표현/발음 반복",
      labelEn: "Phrase/pronunciation repetition",
    },
  },

  promptFragments: {
    ko: `[세부 장르: 언어 학습]
- 각 핵심 표현/단어는 반드시 2회 이상 반복(시각+음성).
- 씬 구조: 표현 제시 → 예문 속 사용 → 따라 하기.
- 발음이 어려운 부분은 입 모양 클로즈업 또는 철자 자막으로 강조.`,
    en: `[Subgenre: Language Learning]
- Every core phrase/word must be repeated at least twice (visual + audio).
- Scene order: introduce → use in context → repeat aloud.
- Emphasize hard pronunciations with mouth close-up or spelling caption.`,
  },

  progressLabelKo: "발음과 반복을 배치하는 중…",
  progressLabelEn: "Sequencing pronunciation drills…",
});

export const subgenreCoding = defineBlock({
  id: "subgenre.coding",
  layer: "subgenre",
  labelKo: "코딩",
  labelEn: "Coding",
  signals: ["tutorial", "code", "screen"],

  promptFragments: {
    ko: `[세부 장르: 코딩]
- 시연 씬은 실제 코드 화면이 보여야 한다. "화면 뒤 그래픽 장식" 으로 대체 금지.
- 한 씬에 1개의 코드 변경만 다룬다(더 많으면 씬 분리).
- 결과 확인(실행/콘솔 출력) 을 별도 씬으로 분리.`,
    en: `[Subgenre: Coding]
- Demo scenes must show real code on screen — no decorative stand-ins.
- One code change per scene (split if more).
- Put result verification (run/console output) in its own scene.`,
  },

  progressLabelKo: "코드 시연을 구성하는 중…",
  progressLabelEn: "Structuring code demo…",
});

/* =========================================================================
 * 음식 · 요리 계열
 * ========================================================================= */

export const subgenreMukbang = defineBlock({
  id: "subgenre.mukbang",
  layer: "subgenre",
  labelKo: "먹방",
  labelEn: "Mukbang",
  signals: ["food", "asmr"],

  promptFragments: {
    ko: `[세부 장르: 먹방]
- 음식의 질감/색감/크기를 클로즈업으로 살린다.
- 씹는 소리, 국물 끓는 소리 등 구체적 음향을 visual 에 명시.
- 인물 표정 리액션 씬을 최소 1회 배치.`,
    en: `[Subgenre: Mukbang]
- Showcase food texture / color / scale in close-ups.
- Specify concrete sounds (chewing, bubbling broth) in visual.
- Include at least one face-reaction scene.`,
  },

  progressLabelKo: "식감과 소리를 잡는 중…",
  progressLabelEn: "Capturing texture and sound…",
});

export const subgenreRecipe = defineBlock({
  id: "subgenre.recipe",
  layer: "subgenre",
  labelKo: "레시피",
  labelEn: "Recipe",
  signals: ["cooking", "step_by_step"],

  promptFragments: {
    ko: `[세부 장르: 레시피]
- 도입 씬에 완성 요리 이미지를 먼저 노출(후크).
- 재료 전체 레이아웃 컷을 반드시 1회 포함.
- 각 조리 단계는 구체적 계량(스푼/그램/분) 을 내레이션에 명시.`,
    en: `[Subgenre: Recipe]
- The opening scene must tease the finished dish (hook).
- Include one overall ingredient-layout shot.
- Each cooking step must state concrete measurements (tsp/g/min) in narration.`,
  },

  progressLabelKo: "계량과 단계를 정리하는 중…",
  progressLabelEn: "Aligning steps and measurements…",
});

/* =========================================================================
 * 라이프 · 일상 계열
 * ========================================================================= */

export const subgenreVlog = defineBlock({
  id: "subgenre.vlog",
  layer: "subgenre",
  labelKo: "브이로그",
  labelEn: "Vlog",
  signals: ["vlog", "personal"],

  promptFragments: {
    ko: `[세부 장르: 브이로그]
- 하루/시간대 흐름이 씬 순서에서 보여야 한다(아침 → 오후 → 저녁 등).
- 인물의 1인칭 내레이션 비율을 절반 이하로 유지 — 행동/소품이 말하게 한다.
- 씬 전환은 "장소 이동" 혹은 "다음 일정" 을 명시.`,
    en: `[Subgenre: Vlog]
- Day/time progression must be readable from scene order (morning → afternoon → evening).
- Keep first-person narration under 50% — let actions and props speak.
- Each transition must state either a location move or the next activity.`,
  },

  progressLabelKo: "하루 흐름을 정리하는 중…",
  progressLabelEn: "Pacing the day's flow…",
});

export const subgenreRoutine = defineBlock({
  id: "subgenre.routine",
  layer: "subgenre",
  labelKo: "루틴",
  labelEn: "Routine",
  signals: ["routine", "procedural"],

  promptFragments: {
    ko: `[세부 장르: 루틴]
- 각 씬은 시간 단서(시계/일출/조명 변화) 가 있어야 한다.
- 루틴의 "반복 가능한 이유" 를 마지막 씬에서 짧게 정리.`,
    en: `[Subgenre: Routine]
- Each scene must contain a time cue (clock / sunlight / lighting shift).
- The last scene must briefly state why this routine is sustainable.`,
  },

  progressLabelKo: "루틴 흐름을 배치하는 중…",
  progressLabelEn: "Structuring the routine…",
});

/* =========================================================================
 * 엔터테인먼트 계열
 * ========================================================================= */

export const subgenreChallenge = defineBlock({
  id: "subgenre.challenge",
  layer: "subgenre",
  labelKo: "챌린지",
  labelEn: "Challenge",
  signals: ["challenge", "reaction"],

  mandatoryTokens: [
    {
      pattern: /(도전|성공|실패|미션|규칙)/,
      severity: SEVERITY.HIGH,
      labelKo: "챌린지 구조 마커",
      labelEn: "Challenge structure marker",
    },
  ],

  promptFragments: {
    ko: `[세부 장르: 챌린지]
- 초반 씬에 규칙/미션을 명확히 선언.
- 중간 씬에 "위기/실패 시도" 를 최소 1회 배치.
- 결과 씬에서 성공/실패를 명시적으로 공개.`,
    en: `[Subgenre: Challenge]
- Declare rules/mission explicitly in the opening scene.
- Place at least one crisis/failed attempt in the middle.
- Reveal success/failure explicitly at the end.`,
  },

  progressLabelKo: "규칙과 위기 지점을 배치하는 중…",
  progressLabelEn: "Placing rules and crisis beats…",
});

export const subgenreReaction = defineBlock({
  id: "subgenre.reaction",
  layer: "subgenre",
  labelKo: "리액션",
  labelEn: "Reaction",
  signals: ["reaction", "emotion"],

  promptFragments: {
    ko: `[세부 장르: 리액션]
- 리액션 대상(영상/소리/맛/물체) 이 첫 씬에 등장해야 한다.
- 출연자 표정 클로즈업 컷을 2씬 이상.
- 마지막 씬에 "무엇이 인상적이었나" 한마디 정리.`,
    en: `[Subgenre: Reaction]
- The reacted-to subject (video/sound/taste/object) must appear in the first scene.
- At least two face-close-up reaction scenes.
- End with a one-line "what stood out" summary.`,
  },

  progressLabelKo: "리액션 포인트를 배치하는 중…",
  progressLabelEn: "Placing reaction beats…",
});

/* =========================================================================
 * 음악 · 사운드 계열
 * ========================================================================= */

export const subgenreASMR = defineBlock({
  id: "subgenre.asmr",
  layer: "subgenre",
  labelKo: "ASMR",
  labelEn: "ASMR",
  signals: ["asmr", "sound_design"],

  constraints: {
    shotLengthAvgSec: {
      min: 4.0,
      max: 12.0,
      severity: SEVERITY.HIGH,
      labelKo: "ASMR 평균 샷 길이",
      labelEn: "ASMR avg shot length",
    },
  },

  forbiddenTokens: [
    {
      pattern: /(큰\s*소리|갑작스런|폭발|시끄러운|비명)/,
      severity: SEVERITY.CRITICAL,
      labelKo: "ASMR 부적합 자극",
      labelEn: "ASMR-breaking loud cues",
    },
  ],

  promptFragments: {
    ko: `[세부 장르: ASMR]
- 각 씬에 구체적 소리 트리거를 명시(탭핑/쓸기/바스락/바람 등).
- 내레이션은 최소화, 속삭임 톤.
- 빠른 컷/큰 소리/급작스런 움직임 금지.`,
    en: `[Subgenre: ASMR]
- Each scene must specify a concrete sound trigger (tapping/brushing/crinkle/wind).
- Minimize narration; whisper tone.
- No fast cuts, loud sounds, or sudden motions.`,
  },

  progressLabelKo: "사운드 트리거를 배치하는 중…",
  progressLabelEn: "Placing sound triggers…",
});

export const subgenreCover = defineBlock({
  id: "subgenre.cover",
  layer: "subgenre",
  labelKo: "커버",
  labelEn: "Music Cover",
  signals: ["music", "performance"],

  promptFragments: {
    ko: `[세부 장르: 커버]
- 원곡의 구조(인트로/벌스/후렴/브릿지) 가 씬 구조에 반영되어야 한다.
- 악기와 보컬이 한 프레임에 보이는 씬을 1개 이상.
- 후렴 씬은 가장 풍부한 공간감/조명으로 연출.`,
    en: `[Subgenre: Music Cover]
- Reflect the source track's structure (intro/verse/chorus/bridge) in the scenes.
- Include at least one frame showing instrument and vocalist together.
- Make the chorus scene the richest in space and light.`,
  },

  progressLabelKo: "곡 구조에 맞추는 중…",
  progressLabelEn: "Matching the song structure…",
});

/* =========================================================================
 * 스포츠 · 피트니스 계열
 * ========================================================================= */

export const subgenreHomeTraining = defineBlock({
  id: "subgenre.home-training",
  layer: "subgenre",
  labelKo: "홈트레이닝",
  labelEn: "Home Training",
  signals: ["fitness", "home"],

  promptFragments: {
    ko: `[세부 장르: 홈트레이닝]
- 장비 없는 대체 동작을 최소 1개 제시.
- 공간은 집 거실/방 기준. 체육관 장비 사용 금지.
- 난이도(초급/중급) 를 명시하는 씬 1개 필수.`,
    en: `[Subgenre: Home Training]
- Suggest at least one no-equipment alternative motion.
- Space = home living room / bedroom. No gym equipment.
- Include one scene that states the difficulty (beginner/intermediate).`,
  },

  progressLabelKo: "홈 공간에 맞추는 중…",
  progressLabelEn: "Tuning for home space…",
});

/* =========================================================================
 * 리뷰 · 추천 계열
 * ========================================================================= */

export const subgenreProductReview = defineBlock({
  id: "subgenre.product-review",
  layer: "subgenre",
  labelKo: "제품",
  labelEn: "Product Review",
  signals: ["review", "product"],

  promptFragments: {
    ko: `[세부 장르: 제품 리뷰]
- 언박싱 / 외관 / 핵심 기능 / 실사용 / 결론 중 최소 4단계 반영.
- 비교 대상 제품이 있다면 한 프레임 안에 나란히 놓는 씬 포함.
- 가격/가성비 언급이 있어야 한다(결론 씬).`,
    en: `[Subgenre: Product Review]
- Cover at least 4 of: unboxing / exterior / core features / real-use / verdict.
- If a comparable product exists, include a side-by-side frame.
- Price/value mention is required in the verdict scene.`,
  },

  progressLabelKo: "제품 검토 흐름을 구성하는 중…",
  progressLabelEn: "Structuring product evaluation…",
});

/* =========================================================================
 * 지식 · 교양 · 사회 · 공감 계열
 * ========================================================================= */

export const subgenreCurrentAffairs = defineBlock({
  id: "subgenre.current-affairs",
  layer: "subgenre",
  labelKo: "시사",
  labelEn: "Current Affairs",
  signals: ["informative", "fact", "balance"],

  forbiddenTokens: [
    {
      pattern: /(무조건|절대|누구나\s*알\s*듯이|당연히)/,
      severity: SEVERITY.HIGH,
      labelKo: "시사 보도에서 지양할 단정 표현",
      labelEn: "Absolute assertions unsuitable for news",
      suggestionKo: "근거와 출처를 수반한 중립적 표현으로 바꾸세요.",
      suggestionEn: "Replace with neutral phrasing accompanied by evidence/source.",
    },
  ],

  promptFragments: {
    ko: `[세부 장르: 시사]
- 주장에는 반드시 구체적 근거/수치/출처를 붙인다.
- 한 쟁점에 대해 상반된 입장이 있다면 양쪽을 명시.
- 단정적 표현 금지, 중립적 전달 유지.`,
    en: `[Subgenre: Current Affairs]
- Any claim must carry concrete evidence / numbers / source.
- When an issue has opposing views, acknowledge both.
- Avoid absolute assertions; maintain neutral delivery.`,
  },

  progressLabelKo: "근거와 양쪽 관점을 정리하는 중…",
  progressLabelEn: "Balancing evidence and viewpoints…",
});

export const subgenreInterview = defineBlock({
  id: "subgenre.interview",
  layer: "subgenre",
  labelKo: "인터뷰",
  labelEn: "Interview",
  signals: ["interview", "voice"],

  promptFragments: {
    ko: `[세부 장르: 인터뷰]
- 오프닝 씬에 인터뷰이의 정체성(이름/역할/배경) 을 자막 또는 소품으로 제시.
- 질문-답변 구조가 씬에 드러나야 한다.
- 인터뷰이의 배경 공간이 그의 삶을 설명하도록 구성.`,
    en: `[Subgenre: Interview]
- The opening scene must introduce the interviewee's identity (name / role / background) via caption or prop.
- Question-answer structure must be visible across scenes.
- Let the interviewee's background space explain their life.`,
  },

  progressLabelKo: "인터뷰 구조를 짜는 중…",
  progressLabelEn: "Building interview structure…",
});

export const subgenreDocumentary = defineBlock({
  id: "subgenre.documentary",
  layer: "subgenre",
  labelKo: "다큐형 콘텐츠",
  labelEn: "Documentary-style",
  signals: ["documentary", "narrative_nonfiction"],

  promptFragments: {
    ko: `[세부 장르: 다큐형 콘텐츠]
- 현장 관찰 씬과 인터뷰 씬을 교차 배치.
- 시대/계절/시간대 같은 맥락 정보를 초반에 제공.
- 결론은 주장이 아니라 열린 질문 또는 남은 과제로 끝낼 수 있다.`,
    en: `[Subgenre: Documentary-style]
- Interleave field-observation scenes with interview scenes.
- Provide period/season/time context early.
- The ending may leave an open question rather than a declarative conclusion.`,
  },

  progressLabelKo: "현장과 인터뷰를 교차하는 중…",
  progressLabelEn: "Interleaving field and interview…",
});

/* =========================================================================
 * 비즈니스 · 테크 계열
 * ========================================================================= */

export const subgenreMarketing = defineBlock({
  id: "subgenre.marketing",
  layer: "subgenre",
  labelKo: "마케팅",
  labelEn: "Marketing",
  signals: ["marketing", "persuasion"],

  promptFragments: {
    ko: `[세부 장르: 마케팅]
- AIDA(주의/흥미/욕구/행동) 또는 Problem-Agitate-Solve 구조 택일.
- 마지막 씬에 명확한 행동 유도(CTA) 를 배치.
- 데이터/사례가 있으면 구체 수치로.`,
    en: `[Subgenre: Marketing]
- Use either AIDA (Attention/Interest/Desire/Action) or Problem-Agitate-Solve.
- Place a clear CTA in the final scene.
- Back claims with concrete numbers when data exists.`,
  },

  progressLabelKo: "전환 흐름을 구성하는 중…",
  progressLabelEn: "Shaping the conversion flow…",
});

export const subgenreAI = defineBlock({
  id: "subgenre.ai",
  layer: "subgenre",
  labelKo: "AI",
  labelEn: "AI",
  signals: ["tech", "ai"],

  forbiddenTokens: [
    {
      pattern: /(인간을\s*넘어|모든\s*것을|완벽한\s*지능|사람을\s*대체)/,
      severity: SEVERITY.HIGH,
      labelKo: "AI 과장 표현",
      labelEn: "AI hype phrasing",
      suggestionKo: "구체적 태스크와 한계(할 수 있는 것/없는 것) 로 바꾸세요.",
      suggestionEn: "Replace with concrete tasks and limits (what it can/can't do).",
    },
  ],

  promptFragments: {
    ko: `[세부 장르: AI]
- 실제 입력/출력 예시를 한 씬 이상 포함.
- 한계(실패 사례/주의사항) 를 최소 1회 언급.
- 추상적 "AI 가 바꾼다" 대신 구체 과업(요약/번역/이미지 생성 등) 명시.`,
    en: `[Subgenre: AI]
- Include at least one real input/output example.
- Mention at least one limitation or caveat.
- Replace abstract "AI changes everything" with concrete tasks (summarize/translate/generate image).`,
  },

  progressLabelKo: "AI 기능과 한계를 구체화하는 중…",
  progressLabelEn: "Grounding AI features and limits…",
});

/* =========================================================================
 * 힐링 · 감성 계열
 * ========================================================================= */

export const subgenreMeditation = defineBlock({
  id: "subgenre.meditation",
  layer: "subgenre",
  labelKo: "명상",
  labelEn: "Meditation",
  signals: ["healing", "breath"],

  constraints: {
    shotLengthAvgSec: {
      min: 6.0,
      max: 15.0,
      severity: SEVERITY.HIGH,
      labelKo: "명상 평균 샷 길이",
      labelEn: "Meditation avg shot length",
    },
  },

  promptFragments: {
    ko: `[세부 장르: 명상]
- 호흡 인디케이터(들숨/날숨 시각화 또는 음성) 가 최소 1회 명시.
- 자연 요소(빛/바람/물) 를 연속적으로 배치.
- 빠른 컷과 급격한 밝기 변화 금지.`,
    en: `[Subgenre: Meditation]
- Include at least one breathing indicator (inhale/exhale visual or voice).
- Keep natural elements (light/wind/water) continuous.
- No fast cuts or abrupt brightness shifts.`,
  },

  progressLabelKo: "호흡과 자연 요소를 맞추는 중…",
  progressLabelEn: "Aligning breath and nature…",
});

/* =========================================================================
 * 세부 장르 → 블록 매핑
 * ========================================================================= */
export const SUBGENRE_BLOCKS = Object.freeze({
  // 키즈
  "동요":               subgenreNurseryRhyme,
  "율동":               subgenreMovementSong,
  "유아 교육":          subgenreKidsEdu,
  "키즈 놀이":          subgenreKidsPlay,

  // 학습
  "튜토리얼":           subgenreTutorial,
  "언어 학습":          subgenreLanguageLearning,
  "코딩":               subgenreCoding,

  // 음식
  "먹방":               subgenreMukbang,
  "레시피":             subgenreRecipe,

  // 일상
  "브이로그":           subgenreVlog,
  "일상 기록":          subgenreVlog,   // 동일 처리
  "루틴":               subgenreRoutine,

  // 엔터
  "챌린지":             subgenreChallenge,
  "리액션":             subgenreReaction,

  // 음악
  "ASMR":               subgenreASMR,
  "커버":               subgenreCover,

  // 스포츠
  "홈트레이닝":         subgenreHomeTraining,

  // 리뷰
  "제품":               subgenreProductReview,

  // 시사/다큐
  "시사":               subgenreCurrentAffairs,
  "인터뷰":             subgenreInterview,
  "다큐형 콘텐츠":      subgenreDocumentary,

  // 비즈니스/테크
  "마케팅":             subgenreMarketing,
  "AI":                 subgenreAI,

  // 힐링
  "명상":               subgenreMeditation,
});

/**
 * purposeTag 문자열로 해당 세부 장르 블록을 찾는다.
 * 없으면 null — 상위 genre 블록만으로 진행.
 */
export function resolveSubgenreBlock(purposeTag) {
  if (!purposeTag || typeof purposeTag !== "string") return null;
  return SUBGENRE_BLOCKS[purposeTag.trim()] || null;
}

export default { SUBGENRE_BLOCKS, resolveSubgenreBlock };
