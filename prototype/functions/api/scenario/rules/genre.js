/**
 * scenario/rules/genre.js
 *
 * Phase 0 Step 3 — 18개 purposeCategory 별 장르 블록.
 * 우선순위 30 (format 보다 낮고 subgenre/purpose/audience 보다 낮음).
 *
 * 기존 RULE_LIBRARY.purposeCategory + ARCHETYPE_LIBRARY 를 선언적 블록으로 이식.
 * 목적: "장르만 정해지면 자동으로 상위 클래스 비트/장소/배경/금칙어가 적용" 되도록 함.
 *
 * 각 블록은 다음을 제공:
 *   - signals: 하류 규칙(format/subgenre/purpose)에서 탐지용
 *   - promptFragments: 시스템 프롬프트에 붙일 자연어 지시
 *   - forbiddenTokens: 장르별 상투구 금지
 *   - constraints: 반복 수 등 수치 제약 (필요한 경우)
 *   - progressLabelKo/En: 진행 UI 가 "영유아 학습용으로 최적화 중…" 처럼 표시
 *   - stage: 장소/배경/서브로케이션/배우 라벨 (구 ARCHETYPE_LIBRARY 대체)
 */

import { defineBlock, SEVERITY } from "../schema.js";

/** 공통 헬퍼 — stage 필드 구성 */
function stage(opts) {
  return {
    roles: opts.roles,
    placeKo: opts.placeKo,
    placeEn: opts.placeEn,
    backgroundKo: opts.backgroundKo,
    backgroundEn: opts.backgroundEn,
    backgroundStyleKo: opts.backgroundStyleKo,
    backgroundStyleEn: opts.backgroundStyleEn,
    sublocationsKo: opts.sublocationsKo,
    sublocationsEn: opts.sublocationsEn,
    category: opts.category,
    actorsKo: opts.actorsKo,
    actorsEn: opts.actorsEn,
  };
}

/* =========================================================================
 * 1) 키즈 · 영유아
 * ========================================================================= */
export const genreKids = defineBlock({
  id: "genre.kids",
  layer: "genre",
  labelKo: "키즈 · 영유아",
  labelEn: "Kids",

  signals: ["kid", "simple_language", "repeat", "play"],

  constraints: {
    repetitionMin: {
      min: 2,
      severity: SEVERITY.HIGH,
      labelKo: "핵심 표현/후렴 반복 횟수",
      labelEn: "Core phrase repetition count",
    },
    narrationMaxChars: {
      max: 30,
      severity: SEVERITY.HIGH,
      labelKo: "나레이션/대사 1문장 최대 글자",
      labelEn: "Max chars per narration line",
    },
    paletteColorsMax: {
      max: 6,
      severity: SEVERITY.MEDIUM,
      labelKo: "주요 색상 상한",
      labelEn: "Max palette colors",
    },
  },

  forbiddenTokens: [
    {
      pattern: /(보컬|연주자|관객석|공연장|무대 조명|스포트라이트|밴드)/,
      severity: SEVERITY.CRITICAL,
      labelKo: "어린이 눈높이에 맞지 않는 공연장 용어",
      labelEn: "Concert/performer jargon unsuitable for young kids",
      suggestionKo: "친구/아이/선생님/놀이방 등 아이 세계 용어로 바꿔 주세요.",
      suggestionEn: "Replace with kid-world vocabulary (friend, child, teacher, playroom).",
    },
    {
      pattern: /(긴장감|공포|잔혹|폭력|어두운 그림자)/,
      severity: SEVERITY.CRITICAL,
      labelKo: "아동 부적합 표현",
      labelEn: "Non-kid-safe expressions",
    },
  ],

  promptFragments: {
    ko: `[장르: 키즈 · 영유아]
- 문장은 짧고 직관적으로. 한 씬에 새로운 개념은 1개까지.
- 행동이 바로 보이는 장면으로 구성. 추상 설명 금지.
- 핵심 표현/후렴/동작을 2회 이상 반복.
- 색감은 맑고 밝게, 캐릭터는 친구/아이 세계 안에서만.`,
    en: `[Genre: Kids]
- Short, intuitive sentences. At most one new concept per scene.
- Show the action directly. No abstract exposition.
- Repeat the core phrase/hook/action at least twice.
- Bright clear palette; characters stay inside the kid-world vocabulary.`,
  },

  progressLabelKo: "영유아 눈높이에 맞춰 조정 중…",
  progressLabelEn: "Tuning for young viewers…",

  stage: stage({
    roles: ["hook", "teach", "practice", "repeat", "recap"],
    placeKo: "밝은 놀이방 교실",
    placeEn: "a bright playroom classroom",
    backgroundKo: "벽에는 커다란 학습 포스터가 걸려 있고 바닥에는 색색의 놀이 매트와 안전한 도형 소품이 놓여 있다.",
    backgroundEn: "Large learning posters hang on the wall and a colorful play mat with safe shape props sits on the floor.",
    backgroundStyleKo: "부드러운 도형, 맑은 색감, 안전한 놀이 소품이 어우러진 밝고 직관적인 키즈 학습 세계.",
    backgroundStyleEn: "A bright kid-friendly learning world with soft shapes, clear colors, and safe playful props.",
    sublocationsKo: ["교실 입구", "알파벳 포스터 벽 앞", "학습 매트 중앙", "햇빛 드는 창가", "리듬 악기 코너"],
    sublocationsEn: ["the room entrance", "the alphabet poster wall", "the learning mat center", "the sunny window side", "the rhythm corner"],
    category: "classroom",
    actorsKo: { group: "친구들이", guide: "안내 역할의 친구가", lead: "한 친구가", closer: "모두가" },
    actorsEn: { group: "the friends", guide: "the guide friend", lead: "one friend", closer: "everyone" },
  }),
});

/* =========================================================================
 * 2) 스토리 · 서사
 * ========================================================================= */
export const genreStory = defineBlock({
  id: "genre.story",
  layer: "genre",
  labelKo: "스토리 · 서사",
  labelEn: "Story / Narrative",
  signals: ["story_arc", "causal"],

  forbiddenTokens: [
    {
      pattern: /(장면 나열|사건들이 있었다|여러 가지 일이 일어났다)/,
      severity: SEVERITY.HIGH,
      labelKo: "서사 없이 단순 나열",
      labelEn: "Flat enumeration without causality",
      suggestionKo: "인물의 선택과 그에 따른 결과가 연결되도록 인과를 명시하세요.",
      suggestionEn: "Make the protagonist's choice and its consequence causally linked.",
    },
  ],

  promptFragments: {
    ko: `[장르: 스토리 · 서사]
- 씬 간 인과 필수. "앞 씬의 선택이 다음 씬을 만든다" 가 읽혀야 한다.
- 인물의 감정 변화를 행동/소품/공간으로 드러낸다(설명 금지).
- 한 씬에 하나의 서사 비트만 할당.`,
    en: `[Genre: Story]
- Causal link between scenes is mandatory: each scene must grow from the previous choice.
- Show emotional change through action/props/space (never exposition).
- One narrative beat per scene.`,
  },

  progressLabelKo: "서사 인과를 짜는 중…",
  progressLabelEn: "Building narrative causality…",

  stage: stage({
    roles: ["setup", "inciting", "turn", "payoff", "close"],
    placeKo: "주인공의 여정이 이어지는 이야기 무대",
    placeEn: "a story world where the protagonist keeps moving forward",
    backgroundKo: "반복해서 보이는 길, 문, 상징 오브젝트가 서사의 방향을 잡아 준다.",
    backgroundEn: "Recurring paths, doors, and symbolic objects keep the story direction clear.",
    backgroundStyleKo: "인물의 감정과 사건 흐름이 읽히는 서사형 배경 세계.",
    backgroundStyleEn: "A narrative world where emotions and story progression remain easy to read.",
    sublocationsKo: ["도입 지점", "갈림길 앞", "전환이 일어나는 길목", "결정적 공간", "엔딩 포인트"],
    sublocationsEn: ["the opening point", "the fork in the path", "the turning corner", "the decisive space", "the ending point"],
    category: "generic",
    actorsKo: { group: "주인공 일행이", guide: "주인공이", lead: "주인공이", closer: "주인공과 동행 인물이" },
    actorsEn: { group: "the story group", guide: "the protagonist", lead: "the protagonist", closer: "the protagonist and companion" },
  }),
});

/* =========================================================================
 * 3) 지식 · 교양
 * ========================================================================= */
export const genreInformative = defineBlock({
  id: "genre.informative",
  layer: "genre",
  labelKo: "지식 · 교양",
  labelEn: "Knowledge / Informative",
  signals: ["informative", "clarity"],

  forbiddenTokens: [
    {
      pattern: /(놀라운 사실|충격적인 진실|아무도 모르는|믿을 수 없는)/,
      severity: SEVERITY.HIGH,
      labelKo: "선정적 훅",
      labelEn: "Sensational hook",
      suggestionKo: "과장 대신 구체적 숫자/출처/사례로 훅을 만드세요.",
      suggestionEn: "Replace sensational hooks with specific numbers, sources, or cases.",
    },
  ],

  promptFragments: {
    ko: `[장르: 지식 · 교양]
- 과장보다 이해를 우선. 한 씬에 핵심 포인트 1개만.
- 주장에는 반드시 근거(숫자/사례/시각적 증거)가 붙어야 한다.
- 내레이션은 결론 선언이 아니라 추론 과정이 보이도록 쓴다.`,
    en: `[Genre: Informative]
- Clarity over hype. One key point per scene.
- Every claim must carry evidence (number/case/visual proof).
- Narration should reveal the reasoning, not just declare the conclusion.`,
  },

  progressLabelKo: "근거를 정리하는 중…",
  progressLabelEn: "Organizing evidence…",

  stage: stage({
    roles: ["hook", "explain", "example", "summary"],
    placeKo: "정돈된 설명 스튜디오",
    placeEn: "an organized explainer studio",
    backgroundKo: "뒤쪽에는 깔끔한 보드와 정보 카드, 정리된 소품 선반이 보인다.",
    backgroundEn: "A clean board, info cards, and organized prop shelves stay visible behind the presenter.",
    backgroundStyleKo: "정보 전달이 잘 읽히는 절제된 스튜디오형 배경.",
    backgroundStyleEn: "A restrained studio background designed for clear information delivery.",
    sublocationsKo: ["오프닝 데스크", "메인 보드 앞", "구체 예시 테이블", "요약 포인트 벽"],
    sublocationsEn: ["the opening desk", "the main board", "the example table", "the summary wall"],
    category: "studio",
    actorsKo: { group: "진행자와 시연 대상이", guide: "진행자가", lead: "진행자가", closer: "진행자가" },
    actorsEn: { group: "the presenter and demo subject", guide: "the presenter", lead: "the presenter", closer: "the presenter" },
  }),
});

/* =========================================================================
 * 4) 교육 · 학습
 * ========================================================================= */
export const genreLearning = defineBlock({
  id: "genre.learning",
  layer: "genre",
  labelKo: "교육 · 학습",
  labelEn: "Learning / Tutorial",
  signals: ["learning", "structured_progression"],

  constraints: {
    repetitionMin: {
      min: 1,
      severity: SEVERITY.HIGH,
      labelKo: "핵심 학습 포인트 반복",
      labelEn: "Key learning repetition",
    },
  },

  promptFragments: {
    ko: `[장르: 교육 · 학습]
- 도입 → 제시 → 따라 하기 → 복습 흐름이 씬 구조에 드러나야 한다.
- 학습 대상(알파벳/단어/동작 등)은 최소 1회 반복.
- 한 씬에 여러 개념 금지. 개념은 항상 순차 제시.`,
    en: `[Genre: Learning]
- Intro → Teach → Practice → Recap flow must be visible in the scene structure.
- The learning subject (letter/word/motion) must be repeated at least once.
- Never bundle multiple concepts into one scene.`,
  },

  progressLabelKo: "학습 흐름을 짜는 중…",
  progressLabelEn: "Structuring the lesson flow…",

  stage: stage({
    roles: ["hook", "teach", "practice", "example", "recap"],
    placeKo: "단계별 학습이 가능한 튜토리얼 스튜디오",
    placeEn: "a tutorial studio built for step-by-step learning",
    backgroundKo: "보드, 학습 카드, 시연용 테이블이 순서대로 배치되어 있다.",
    backgroundEn: "A board, learning cards, and a demo table are arranged in clear sequence.",
    backgroundStyleKo: "단계와 반복이 선명하게 보이는 학습형 설명 공간.",
    backgroundStyleEn: "A learning-oriented setup where steps and repetition are easy to follow.",
    sublocationsKo: ["도입 보드 앞", "핵심 설명 구역", "따라 하기 자리", "예시 시연 테이블", "복습 포인트"],
    sublocationsEn: ["the intro board", "the teaching zone", "the follow-along area", "the demo table", "the recap point"],
    category: "studio",
    actorsKo: { group: "학습 진행자와 참가자가", guide: "학습 진행자가", lead: "진행자가", closer: "진행자와 참가자가" },
    actorsEn: { group: "the learning host and participants", guide: "the learning host", lead: "the host", closer: "the host and participants" },
  }),
});

/* =========================================================================
 * 5) 음식 · 요리
 * ========================================================================= */
export const genreCooking = defineBlock({
  id: "genre.cooking",
  layer: "genre",
  labelKo: "음식 · 요리",
  labelEn: "Food / Cooking",
  signals: ["cooking", "procedural"],

  promptFragments: {
    ko: `[장르: 음식 · 요리]
- 재료 준비 → 조리 → 완성 → (선택) 시식 순서 유지. 순서 섞지 않는다.
- 재료 클로즈업과 조리 동작을 반드시 분리 씬으로 제시.
- 완성 접시는 단독 컷으로 한 번 보여 준다.`,
    en: `[Genre: Food / Cooking]
- Keep the order: ingredient prep → cook → plate → (optional) taste. Never shuffle.
- Show ingredient close-ups and cooking actions as separate scenes.
- The plated result must get its own hero cut.`,
  },

  progressLabelKo: "조리 순서를 맞추는 중…",
  progressLabelEn: "Sequencing the cook…",

  stage: stage({
    roles: ["intro", "prep", "cook", "plate", "taste"],
    placeKo: "따뜻한 오픈 키친 스튜디오",
    placeEn: "a warm open kitchen studio",
    backgroundKo: "도마, 싱크대, 조리도구, 접시가 정돈된 조리대가 이어진다.",
    backgroundEn: "A tidy counter with a cutting board, sink, cooking tools, and plates stays in view.",
    backgroundStyleKo: "재료, 조리 과정, 완성 접시가 선명하게 보이는 생활형 키친 배경.",
    backgroundStyleEn: "A kitchen world where ingredients, cooking steps, and plated results are easy to read.",
    sublocationsKo: ["재료 준비대", "도마와 싱크대 앞", "화구 조리대", "플레이팅 테이블", "시식 자리"],
    sublocationsEn: ["the ingredient counter", "the cutting board and sink", "the stove station", "the plating table", "the tasting spot"],
    category: "home",
    actorsKo: { group: "요리사가", guide: "요리사가", lead: "요리사가", closer: "요리사와 함께 먹는 인물이" },
    actorsEn: { group: "the cook", guide: "the cook", lead: "the cook", closer: "the cook and taster" },
  }),
});

/* =========================================================================
 * 6) 여행 · 관광
 * ========================================================================= */
export const genreTravel = defineBlock({
  id: "genre.travel",
  layer: "genre",
  labelKo: "여행 · 관광",
  labelEn: "Travel",
  signals: ["travel", "route"],

  promptFragments: {
    ko: `[장르: 여행 · 관광]
- 도착 → 이동 → 체험 → 마무리 동선이 이어져야 한다.
- 각 씬은 구체적 위치(명소명/골목/전망점) 를 명시한다. "아름다운 풍경" 같은 추상 표현 금지.
- 현지의 소리/바람/사람이 한 씬 이상 등장해야 한다.`,
    en: `[Genre: Travel]
- Arrive → Move → Experience → Close — the route must feel continuous.
- Each scene must name a specific location (landmark/alley/viewpoint). No abstract "beautiful scenery".
- Local sound/wind/people must appear in at least one scene.`,
  },

  progressLabelKo: "동선을 그리는 중…",
  progressLabelEn: "Charting the route…",

  stage: stage({
    roles: ["hook", "arrive", "explore", "highlight", "close"],
    placeKo: "대표 명소를 잇는 여행 동선",
    placeEn: "a travel route connecting key local spots",
    backgroundKo: "이정표, 골목, 전망, 휴식 포인트가 한 지역 안에서 이어진다.",
    backgroundEn: "Signposts, streets, viewpoints, and rest spots connect within one local area.",
    backgroundStyleKo: "동선과 현장감이 읽히는 여행형 공간 연출.",
    backgroundStyleEn: "A travel setup that makes route and on-site atmosphere easy to feel.",
    sublocationsKo: ["입구 광장", "전망 포인트", "골목길 포인트", "체험 구역", "휴식 벤치"],
    sublocationsEn: ["the entry plaza", "the viewpoint", "the alley point", "the activity zone", "the rest bench"],
    category: "city",
    actorsKo: { group: "진행자와 동행자가", guide: "진행자가", lead: "진행자가", closer: "진행자와 동행자가" },
    actorsEn: { group: "the host and companion", guide: "the host", lead: "the host", closer: "the host and companion" },
  }),
});

/* =========================================================================
 * 7) 라이프 · 일상
 * ========================================================================= */
export const genreLifestyle = defineBlock({
  id: "genre.lifestyle",
  layer: "genre",
  labelKo: "라이프 · 일상",
  labelEn: "Lifestyle",
  signals: ["lifestyle", "slice_of_life"],

  promptFragments: {
    ko: `[장르: 라이프 · 일상]
- 과장된 이벤트보다 일상의 결(습관/순간/감정)을 살린다.
- 한 씬은 "행동 + 사소한 디테일" 로 구성 (예: 창가에서 커피를 따르고 김이 오르는 손).
- 씬 전환은 물리적 이동 또는 시간 경과가 있어야 한다.`,
    en: `[Genre: Lifestyle]
- Preserve daily texture (habit/moment/feeling) over dramatic events.
- Build each scene as "action + small detail" (e.g. pouring coffee by the window, steam on a hand).
- Transitions require either physical movement or time passage.`,
  },

  progressLabelKo: "일상의 결을 살리는 중…",
  progressLabelEn: "Preserving daily texture…",

  stage: stage({
    roles: ["hook", "routine", "moment", "reflect", "close"],
    placeKo: "생활 공간과 동네 동선이 이어지는 일상 무대",
    placeEn: "a daily-life setting that links home space and neighborhood route",
    backgroundKo: "집 안 코너와 동네 길이 같은 생활 리듬 안에서 연결된다.",
    backgroundEn: "Home corners and neighborhood paths connect within one daily rhythm.",
    backgroundStyleKo: "생활 습관과 감정이 자연스럽게 이어지는 일상형 공간.",
    backgroundStyleEn: "A lifestyle world where habits and emotions connect naturally.",
    sublocationsKo: ["현관 앞", "주방 테이블", "창가 자리", "근처 거리", "하루 마무리 코너"],
    sublocationsEn: ["the entryway", "the kitchen table", "the window seat", "the nearby street", "the end-of-day corner"],
    category: "home",
    actorsKo: { group: "등장 인물이", guide: "등장 인물이", lead: "등장 인물이", closer: "등장 인물이" },
    actorsEn: { group: "the subject", guide: "the subject", lead: "the subject", closer: "the subject" },
  }),
});

/* =========================================================================
 * 8) 리뷰 · 추천
 * ========================================================================= */
export const genreReview = defineBlock({
  id: "genre.review",
  layer: "genre",
  labelKo: "리뷰 · 추천",
  labelEn: "Review",
  signals: ["review", "comparison"],

  forbiddenTokens: [
    {
      pattern: /(최고의|역대급|무조건 사세요|강추)/,
      severity: SEVERITY.HIGH,
      labelKo: "과장 리뷰 표현",
      labelEn: "Overhyped review phrases",
      suggestionKo: "구체적 장단점/사용 조건/비교 대상으로 대체하세요.",
      suggestionEn: "Replace with concrete pros/cons/usage context/comparison targets.",
    },
  ],

  promptFragments: {
    ko: `[장르: 리뷰 · 추천]
- 첫인상 → 점검 → 비교 → 결론 순서가 씬에 드러나야 한다.
- 장단점은 각각 최소 1개씩 반드시 제시.
- 결론 씬에는 "어떤 사용자에게 적합한가" 를 명시한다.`,
    en: `[Genre: Review]
- First look → Check → Compare → Verdict must be structurally visible.
- Present at least one pro AND one con.
- The verdict scene must specify "who this is for".`,
  },

  progressLabelKo: "장단점을 정리하는 중…",
  progressLabelEn: "Weighing pros and cons…",

  stage: stage({
    roles: ["hook", "firstlook", "check", "compare", "verdict"],
    placeKo: "제품이 잘 보이는 리뷰 스튜디오",
    placeEn: "a review studio built for product visibility",
    backgroundKo: "언박싱 테이블, 디테일 촬영대, 비교 진열대가 한 세트로 이어진다.",
    backgroundEn: "An unboxing table, detail stand, and comparison shelf connect as one review set.",
    backgroundStyleKo: "대상 비교와 판단 근거가 선명한 리뷰형 스튜디오.",
    backgroundStyleEn: "A review-focused studio where comparison and judgment cues stay explicit.",
    sublocationsKo: ["언박싱 테이블", "디테일 클로즈업 존", "비교 진열대", "최종 평결 스탠드"],
    sublocationsEn: ["the unboxing table", "the detail close-up zone", "the comparison shelf", "the verdict stand"],
    category: "studio",
    actorsKo: { group: "리뷰어가", guide: "리뷰어가", lead: "리뷰어가", closer: "리뷰어가" },
    actorsEn: { group: "the reviewer", guide: "the reviewer", lead: "the reviewer", closer: "the reviewer" },
  }),
});

/* =========================================================================
 * 9) 엔터테인먼트
 * ========================================================================= */
export const genreEntertainment = defineBlock({
  id: "genre.entertainment",
  layer: "genre",
  labelKo: "엔터테인먼트",
  labelEn: "Entertainment",
  signals: ["entertainment", "tempo"],

  promptFragments: {
    ko: `[장르: 엔터테인먼트]
- 템포 변화와 리액션 포인트가 반드시 보여야 한다.
- 한 번 이상의 "반전/예상 이탈" 을 삽입한다.
- 출연자의 감정 반응을 표정·행동으로 명시 (내레이션으로 설명 금지).`,
    en: `[Genre: Entertainment]
- Tempo shifts and visible reaction beats are mandatory.
- Insert at least one twist or expectation-break.
- Show cast reactions through faces and actions (never via narration).`,
  },

  progressLabelKo: "템포와 반응을 조율하는 중…",
  progressLabelEn: "Tuning tempo and reactions…",

  stage: stage({
    roles: ["hook", "setup", "playbeat", "twist", "close"],
    placeKo: "반응과 챌린지가 벌어지는 엔터테인먼트 세트",
    placeEn: "an entertainment set built for reactions and challenge beats",
    backgroundKo: "오프닝 스테이지, 미션 존, 리액션 구역이 한 세트 안에 이어진다.",
    backgroundEn: "An opening stage, mission zone, and reaction area connect inside one set.",
    backgroundStyleKo: "리액션과 템포 변화가 잘 읽히는 퍼포먼스형 세트.",
    backgroundStyleEn: "A performance-oriented set where reactions and tempo shifts read clearly.",
    sublocationsKo: ["오프닝 스테이지", "미션 존", "리액션 포인트", "피날레 구역"],
    sublocationsEn: ["the opening stage", "the mission zone", "the reaction point", "the finale area"],
    category: "stage",
    actorsKo: { group: "출연자들이", guide: "진행자가", lead: "출연자가", closer: "출연자들이" },
    actorsEn: { group: "the cast", guide: "the host", lead: "one cast member", closer: "the cast" },
  }),
});

/* =========================================================================
 * 10) 게임
 * ========================================================================= */
export const genreGame = defineBlock({
  id: "genre.game",
  layer: "genre",
  labelKo: "게임",
  labelEn: "Game",
  signals: ["game", "objective"],

  promptFragments: {
    ko: `[장르: 게임]
- 목표 → 플레이 → 결정적 순간 → 결과 순서를 지킨다.
- 결정적 순간에는 UI/스코어/타이머 등 구체적 근거가 화면에 있어야 한다.
- 승/패/하이라이트 씬은 단독으로 분리한다.`,
    en: `[Genre: Game]
- Goal → Play → Decisive moment → Result — keep this order.
- The decisive moment must show concrete on-screen evidence (UI/score/timer).
- Win/lose/highlight must be separate scenes.`,
  },

  progressLabelKo: "플레이 하이라이트를 구성하는 중…",
  progressLabelEn: "Composing gameplay highlights…",

  stage: stage({
    roles: ["hook", "mission", "playbeat", "highlight", "result"],
    placeKo: "플레이와 전략이 교차하는 게이밍 아레나",
    placeEn: "a gaming arena where play and strategy intersect",
    backgroundKo: "대기 구역, 플레이 필드, 하이라이트 구간이 게임 흐름에 맞춰 이어진다.",
    backgroundEn: "A prep zone, play field, and highlight lane connect along the game flow.",
    backgroundStyleKo: "목표, 액션, 결과가 빠르게 읽히는 게임형 무대.",
    backgroundStyleEn: "A game-oriented stage where goals, action, and results read quickly.",
    sublocationsKo: ["대기 구역", "메인 플레이 필드", "아이템 포인트", "하이라이트 라인", "결승 포인트"],
    sublocationsEn: ["the prep zone", "the main play field", "the item point", "the highlight lane", "the finish point"],
    category: "stage",
    actorsKo: { group: "플레이어들이", guide: "플레이어가", lead: "플레이어가", closer: "플레이어들이" },
    actorsEn: { group: "the players", guide: "the player", lead: "the player", closer: "the players" },
  }),
});

/* =========================================================================
 * 11) 음악 · 사운드
 * ========================================================================= */
export const genreMusic = defineBlock({
  id: "genre.music",
  layer: "genre",
  labelKo: "음악 · 사운드",
  labelEn: "Music / Sound",
  signals: ["music", "rhythm"],

  constraints: {
    repetitionMin: {
      min: 1,
      severity: SEVERITY.MEDIUM,
      labelKo: "훅/후렴 반복",
      labelEn: "Hook/chorus repetition",
    },
  },

  promptFragments: {
    ko: `[장르: 음악 · 사운드]
- 후렴 또는 반복 훅이 씬 구조에 1회 이상 드러나야 한다.
- 박자(비트/리듬) 변화를 장면 전환에 맞춘다.
- 사운드 디자인(음색/공간감) 을 visual 에 명시 — "울림이 있는 홀", "가까운 마이크" 등.`,
    en: `[Genre: Music / Sound]
- The chorus/hook must appear at least once in the scene structure.
- Align scene cuts with beat/rhythm changes.
- Specify sound design in visual (e.g. "reverberant hall", "close mic").`,
  },

  progressLabelKo: "박자와 훅을 맞추는 중…",
  progressLabelEn: "Aligning beat and hook…",

  stage: stage({
    roles: ["hook", "build", "chorus", "variation", "outro"],
    placeKo: "사운드와 리듬이 살아 있는 퍼포먼스 스테이지",
    placeEn: "a performance stage alive with sound and rhythm",
    backgroundKo: "메인 마이크, 리듬 존, 후렴 스폿이 조명 아래 이어진다.",
    backgroundEn: "A lead mic, rhythm zone, and chorus spot connect under the stage lights.",
    backgroundStyleKo: "박자, 후렴, 리듬 변화가 잘 드러나는 음악형 공간.",
    backgroundStyleEn: "A music-oriented space where beat, hook, and rhythm changes stay clear.",
    sublocationsKo: ["인트로 스폿", "리듬 존", "후렴 스테이지", "변주 코너", "엔딩 스폿"],
    sublocationsEn: ["the intro spot", "the rhythm zone", "the chorus stage", "the variation corner", "the ending spot"],
    category: "stage",
    actorsKo: { group: "보컬과 연주자가", guide: "보컬이", lead: "보컬이", closer: "보컬과 연주자가" },
    actorsEn: { group: "the vocalist and players", guide: "the vocalist", lead: "the vocalist", closer: "the vocalist and players" },
  }),
});

/* =========================================================================
 * 12) 스포츠 · 피트니스
 * ========================================================================= */
export const genreFitness = defineBlock({
  id: "genre.fitness",
  layer: "genre",
  labelKo: "스포츠 · 피트니스",
  labelEn: "Sports / Fitness",
  signals: ["fitness", "motion"],

  promptFragments: {
    ko: `[장르: 스포츠 · 피트니스]
- 준비 운동 → 본 동작 → 쿨다운 순서를 반드시 유지.
- 동작 정확도가 보이는 각도(옆/앞) 를 최소 1회 사용한다.
- 호흡·횟수 카운트 등 구체적 큐를 내레이션에 포함.`,
    en: `[Genre: Sports / Fitness]
- Warm-up → main set → cool-down sequence is mandatory.
- Use at least one form-checking angle (side/front view).
- Include concrete cues — breath count, rep count — in narration.`,
  },

  progressLabelKo: "동작 시퀀스를 짜는 중…",
  progressLabelEn: "Sequencing the workout…",

  stage: stage({
    roles: ["hook", "warmup", "main", "main", "cooldown"],
    placeKo: "몸의 움직임이 잘 보이는 피트니스 스튜디오",
    placeEn: "a fitness studio where body motion reads clearly",
    backgroundKo: "매트 존, 메인 동작 구역, 호흡 정리 라인이 선명하게 나뉘어 있다.",
    backgroundEn: "The mat zone, main exercise area, and cooldown line are clearly separated.",
    backgroundStyleKo: "동작 정확도와 리듬이 읽히는 운동형 공간.",
    backgroundStyleEn: "A fitness-oriented space where movement accuracy and rhythm are easy to read.",
    sublocationsKo: ["워밍업 매트 존", "메인 동작 구역", "호흡 정리 라인", "마무리 스트레치 코너"],
    sublocationsEn: ["the warm-up mat zone", "the main exercise area", "the cooldown line", "the stretch corner"],
    category: "stage",
    actorsKo: { group: "코치와 참가자가", guide: "코치가", lead: "코치가", closer: "코치와 참가자가" },
    actorsEn: { group: "the coach and participants", guide: "the coach", lead: "the coach", closer: "the coach and participants" },
  }),
});

/* =========================================================================
 * 13) 취미 · 크리에이티브
 * ========================================================================= */
export const genreCreative = defineBlock({
  id: "genre.creative",
  layer: "genre",
  labelKo: "취미 · 크리에이티브",
  labelEn: "Creative / Craft",
  signals: ["creative", "craft"],

  promptFragments: {
    ko: `[장르: 취미 · 크리에이티브]
- 준비 → 제작 과정 → 디테일 → 완성 공개 순서 유지.
- 손의 움직임이나 도구 사용 장면을 최소 1회 클로즈업.
- 완성물은 별도 씬에서 단독으로 보여 준다.`,
    en: `[Genre: Creative / Craft]
- Prep → process → detail → reveal — keep this order.
- At least one close-up of hand motion or tool use.
- Show the finished piece in its own dedicated scene.`,
  },

  progressLabelKo: "과정과 디테일을 구성하는 중…",
  progressLabelEn: "Structuring process and detail…",

  stage: stage({
    roles: ["hook", "setup", "process", "detail", "reveal"],
    placeKo: "손작업과 결과물이 돋보이는 크리에이티브 작업실",
    placeEn: "a creative workshop where process and outcome both read clearly",
    backgroundKo: "준비 책상, 작업 테이블, 디테일 코너, 전시 벽이 차례로 이어진다.",
    backgroundEn: "A prep desk, work table, detail corner, and reveal wall connect in sequence.",
    backgroundStyleKo: "과정과 완성 결과가 함께 살아나는 창작형 작업 공간.",
    backgroundStyleEn: "A creative workspace where both process and finished results stay visible.",
    sublocationsKo: ["준비 책상", "작업 테이블", "디테일 코너", "완성 전시 벽"],
    sublocationsEn: ["the prep desk", "the work table", "the detail corner", "the reveal wall"],
    category: "studio",
    actorsKo: { group: "창작자가", guide: "창작자가", lead: "창작자가", closer: "창작자가" },
    actorsEn: { group: "the creator", guide: "the creator", lead: "the creator", closer: "the creator" },
  }),
});

/* =========================================================================
 * 14) 비즈니스 · 경제
 * ========================================================================= */
export const genreBusiness = defineBlock({
  id: "genre.business",
  layer: "genre",
  labelKo: "비즈니스 · 경제",
  labelEn: "Business / Economy",
  signals: ["business", "takeaway"],

  promptFragments: {
    ko: `[장르: 비즈니스 · 경제]
- 맥락 → 핵심 포인트 → 사례 → 적용/결론 구조를 유지한다.
- 숫자/지표가 등장하면 구체적 수치로 명시 (예: "매출 18% 증가").
- 마지막 씬에는 "시청자가 바로 할 수 있는 행동" 을 1개 포함.`,
    en: `[Genre: Business / Economy]
- Context → key point → case → apply/conclude structure is required.
- Any figure must be concrete (e.g. "revenue up 18%").
- The last scene must include one actionable takeaway.`,
  },

  progressLabelKo: "핵심 포인트를 정리하는 중…",
  progressLabelEn: "Organizing the takeaway…",

  stage: stage({
    roles: ["hook", "context", "point", "example", "takeaway"],
    placeKo: "핵심 포인트를 정리하는 비즈니스 브리핑룸",
    placeEn: "a business briefing room focused on clear takeaways",
    backgroundKo: "차트 보드, 사례 테이블, 정리 포인트 패널이 안정적으로 이어진다.",
    backgroundEn: "A chart board, case table, and takeaway panel stay connected in a stable layout.",
    backgroundStyleKo: "맥락, 숫자, 결론이 정돈되어 보이는 비즈니스형 스튜디오.",
    backgroundStyleEn: "A business-oriented studio where context, figures, and conclusions stay organized.",
    sublocationsKo: ["브리핑 데스크", "차트 보드 앞", "사례 테이블", "정리 포인트 패널"],
    sublocationsEn: ["the briefing desk", "the chart board", "the case table", "the takeaway panel"],
    category: "studio",
    actorsKo: { group: "진행자와 실무자가", guide: "진행자가", lead: "진행자가", closer: "진행자가" },
    actorsEn: { group: "the host and practitioner", guide: "the host", lead: "the host", closer: "the host" },
  }),
});

/* =========================================================================
 * 15) 테크 · IT
 * ========================================================================= */
export const genreTech = defineBlock({
  id: "genre.tech",
  layer: "genre",
  labelKo: "테크 · IT",
  labelEn: "Tech / IT",
  signals: ["tech", "demo"],

  promptFragments: {
    ko: `[장르: 테크 · IT]
- 문제 제기 → 시연 → 효용 → 정리 구조 유지.
- 시연 씬에는 반드시 실제 화면/기기 조작이 보여야 한다.
- 과장 광고(혁신적/역사적/획기적) 금지 — 구체적 기능으로 대체.`,
    en: `[Genre: Tech / IT]
- Problem → demo → benefit → takeaway structure is required.
- Demo scenes must show actual screens or device interaction.
- No ad-speak ("revolutionary/historic/game-changing") — describe concrete features instead.`,
  },

  forbiddenTokens: [
    {
      pattern: /(혁신적인|역사적인|획기적인|게임체인저|revolutionary)/i,
      severity: SEVERITY.HIGH,
      labelKo: "테크 과장 홍보 표현",
      labelEn: "Tech ad-speak",
      suggestionKo: "구체적 기능 또는 비교 가능한 지표로 대체하세요.",
      suggestionEn: "Replace with a concrete feature or comparable metric.",
    },
  ],

  progressLabelKo: "기능 시연을 구성하는 중…",
  progressLabelEn: "Building the demo flow…",

  stage: stage({
    roles: ["hook", "problem", "demo", "benefit", "takeaway"],
    placeKo: "기기와 화면이 선명한 테크 데모 랩",
    placeEn: "a tech demo lab where devices and screens read clearly",
    backgroundKo: "디바이스 테이블, 메인 디스플레이, 기능 시연 존이 한 흐름으로 연결된다.",
    backgroundEn: "A device table, main display, and feature demo zone connect in one flow.",
    backgroundStyleKo: "기능 설명과 실제 조작이 함께 보이는 테크형 데모 공간.",
    backgroundStyleEn: "A tech demo environment where feature explanation and hands-on action stay visible together.",
    sublocationsKo: ["디바이스 테이블", "메인 디스플레이 앞", "기능 시연 존", "결론 패널"],
    sublocationsEn: ["the device table", "the main display", "the feature demo zone", "the takeaway panel"],
    category: "studio",
    actorsKo: { group: "진행자와 사용자가", guide: "진행자가", lead: "진행자가", closer: "진행자가" },
    actorsEn: { group: "the host and user", guide: "the host", lead: "the host", closer: "the host" },
  }),
});

/* =========================================================================
 * 16) 힐링 · 감성
 * ========================================================================= */
export const genreHealing = defineBlock({
  id: "genre.healing",
  layer: "genre",
  labelKo: "힐링 · 감성",
  labelEn: "Healing / Emotional",
  signals: ["healing", "slow_pace"],

  constraints: {
    shotLengthAvgSec: {
      min: 3.0,
      max: 8.0,
      severity: SEVERITY.MEDIUM,
      labelKo: "힐링 장르 평균 샷 길이",
      labelEn: "Healing avg shot length",
    },
  },

  promptFragments: {
    ko: `[장르: 힐링 · 감성]
- 속도보다 호흡과 정서 정리를 우선. 빠른 컷 전환 금지.
- 자연 요소(빛/바람/물/식물) 를 최소 2씬에 등장시킨다.
- 내레이션은 선언보다 여운을 남기는 톤으로.`,
    en: `[Genre: Healing]
- Prioritize breath and emotional settling over pace. No rapid cuts.
- Feature natural elements (light/wind/water/plant) in at least two scenes.
- Narration should leave space, not declare.`,
  },

  progressLabelKo: "호흡과 여운을 다듬는 중…",
  progressLabelEn: "Tuning breath and afterglow…",

  stage: stage({
    roles: ["settle", "immerse", "breathe", "reflect", "close"],
    placeKo: "호흡과 감정이 가라앉는 조용한 힐링 공간",
    placeEn: "a quiet healing space where breath and emotion settle",
    backgroundKo: "잔잔한 빛, 느린 바람, 단순한 자연 요소가 계속 이어진다.",
    backgroundEn: "Gentle light, slow air, and simple natural elements remain continuous.",
    backgroundStyleKo: "정서 안정과 몰입을 돕는 잔잔한 힐링형 공간.",
    backgroundStyleEn: "A calm healing space built for emotional rest and immersion.",
    sublocationsKo: ["고요한 입구", "햇살 드는 자리", "바람 스치는 길", "마무리 전망 포인트"],
    sublocationsEn: ["the quiet entrance", "the sunlit spot", "the breezy path", "the closing viewpoint"],
    category: "forest",
    actorsKo: { group: "안내자가", guide: "안내자가", lead: "안내자가", closer: "안내자가" },
    actorsEn: { group: "the guide", guide: "the guide", lead: "the guide", closer: "the guide" },
  }),
});

/* =========================================================================
 * 17) 종교 · 신앙
 * ========================================================================= */
export const genreReligion = defineBlock({
  id: "genre.religion",
  layer: "genre",
  labelKo: "종교 · 신앙",
  labelEn: "Religion / Faith",
  signals: ["religion", "reflection"],

  promptFragments: {
    ko: `[장르: 종교 · 신앙]
- 말씀/묵상/기도 흐름을 명확히 분리한다.
- 특정 종파 비방 금지. 보편적 신앙 경험을 우선.
- 씬 전환은 평온한 페이스로, 갑작스런 컷 금지.`,
    en: `[Genre: Religion / Faith]
- Keep scripture / reflection / prayer structurally distinct.
- No denominational disparagement. Favor universal faith experience.
- Transitions stay calm; avoid abrupt cuts.`,
  },

  progressLabelKo: "묵상 흐름을 정리하는 중…",
  progressLabelEn: "Pacing reflection and prayer…",

  stage: stage({
    roles: ["hook", "scripture", "reflect", "prayer", "close"],
    placeKo: "묵상과 기도가 이어지는 평온한 신앙 공간",
    placeEn: "a peaceful faith space for reflection and prayer",
    backgroundKo: "말씀 책상, 조용한 의자, 은은한 빛 포인트가 차분하게 이어진다.",
    backgroundEn: "A scripture desk, quiet chair, and soft light point connect calmly.",
    backgroundStyleKo: "묵상과 인도를 돕는 차분한 신앙형 공간.",
    backgroundStyleEn: "A calm faith-oriented space that supports reflection and guidance.",
    sublocationsKo: ["말씀 테이블", "묵상 의자 곁", "기도 자리", "마무리 빛 포인트"],
    sublocationsEn: ["the scripture table", "the reflection chair", "the prayer spot", "the closing light point"],
    category: "studio",
    actorsKo: { group: "인도자와 참여자가", guide: "인도자가", lead: "인도자가", closer: "인도자가" },
    actorsEn: { group: "the leader and participants", guide: "the leader", lead: "the leader", closer: "the leader" },
  }),
});

/* =========================================================================
 * 18) 사회 · 공감
 * ========================================================================= */
export const genreSocial = defineBlock({
  id: "genre.social",
  layer: "genre",
  labelKo: "사회 · 공감",
  labelEn: "Social / Empathy",
  signals: ["social", "interview"],

  promptFragments: {
    ko: `[장르: 사회 · 공감]
- 맥락 설명 씬과 당사자의 목소리 씬을 분리한다.
- 일반화·단정 금지. 특정 사례의 구체성을 유지한다.
- 인터뷰 컷은 인물의 표정/손/공간을 함께 담는다.`,
    en: `[Genre: Social / Empathy]
- Separate context scenes from first-person voice scenes.
- Avoid generalization. Preserve the specificity of each case.
- Interview cuts must include face, hands, and surrounding space.`,
  },

  progressLabelKo: "당사자의 목소리를 배치하는 중…",
  progressLabelEn: "Placing first-person voices…",

  stage: stage({
    roles: ["hook", "context", "voice", "insight", "close"],
    placeKo: "대화와 공감이 이어지는 인터뷰 공간",
    placeEn: "an interview space built for dialogue and empathy",
    backgroundKo: "대화 자리, 현장 컷 포인트, 정리 좌석이 같은 맥락 안에 이어진다.",
    backgroundEn: "Conversation seats, field cut points, and summary seats connect inside the same context.",
    backgroundStyleKo: "사람의 목소리와 맥락이 선명하게 남는 공감형 공간.",
    backgroundStyleEn: "An empathy-driven space where voice and context remain clear.",
    sublocationsKo: ["오프닝 자리", "맥락 설명 포인트", "이야기 테이블", "정리 좌석"],
    sublocationsEn: ["the opening seat", "the context point", "the conversation table", "the summary seat"],
    category: "studio",
    actorsKo: { group: "진행자와 인터뷰이가", guide: "진행자가", lead: "인터뷰이가", closer: "진행자가" },
    actorsEn: { group: "the host and interviewee", guide: "the host", lead: "the interviewee", closer: "the host" },
  }),
});

/* =========================================================================
 * 카테고리 → 블록 매핑
 * UI 에서 넘어오는 한국어 purposeCategory 이름을 그대로 키로 사용.
 * ========================================================================= */
export const GENRE_BLOCKS = Object.freeze({
  "키즈 · 영유아":  genreKids,
  "스토리 · 서사":  genreStory,
  "지식 · 교양":    genreInformative,
  "교육 · 학습":    genreLearning,
  "음식 · 요리":    genreCooking,
  "여행 · 관광":    genreTravel,
  "라이프 · 일상":  genreLifestyle,
  "리뷰 · 추천":    genreReview,
  "엔터테인먼트":   genreEntertainment,
  "게임":           genreGame,
  "음악 · 사운드":  genreMusic,
  "스포츠 · 피트니스": genreFitness,
  "취미 · 크리에이티브": genreCreative,
  "비즈니스 · 경제": genreBusiness,
  "테크 · IT":      genreTech,
  "힐링 · 감성":    genreHealing,
  "종교 · 신앙":    genreReligion,
  "사회 · 공감":    genreSocial,
});

/**
 * purposeCategory 문자열로 해당 장르 블록을 찾는다.
 * 입력이 비어있거나 알 수 없는 카테고리인 경우 null 반환 → 상위에서 base 만으로 진행.
 */
export function resolveGenreBlock(purposeCategory) {
  if (!purposeCategory || typeof purposeCategory !== "string") return null;
  return GENRE_BLOCKS[purposeCategory.trim()] || null;
}

export default { GENRE_BLOCKS, resolveGenreBlock };
