// Phase 0 Step 8 — 선언적 블록 규칙 기반 프롬프트/검증기 연결
// v2.684: 풀 systemPrompt 를 덧붙이면 CF 30s 리밋 근처에서 타임아웃 났던 문제 수정.
// enforcement-only compact suffix 로 전환, 재시도는 시간 예산에 여유가 있을 때만.
import { buildEnforcementSuffix } from "./scenario/prompt-builder.js";
import { runWithAutoRetry as runSceneValidator } from "./scenario/validator.js";

// 첫 호출 이후 남은 시간이 이 값보다 작으면 validator 재시도를 포기한다.
// requestScenarioChunk 자체가 29s 타임아웃이므로 안전 마진 포함 16s.
const RULE_RETRY_MIN_REMAINING_MS = 16000;
// onRequestPost 시작 시각으로부터의 전체 예산(ms). CF 하드 리밋 30s 보다 짧게 잡는다.
const RULE_RETRY_TOTAL_BUDGET_MS = 26000;

const corsHeaders = (origin) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Origin": origin || "*",
  Vary: "Origin",
});

const durationToScenes = {
  "15": 5,
  "30": 10,
  "45": 11,
  "60": 12,
  "1800": 120,
  "3600": 240,
  "7200": 480,
};

const LONG_TOPIC_CHUNK_THRESHOLD = 2800;
const TOPIC_CHUNK_SIZE = 2200;
const MAX_COMPLETION_RETRIES = 1;
const BASE_RETRY_DELAY_MS = 1500;

const RULE_LIBRARY = {
  purposeCategory: {
    "키즈 · 영유아": {
      signals: ["kid", "simple_language", "repeat"],
      generationRulesKo: ["문장은 짧고 직관적으로 유지", "행동이 바로 보이는 장면으로 구성", "반복과 호응을 적극 사용"],
      generationRulesEn: ["Use short intuitive sentences", "Keep actions visually obvious", "Use repetition and call-and-response"],
      validationRulesKo: ["어린 시청자가 바로 따라 할 수 있는 표현이 포함되어야 한다"],
      validationRulesEn: ["The result must feel immediately followable for very young viewers"],
    },
    "교육 · 학습": {
      signals: ["learning", "structured_progression"],
      generationRulesKo: ["설명보다 학습 단계가 보이도록 구성", "도입-제시-반복-정리 흐름 유지"],
      generationRulesEn: ["Show learning steps instead of generic exposition", "Keep an intro-teach-repeat-recap arc"],
      validationRulesKo: ["학습 대상 제시와 반복/정리 장면이 모두 있어야 한다"],
      validationRulesEn: ["Must include both teaching and reinforcement moments"],
    },
    "지식 · 교양": {
      signals: ["informative", "clarity"],
      generationRulesKo: ["정확하고 명료하게 설명", "과장보다 이해를 우선"],
      generationRulesEn: ["Explain accurately and clearly", "Prioritize comprehension over hype"],
      validationRulesKo: ["불필요한 과장 없이 정보 전달 중심이어야 한다"],
      validationRulesEn: ["Should stay information-first without unnecessary hype"],
    },
    "스토리 · 서사": {
      signals: ["story_arc"],
      generationRulesKo: ["장면 간 인과와 감정 흐름을 유지"],
      generationRulesEn: ["Keep causal and emotional continuity between scenes"],
      validationRulesKo: ["단순 나열이 아니라 서사 전개가 보여야 한다"],
      validationRulesEn: ["Should feel like progression instead of a flat list of scenes"],
    },
  },
  purposeTag: {
    "키즈 놀이": {
      signals: ["play", "participation"],
      generationRulesKo: ["시청자가 몸이나 말로 따라 할 수 있게 구성", "호응과 참여 유도를 포함"],
      generationRulesEn: ["Make the audience able to join by motion or speech", "Include participation prompts"],
      validationRulesKo: ["따라 하기 또는 함께 하기 요소가 최소 1회 이상 필요"],
      validationRulesEn: ["Must contain at least one participatory or follow-along moment"],
    },
    "키즈 학습": {
      signals: ["learning", "repeat"],
      generationRulesKo: ["한 번에 하나씩 제시하고 바로 반복"],
      generationRulesEn: ["Introduce one item at a time and repeat it immediately"],
      validationRulesKo: ["핵심 학습 요소가 반복되어야 한다"],
      validationRulesEn: ["Core learning content must be repeated"],
    },
    "유아 교육": {
      signals: ["learning", "simple_language"],
      generationRulesKo: ["개념 수를 최소화하고 매우 쉽게 설명"],
      generationRulesEn: ["Limit concepts and explain them very simply"],
      validationRulesKo: ["인지 부담이 낮아야 한다"],
      validationRulesEn: ["Cognitive load should stay low"],
    },
    "동요": {
      signals: ["song", "repeat"],
      generationRulesKo: ["리듬감 있는 반복 구절이나 후렴을 포함", "노래하듯 따라 부를 수 있게 작성"],
      generationRulesEn: ["Include a rhythmic repeated phrase or hook", "Make it singable and repeatable"],
      validationRulesKo: ["후렴 또는 반복 구절이 보여야 한다"],
      validationRulesEn: ["A hook or repeated phrase must be visible"],
    },
    "율동": {
      signals: ["song", "play", "movement"],
      generationRulesKo: ["리듬과 몸동작을 함께 제시"],
      generationRulesEn: ["Tie rhythm to body movement"],
      validationRulesKo: ["동작 유도 표현이 있어야 한다"],
      validationRulesEn: ["Should explicitly cue movement"],
    },
    "언어 학습": {
      signals: ["learning", "pronunciation"],
      generationRulesKo: ["발음과 반복을 중심으로 구성"],
      generationRulesEn: ["Center the structure on pronunciation and repetition"],
      validationRulesKo: ["따라 읽기 또는 발화 반복이 포함되어야 한다"],
      validationRulesEn: ["Must include repeated speaking or read-along cues"],
    },
  },
  need: {
    "학습": {
      signals: ["learning", "structured_progression"],
      generationRulesKo: ["학습 대상 제시, 반복, 복습을 포함"],
      generationRulesEn: ["Include teaching, repetition, and recap"],
      validationRulesKo: ["학습 구조가 없으면 실패"],
      validationRulesEn: ["Fail if there is no visible learning structure"],
    },
    "놀이": {
      signals: ["play", "participation"],
      generationRulesKo: ["설명형보다 참여형으로 구성", "함께 말하거나 움직이게 유도"],
      generationRulesEn: ["Bias toward participation over explanation", "Prompt the audience to speak or move along"],
      validationRulesKo: ["놀이 목적이면 참여 요소가 반드시 필요"],
      validationRulesEn: ["Play-oriented outputs must contain participation"],
    },
    "실용 정보": {
      signals: ["informative", "clarity"],
      generationRulesKo: ["군더더기 없이 핵심부터 전달"],
      generationRulesEn: ["Deliver key points directly with minimal fluff"],
      validationRulesKo: ["핵심 정보가 분명해야 한다"],
      validationRulesEn: ["Key information should remain explicit"],
    },
  },
  tone: {
    "유머": {
      signals: ["humor"],
      generationRulesKo: ["귀여운 실수, 상황 개그, 가벼운 반전 중 최소 1개 포함"],
      generationRulesEn: ["Include at least one gentle mistake, gag, or light reversal"],
      validationRulesKo: ["웃음 포인트가 보이지 않으면 실패"],
      validationRulesEn: ["Fail if no humor beat is visible"],
    },
    "차분": {
      signals: ["calm"],
      generationRulesKo: ["과장된 감정 표현을 줄이고 안정적으로 전개"],
      generationRulesEn: ["Reduce exaggerated emotion and keep the delivery calm"],
      validationRulesKo: ["과도한 긴장감 없이 안정적인 톤이어야 한다"],
      validationRulesEn: ["Should feel stable rather than frantic"],
    },
  },
  target: {
    "영유아": {
      signals: ["very_young", "simple_language", "repeat"],
      generationRulesKo: ["문장을 매우 짧게 유지", "개념을 한 번에 하나씩 제시", "반복을 통해 익히게 구성"],
      generationRulesEn: ["Keep sentences very short", "Introduce one concept at a time", "Use repetition for retention"],
      validationRulesKo: ["긴 문장과 복잡한 정보 밀도는 피해야 한다"],
      validationRulesEn: ["Avoid long sentences and dense information"],
    },
  },
};

const PURPOSE_CATEGORY_ARCHETYPE = {
  "키즈 · 영유아": "kids",
  "스토리 · 서사": "story",
  "지식 · 교양": "informative",
  "교육 · 학습": "learning",
  "음식 · 요리": "cooking",
  "여행 · 관광": "travel",
  "라이프 · 일상": "lifestyle",
  "리뷰 · 추천": "review",
  "엔터테인먼트": "entertainment",
  "게임": "game",
  "음악 · 사운드": "music",
  "스포츠 · 피트니스": "fitness",
  "취미 · 크리에이티브": "creative",
  "비즈니스 · 경제": "business",
  "테크 · IT": "tech",
  "힐링 · 감성": "healing",
  "종교 · 신앙": "religion",
  "사회 · 공감": "social",
};

const ARCHETYPE_LIBRARY = {
  kids: {
    key: "kids",
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
    generationRulesKo: ["시청자가 바로 따라 할 수 있는 단순 행동과 짧은 발화를 유지한다."],
    generationRulesEn: ["Keep simple actions and short speech that young viewers can copy immediately."],
  },
  story: {
    key: "story",
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
    generationRulesKo: ["씬마다 인과가 이어져야 하며, 앞 장면의 선택이 다음 장면을 만든다는 느낌을 준다."],
    generationRulesEn: ["Each beat should feel causal so the next scene clearly grows from the prior one."],
  },
  informative: {
    key: "informative",
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
    generationRulesKo: ["과장보다 이해를 우선하고, 장면마다 하나의 핵심 포인트만 밀어 준다."],
    generationRulesEn: ["Prioritize comprehension over hype and push only one key point per beat."],
  },
  learning: {
    key: "learning",
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
    generationRulesKo: ["도입-제시-따라 하기-복습 흐름이 보여야 한다."],
    generationRulesEn: ["An intro-teach-follow-recap arc must stay visible."],
  },
  cooking: {
    key: "cooking",
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
    generationRulesKo: ["재료 준비, 조리, 완성 순서가 뒤엉키지 않게 보여 준다."],
    generationRulesEn: ["Keep the ingredient-prep-cook-finish order unambiguous."],
  },
  travel: {
    key: "travel",
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
    generationRulesKo: ["장소의 이동 동선과 체험 포인트가 자연스럽게 연결되어야 한다."],
    generationRulesEn: ["Keep route movement and experiential highlights naturally connected."],
  },
  lifestyle: {
    key: "lifestyle",
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
    generationRulesKo: ["과장보다 일상의 결을 살리고, 장면 사이 리듬이 부드럽게 이어져야 한다."],
    generationRulesEn: ["Preserve daily texture over exaggeration and keep transitions gentle."],
  },
  review: {
    key: "review",
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
    generationRulesKo: ["인상, 점검, 비교, 결론 순서가 드러나야 한다."],
    generationRulesEn: ["A first-impression, check, comparison, and verdict sequence should be visible."],
  },
  entertainment: {
    key: "entertainment",
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
    generationRulesKo: ["템포 변화와 반응 포인트가 보여야 한다."],
    generationRulesEn: ["Tempo changes and visible reaction beats are required."],
  },
  game: {
    key: "game",
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
    generationRulesKo: ["목표 제시, 플레이, 결과가 씬 흐름에서 분명해야 한다."],
    generationRulesEn: ["Goal, play, and result should be obvious across the beats."],
  },
  music: {
    key: "music",
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
    generationRulesKo: ["후렴 또는 반복 훅이 장면 구조에 드러나야 한다."],
    generationRulesEn: ["A chorus or repeated hook should be visible in the scene structure."],
  },
  fitness: {
    key: "fitness",
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
    generationRulesKo: ["준비 운동과 마무리 정리를 빠뜨리지 않는다."],
    generationRulesEn: ["Do not skip warm-up and cooldown."],
  },
  creative: {
    key: "creative",
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
    generationRulesKo: ["준비, 제작, 디테일, 결과 공개가 이어져야 한다."],
    generationRulesEn: ["Prep, making, detail, and reveal should flow in order."],
  },
  business: {
    key: "business",
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
    generationRulesKo: ["맥락, 핵심 포인트, 적용 예시, 결론이 구조적으로 나뉘어야 한다."],
    generationRulesEn: ["Context, point, application example, and takeaway should be structurally distinct."],
  },
  tech: {
    key: "tech",
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
    generationRulesKo: ["문제 제기, 시연, 효용, 정리가 순서대로 이어져야 한다."],
    generationRulesEn: ["Problem, demo, benefit, and takeaway should follow in order."],
  },
  healing: {
    key: "healing",
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
    generationRulesKo: ["속도보다 호흡과 정서 정리를 우선한다."],
    generationRulesEn: ["Prioritize breath and emotional settling over pace."],
  },
  religion: {
    key: "religion",
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
    generationRulesKo: ["말씀, 묵상, 기도 흐름이 분명해야 한다."],
    generationRulesEn: ["Scripture, reflection, and prayer should be structurally distinct."],
  },
  social: {
    key: "social",
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
    generationRulesKo: ["맥락 설명과 당사자의 목소리가 분리되어 보여야 한다."],
    generationRulesEn: ["Context and first-person voice should remain separate."],
  },
  horror: {
    key: "horror",
    roles: ["setup", "sign", "dread", "reveal", "escape"],
    placeKo: "긴장감이 감도는 폐건물",
    placeEn: "an abandoned building charged with tension",
    backgroundKo: "깜빡이는 조명, 먼지, 닫힌 문, 좁은 통로가 계속 시야에 남는다.",
    backgroundEn: "Flickering lights, dust, closed doors, and tight corridors stay in view.",
    backgroundStyleKo: "정적과 불안이 겹치는 폐쇄형 호러 공간.",
    backgroundStyleEn: "A closed horror space layered with stillness and dread.",
    sublocationsKo: ["삐걱이는 현관", "깜빡이는 복도", "먼지 쌓인 방", "막다른 계단 앞", "탈출 문 앞"],
    sublocationsEn: ["the creaking entry", "the flickering corridor", "the dusty room", "the dead-end stairs", "the exit door"],
    category: "building",
    actorsKo: { group: "주인공 일행이", guide: "주인공이", lead: "주인공이", closer: "주인공 일행이" },
    actorsEn: { group: "the group", guide: "the lead", lead: "the lead", closer: "the group" },
    generationRulesKo: ["정보를 한 번에 다 풀지 말고 징후, 긴장, 드러남 순서로 전개한다."],
    generationRulesEn: ["Do not reveal everything at once; unfold through sign, dread, then reveal."],
  },
  sf: {
    key: "sf",
    roles: ["mission", "discovery", "turn", "solution", "close"],
    placeKo: "미래 탐사 기지",
    placeEn: "a futuristic exploration base",
    backgroundKo: "도킹 베이, 홀로그램 지도, 관측 창, 제어 콘솔이 같은 미래 시스템 안에 연결된다.",
    backgroundEn: "A docking bay, hologram map, observation window, and control console connect inside one future system.",
    backgroundStyleKo: "네온 광원, 반투명 인터페이스, 정교한 기계 구조가 보이는 SF 배경.",
    backgroundStyleEn: "An SF background with neon light, translucent interfaces, and precise mechanical structure.",
    sublocationsKo: ["도킹 베이", "홀로그램 지도 앞", "관측 창가", "제어 콘솔 앞", "출발 포인트"],
    sublocationsEn: ["the docking bay", "the hologram map", "the observation window", "the control console", "the launch point"],
    category: "space",
    actorsKo: { group: "탐사대가", guide: "탐사대장이", lead: "탐사대원이", closer: "탐사대가" },
    actorsEn: { group: "the exploration team", guide: "the commander", lead: "the crew member", closer: "the team" },
    generationRulesKo: ["기술 장치, 미션 목표, 해결 단계가 함께 보이도록 구성한다."],
    generationRulesEn: ["Keep devices, mission goals, and solution steps visible together."],
  },
  generic: {
    key: "generic",
    roles: ["hook", "develop", "reinforce", "close"],
    placeKo: "하나의 일관된 메인 공간",
    placeEn: "one consistent main space",
    backgroundKo: "같은 배경 요소가 씬마다 이어서 보인다.",
    backgroundEn: "The same background elements continue across scenes.",
    backgroundStyleKo: "반복되는 시각 모티프와 안정적인 색감 규칙을 가진 일관된 세계.",
    backgroundStyleEn: "One coherent world with repeating motifs and stable color logic.",
    sublocationsKo: ["메인 전경", "중앙 공간", "옆 공간", "마지막 포인트 공간"],
    sublocationsEn: ["the main foreground", "the center area", "the side area", "the final focal area"],
    category: "generic",
    actorsKo: { group: "등장 인물들이", guide: "등장 인물이", lead: "한 인물이", closer: "모두가" },
    actorsEn: { group: "the cast", guide: "the subject", lead: "one subject", closer: "everyone" },
    generationRulesKo: ["입력 개요에서 드러난 목적과 톤을 씬 구조 안에 직접 반영한다."],
    generationRulesEn: ["Reflect the requested purpose and tone directly in the scene structure."],
  },
};

const durationSceneAnchors = Object.keys(durationToScenes)
  .map((key) => ({
    duration: Number(key),
    scenes: durationToScenes[key],
  }))
  .sort((a, b) => a.duration - b.duration);

export function calculateSceneCountForDuration(rawDuration) {
  const duration = Math.max(1, Math.round(Number(rawDuration) || 0));
  if (!duration) return 7;
  const direct = durationToScenes[String(duration)];
  if (direct) return direct;
  if (!durationSceneAnchors.length) return 7;

  if (duration <= durationSceneAnchors[0].duration) {
    const first = durationSceneAnchors[0];
    return Math.max(1, Math.round(duration * (first.scenes / first.duration)));
  }

  for (let i = 0; i < durationSceneAnchors.length - 1; i++) {
    const start = durationSceneAnchors[i];
    const end = durationSceneAnchors[i + 1];
    if (duration >= start.duration && duration <= end.duration) {
      const ratio = (duration - start.duration) / Math.max(end.duration - start.duration, 1);
      return Math.max(1, Math.round(start.scenes + ((end.scenes - start.scenes) * ratio)));
    }
  }

  const last = durationSceneAnchors[durationSceneAnchors.length - 1];
  return Math.max(1, Math.round(duration * (last.scenes / last.duration)));
}

function isCharacterGenerationDisabled(rawFlag, characters = []) {
  if (rawFlag === null || rawFlag === undefined || rawFlag === "") {
    return !(Array.isArray(characters) && characters.length);
  }
  return !toBool(rawFlag, true);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonError("Invalid JSON body", 400, origin);
  }

  try {
    const episodeTitle = String(body.topic || body.episodeTitle || "").trim();
    const topic = String(body.story || body.topic || "주제 없음").trim();
    const purposeCategory = String(body.purposeCategory || "").trim();
    const purposeTagsArr = Array.isArray(body.purposeTags) ? body.purposeTags.filter(Boolean).map(String) : [];
    const purposeTags = purposeTagsArr.join(", ");
    const target = String(body.target || "").trim();
    const tones = Array.isArray(body.tones) ? body.tones.filter(Boolean).map(String).join(", ") : "";
    const toneText = String(body.tone || "").trim();
    const styles = Array.isArray(body.styles) ? body.styles.filter(Boolean).map(String).join(", ") : "";
    const styleText = String(body.style || "").trim();
    const needs = Array.isArray(body.needs) ? body.needs.filter(Boolean).map(String).join(", ") : "";
    const duration = String(body.duration || "60");
    const manualDirectives = String(body.manualDirectives || body.extraNotes || body.banned || "").trim();
    const aspectRatio = String(body.aspectRatio || "").trim();
    const lang = body.language === "en" ? "en" : "ko";
    const storyBeats = normalizeStoryBeatsInput(body.storyBeats);
    const characters = normalizeCharacters(body.characters || []);
    const characterGenerationDisabled = isCharacterGenerationDisabled(body.charactersEnabled, characters);
    const knowledgeHub = normalizeKnowledgeHubInput(body, { characterGenerationDisabled });
    const activeCharacters = characterGenerationDisabled ? [] : characters;
    const narrationEnabled = toBool(body.narrationEnabled, false);
    const dubbingEnabled = toBool(body.dubbingEnabled, false);
    const sceneCount = calculateSceneCountForDuration(duration);

    let scenes;
    let generationMeta = {
      chunked: false,
      chunkCount: 1,
      sourceLength: topic.length,
      failedChunks: 0,
      partial: false,
      refinedChunks: 0,
      validationFallbackChunks: 0,
    };
    try {
      const generated = await generateScenarioScenes({
        env,
        lang,
        topic,
        episodeTitle,
        story: topic,
        target,
        purposeCategory,
        purposeTags,
        needs,
        toneText,
        tones,
        styleText,
        styles,
        manualDirectives,
        knowledgeHub,
        aspectRatio,
        duration,
        characterGenerationDisabled,
        narrationEnabled,
        dubbingEnabled,
        characters: activeCharacters,
        sceneCount,
        storyBeats,
      });
      scenes = generated.scenes;
      generationMeta = generated.meta;
    } catch (err) {
      if (isCreditExhaustedError(err)) throw err;
      return jsonError(err?.message || "scenario_generation_failed", 500, origin);
    }

    return new Response(JSON.stringify({ scenes, meta: generationMeta }), {
      status: 200,
      headers: corsHeaders(origin),
    });
  } catch (err) {
    if (isCreditExhaustedError(err)) {
      return jsonError("CREDIT_EXHAUSTED", 402, origin);
    }
    return jsonError(err?.message || "unexpected_error", 500, origin);
  }
}

function buildSystemPromptKo(sceneCount, duration, spec = {}) {
  const required = (spec.requiredOutputsKo || []).map((item) => `- ${item}`).join("\n") || "- 개요의 핵심 의도를 직접 드러낸다.";
  const avoid = (spec.avoidOutputsKo || []).map((item) => `- ${item}`).join("\n") || "- 개요와 무관한 범용 장면 나열";
  return `너는 NK_Studio의 프리프로덕션 시나리오 작성 엔진이다.
[씬 작성 핵심 원칙]
1. 모든 씬은 보여주기로만 구성한다. 설명하지 않는다.
- 금지: "슬픈 분위기의 공간"
- 허용: "빈 식탁 위에 식은 커피 한 잔, 김이 사라진 상태"
2. 각 씬은 반드시 관객 반응 목표 1개를 가진다.
- 금지: "제품을 소개한다", "정보를 전달한다"
- 허용: "관객이 '저게 뭐지?' 하고 시선을 멈춘다"
- 허용: "관객이 '나도 저런 적 있는데' 하고 공감한다"
3. visual에는 카메라에 실제로 찍히는 것만 쓴다.
- 반드시 포함: 구체적 장소, 프레임 안에 보이는 사물, 인물의 물리적 행동, 카메라 앵글/움직임
- 절대 금지 표현: "~한 느낌", "~적인 분위기", "아름다운", "감동적인", "화려한", "따뜻한 톤", "세련된", "역동적인", "인상적인", "드라마틱한", "감성적인", "몽환적인"
4. 씬 간 연결 규칙:
- 각 씬의 visual 첫 문장은 이전 씬의 마지막 상태와 연결되어야 한다.
- Scene 2의 시작은 Scene 1의 끝에서 자연스럽게 이어지는 화면이어야 한다.
- 점프컷이 필요하면 시간/장소 전환을 명시적으로 드러낸다. 예: "3시간 후, 같은 장소", "컷 전환: 실내→야외"
- 비트(scene) 경계 룰: 한 씬은 "한 행동·감정 단위" 이다. 같은 액션/감정 비트가 연속이면
  공간이 미세하게 변해도(예: "우주선 외부 → 에어록 내부 진입", "궁전 복도 → 침실로 들어감")
  반드시 한 씬으로 묶어라. Pass 2 가 그 씬을 여러 컷으로 분해해 sub-location 차이를 표현한다.
  새 씬은 (a) 명백한 시간 점프, (b) 무관한 새 액션/감정 비트, (c) 다른 캐릭터 시퀀스로 전환할 때만.
- sceneLocation 작성: 그 비트의 broad / 우선 location 을 적는다. 비트 안에 sub-location 이
  여럿이면 둘 다 포함하거나 ("우주선 (외부+에어록)") 우선 sub-location 을 적는다.
5. estSec과 내용 밀도를 맞춘다.
- 2~3초 씬: 행동 1개 또는 반응 1개만
- 4~5초 씬: 행동 1개 + 환경 디테일 1개
- 6초 씬(상한): 짧은 동작 시퀀스 또는 대사 1마디 + 반응
- 절대 금지: 7초 이상의 씬. 영상 생성 모델(Runway/Kling/Veo 등)이 안정적으로 만들 수 있는 단일 샷 한계가 5~6초이며, 길어지면 시각적 재미도 떨어진다. 더 긴 흐름이 필요하면 반드시 씬을 쪼개라.
반드시 JSON만 반환한다.
응답 형식: {"scenes":[...]}.
각 scene에는 id, estSec, sceneIntent, sceneLocation, visual은 항상 포함한다.
총 scene 개수는 ${sceneCount}개로 만들고 총 길이는 ${duration}초 목표에 가깝게 분배한다.
개요 입력값은 참고 정보가 아니라 반드시 지켜야 하는 생성 계약이다.
장르, 세부 장르, 시청 타겟, 시청 목적, 톤, 스타일, 브랜드 규칙이 모두 결과 구조에 직접 반영되어야 한다.
특히 시청 목적과 세부 장르가 전개 구조를 실제로 바꿔야 하며, generic한 장면 나열은 금지한다.
브랜드 톤&매너는 모든 영상에서 유지해야 하는 고정 화법이다.
개요 톤은 이번 영상에서만 적용되는 가변 정서/말투 조절값이다.
개요 톤은 narration, dialogue, 상황 전개의 분위기만 조절하고 시각 스타일 자체를 바꾸지 않는다.
스타일은 visual의 룩, 질감, 조명, 색감에만 적용하고 줄거리나 대사 톤을 바꾸지 않는다.
브랜드 톤&매너와 개요 톤이 함께 있으면 브랜드 톤&매너를 기본 화법으로 유지하고, 개요 톤은 이번 영상의 분위기와 감정 강도에만 반영한다.
충돌 시 우선순위는 추가 지시사항, 브랜드 규칙, 금지 표현, 브랜드 톤&매너, 개요 톤 순서다.
사용자 추가 지시사항과 브랜드 규칙, 금지 표현은 반드시 우선 적용한다.
sceneIntent는 이 씬을 본 관객이 느끼거나 행동하는 구체적 반응으로 쓴다.
- 금지: "제품의 장점을 보여준다", "감정을 전달한다", "브랜드를 인지시킨다"
- 허용: "관객이 화면 속 물체에 시선을 고정한다", "관객이 '어떻게 되는 거지?' 하고 다음 장면을 기대한다", "관객이 주인공의 손떨림을 보고 긴장감을 느낀다"
visual 작성법:
- 한 문단, 3~5문장으로 쓴다.
- 문장 1: 장소와 프레임 범위
- 문장 2: 프레임 안에 보이는 사물/인물 배치
- 문장 3: 이 씬에서 일어나는 물리적 행동
- 문장 4: 카메라
- 문장 5(선택): 조명/시간대
- 검증: 이 visual을 읽고 촬영감독이 바로 카메라를 세팅할 수 있어야 한다. 불가능하면 다시 쓴다.
명시적인 장소 전환이 없는 한 모든 씬은 같은 기본 배경/장소를 유지해야 한다.
다음 결과 조건을 반드시 만족한다:
${required}
다음 실패 패턴을 피한다:
${avoid}
[생성 후 자체 검증 - 모든 씬에 적용]
아래 항목 중 하나라도 실패하면 해당 씬을 다시 작성한다.
□ visual을 읽고 촬영감독이 즉시 카메라를 세팅할 수 있는가?
□ sceneIntent가 관객의 구체적 반응으로 작성되었는가?
□ 금지 표현(~한 느낌, ~적인 분위기, 아름다운, 감동적인 등)이 없는가?
□ 이전 씬과 시각적으로 연결되는가? (첫 씬 제외)
□ estSec 길이에 맞는 내용 밀도인가? (3초 씬에 행동 3개 금지)
□ 이 씬을 빼면 전체 흐름에 구멍이 생기는가? 안 생기면 삭제한다.

[허브 데이터 적용 규칙]
- 브랜드 규칙·금지 표현·브랜드 톤&매너는 모든 씬에 강제 적용한다.
- IP 세계관은 이 IP가 속한 배경 지식이다. 에피소드의 실제 장소·배경이 아니다.
- 에피소드 이야기(Story)가 씬의 장소·배경·소품을 결정한다. 이야기에 "들판"이 나오면 씬은 들판이다. 세계관 설명을 장소로 삽입하지 않는다.

[JSON 출력 규칙 - 반드시 준수]
- 반드시 유효한 JSON만 출력한다. JSON 형식이 깨지면 절대 안 된다.
- 마크다운(\`\`\`, \*\*), 설명, 주석, 백틱을 절대 포함하지 않는다.
- 응답의 첫 글자는 { 이고 마지막 글자는 } 여야 한다.
- 정확한 형식: {"scenes":[...]}
- 다른 문자, 설명, 마크다운이 조금이라도 있으면 출력하지 않는다.`;
}

function buildSystemPromptEn(sceneCount, duration, spec = {}) {
  const required = (spec.requiredOutputsEn || []).map((item) => `- ${item}`).join("\n") || "- Make the overview intent explicit in the scene structure.";
  const avoid = (spec.avoidOutputsEn || []).map((item) => `- ${item}`).join("\n") || "- Generic scenes that only loosely mention the topic";
  return `You are NK_Studio's pre-production scenario engine.
[Core Scene Writing Principles]
1. Build every scene through visible evidence only. Do not explain.
- Forbidden: "a sad atmosphere"
- Allowed: "a cold cup of coffee sits on an empty table, no steam left"
2. Every scene must have exactly one audience reaction goal.
- Forbidden: "introduce the product", "deliver information"
- Allowed: "the viewer stops and thinks 'what is that?'"
- Allowed: "the viewer thinks 'that happened to me too'"
3. Write only what the camera can literally capture in visual.
- Must include: concrete place, visible objects, physical action, camera angle/movement
- Forbidden phrases: "feels like", "atmospheric", "beautiful", "touching", "flashy", "warm tone", "stylish", "dynamic", "impressive", "dramatic", "emotional", "dreamlike"
4. Scene linkage rules:
- The first sentence of each visual should connect to the ending state of the previous scene.
- Scene 2 should begin from where Scene 1 visually ends.
- If a jump cut is needed, mark the time/place change explicitly. Example: "3 hours later, same place", "Cut transition: indoors to outdoors"
- Beat boundary rule: a scene = one action/emotional beat. If consecutive moments share the
  same beat, keep them in ONE scene even when the sub-location shifts (e.g., "spaceship exterior →
  airlock interior on entry", "palace corridor → bedroom"). Pass 2 will decompose that scene into
  shots that express the sub-location difference. Start a NEW scene only on (a) explicit time
  jump, (b) unrelated new action/emotional beat, or (c) switch to a different character sequence.
- Writing sceneLocation: put the broad / primary location of the beat. If the beat covers multiple
  sub-locations, either include both ("Spaceship (exterior + airlock)") or pick the primary one.
5. Match estSec to content density.
- 2-3 seconds: one action or one reaction only
- 4-5 seconds: one action plus one environmental detail
- 6 seconds (hard cap): a short motion sequence or one spoken line plus a reaction
- Never exceed 6 seconds for a single scene. Current AI video models (Runway/Kling/Veo etc.) cannot reliably produce a stable shot longer than 5-6 seconds, and longer takes lose visual interest. If you need a longer flow, split it into multiple scenes.
Return JSON only.
Output format: {"scenes":[...]}.
Each scene must include id, estSec, sceneIntent, sceneLocation, and visual.
Produce exactly ${sceneCount} scenes and distribute timing close to ${duration}s.
The overview inputs are a binding generation contract, not optional references.
Genre, subgenre, target audience, viewing purpose, tone, style, and brand rules must directly shape the scenario structure.
Viewing purpose and subgenre must materially change how scenes unfold. Generic scene lists are not allowed.
Brand tone and manner is the fixed brand voice that must persist across every video.
Overview tone is the variable tone for this specific video only.
Use overview tone only for narration, dialogue, and dramatic mood.
Use style only for visual look, texture, lighting, and color. Do not let style rewrite plot or spoken tone.
If both are present, keep the brand tone and manner as the base speaking style, and use the overview tone only to adjust this video's mood and emotional intensity.
Resolve conflicts in this order: manual directives, brand rules, banned expressions, brand tone and manner, then overview tone.
Treat user directives, brand rules, and banned expressions as mandatory constraints.
sceneIntent must describe the concrete audience reaction this scene should trigger.
- Forbidden: "show the product's strengths", "deliver emotion", "build brand awareness"
- Allowed: "the viewer locks onto the object on screen", "the viewer expects the next scene", "the viewer feels tension from the trembling hand"
visual writing method:
- Write one paragraph with 3 to 5 sentences.
- Sentence 1: place and framing range
- Sentence 2: visible placement of people/objects
- Sentence 3: physical action happening in the scene
- Sentence 4: camera direction
- Sentence 5 optional: lighting or time of day
- Test: a cinematographer should be able to set the camera immediately after reading it.
Keep the same base setting across scenes unless a location transition is explicitly shown.
The output must satisfy:
${required}
Avoid these failure patterns:
${avoid}
[Self-Check After Generation - Apply To Every Scene]
Rewrite the scene if any check fails.
□ Can a cinematographer set the camera immediately from the visual?
□ Is sceneIntent written as a concrete audience reaction?
□ Are forbidden phrases absent?
□ Does it visually connect to the previous scene? (except scene 1)
□ Does content density fit estSec?
□ If this scene is removed, does the full flow break? If not, remove it.
No markdown, no extra explanation.`;
}

function buildGenreProgressionGuide(input = {}) {
  const joined = [
    input.purposeCategory,
    input.purposeTags,
    input.needs,
    input.topic,
    input.story,
  ].filter(Boolean).join(" ");
  const isKo = (input.lang || "ko") !== "en";
  const matches = {
    ad: /광고|(^|[^a-z])ad([^a-z]|$)|advert/i.test(joined),
    news: /뉴스|news/i.test(joined),
    documentary: /다큐|다큐멘터리|documentary|docu/i.test(joined),
    drama: /드라마|영화|극영화|시네마|drama|film|movie/i.test(joined),
  };
  if (!Object.values(matches).some(Boolean)) return "";

  const blocks = [isKo ? "[장르별 씬 전개 규칙]" : "[Genre-Specific Scene Progression Rules]"];
  if (matches.ad) {
    blocks.push(isKo
      ? `장르가 "광고"인 경우:
- 한 씬은 절대 6초 초과 금지(영상 생성 모델 한계). 30초 광고는 9~12씬으로 쪼갠다.
- 전체 5단계: Attention(2-3초, 1~2씬) -> Interest(5-6초, 2씬) -> Desire(8-10초, 3~4씬) -> Climax(3-5초, 1~2씬) -> Action(4-6초, 타이틀카드+CTA 1~2씬)
- 첫 씬은 반드시 시각적 충격 또는 의외성으로 시작
- Climax 씬에는 감정 정점 또는 결정적 결과 샷이 반드시 들어간다 (변화 전/후 대비, 표정 클로즈업, 결과물 리빌 등)
- 마지막은 타이틀 카드(브랜드/슬로건 노출 1씬) + CTA 1씬으로 종결. CTA 는 단 하나의 행동만 요구.`
      : `If the genre is "advertising":
- No scene may exceed 6 seconds (AI video model limit). A 30s ad must be broken into 9-12 scenes.
- Use 5 stages overall: Attention (2-3s, 1-2 scenes) -> Interest (5-6s, 2 scenes) -> Desire (8-10s, 3-4 scenes) -> Climax (3-5s, 1-2 scenes) -> Action (4-6s, title card + CTA, 1-2 scenes)
- The first scene must begin with visual surprise or unexpected contrast
- The Climax scene(s) must contain an emotional peak or a decisive payoff shot (before/after contrast, facial close-up, product reveal, etc.)
- End with a title card scene (brand/slogan reveal) + a CTA scene. The CTA requests exactly one action.`);
  }
  if (matches.news) {
    blocks.push(isKo
      ? `장르가 "뉴스"인 경우:
- 전체 5단계: 핵심팩트(3-5초) -> 배경설명(5-7초) -> 현장(5-7초) -> 전문가/반응(5-7초) -> 정리(3-5초)
- 감정 표현 최소화, 사실과 수치 중심
- 모든 씬에 정보 1개씩 배치`
      : `If the genre is "news":
- Use 5 stages overall: Key fact (3-5s) -> Background (5-7s) -> On-site view (5-7s) -> Expert/reaction (5-7s) -> Wrap-up (3-5s)
- Minimize emotion and prioritize facts and numbers
- Place one information unit in every scene`);
  }
  if (matches.documentary) {
    blocks.push(isKo
      ? `장르가 "다큐멘터리"인 경우:
- 전체 5단계: 관찰(3-5초) -> 맥락(5-7초) -> 깊이(7-10초) -> 전환점(5-7초) -> 여운(3-5초)
- 관찰 -> 이해 -> 감정 순서 유지
- 현실 소재 기반, 연출 티가 나지 않게`
      : `If the genre is "documentary":
- Use 5 stages overall: Observation (3-5s) -> Context (5-7s) -> Depth (7-10s) -> Turning point (5-7s) -> Aftertaste (3-5s)
- Keep the order observation -> understanding -> emotion
- Stay grounded in real-world material without obvious staging`);
  }
  if (matches.drama) {
    blocks.push(isKo
      ? `장르가 "드라마/영화"인 경우:
- 전체 5단계: 일상(3-5초) -> 사건(3-5초) -> 갈등심화(5-7초) -> 선택(3-5초) -> 변화(3-5초)
- 캐릭터의 구체적 행동으로 감정 표현
- 대사는 최소화, 행동과 시선으로 이야기 전달`
      : `If the genre is "drama/film":
- Use 5 stages overall: Everyday state (3-5s) -> Incident (3-5s) -> Conflict deepens (5-7s) -> Choice (3-5s) -> Change (3-5s)
- Show emotion through concrete character action
- Minimize dialogue and let action and gaze carry the story`);
  }
  blocks.push(isKo
    ? "위 단계는 가이드이며, 목표 길이에 맞춰 씬 수와 각 단계 배분을 조절한다."
    : "These stages are guides. Adjust scene count and beat allocation to the target duration.");
  return blocks.join("\n");
}

function buildUserPrompt(input) {
  const episodeTitle = String(input.episodeTitle || input.topic || "").trim();
  const storyText = String(input.story || input.topic || "").trim();
  const chunkGuide = input.chunkGuide ? `\n${input.chunkGuide}` : "";
  const modeInstruction = buildModePrompt(input);
  const specText = formatScenarioSpecForPrompt(input.spec);
  const blueprintText = formatBlueprintForPrompt(input.spec);
  const genreGuide = buildGenreProgressionGuide(input);
  const beatsBlock = formatStoryBeatsForPrompt(input.storyBeats, input.lang);
  const characterModeInstruction = input.characterGenerationDisabled
    ? (input.lang === "en"
      ? "Character mode: disabled. Do not create characters, people, mascots, named speakers, or dialogue participants. Build scenes around environment, objects, motion, and narrator-only speech when voice is required."
      : "캐릭터 모드: 비활성화. 캐릭터, 사람, 마스코트, 이름 있는 화자, 대화 참여자를 새로 만들지 말고 환경, 사물, 움직임 중심으로 구성한다. 음성이 필요하면 내레이터만 사용한다.")
    : "";
  if (input.lang === "en") {
    return `Topic: ${episodeTitle || "(not provided)"}
Story: ${storyText || "(not provided)"}
Audience: ${input.target || "(not provided)"}
Purpose category: ${input.purposeCategory || "(not provided)"}
Purpose tags: ${input.purposeTags || "(none)"}
Viewing purpose: ${input.needs || "(none)"}
Overview tone freeform: ${input.toneText || "(none)"}
Overview tone tags: ${input.tones || "(none)"}
Style freeform: ${input.styleText || "(none)"}
Style tags: ${input.styles || "(none)"}
Manual directives: ${input.manualDirectives || "(none)"}
Brand tone & manner: ${input.knowledgeHub.brandVoice || "(none)"}
Brand story: ${input.knowledgeHub.brandStory || "(none)"}
Brand character: ${input.knowledgeHub.brandCharacter || "(none)"}
IP world setting (background lore only, not the episode location): ${input.knowledgeHub.worldSetting || "(none)"}
Brand rules: ${input.knowledgeHub.brandRules.length ? input.knowledgeHub.brandRules.join(", ") : "(none)"}
Banned expressions: ${input.knowledgeHub.bannedExpressions.length ? input.knowledgeHub.bannedExpressions.join(", ") : "(none)"}
Reference contents: ${input.knowledgeHub.referenceContents.length ? input.knowledgeHub.referenceContents.join(", ") : "(none)"}
Past success cases: ${input.knowledgeHub.successCases.length ? input.knowledgeHub.successCases.join(", ") : "(none)"}
Aspect ratio: ${input.aspectRatio || "(not provided)"}
Duration target: ${input.duration}s
${characterModeInstruction}
${beatsBlock}Scenario spec:
${specText}
Scene blueprint:
${blueprintText}
${chunkGuide}
${genreGuide ? `${genreGuide}\n` : ""}Formatting intent example:
- SceneIntent: "The viewer stops and focuses on the object at the center of the frame."
- SceneLocation: "the alphabet poster wall"
- Visual: "The alphabet poster wall, a medium-wide frame holding the presenter and the cards together. The presenter stands on the left and the letter cards line up on the right. The presenter lifts the A card and points to it with the other hand. Camera: medium shot, eye-level angle, slow dolly-in, centered framing."
- Narration: "The boy sat by the well and looked down."
- Dialogue: [{"speaker":"@boy","line":"It is deeper than I thought."}]
${modeInstruction}`;
  }

  const referenceSection = input.knowledgeHub.referenceContents.length
    ? `\n참조 콘텐츠: ${input.knowledgeHub.referenceContents.join(", ")}`
    : "";
  const successSection = input.knowledgeHub.successCases.length
    ? `\n과거 성공 패턴: ${input.knowledgeHub.successCases.join(", ")}`
    : "";

  return `주제: ${episodeTitle || "(미입력)"}
이야기: ${storyText || "(없음)"}
시청 타겟: ${input.target || "(미입력)"}
장르: ${input.purposeCategory || "(미입력)"}
장르 태그: ${input.purposeTags || "(없음)"}
시청 목적: ${input.needs || "(없음)"}
개요 톤(자유입력): ${input.toneText || "(없음)"}
개요 톤 태그: ${input.tones || "(없음)"}
스타일(자유입력): ${input.styleText || "(없음)"}
스타일 태그: ${input.styles || "(없음)"}
수동 추가 지시사항: ${input.manualDirectives || "(없음)"}
브랜드 톤&매너(고정 화법): ${input.knowledgeHub.brandVoice || "(없음)"}
브랜드 스토리: ${input.knowledgeHub.brandStory || "(없음)"}
대표 캐릭터/주체: ${input.knowledgeHub.brandCharacter || "(없음)"}
IP 세계관(참고 배경 지식, 에피소드 장소 아님): ${input.knowledgeHub.worldSetting || "(없음)"}
브랜드 규칙: ${input.knowledgeHub.brandRules.length ? input.knowledgeHub.brandRules.join(", ") : "(없음)"}
금지 표현: ${input.knowledgeHub.bannedExpressions.length ? input.knowledgeHub.bannedExpressions.join(", ") : "(없음)"}${referenceSection}${successSection}
화면비: ${input.aspectRatio || "(미입력)"}
목표 길이: ${input.duration}초
${characterModeInstruction}
${beatsBlock}시나리오 스펙:
${specText}
씬 블루프린트:
${blueprintText}
${chunkGuide}
${genreGuide ? `${genreGuide}\n` : ""}${modeInstruction}`;
}

async function generateScenarioScenes(input) {
  if (!input?.env?.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");

  const fullTopic = String(input.topic || "").trim();
  const rawChunks = fullTopic.length > LONG_TOPIC_CHUNK_THRESHOLD
    ? splitLongTextIntoChunks(fullTopic, TOPIC_CHUNK_SIZE)
    : [fullTopic];
  const chunks = collapseChunksToSceneBudget(rawChunks, Math.max(1, Number(input.sceneCount) || 1));
  const sceneCounts = distributeIntegerByWeight(chunks, Math.max(1, Number(input.sceneCount) || 1));
  const durationTargets = distributeIntegerByWeight(
    sceneCounts.map((count) => "x".repeat(Math.max(1, Number(count) || 1))),
    Math.max(Number(input.duration) || 0, sceneCounts.length * 3),
    3
  );
  const merged = [];
  const failedChunks = [];
  let refinedChunks = 0;
  let validationFallbackChunks = 0;

  // Phase 0 Step 8 — 선언적 블록 규칙에서 현재 입력에 맞는 validatorSpec + compact suffix 생성.
  // 풀 systemPrompt 가 아닌 enforcement-only suffix 만 이어 붙여 토큰 증가를 최소화한다.
  // 실패해도 레거시 경로가 살아있도록 try/catch 로 감싼다.
  let ruleValidatorSpec = null;
  let rulePromptSuffix = "";
  try {
    const ruleBuilt = buildEnforcementSuffix({
      lang: input.lang,
      durationSec: Number(input.duration) || 0,
      sceneCount: Math.max(1, Number(input.sceneCount) || 1),
      purposeCategory: input.purposeCategory,
      purposeTags: input.purposeTags,
      target: input.target,
      needs: input.needs,
      tones: input.tones,
      styles: input.styles,
    });
    ruleValidatorSpec = ruleBuilt.validatorSpec;
    rulePromptSuffix = ruleBuilt.suffix;
  } catch (_) {
    // 블록 규칙이 아직 커버하지 않는 케이스 — 조용히 레거시만 사용
  }
  let ruleRetried = false;
  let ruleCriticalRemaining = 0;
  const runStartedAt = Date.now();

  for (let i = 0; i < chunks.length; i++) {
    const chunkText = String(chunks[i] || "").trim();
    if (!chunkText) continue;
    const chunkSceneCount = Math.max(1, Number(sceneCounts[i]) || 1);
    const chunkDuration = Math.max(chunkSceneCount * 3, Number(durationTargets[i]) || chunkSceneCount * 3);
    const spec = buildScenarioSpec({
      lang: input.lang,
      topic: chunkText,
      episodeTitle: input.episodeTitle || "",
      story: String(input.story || ""),
      target: input.target,
      purposeCategory: input.purposeCategory,
      purposeTags: input.purposeTags,
      needs: input.needs,
      toneText: input.toneText,
      tones: input.tones,
      styleText: input.styleText,
      styles: input.styles,
      knowledgeHub: input.knowledgeHub,
      characters: input.characters,
      duration: String(chunkDuration),
      sceneCount: chunkSceneCount,
    });
    const sys = input.lang === "en"
      ? buildSystemPromptEn(chunkSceneCount, chunkDuration, spec)
      : buildSystemPromptKo(chunkSceneCount, chunkDuration, spec);
    // v2.685: 첫 호출 system prompt 는 레거시 그대로 유지한다.
    // 블록 규칙 suffix 를 첫 호출에 덧붙이면 생성 시간이 29s 한계를 넘어
    // aborted 에러가 난다. suffix 는 critical 위반 재시도 경로에서만 사용.
    const basePrompt = buildUserPrompt({
      lang: input.lang,
      topic: chunkText,
      episodeTitle: input.episodeTitle || "",
      story: String(input.story || ""),
      target: input.target,
      purposeCategory: input.purposeCategory,
      purposeTags: input.purposeTags,
      needs: input.needs,
      toneText: input.toneText,
      tones: input.tones,
      styleText: input.styleText,
      styles: input.styles,
      manualDirectives: input.manualDirectives,
      knowledgeHub: input.knowledgeHub,
      aspectRatio: input.aspectRatio,
      duration: String(chunkDuration),
      characterGenerationDisabled: input.characterGenerationDisabled,
      narrationEnabled: input.narrationEnabled,
      dubbingEnabled: input.dubbingEnabled,
      characters: input.characters,
      spec,
      storyBeats: chunks.length === 1 ? input.storyBeats : null,
      chunkGuide: buildChunkGuide({
        lang: input.lang,
        index: i,
        total: chunks.length,
        requestedSceneCount: chunkSceneCount,
      }),
    });

    try {
      const chunkOpts = Object.assign({}, input, {
        topic: chunkText,
        sceneCount: chunkSceneCount,
        duration: chunkDuration,
        defaultSpeaker: input.characters[0]?.token || "@narrator",
      });
      const firstPass = await requestAndShapeScenarioChunk({
        apiKey: input.env.ANTHROPIC_API_KEY,
        sys,
        userPrompt: basePrompt,
        spec,
        options: chunkOpts,
      });

      // Phase 0 Step 8 — single-chunk 이고 블록 규칙이 활성화됐을 때만
      // critical 위반 시 1회 자동 재시도. 다중 청크는 기존 경로 그대로.
      // v2.684: 첫 호출이 오래 걸려 남은 예산이 모자라면 재시도를 생략한다
      //         (재시도 중 CF 30s 리밋에 걸려 전체가 실패하는 것을 방지).
      let chunkScenes = firstPass.scenes;
      const elapsedMs = Date.now() - runStartedAt;
      const remainingMs = RULE_RETRY_TOTAL_BUDGET_MS - elapsedMs;
      const hasTimeForRetry = remainingMs >= RULE_RETRY_MIN_REMAINING_MS;
      if (chunks.length === 1 && ruleValidatorSpec && hasTimeForRetry) {
        // 이야기 비트(story-structure 결과)를 spec 에 합쳐, validator 가 비트 커버리지를 critical 검사할 수 있게 한다.
        const validatorSpecWithBeats = Object.assign({}, ruleValidatorSpec, {
          storyBeats: Array.isArray(input.storyBeats) ? input.storyBeats : [],
        });
        const retryResult = await runSceneValidator({
          scenes: chunkScenes,
          spec: validatorSpecWithBeats,
          language: input.lang === "en" ? "en" : "ko",
          regenerate: async (refinePrompt) => {
            // 재시도에는 블록 규칙 enforcement suffix 를 같이 실어, LLM 이
            // critical 위반 원인(무대/금칙/비트)을 명시적으로 볼 수 있게 한다.
            const suffixPart = rulePromptSuffix ? `\n\n[블록 규칙]\n${rulePromptSuffix}` : "";
            const retrySys = `${sys}${suffixPart}\n\n[재생성 지시]\n${refinePrompt}`;
            const retryPass = await requestAndShapeScenarioChunk({
              apiKey: input.env.ANTHROPIC_API_KEY,
              sys: retrySys,
              userPrompt: basePrompt,
              spec,
              options: chunkOpts,
            });
            return retryPass.scenes;
          },
          logger: () => {}, // 사용자에게 숨김
        });
        chunkScenes = retryResult.scenes;
        if (retryResult.retried) ruleRetried = true;
        if (retryResult.hasCritical) {
          ruleCriticalRemaining = retryResult.violations.filter((v) => v.severity === "critical").length;
        }
      }

      merged.push(...rebalanceEstSec(chunkScenes, chunkDuration));
    } catch (err) {
      failedChunks.push({
        index: i + 1,
        message: err?.message || "chunk_failed",
      });
      if (chunks.length === 1) throw err;
    }
  }

  if (!merged.length) {
    throw new Error(failedChunks[0]?.message || "Invalid scenes format from Claude");
  }

  const normalizedScenes = merged.map((scene, index) => Object.assign({}, scene, {
    id: index + 1,
    title: scene.title || `Scene ${index + 1}`,
  }));

  return {
    scenes: rebalanceEstSec(normalizedScenes, Number(input.duration) || 0),
    meta: {
      chunked: chunks.length > 1,
      chunkCount: chunks.length,
      sourceLength: fullTopic.length,
      failedChunks: failedChunks.length,
      partial: failedChunks.length > 0,
      refinedChunks,
      validationFallbackChunks,
      ruleRetried,
      ruleCriticalRemaining,
    },
  };
}

async function requestAndShapeScenarioChunk({ apiKey, sys, userPrompt, spec, options }) {
  const rawScenes = await requestScenarioChunk(apiKey, sys, userPrompt, {
    sceneCount: options.sceneCount,
  });
  const shaped = shapeScenesFromModel(rawScenes, {
    lang: options.lang,
    topic: options.topic,
    purposeCategory: options.purposeCategory,
    purposeTags: options.purposeTags,
    toneText: options.toneText,
    tones: options.tones,
    styleText: options.styleText,
    styles: options.styles,
    aspectRatio: options.aspectRatio,
    sceneCount: options.sceneCount,
    duration: options.duration,
    characterGenerationDisabled: options.characterGenerationDisabled,
    narrationEnabled: options.narrationEnabled,
    dubbingEnabled: options.dubbingEnabled,
    characters: options.characters,
  });
  const normalized = fitScenesToRequestedCount(shaped, options.sceneCount, {
    topic: options.topic,
    target: options.target,
    duration: String(options.duration),
    sceneCount: options.sceneCount,
    narrationEnabled: options.narrationEnabled,
    dubbingEnabled: options.dubbingEnabled,
    characters: options.characters,
    lang: options.lang,
    purposeCategory: options.purposeCategory,
    purposeTags: options.purposeTags,
    toneText: options.toneText,
    tones: options.tones,
    styleText: options.styleText,
    styles: options.styles,
    aspectRatio: options.aspectRatio,
    spec,
  });
  const aligned = alignScenesToScenarioSpec(normalized, spec, {
    lang: options.lang,
    topic: options.topic,
    purposeCategory: options.purposeCategory,
    purposeTags: options.purposeTags,
    toneText: options.toneText,
    tones: options.tones,
    styleText: options.styleText,
    styles: options.styles,
    aspectRatio: options.aspectRatio,
    sceneCount: options.sceneCount,
    duration: options.duration,
    narrationEnabled: options.narrationEnabled,
    dubbingEnabled: options.dubbingEnabled,
    defaultSpeaker: options.defaultSpeaker,
  });
  // Pass 1 캐릭터 일관성 강제: 시스템 프롬프트로도 안내하지만 LLM 이
  // 누락시키는 케이스가 있어 서버에서 한 번 더 검증해 @토큰을 채운다.
  const anchored = enforceCharacterAnchorsInScenes(aligned, options.characters || [], options.lang);
  return {
    scenes: anchored.scenes,
    validation: validateScenarioAgainstSpec(anchored.scenes, spec),
    characterAnchorInjections: anchored.injected,
  };
}

/**
 * 씬 개수에 맞춰 max_tokens 를 동적으로 계산한다.
 * - 씬 당 대략 220 토큰 (id/title/intent/location/visual/narration/dialogue 총합) + JSON 오버헤드 400
 * - 하한 1100, 상한 3200 (CF 30s 리밋 안에서 안전하게 생성 가능한 폭)
 * 이전엔 고정 2000 이라 씬 4개에도 2000 까지 생성하려다 30s 리밋을 넘기는 케이스가 있었다.
 */
function resolveMaxTokensForScenes(sceneCount) {
  const n = Math.max(1, Number(sceneCount) || 1);
  const target = 220 * n + 400;
  return Math.min(3200, Math.max(1100, target));
}

/**
 * 부분 수신된 JSON 텍스트의 미닫힌 괄호/문자열을 강제로 닫아 파싱 가능한 모양으로 만든다.
 * 스트리밍이 한계로 중단됐을 때 1차 fallback.
 *
 * - 문자열 안에서 끊겼으면 닫는 따옴표 + 그 시점의 객체/배열 모두 닫는다.
 * - 마지막 컴마/콜론 뒤가 잘렸으면 그 부분도 잘라낸다.
 *
 * 주의: 문자열 내부의 unescaped quote 가 있으면 inStr 추적이 어긋나
 * 잘못된 위치를 닫을 수 있다. 그래서 scene-level salvage 가 1차이고
 * 이 함수는 2차 fallback.
 */
function closeTruncatedJson(text) {
  let s = String(text || "");
  if (!s) return s;
  let inStr = false;
  let escape = false;
  const stack = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (inStr) {
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
  }
  // 미완 문자열은 따옴표로 닫는다
  if (inStr) s += '"';
  // 마지막에 매달린 컴마/콜론 정리: ",..."  ":..."  "{key:" 같은 경우
  s = s.replace(/[,:]\s*$/, "");
  // 미완 키-값(`"key":`) 같이 키만 있고 값이 없는 경우 키 토큰 자체를 제거
  s = s.replace(/,\s*"[^"\\]*"\s*$/, "");
  s = s.replace(/\{\s*"[^"\\]*"\s*$/, "{");
  // 스택을 LIFO 로 닫는다
  while (stack.length) {
    const open = stack.pop();
    s += open === "{" ? "}" : "]";
  }
  return s;
}

/**
 * 잘린 응답에서 각 씬 객체(`{...}`) 만 개별로 잘라 따로따로 JSON.parse 한다.
 * 개별 파싱이라 한 씬에 unescaped quote 가 있어도 그 씬만 버리고 나머진 산다.
 * 가장 안정적인 1차 복구 전략 — 전체 텍스트 한 번에 파싱하는 게 실패할 때 사용.
 *
 * 반환: 파싱된 씬 객체 배열, 하나도 못 살리면 null.
 */
function extractIndividualScenes(text) {
  const s = String(text || "");
  if (!s) return null;
  const m = s.match(/"scenes"\s*:\s*\[/);
  if (!m) return null;
  const arrayContentStart = m.index + m[0].length;

  const scenes = [];
  let i = arrayContentStart;
  let depth = 0;
  let inStr = false;
  let escape = false;
  let sceneStart = -1;

  while (i < s.length) {
    const c = s[i];
    if (escape) { escape = false; i++; continue; }
    if (c === "\\") { escape = true; i++; continue; }
    if (inStr) {
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') { inStr = true; i++; continue; }
    if (c === "{" || c === "[") {
      if (depth === 0 && c === "{") sceneStart = i;
      depth++;
      i++;
      continue;
    }
    if (c === "}" || c === "]") {
      const wasArrayLevel = depth === 1 && c === "}";
      depth--;
      i++;
      if (depth === 0 && sceneStart >= 0 && wasArrayLevel) {
        const sceneText = s.slice(sceneStart, i);
        let parsed = null;
        try { parsed = JSON.parse(sceneText); } catch (_) {
          try { parsed = JSON.parse(repairJsonString(sceneText)); } catch (_) { parsed = null; }
        }
        if (parsed && typeof parsed === "object") scenes.push(parsed);
        sceneStart = -1;
      } else if (depth < 0) {
        // scenes 배열 자체가 닫힌 시점
        break;
      }
      continue;
    }
    i++;
  }

  return scenes.length ? scenes : null;
}

/**
 * 잘린 응답에서 "완전히 닫힌 씬 객체" 만 추려서 `{"scenes":[...]}` 형태로 다시 만든다.
 * closeTruncatedJson 보다 강력한 fallback — 문자열 내부 unescaped quote 가
 * 있어도 마지막으로 깊이가 0 으로 돌아온 시점만 신뢰하기 때문에 비교적 안정적.
 *
 * 동작:
 *  1. `"scenes"\s*:\s*\[` 위치를 찾는다.
 *  2. 그 `[` 이후로 한 글자씩 진행하면서 문자열/이스케이프/괄호 깊이를 추적.
 *  3. 깊이가 다시 0 으로 돌아온 (= 씬 하나가 완전히 닫힌) 시점을 lastSafeEnd 로 기록.
 *  4. 마지막으로 기록된 lastSafeEnd 까지만 보존하고 `]}` 로 닫는다.
 *
 * 결과: 마지막 부분 씬은 통째로 버리되, 이전에 들어온 완성 씬들은 그대로 산다.
 */
function salvageCompletedScenes(text) {
  const s = String(text || "");
  if (!s) return null;
  const m = s.match(/"scenes"\s*:\s*\[/);
  if (!m) return null;
  const arrayOpen = m.index + m[0].length - 1; // index of '['
  const prefix = s.slice(0, arrayOpen + 1); // up to and including '['

  let i = arrayOpen + 1;
  let depth = 0;
  let inStr = false;
  let escape = false;
  let lastSafeEnd = -1; // 배열 안에서 깊이가 0 으로 돌아온 직후 위치 (다음 ',' 또는 ']' 직전)
  let sawAnyElement = false;

  while (i < s.length) {
    const c = s[i];
    if (escape) { escape = false; i++; continue; }
    if (c === "\\") { escape = true; i++; continue; }
    if (inStr) {
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') { inStr = true; i++; continue; }
    if (c === "{" || c === "[") {
      depth++;
      sawAnyElement = true;
      i++;
      continue;
    }
    if (c === "}" || c === "]") {
      depth--;
      i++;
      if (depth === 0) {
        lastSafeEnd = i; // 닫는 괄호 포함 위치
      } else if (depth < 0) {
        // 우리가 본 ']' 가 scenes 배열 자체의 닫기였다면 — 정상 종료, 그대로 반환
        return s.slice(0, i) + "}";
      }
      continue;
    }
    i++;
  }

  if (!sawAnyElement || lastSafeEnd < 0) {
    // 한 씬도 완성 못 했다면 빈 배열로라도 닫아 호출자가 다른 fallback 으로 가도록.
    return prefix + "]}";
  }
  return s.slice(0, lastSafeEnd) + "]}";
}

/**
 * Anthropic SSE 스트림에서 text_delta 만 모아 합본 텍스트를 반환한다.
 * abort 가 걸리면 그 시점까지의 텍스트와 timedOut=true 를 같이 돌려준다.
 */
async function streamAnthropicText({ apiKey, payload, signal, timeoutMs }) {
  const controller = new AbortController();
  // 외부 signal 이 있으면 같이 묶어둔다
  if (signal) signal.addEventListener("abort", () => controller.abort(signal.reason));
  const timer = setTimeout(() => controller.abort("scenario_stream_timeout"), timeoutMs);

  let collected = "";
  let timedOut = false;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (res.status === 402 || /"billing_error"|credit_balance|insufficient.{0,10}credit/i.test(errText)) {
        throw new Error("CREDIT_EXHAUSTED");
      }
      throw new Error(`Anthropic error: ${res.status} ${errText}`);
    }
    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    if (!reader) throw new Error("Anthropic stream not readable");
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const evt = JSON.parse(data);
            if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
              collected += evt.delta.text || "";
            } else if (evt.type === "message_stop") {
              // end of message
            }
          } catch (_) { /* ignore malformed sse line */ }
        }
      }
    } catch (streamErr) {
      if (controller.signal.aborted) {
        timedOut = true;
      } else {
        throw streamErr;
      }
    }
  } catch (err) {
    if (controller.signal.aborted && /abort/i.test(String(err?.message || ""))) {
      timedOut = true;
    } else {
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }

  return { text: collected, timedOut };
}

async function requestScenarioChunk(apiKey, sys, userPrompt, opts = {}) {
  const maxTokens = resolveMaxTokensForScenes(opts.sceneCount);
  const payload = {
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    system: sys,
    messages: [
      { role: "user", content: userPrompt },
    ],
    temperature: 0.5,
    stream: true,
  };

  // 27초 타임아웃: CF 30s 리밋 안쪽에 안전 마진 3초.
  // 끝까지 못 받아도 그 시점까지의 텍스트를 살려서 부분 씬이라도 돌려준다.
  const { text, timedOut } = await streamAnthropicText({
    apiKey,
    payload,
    timeoutMs: 27000,
  });

  if (!text) {
    throw new Error(timedOut ? "Anthropic stream timed out before any content" : "Anthropic empty response");
  }

  const cleaned = cleanJsonResponse(text || "{}");

  // 복구 cascade: 가장 안전한 전략부터 차례로 시도.
  //  1) cleaned 원본 (정상 종료 케이스)
  //  2) cleaned + repair (제어문자/이스케이프/trailing comma)
  //  3) extractIndividualScenes(raw)  ← 핵심: 씬을 하나씩 따로 파싱
  //  4) extractIndividualScenes(cleaned) — cleanJsonResponse 가 다른 모양으로 만들었을 수 있어 한 번 더
  //  5) salvageCompletedScenes(cleaned) + repair
  //  6) closeTruncatedJson(cleaned) + repair (LIFO — 마지막 안전망)
  const tryParse = (src) => {
    try { return JSON.parse(src); } catch (_) { return null; }
  };
  const tryRepairThenParse = (src) => {
    try { return JSON.parse(repairJsonString(src)); } catch (_) { return null; }
  };

  let parsed = null;
  let strategy = "raw";
  let firstErr = null;

  parsed = tryParse(cleaned);
  if (!parsed) {
    try { JSON.parse(cleaned); } catch (e) { firstErr = e; }
    strategy = "repair";
    parsed = tryRepairThenParse(cleaned);
  }
  // 개별 씬 파싱 — RAW 텍스트 우선. cleanJsonResponse 가 truncated 응답에서
  // 깊이 추적 실수로 잘못된 위치에 ]} 를 박는 경우가 있어, 원본을 먼저 본다.
  if (!parsed) {
    const indiv = extractIndividualScenes(text) || extractIndividualScenes(cleaned);
    if (indiv && indiv.length) {
      strategy = "individual-scenes";
      parsed = { scenes: indiv };
    }
  }
  if (!parsed) {
    const salvaged = salvageCompletedScenes(cleaned);
    if (salvaged) {
      strategy = "salvage";
      parsed = tryParse(salvaged) || tryRepairThenParse(salvaged);
      if (parsed) strategy = "salvage+repair";
    }
  }
  if (!parsed) {
    strategy = "closeTrunc";
    parsed = tryRepairThenParse(closeTruncatedJson(cleaned));
  }

  if (!parsed) {
    const pos = (firstErr?.message?.match(/position\s+(\d+)/i) || [])[1];
    const snippet = pos ? cleaned.slice(Math.max(0, Number(pos) - 40), Number(pos) + 40) : cleaned.slice(0, 120);
    console.error("[scenario] JSON repair failed near:", snippet, "len=", cleaned.length, "timedOut=", timedOut);
    throw new Error(`JSON parse error${timedOut ? " (stream truncated)" : ""}: ${firstErr?.message || "unknown"}`);
  }
  if (strategy !== "raw") {
    console.log(`[scenario] JSON recovered via strategy=${strategy} (timedOut=${timedOut})`);
  }
  const scenes = parsed.scenes || parsed;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("Invalid scenes format from Anthropic");
  }
  if (timedOut) {
    console.log(`[scenario] stream truncated, salvaged ${scenes.length} scene(s)`);
  }
  return scenes;
}

function buildScenarioSpec(input = {}) {
  const lang = input.lang === "en" ? "en" : "ko";
  const category = String(input.purposeCategory || "").trim();
  const tags = normalizeTextList(input.purposeTags);
  const needs = normalizeTextList(input.needs);
  const toneValues = uniqueStrings([input.toneText, input.tones].flatMap((value) => normalizeTextList(value)));
  const target = String(input.target || "").trim();
  const knowledgeHub = input.knowledgeHub && typeof input.knowledgeHub === "object" ? input.knowledgeHub : {};
  const characters = Array.isArray(input.characters) ? input.characters : [];
  const topicProfile = parseTopicProfile(input.episodeTitle || input.topic, lang);
  const rules = [
    ...collectRulesFromLibrary("purposeCategory", [category]),
    ...collectRulesFromLibrary("purposeTag", tags),
    ...collectRulesFromLibrary("need", needs),
    ...collectRulesFromLibrary("tone", toneValues),
    ...collectRulesFromLibrary("target", [target]),
  ];

  const signalSet = new Set(rules.flatMap((rule) => rule.signals || []));
  if (topicProfile.hasLearningCue) signalSet.add("learning");
  if (topicProfile.hasSongCue) signalSet.add("song");
  if (topicProfile.hasPlayCue) signalSet.add("play");
  if (topicProfile.hasAlphabet) signalSet.add("alphabet");
  if (/영유아/.test(target)) signalSet.add("very_young");

  const signals = {
    learning: signalSet.has("learning"),
    play: signalSet.has("play") || signalSet.has("participation"),
    song: signalSet.has("song"),
    humor: signalSet.has("humor"),
    informative: signalSet.has("informative"),
    simpleLanguage: signalSet.has("simple_language") || signalSet.has("very_young"),
    alphabet: signalSet.has("alphabet"),
    movement: signalSet.has("movement"),
    veryYoung: signalSet.has("very_young"),
  };
  const sceneCount = Math.max(1, Number(input.sceneCount) || 1);
  const profile = resolveOverviewProfile({
    lang,
    purposeCategory: category,
    purposeTags: tags,
    needs,
    tones: toneValues,
    target,
    styleText: String(input.styleText || "").trim(),
    styles: normalizeTextList(input.styles),
    topicProfile,
    signals,
  });

  const requiredOutputsKo = [];
  const requiredOutputsEn = [];
  const avoidOutputsKo = [
    "주제만 언급하고 아무 장면에나 붙일 수 있는 범용 시나리오",
    "씬마다 같은 의미를 반복하는 평면적인 전개",
    "개요의 목적과 톤이 실제 장면 구조를 바꾸지 않는 결과",
  ];
  const avoidOutputsEn = [
    "A generic scenario that only mentions the topic",
    "Flat repetition where every scene serves the same purpose",
    "An output where purpose and tone do not materially change the structure",
  ];

  if (signals.learning) {
    requiredOutputsKo.push("학습 대상 제시, 따라 하기 또는 반복, 마지막 정리/복습이 드러나야 한다.");
    requiredOutputsEn.push("Show teaching, follow-along or repetition, and a final recap.");
  }
  const storyText = String(input.story || "").trim();
  const episodeTitleText = String(input.episodeTitle || "").trim();
  const hasNarrativeStory = storyText.length > 50 && (!episodeTitleText || storyText !== episodeTitleText);

  if (signals.play) {
    if (hasNarrativeStory) {
      requiredOutputsKo.push("이야기에 제시된 사건·행동을 씬 순서대로 시각화한다. 캐릭터들의 대사와 행동은 이야기에 나온 것을 따른다.");
      requiredOutputsEn.push("Visualize the events and actions in the story scene by scene. Character dialogue and actions must follow the story as written.");
      avoidOutputsKo.push("카메라를 향한 직접 초대, '같이 해볼까?' 등 시청자 참여 요청, 이야기와 무관한 튜토리얼·참여 포맷");
      avoidOutputsEn.push("Direct camera address, audience participation prompts, tutorial formats unrelated to the story");
    } else {
      requiredOutputsKo.push("시청자가 함께 말하거나 움직일 수 있는 참여 요소가 포함되어야 한다.");
      requiredOutputsEn.push("Include at least one audience participation moment through speech or movement.");
    }
  }
  if (signals.song) {
    requiredOutputsKo.push("리듬감 있는 반복 구절이나 후렴 느낌의 문장을 포함해야 한다.");
    requiredOutputsEn.push("Include a rhythmic repeated phrase or hook-like line.");
  }
  if (signals.humor) {
    requiredOutputsKo.push("귀여운 실수, 장난, 가벼운 반전 중 최소 1개의 유머 비트를 포함해야 한다.");
    requiredOutputsEn.push("Include at least one gentle humor beat such as a cute mistake or light gag.");
  }
  if (signals.simpleLanguage) {
    requiredOutputsKo.push("문장은 짧고 쉬워야 하며 한 장면에 너무 많은 정보를 넣지 않는다.");
    requiredOutputsEn.push("Keep sentences short and simple and avoid packing too much information into one scene.");
  }
  if (signals.alphabet) {
    requiredOutputsKo.push(`핵심 학습 대상 "${topicProfile.subject}"를 직접 말하거나 보여주는 장면이 필요하다.`);
    requiredOutputsEn.push(`Explicitly show or say the learning target "${topicProfile.subject}".`);
  }
  if (sceneCount >= 4) {
    requiredOutputsKo.push("전체 씬 흐름은 기-승-전-결 또는 그에 준하는 도입-확장-전환-결말 구조를 따라야 한다.");
    requiredOutputsEn.push("The full scene flow must follow a setup-rise-turn-close arc or an equivalent opening-development-turn-ending structure.");
  }

  const continuity = buildContinuityPlan({
    lang,
    knowledgeHub,
    topicProfile,
    signals,
    profile,
    purposeCategory: category,
    purposeTags: tags,
    hasNarrativeStory,
  });
  requiredOutputsKo.push("각 visual은 추상적인 장면 설명 대신 실제로 연출 가능한 공간, 배경, 행동, 프롭을 모두 포함해야 한다.");
  if (hasNarrativeStory) {
    requiredOutputsKo.push("씬 배경과 장소는 이야기가 결정한다. 이야기에 명시된 장소를 그대로 사용하고, 명시되지 않은 경우에만 이전 씬과 자연스럽게 이어지는 공간을 유지한다.");
  } else {
    requiredOutputsKo.push(`모든 씬은 같은 기본 공간인 "${continuity.place}"에서 이어지며, 장소를 바꿀 때만 명시적으로 전환을 드러낸다.`);
  }
  requiredOutputsKo.push("sceneIntent는 씬을 본 관객의 구체적 반응으로 쓰고, visual에는 실제 화면에 보일 내용을 3~5문장으로 구체적으로 쓴다.");
  requiredOutputsEn.push("Each visual must be directly stageable and include space, background, action, and props instead of abstract scene labels.");
  if (hasNarrativeStory) {
    requiredOutputsEn.push("Scene locations are determined by the story. Use locations exactly as written in the story; otherwise keep continuity with the prior scene.");
  } else {
    requiredOutputsEn.push(`Keep every scene in the same base setting "${continuity.place}" unless an explicit location transition is shown.`);
  }
  requiredOutputsEn.push("sceneIntent should describe a concrete audience reaction, while visual should describe the actual shot content in 3 to 5 sentences.");
  avoidOutputsKo.push("시각화에 '장면', '분위기', '구성' 같은 추상 문장만 적는 결과");
  avoidOutputsKo.push("씬 사이 기본 장소가 뜬금없이 바뀌는 결과");
  avoidOutputsEn.push("Visuals that stay abstract with words like scene, mood, or composition only");
  avoidOutputsEn.push("Abrupt base-location changes between scenes");

  const sceneBlueprint = buildSceneBlueprint({
    lang,
    sceneCount,
    topicProfile,
    signals,
    profile,
    continuity,
    hasNarrativeStory,
  });

  return {
    lang,
    topic: String(input.topic || "").trim(),
    target,
    purposeCategory: category,
    purposeTags: tags,
    needs,
    tones: toneValues,
    styleText: String(input.styleText || "").trim(),
    styles: normalizeTextList(input.styles),
    characters,
    topicProfile,
    signals,
    profile,
    rules,
    requiredOutputsKo: uniqueStrings(requiredOutputsKo.concat(profile.generationRules || [], rules.flatMap((rule) => rule.generationRulesKo || []))),
    requiredOutputsEn: uniqueStrings(requiredOutputsEn.concat(lang === "en" ? profile.generationRules || [] : [], rules.flatMap((rule) => rule.generationRulesEn || []))),
    validationRulesKo: uniqueStrings((lang === "en" ? [] : (profile.validationRules || [])).concat(rules.flatMap((rule) => rule.validationRulesKo || []))),
    validationRulesEn: uniqueStrings((lang === "en" ? (profile.validationRules || []) : []).concat(rules.flatMap((rule) => rule.validationRulesEn || []))),
    avoidOutputsKo,
    avoidOutputsEn,
    sceneBlueprint,
    continuity,
  };
}

function parseTopicProfile(topic = "", lang = "ko") {
  const raw = String(topic || "").trim();
  const cleaned = raw
    .replace(/\b(배우기|배우는|배워요|학습|공부|알아보기|소개|가이드|튜토리얼|레슨|lesson|guide)\b/gi, " ")
    .replace(/\b(동요|노래|song|songs|chant|챈트)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const englishCaps = raw.match(/\b[A-Z]{2,}\b/g) || [];
  const koreanWords = raw.match(/[가-힣]{2,}/g) || [];
  const keywords = uniqueStrings([
    ...englishCaps,
    ...koreanWords.filter((word) => !/(배우기|학습|놀이|동요|노래|영상|콘텐츠|소개|가이드)/.test(word)),
    cleaned,
  ]).slice(0, 5);
  const subject = keywords[0] || cleaned || raw || (lang === "en" ? "the topic" : "주제");
  return {
    raw,
    subject,
    keywords,
    hasAlphabet: /\babc\b|\balphabet\b/i.test(raw),
    hasSongCue: /(동요|노래|song|chant|리듬)/i.test(raw),
    hasLearningCue: /(배우|학습|익히|공부|알아보|learn|study)/i.test(raw),
    hasPlayCue: /(놀이|놀|율동|play|game|dance)/i.test(raw),
  };
}

function resolveOverviewProfile({ lang = "ko", purposeCategory = "", purposeTags = [], needs = [], tones = [], target = "", styleText = "", styles = [], topicProfile = {}, signals = {} } = {}) {
  const category = String(purposeCategory || "").trim();
  const tags = normalizeTextList(purposeTags);
  const needValues = normalizeTextList(needs);
  const toneValues = normalizeTextList(tones);
  const styleValues = normalizeTextList(styles);
  const joined = [category, tags.join(" "), needValues.join(" "), toneValues.join(" "), target, styleText, styleValues.join(" "), topicProfile.raw || ""]
    .join(" ")
    .toLowerCase();

  let key = PURPOSE_CATEGORY_ARCHETYPE[category] || "generic";
  if (/(공포|호러|괴담|스릴러|horror|haunt|haunted)/i.test(joined)) key = "horror";
  else if (/(sf|sci[\s-]?fi|우주|행성|미래|사이버|로봇|외계|space|galaxy|future|cyber)/i.test(joined)) key = "sf";
  else if (/(동요|율동|음악|사운드|bgm|asmr|cover|cover song|song|music)/i.test(joined)) key = "music";
  else if (/(레시피|요리|홈쿡|먹방|맛집|kitchen|recipe|cook|cooking)/i.test(joined)) key = "cooking";
  else if (/(여행|관광|명소|trip|travel|tour)/i.test(joined)) key = "travel";
  else if (/(리뷰|추천|언박싱|compare|review|unbox)/i.test(joined)) key = "review";
  else if (/(운동|피트니스|홈트|스트레칭|workout|fitness|stretch)/i.test(joined)) key = "fitness";
  else if (/(게임|공략|플레이|gaming|gameplay|quest)/i.test(joined)) key = "game";
  else if (/(브이로그|일상|루틴|vlog|routine|daily)/i.test(joined)) key = "lifestyle";
  else if (/(ai|앱|기술|테크|it|device|tool|software|productivity)/i.test(joined) && key !== "sf") key = "tech";
  else if (/(비즈니스|경제|브랜딩|마케팅|재테크|business|economy|marketing|finance)/i.test(joined)) key = "business";
  else if (/(인터뷰|사회|공감|이슈|다큐|interview|social|documentary|issue)/i.test(joined)) key = "social";
  else if (/(명상|힐링|위로|감성|healing|meditation|calm)/i.test(joined) && key !== "kids") key = "healing";
  else if (/(말씀|기도|간증|묵상|faith|prayer|scripture)/i.test(joined)) key = "religion";
  else if (/(그림|공예|diy|디자인|글쓰기|사진|craft|creative|design)/i.test(joined)) key = "creative";
  else if (/(공부법|자격증|튜토리얼|tutorial|lesson|learn|study)/i.test(joined) && key !== "kids") key = "learning";
  else if (/(과학|수학|역사|상식|교양|science|history|knowledge)/i.test(joined) && !signals.song) key = "informative";

  const base = ARCHETYPE_LIBRARY[key] || ARCHETYPE_LIBRARY.generic;
  const profile = {
    key,
    label: category || key,
    toneMode: toneValues[0] || "",
    target,
    tags,
    needs: needValues,
    styles: styleValues,
    styleText: String(styleText || "").trim(),
    roles: Array.isArray(base.roles) ? base.roles.slice() : ARCHETYPE_LIBRARY.generic.roles.slice(),
    place: lang === "en" ? base.placeEn : base.placeKo,
    background: lang === "en" ? base.backgroundEn : base.backgroundKo,
    backgroundStyle: lang === "en" ? base.backgroundStyleEn : base.backgroundStyleKo,
    sublocations: lang === "en" ? (base.sublocationsEn || []) : (base.sublocationsKo || []),
    category: base.category || "generic",
    actors: lang === "en" ? (base.actorsEn || ARCHETYPE_LIBRARY.generic.actorsEn) : (base.actorsKo || ARCHETYPE_LIBRARY.generic.actorsKo),
    generationRules: lang === "en" ? (base.generationRulesEn || []) : (base.generationRulesKo || []),
    validationRules: buildProfileValidationRules({ lang, key, target, needValues, toneValues }),
  };

  if (signals.song && !profile.roles.includes("chorus") && profile.key !== "kids") {
    profile.roles = fitRoleSequence(["hook", "build", "chorus", "variation", "outro"], profile.roles.length || 4, "close");
  }
  if (signals.learning && ["entertainment", "story", "social"].includes(profile.key)) {
    profile.roles = fitRoleSequence(["hook", "teach", "practice", "example", "recap"], profile.roles.length || 4, "recap");
  }
  if (signals.play && ["kids", "entertainment", "game", "fitness"].includes(profile.key)) {
    profile.roles = fitRoleSequence(profile.roles.map((role, idx) => idx === 1 && role === "teach" ? "invite" : role), profile.roles.length || 4, "close");
  }
  if (/유머|코미디|패러디|챌린지|comedy|parody|challenge/i.test(joined) && !toneValues.includes("유머")) {
    profile.generationRules = uniqueStrings(profile.generationRules.concat([
      lang === "en" ? "Add a visible playful or comedic beat." : "장면 안에 가벼운 장난이나 코미디 비트를 한 번 이상 드러낸다."
    ]));
  }
  if (/영유아|어린이|kid|toddler|preschool/i.test(String(target || "")) && profile.key !== "kids") {
    profile.generationRules = uniqueStrings(profile.generationRules.concat([
      lang === "en" ? "Keep language simple and reduce information density for young viewers." : "어린 시청자를 위해 어휘를 단순하게 하고 정보 밀도를 낮춘다."
    ]));
  }

  return profile;
}

function fitRoleSequence(roles = [], count = 4, closingRole = "close") {
  const target = Math.max(1, Number(count) || 1);
  let list = (Array.isArray(roles) ? roles : []).filter(Boolean);
  if (!list.length) list = ["hook", "develop", "reinforce", closingRole];

  const lastRole = list[list.length - 1] || closingRole;
  while (list.length < target) {
    list.splice(Math.max(list.length - 1, 1), 0, list[Math.max(list.length - 2, 1)] || "develop");
  }
  if (list.length <= target) return list;
  if (target === 1) return [lastRole];

  const body = list.slice(0, -1);
  const bodyTarget = Math.max(target - 1, 0);
  if (body.length <= bodyTarget) return body.concat(lastRole).slice(0, target);

  const compacted = [];
  for (let i = 0; i < bodyTarget; i++) {
    const sourceIndex = Math.floor((i * body.length) / bodyTarget);
    compacted.push(body[sourceIndex] || body[body.length - 1] || "develop");
  }
  return compacted.concat(lastRole);
}

function isClosingRole(role = "") {
  return /^(close|recap|summary|outro|verdict|takeaway|taste|cooldown|reveal|result|escape|prayer)$/i.test(String(role || "").trim());
}

function buildNarrativeArcPlan(count = 4, lang = "ko") {
  const total = Math.max(1, Number(count) || 1);
  const phaseDefs = lang === "en"
    ? [
      { key: "setup", label: "Setup", goal: "Establish the world, premise, or baseline." },
      { key: "rise", label: "Rise", goal: "Expand the main action, learning, or journey." },
      { key: "turn", label: "Turn", goal: "Escalate, vary, or pivot the material toward resolution." },
      { key: "close", label: "Close", goal: "Resolve, recap, or end with a clear payoff." },
    ]
    : [
      { key: "setup", label: "기", goal: "세계관, 전제, 기본 상황을 세운다." },
      { key: "rise", label: "승", goal: "핵심 전개, 학습, 체험을 본격적으로 확장한다." },
      { key: "turn", label: "전", goal: "변주, 전환, 긴장 상승, 핵심 응용으로 흐름을 바꾼다." },
      { key: "close", label: "결", goal: "회수, 복습, 결론, 엔딩으로 분명하게 마무리한다." },
    ];

  if (total === 1) return [phaseDefs[3]];
  if (total === 2) return [phaseDefs[0], phaseDefs[3]];
  if (total === 3) return [phaseDefs[0], phaseDefs[2], phaseDefs[3]];
  if (total === 4) return phaseDefs.slice();

  const ratios = [0.22, 0.33, 0.23, 0.22];
  const counts = phaseDefs.map(() => 1);
  let remaining = total - counts.reduce((sum, value) => sum + value, 0);
  const weighted = ratios.map((ratio, index) => ({
    index,
    raw: ratio * remaining,
    whole: Math.floor(ratio * remaining),
    frac: (ratio * remaining) - Math.floor(ratio * remaining),
  }));
  weighted.forEach((row) => {
    counts[row.index] += row.whole;
    remaining -= row.whole;
  });
  weighted.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < remaining; i++) counts[weighted[i % weighted.length].index] += 1;

  const plan = [];
  phaseDefs.forEach((phase, index) => {
    for (let i = 0; i < counts[index]; i++) plan.push(Object.assign({}, phase));
  });
  return plan.slice(0, total);
}

function roleToNarrativePhase(role = "") {
  const value = String(role || "").trim();
  if (/^(hook|setup|intro|arrive|settle|mission|firstlook|scripture|context)$/i.test(value)) return "setup";
  if (/^(teach|practice|invite|play|develop|build|prep|routine|explore|warmup|process|explain|voice|main|discovery|playbeat|problem)$/i.test(value)) return "rise";
  if (/^(repeat|turn|example|highlight|variation|compare|benefit|detail|point|insight|breathe|sign|dread|solution|chorus|plate|reveal|reinforce|twist|cook|demo)$/i.test(value)) return "turn";
  if (/^(recap|summary|close|outro|verdict|takeaway|taste|cooldown|result|escape|prayer|payoff|reflect)$/i.test(value)) return "close";
  return "rise";
}

function buildRolePoolsForArc(baseRoles = [], closingRole = "close") {
  const source = (Array.isArray(baseRoles) ? baseRoles : []).filter(Boolean);
  const pools = {
    setup: [],
    rise: [],
    turn: [],
    close: [],
  };
  source.forEach((role) => {
    const phase = roleToNarrativePhase(role);
    pools[phase].push(role);
  });
  pools.setup = uniqueStrings(pools.setup.concat(source[0] || "hook", "hook")).filter((role) => !isClosingRole(role));
  pools.rise = uniqueStrings(pools.rise.concat(source.find((role) => !isClosingRole(role)) || "develop", "develop"));
  pools.turn = uniqueStrings(pools.turn.concat(source.filter((role) => !isClosingRole(role)).slice(-2), "reinforce"));
  pools.close = uniqueStrings(pools.close.concat(source.filter((role) => isClosingRole(role)), closingRole || "close", "summary"));
  return pools;
}

function buildProfileValidationRules({ lang = "ko", key = "generic", target = "", needValues = [], toneValues = [] } = {}) {
  const rulesKo = [];
  const rulesEn = [];
  const add = (ko, en) => {
    rulesKo.push(ko);
    rulesEn.push(en);
  };
  if (["story", "horror", "sf"].includes(key)) add("각 씬은 앞 장면의 사건을 이어받아 전개되어야 한다.", "Each scene should clearly inherit momentum from the previous beat.");
  if (["cooking", "learning", "fitness", "review", "tech", "business"].includes(key)) add("장면 순서가 절차나 판단 단계에 맞게 보여야 한다.", "Scene order should follow a visible procedure or decision flow.");
  if (["travel", "lifestyle", "healing"].includes(key)) add("공간 이동과 감정 리듬이 자연스럽게 이어져야 한다.", "Location movement and emotional rhythm should connect naturally.");
  if (/영유아|어린이|kid|toddler|preschool/i.test(String(target || ""))) add("어휘 난이도와 장면 밀도가 어린 시청자 수준에 맞아야 한다.", "Vocabulary and scene density must fit very young viewers.");
  if (needValues.includes("실용 정보")) add("결론 또는 실질적인 요점이 분명해야 한다.", "A practical takeaway should remain explicit.");
  if (toneValues.includes("유머")) add("유머는 대사나 상황에서 실제 비트로 확인되어야 한다.", "Humor should appear as a concrete beat in action or dialogue.");
  return lang === "en" ? rulesEn : rulesKo;
}

function getProfileSignaturePattern(key = "generic") {
  switch (key) {
    case "cooking":
      return /(재료|도마|조리|플레이팅|시식|ingredient|cook|plate|taste)/i;
    case "travel":
      return /(도착|전망|골목|동선|명소|arrive|viewpoint|route|landmark|explore)/i;
    case "review":
      return /(첫인상|비교|장단점|총평|추천|first look|compare|verdict|review)/i;
    case "fitness":
      return /(워밍업|동작|호흡|스트레칭|warm-?up|cooldown|stretch|movement)/i;
    case "tech":
      return /(문제|시연|기능|화면|효용|problem|demo|feature|screen|benefit)/i;
    case "business":
      return /(맥락|핵심 포인트|사례|결론|context|point|case|takeaway)/i;
    case "creative":
      return /(작업|제작|디테일|완성|process|detail|reveal|make)/i;
    case "social":
      return /(맥락|인터뷰|목소리|통찰|context|interview|voice|insight)/i;
    case "religion":
      return /(말씀|묵상|기도|scripture|reflection|prayer)/i;
    case "healing":
      return /(호흡|잔잔|천천히|breathe|calm|gentle|settle)/i;
    case "music":
      return /(후렴|리듬|박자|노래|chorus|rhythm|beat|sing)/i;
    case "game":
      return /(미션|플레이|아이템|결과|mission|play|item|result)/i;
    case "horror":
      return /(징후|불안|그림자|탈출|sign|dread|shadow|escape)/i;
    case "sf":
      return /(미션|홀로그램|콘솔|탐사|mission|hologram|console|exploration)/i;
    case "story":
      return /(상황|계기|전환|결과|setup|turn|payoff|story)/i;
    default:
      return null;
  }
}

function buildContinuityPlan({ lang = "ko", knowledgeHub = {}, topicProfile = {}, signals = {}, profile = {}, purposeCategory = "", purposeTags = [], hasNarrativeStory = false } = {}) {
  const settingRaw = String(knowledgeHub.worldSetting || "").trim();
  const subject = topicProfile.subject || (lang === "en" ? "the topic" : "주제");
  const defaultProp = buildSubjectPropCue({ lang, subject, signals, profile });
  // worldSetting은 IP 배경 지식(참고)이다.
  // 에피소드 이야기가 있으면(hasNarrativeStory) 이야기가 실제 씬 배경을 결정하므로
  // worldSetting을 장소·배경으로 강제 변환하지 않는다.
  if (settingRaw && !hasNarrativeStory) {
    const parsedSetting = parseWorldSetting(settingRaw, lang);
    return {
      source: "knowledge_hub",
      place: parsedSetting.place,
      background: parsedSetting.background,
      backgroundStyle: parsedSetting.backgroundStyle,
      props: [defaultProp],
      sublocations: parsedSetting.sublocations,
      category: detectSettingCategory(parsedSetting.place || settingRaw),
      anchorTerms: extractAnchorTerms(parsedSetting.place, parsedSetting.background, ...(parsedSetting.sublocations || []), defaultProp),
    };
  }

  const baseProfile = ARCHETYPE_LIBRARY[profile.key] || ARCHETYPE_LIBRARY.generic;
  const place = profile.place || (lang === "en" ? baseProfile.placeEn : baseProfile.placeKo);
  const background = profile.background || (lang === "en" ? baseProfile.backgroundEn : baseProfile.backgroundKo);
  return {
    source: `default_${profile.key || "generic"}`,
    place,
    background,
    backgroundStyle: profile.backgroundStyle || (lang === "en" ? baseProfile.backgroundStyleEn : baseProfile.backgroundStyleKo),
    props: uniqueStrings([defaultProp, signals.song ? (lang === "en" ? "small rhythm instruments" : "작은 리듬 악기") : ""]),
    sublocations: Array.isArray(profile.sublocations) && profile.sublocations.length
      ? profile.sublocations
      : (lang === "en" ? ["the main foreground", "the center area", "the side area", "the final focal point"] : ["메인 전경", "중앙 공간", "옆 공간", "마지막 포인트 공간"]),
    category: profile.category || detectSettingCategory(place),
    anchorTerms: extractAnchorTerms(place, background, defaultProp),
  };
}

function parseWorldSetting(raw = "", lang = "ko") {
  const lines = String(raw || "")
    .split(/\r?\n+/)
    .map((line) => line.replace(/^[\s\-*•]+/, "").trim())
    .filter(Boolean);
  const place = lines[0] || (lang === "en" ? "one consistent main location" : "하나의 일관된 메인 공간");
  const zoneSource = lines.slice(1).join(", ");
  let sublocations = zoneSource
    .split(/[,:/]/)
    .map((part) => part.replace(/\b(등|etc\.?)\b/gi, "").replace(/공간|장소|배경|world|setting/gi, "").trim())
    .filter(Boolean)
    .map((part) => part.replace(/\s{2,}/g, " ").trim())
    .slice(0, 6);
  if (!sublocations.length) {
    sublocations = lang === "en"
      ? ["the entrance side", "the center area", "the side area", "the final focal area"]
      : ["입구 쪽", "중앙 공간", "옆 공간", "마지막 포인트 공간"];
  }
  const backgroundSource = lines[1] || lines[0] || "";
  const background = lang === "en"
    ? `${backgroundSource || "The same world details"} stay visible as shared background elements.`
    : `${backgroundSource || "같은 세계관 디테일"}이 공통 배경 요소로 이어서 보인다.`;
  const backgroundStyle = lines.length > 1
    ? [lines[0], lines[1]].join(". ")
    : (lines[0] || (lang === "en" ? "One consistent visual world." : "하나의 일관된 시각 세계."));
  return {
    place,
    background,
    backgroundStyle,
    sublocations,
  };
}

function buildSubjectPropCue({ lang = "ko", subject = "", signals = {}, profile = {} } = {}) {
  const safeSubject = String(subject || "").trim() || (lang === "en" ? "topic" : "주제");
  switch (profile.key) {
    case "cooking":
      return lang === "en" ? "the main ingredients, a cutting board, and cooking utensils" : "주재료와 도마, 조리도구";
    case "travel":
      return lang === "en" ? "a route map, a local sign, and a small travel prop" : "동선 지도와 현지 표지판, 작은 여행 소품";
    case "review":
      return lang === "en" ? "the review item, close-up props, and a comparison card" : "리뷰 대상과 클로즈업 소품, 비교 카드";
    case "fitness":
      return lang === "en" ? "exercise mats and simple training props" : "운동 매트와 간단한 트레이닝 소품";
    case "tech":
      return lang === "en" ? "the device, its screen, and a demo control prop" : "기기 본체와 화면, 시연용 조작 소품";
    case "business":
      return lang === "en" ? "a chart board, key figures, and a summary card" : "차트 보드와 핵심 수치, 요약 카드";
    case "creative":
      return lang === "en" ? "the making tools, work surface, and finished sample" : "제작 도구와 작업판, 완성 샘플";
    case "music":
      return lang === "en" ? "a microphone, rhythm props, and music cue cards" : "마이크와 리듬 소품, 음악 큐 카드";
    case "game":
      return lang === "en" ? "game props, item markers, and a score display" : "게임 소품과 아이템 마커, 점수 표시";
    case "social":
      return lang === "en" ? "conversation cards and a context board" : "대화 카드와 맥락 보드";
    case "religion":
      return lang === "en" ? "a scripture card and a small prayer light" : "말씀 카드와 작은 기도 조명";
    case "healing":
      return lang === "en" ? "gentle cue cards and calm sensory props" : "부드러운 안내 카드와 잔잔한 감각 소품";
    case "horror":
      return lang === "en" ? "a flickering flashlight and a key clue object" : "깜빡이는 손전등과 단서 오브젝트";
    case "sf":
      return lang === "en" ? "a hologram panel and mission device" : "홀로그램 패널과 미션 장치";
    default:
      break;
  }
  if (signals.alphabet) {
    return lang === "en" ? "large ABC cards and alphabet blocks" : "커다란 ABC 카드와 알파벳 블록";
  }
  if (signals.song) {
    return lang === "en" ? `${safeSubject} cue cards and a small tambourine` : `${safeSubject} 카드와 작은 탬버린`;
  }
  if (signals.learning) {
    return lang === "en" ? `${safeSubject} learning cards` : `${safeSubject} 학습 카드`;
  }
  return lang === "en" ? `${safeSubject} props` : `${safeSubject} 소품`;
}

function extractAnchorTerms(...values) {
  const joined = values.map((value) => String(value || "").trim()).filter(Boolean).join(" ");
  const matches = joined.match(/[A-Za-z]{3,}|[가-힣]{2,}/g) || [];
  return uniqueStrings(matches.filter((token) => !/scene|camera|framing|angle|movement|장면|카메라|연출|구도|앵글|무빙/.test(token))).slice(0, 10);
}

function detectSettingCategory(text = "") {
  const lower = String(text || "").toLowerCase();
  if (!lower) return "generic";
  const categories = [
    { key: "space", re: /우주|행성|별|우주선|space|planet|starship|galaxy/ },
    { key: "sea", re: /바다|해변|파도|수중|sea|ocean|beach|underwater/ },
    { key: "forest", re: /숲|정글|나무|forest|jungle|woods/ },
    { key: "classroom", re: /교실|놀이방|유치원|칠판|classroom|playroom|kindergarten|board/ },
    { key: "building", re: /복도|계단|지하실|폐건물|폐교|저택|corridor|stairs|basement|mansion|abandoned/ },
    { key: "home", re: /집|거실|부엌|침실|home|living room|kitchen|bedroom/ },
    { key: "studio", re: /스튜디오|세트|무대|studio|set|stage/ },
    { key: "lab", re: /연구실|랩|콘솔|디스플레이|lab|console|display|device/ },
    { key: "city", re: /도시|거리|골목|city|street|downtown/ },
    { key: "farm", re: /농장|목장|farm|barn/ },
  ];
  const found = categories.find((row) => row.re.test(lower));
  return found ? found.key : "generic";
}

function collectRulesFromLibrary(kind, values = []) {
  const out = [];
  const seen = new Set();
  (Array.isArray(values) ? values : [values]).forEach((value) => {
    const key = String(value || "").trim();
    if (!key) return;
    const rule = RULE_LIBRARY[kind]?.[key];
    if (!rule || seen.has(key)) return;
    seen.add(key);
    out.push(Object.assign({ key }, rule));
  });
  return out;
}

function uniqueStrings(list = []) {
  return Array.from(new Set((Array.isArray(list) ? list : []).map((item) => String(item || "").trim()).filter(Boolean)));
}

function buildSceneBlueprint({ lang = "ko", sceneCount = 4, topicProfile, signals, profile = {}, continuity = {}, hasNarrativeStory = false }) {
  const count = Math.max(1, Number(sceneCount) || 1);
  let roles;
  if (hasNarrativeStory) {
    roles = fitRoleSequence(["setup", "inciting", "turn", "payoff", "close"], count, "close");
  } else {
    roles = fitRoleSequence(profile.roles || [], count, "close");
    if (!roles.length) {
      if (signals.learning && signals.song) roles = fitRoleSequence(["hook", "teach", "sing", "repeat", "recap"], count, "recap");
      else if (signals.learning) roles = fitRoleSequence(["hook", "teach", "practice", "repeat", "recap"], count, "recap");
      else if (signals.play) roles = fitRoleSequence(["hook", "invite", "play", "play", "close"], count, "close");
      else if (signals.informative) roles = fitRoleSequence(["hook", "explain", "example", "summary"], count, "summary");
      else roles = fitRoleSequence(["hook", "develop", "reinforce", "close"], count, "close");
    }
  }
  const arcPlan = buildNarrativeArcPlan(count, lang);
  const closingRole = roles[roles.length - 1] || "close";
  const rolePools = buildRolePoolsForArc(roles, closingRole);
  const phaseOffsets = { setup: 0, rise: 0, turn: 0, close: 0 };
  const arcRoles = arcPlan.map((phase, idx) => {
    if (idx === count - 1) return closingRole;
    const pool = rolePools[phase.key] && rolePools[phase.key].length ? rolePools[phase.key] : rolePools.rise;
    const offset = phaseOffsets[phase.key] || 0;
    phaseOffsets[phase.key] = offset + 1;
    return pool[offset % pool.length] || closingRole;
  });
  return arcRoles.map((role, idx) => createBlueprintItem({
    lang,
    role,
    idx,
    total: count,
    topicProfile,
    signals,
    continuity,
    profile,
    phase: arcPlan[idx],
  }));
}

function createBlueprintItem({ lang = "ko", role, idx, total, topicProfile, signals, continuity = {}, profile = {}, phase = {} }) {
  const subject = topicProfile.subject;
  const location = pickSceneSublocation(continuity, idx, lang);
  const roleMapKo = {
    hook: { title: "흥미 유도", goal: `${subject}에 시선을 붙잡는 도입`, must: "가볍게 시작하고 바로 주제를 드러낸다" },
    teach: { title: "핵심 제시", goal: `${subject}를 한 단계씩 소개`, must: "무엇을 배울지 분명히 말한다" },
    sing: { title: "노래 전개", goal: `${subject}를 리듬과 함께 부르게 함`, must: "반복 가능한 구절을 넣는다" },
    practice: { title: "따라 하기", goal: `${subject}를 보고 듣고 따라 하게 함`, must: "반복 또는 따라 하기 행동이 있어야 한다" },
    repeat: { title: "반복 강화", goal: `${subject}를 한 번 더 익히게 함`, must: signals.humor ? "필요하면 귀여운 실수 후 바로잡기" : "이전 장면보다 더 쉽게 다시 말한다" },
    recap: { title: "복습 마무리", goal: `${subject}를 다시 확인하며 끝맺음`, must: "마지막 정리 또는 함께 외치기" },
    invite: { title: "참여 초대", goal: `${subject}를 함께 시작하게 유도`, must: "시청자에게 함께 하자고 말한다" },
    play: { title: "놀이 전개", goal: `${subject}를 놀이처럼 체험`, must: "움직임 또는 호응이 있어야 한다" },
    explain: { title: "핵심 설명", goal: `${subject}의 핵심을 명료하게 전달`, must: "요점을 분명히 설명한다" },
    example: { title: "예시 제시", goal: `${subject}를 예시로 보여줌`, must: "설명에 맞는 구체 예시 포함" },
    summary: { title: "요약 정리", goal: `${subject}를 짧게 요약`, must: "핵심만 압축해 마무리" },
    develop: { title: "전개", goal: `${subject}를 확장`, must: "앞 장면보다 한 단계 더 나아간다" },
    reinforce: { title: "강화", goal: `${subject}를 다시 확인`, must: "핵심 메시지를 재확인한다" },
    close: { title: "마무리", goal: `${subject}를 기억하게 끝냄`, must: "끝맺음이 분명해야 한다" },
    setup: { title: "상황 설정", goal: `${subject} 주변의 기본 상황을 세운다`, must: "등장 인물과 현재 상태를 분명히 보여 준다" },
    inciting: { title: "계기 발생", goal: `${subject} 전개를 밀어붙이는 계기를 만든다`, must: "다음 장면으로 넘어갈 이유가 보여야 한다" },
    turn: { title: "전환", goal: `${subject} 흐름을 한 단계 바꾼다`, must: "상황 변화나 선택이 드러나야 한다" },
    payoff: { title: "회수", goal: `${subject}의 앞선 단서를 회수한다`, must: "앞 장면과 이어지는 결과가 보여야 한다" },
    discovery: { title: "발견", goal: `${subject}의 새로운 단서를 발견한다`, must: "다음 전개를 여는 발견 요소가 있어야 한다" },
    intro: { title: "도입 소개", goal: `${subject}를 시작하며 전체 흐름을 알린다`, must: "오늘 다룰 대상과 결과물을 짚는다" },
    build: { title: "빌드업", goal: `${subject}의 리듬과 긴장을 끌어올린다`, must: "다음 반복이나 후렴으로 이어지는 준비가 보여야 한다" },
    chorus: { title: "후렴", goal: `${subject}의 반복 훅을 전면에 둔다`, must: "반복해서 따라 부를 수 있는 구간이 보여야 한다" },
    variation: { title: "변주", goal: `${subject}를 조금 다르게 다시 체험시킨다`, must: "기존 훅을 유지한 채 변화를 준다" },
    outro: { title: "아웃트로", goal: `${subject}를 여운 있게 마무리한다`, must: "마지막 후렴이나 여운을 남긴다" },
    prep: { title: "준비", goal: `${subject}를 위한 준비 단계를 보여 준다`, must: "재료나 도구, 기본 세팅을 분명히 보여 준다" },
    cook: { title: "조리", goal: `${subject}의 핵심 과정을 진행한다`, must: "실제 핵심 동작이 보이도록 한다" },
    plate: { title: "완성", goal: `${subject} 결과물을 보기 좋게 정리한다`, must: "완성 상태와 핵심 포인트를 분명히 보여 준다" },
    taste: { title: "결과 확인", goal: `${subject}의 결과와 반응을 확인한다`, must: "최종 느낌이나 판단을 짧게 남긴다" },
    arrive: { title: "도착", goal: `${subject} 현장에 들어서는 순간을 만든다`, must: "어디에 도착했는지 감각적으로 드러낸다" },
    explore: { title: "탐색", goal: `${subject} 장소를 직접 둘러보게 한다`, must: "시선이 머물 포인트를 구체적으로 보여 준다" },
    highlight: { title: "하이라이트", goal: `${subject}의 가장 강한 포인트를 전면에 둔다`, must: "이번 영상의 대표 장면이 분명해야 한다" },
    routine: { title: "루틴", goal: `${subject}의 반복되는 생활 흐름을 보여 준다`, must: "생활 리듬이 읽히는 행동이 있어야 한다" },
    moment: { title: "한순간 포착", goal: `${subject}의 감정이나 분위기를 잡아낸다`, must: "짧아도 기억에 남는 순간을 만든다" },
    reflect: { title: "정리/성찰", goal: `${subject}를 돌아보며 정리한다`, must: "앞 장면을 짚는 정리감이 있어야 한다" },
    firstlook: { title: "첫인상", goal: `${subject}의 첫 인상을 빠르게 전달한다`, must: "무엇이 가장 먼저 눈에 띄는지 말한다" },
    check: { title: "점검", goal: `${subject}를 항목별로 확인한다`, must: "실제 확인 포인트가 드러나야 한다" },
    compare: { title: "비교", goal: `${subject}를 다른 기준과 나란히 본다`, must: "비교 기준과 차이가 명확해야 한다" },
    verdict: { title: "최종 판단", goal: `${subject}에 대한 결론을 내린다`, must: "추천/비추천 또는 총평이 분명해야 한다" },
    twist: { title: "반전", goal: `${subject} 흐름에 뜻밖의 변화를 준다`, must: "리듬이나 상황을 바꾸는 반전이 있어야 한다" },
    mission: { title: "미션 제시", goal: `${subject}를 위한 목표를 세운다`, must: "이번 씬의 임무가 분명해야 한다" },
    playbeat: { title: "플레이 비트", goal: `${subject}를 행동 중심으로 밀어붙인다`, must: "직접 행동하는 장면이 있어야 한다" },
    result: { title: "결과 확인", goal: `${subject} 진행 결과를 짧게 회수한다`, must: "성공/실패나 성과가 보여야 한다" },
    warmup: { title: "워밍업", goal: `${subject} 전 몸을 준비시킨다`, must: "가벼운 준비 동작이 있어야 한다" },
    main: { title: "메인 동작", goal: `${subject}의 핵심 동작을 수행한다`, must: "주요 동작을 정확하게 보여 준다" },
    cooldown: { title: "정리 동작", goal: `${subject}를 마무리하며 호흡을 정리한다`, must: "과열된 리듬을 안정적으로 낮춘다" },
    process: { title: "과정 전개", goal: `${subject} 제작 과정을 진행한다`, must: "손동작이나 제작 단계가 보여야 한다" },
    detail: { title: "디테일", goal: `${subject}의 핵심 디테일을 보여 준다`, must: "가까이서 봐야 하는 차이를 드러낸다" },
    reveal: { title: "결과 공개", goal: `${subject}의 완성 결과를 드러낸다`, must: "완성 결과가 명확해야 한다" },
    context: { title: "맥락 설명", goal: `${subject}의 배경이나 문제의식을 짚는다`, must: "왜 이 이야기가 중요한지 설명한다" },
    point: { title: "핵심 포인트", goal: `${subject}의 가장 중요한 포인트를 세운다`, must: "하나의 중심 메시지를 분명히 남긴다" },
    problem: { title: "문제 제기", goal: `${subject}가 해결할 문제를 밝힌다`, must: "불편함이나 한계를 먼저 짚는다" },
    demo: { title: "실제 시연", goal: `${subject}를 직접 작동시켜 본다`, must: "조작과 결과가 함께 보여야 한다" },
    benefit: { title: "효용 확인", goal: `${subject}가 주는 효용을 정리한다`, must: "사용자 이익이 분명해야 한다" },
    takeaway: { title: "핵심 정리", goal: `${subject}의 결론을 간단히 남긴다`, must: "보고 나서 가져갈 요점이 있어야 한다" },
    settle: { title: "가라앉기", goal: `${subject}로 시선을 천천히 가라앉힌다`, must: "리듬을 안정시키며 시작한다" },
    immerse: { title: "몰입", goal: `${subject} 안으로 천천히 들어가게 만든다`, must: "지속적으로 머무를 감각이 있어야 한다" },
    breathe: { title: "호흡", goal: `${subject}와 함께 호흡을 맞춘다`, must: "짧은 호흡이나 따라 할 리듬이 있어야 한다" },
    scripture: { title: "말씀 제시", goal: `${subject}와 연결된 말씀을 놓는다`, must: "핵심 문구 또는 메시지를 분명히 제시한다" },
    prayer: { title: "기도", goal: `${subject}를 기도로 마무리한다`, must: "짧아도 명확한 기도 흐름이 있어야 한다" },
    voice: { title: "당사자 목소리", goal: `${subject}를 실제 목소리로 들려준다`, must: "직접 말하는 관점이 분명해야 한다" },
    insight: { title: "통찰", goal: `${subject}에서 얻은 생각을 정리한다`, must: "맥락에서 나온 통찰을 분명히 남긴다" },
    sign: { title: "징후", goal: `${subject} 주변의 이상 징후를 포착한다`, must: "불안의 첫 신호가 보여야 한다" },
    dread: { title: "긴장 고조", goal: `${subject}의 불안을 한 단계 끌어올린다`, must: "소리, 시선, 움직임으로 긴장을 누적한다" },
    solution: { title: "해결 시도", goal: `${subject} 문제를 푸는 단계를 보여 준다`, must: "장치나 선택을 통해 해결 실마리를 제시한다" },
    escape: { title: "탈출/이탈", goal: `${subject}의 긴장을 벗어나려 한다`, must: "빠져나가려는 행동이 분명해야 한다" },
  };
  const roleMapEn = {
    hook: { title: "Hook", goal: `Open with immediate interest around ${subject}`, must: "Reveal the topic quickly" },
    teach: { title: "Teach", goal: `Introduce ${subject} step by step`, must: "State clearly what is being learned" },
    sing: { title: "Song Progression", goal: `Make ${subject} singable`, must: "Add a repeatable hook line" },
    practice: { title: "Follow Along", goal: `Get the audience to repeat ${subject}`, must: "Include visible follow-along behavior" },
    repeat: { title: "Reinforcement", goal: `Repeat ${subject} once more`, must: signals.humor ? "A gentle mistake and correction is allowed" : "Say it again more simply" },
    recap: { title: "Recap", goal: `Close by recalling ${subject}`, must: "End with a recap or group repeat" },
    invite: { title: "Invite", goal: `Invite the audience into ${subject}`, must: "Ask them to join" },
    play: { title: "Play Beat", goal: `Experience ${subject} as play`, must: "Include movement or response" },
    explain: { title: "Explain", goal: `Explain ${subject} clearly`, must: "Deliver the point directly" },
    example: { title: "Example", goal: `Show an example for ${subject}`, must: "Use a concrete example" },
    summary: { title: "Summary", goal: `Summarize ${subject}`, must: "Compress the key takeaway" },
    develop: { title: "Develop", goal: `Develop ${subject}`, must: "Move one step forward from the prior scene" },
    reinforce: { title: "Reinforce", goal: `Reinforce ${subject}`, must: "Restate the core message" },
    close: { title: "Close", goal: `End with ${subject} remembered`, must: "Provide a clear closing beat" },
    setup: { title: "Setup", goal: `Establish the situation around ${subject}`, must: "Make the current status clear" },
    inciting: { title: "Inciting Beat", goal: `Trigger movement around ${subject}`, must: "Show a clear reason to move forward" },
    turn: { title: "Turn", goal: `Shift the flow of ${subject}`, must: "Make the change or choice explicit" },
    payoff: { title: "Payoff", goal: `Pay off an earlier setup around ${subject}`, must: "Show a concrete result" },
    discovery: { title: "Discovery", goal: `Discover a new clue around ${subject}`, must: "Introduce a finding that opens the next beat" },
    intro: { title: "Intro", goal: `Introduce ${subject} and its overall flow`, must: "State what will be made or covered" },
    build: { title: "Build", goal: `Build rhythm around ${subject}`, must: "Lead into the next hook or repetition" },
    chorus: { title: "Chorus", goal: `Put the repeatable hook of ${subject} front and center`, must: "The audience should be able to repeat it" },
    variation: { title: "Variation", goal: `Revisit ${subject} with a twist`, must: "Keep the hook while changing the delivery" },
    outro: { title: "Outro", goal: `Leave ${subject} with afterglow`, must: "End on a memorable final beat" },
    prep: { title: "Prep", goal: `Prepare the stage for ${subject}`, must: "Show ingredients, tools, or setup clearly" },
    cook: { title: "Cook", goal: `Perform the core process for ${subject}`, must: "Show the actual main action" },
    plate: { title: "Plate", goal: `Present the result of ${subject}`, must: "Make the finished state obvious" },
    taste: { title: "Taste", goal: `Confirm the result of ${subject}`, must: "Leave a short final reaction or judgment" },
    arrive: { title: "Arrival", goal: `Arrive at the place of ${subject}`, must: "Make the destination feel tangible" },
    explore: { title: "Explore", goal: `Explore the space of ${subject}`, must: "Show a concrete point of interest" },
    highlight: { title: "Highlight", goal: `Put the strongest point of ${subject} in front`, must: "Make the representative beat unmistakable" },
    routine: { title: "Routine", goal: `Show the repeated daily flow of ${subject}`, must: "Include a readable habit action" },
    moment: { title: "Moment", goal: `Catch a memorable moment around ${subject}`, must: "Create a brief but distinct beat" },
    reflect: { title: "Reflect", goal: `Reflect on ${subject}`, must: "Include a sense of looking back" },
    firstlook: { title: "First Look", goal: `Deliver the first impression of ${subject}`, must: "State what stands out first" },
    check: { title: "Check", goal: `Inspect ${subject}`, must: "Make the review checkpoints explicit" },
    compare: { title: "Compare", goal: `Compare ${subject} against another baseline`, must: "Make the differences explicit" },
    verdict: { title: "Verdict", goal: `Give a conclusion on ${subject}`, must: "Leave a clear verdict" },
    twist: { title: "Twist", goal: `Add a surprising change around ${subject}`, must: "Shift rhythm or situation in a visible way" },
    mission: { title: "Mission", goal: `Set the mission around ${subject}`, must: "Make the objective explicit" },
    playbeat: { title: "Play Beat", goal: `Push ${subject} through direct action`, must: "Include an active play moment" },
    result: { title: "Result", goal: `Confirm the outcome of ${subject}`, must: "Show success, failure, or progress" },
    warmup: { title: "Warm-up", goal: `Prepare the body for ${subject}`, must: "Include a gentle prep movement" },
    main: { title: "Main Move", goal: `Perform the main move for ${subject}`, must: "Show the key movement clearly" },
    cooldown: { title: "Cooldown", goal: `Wind down ${subject}`, must: "Lower the intensity in a controlled way" },
    process: { title: "Process", goal: `Advance the making process of ${subject}`, must: "Show hands-on making steps" },
    detail: { title: "Detail", goal: `Show the key detail of ${subject}`, must: "Reveal a close-up difference" },
    reveal: { title: "Reveal", goal: `Reveal the finished result of ${subject}`, must: "Make the outcome unmistakable" },
    context: { title: "Context", goal: `Explain the context behind ${subject}`, must: "State why this matters" },
    point: { title: "Point", goal: `State the core point of ${subject}`, must: "Leave one clear message" },
    problem: { title: "Problem", goal: `State the problem around ${subject}`, must: "Name the friction first" },
    demo: { title: "Demo", goal: `Demonstrate ${subject} directly`, must: "Show operation and result together" },
    benefit: { title: "Benefit", goal: `Explain the benefit of ${subject}`, must: "Make the user gain explicit" },
    takeaway: { title: "Takeaway", goal: `Leave the key takeaway of ${subject}`, must: "End with a concise conclusion" },
    settle: { title: "Settle", goal: `Let the audience settle into ${subject}`, must: "Lower the pace at the beginning" },
    immerse: { title: "Immerse", goal: `Deepen immersion in ${subject}`, must: "Create a sustained sensory hold" },
    breathe: { title: "Breathe", goal: `Sync breath with ${subject}`, must: "Include a visible breathing rhythm" },
    scripture: { title: "Scripture", goal: `Present a scripture tied to ${subject}`, must: "State the key line clearly" },
    prayer: { title: "Prayer", goal: `Close ${subject} in prayer`, must: "Leave a short clear prayer flow" },
    voice: { title: "Voice", goal: `Let a first-person voice speak on ${subject}`, must: "Make the speaker perspective clear" },
    insight: { title: "Insight", goal: `Extract insight from ${subject}`, must: "Leave an explicit insight" },
    sign: { title: "Sign", goal: `Notice the first sign around ${subject}`, must: "Show the first signal of unease" },
    dread: { title: "Dread", goal: `Raise dread around ${subject}`, must: "Accumulate tension through sound, gaze, or movement" },
    solution: { title: "Solution", goal: `Attempt a solution for ${subject}`, must: "Present a solving step or device" },
    escape: { title: "Escape", goal: `Try to escape the tension around ${subject}`, must: "Make the escape action explicit" },
  };
  const map = lang === "en" ? roleMapEn : roleMapKo;
  return Object.assign({
    role,
    index: idx + 1,
    total,
    location,
    phaseKey: phase.key || roleToNarrativePhase(role),
    phaseLabel: phase.label || (lang === "en" ? "Rise" : "승"),
    phaseGoal: phase.goal || (lang === "en" ? "Advance the overall narrative arc." : "전체 전개 흐름을 다음 단계로 보낸다."),
  }, map[role] || map.develop);
}

const VALID_BEAT_INTENSITIES = new Set(["low", "medium", "high", "climax"]);

function normalizeStoryBeatsInput(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (out.length >= 6) break;
    const action = typeof item === "string"
      ? item
      : String(item?.action || item?.text || item?.beat || "");
    const trimmed = action.replace(/\s+/g, " ").trim();
    if (!trimmed) continue;
    const isClimax = Boolean(item && typeof item === "object" && (item.isClimax === true || item.climax === true));
    const rawIntensity = item && typeof item === "object" ? String(item.intensity || "").toLowerCase().trim() : "";
    const intensity = VALID_BEAT_INTENSITIES.has(rawIntensity)
      ? rawIntensity
      : (isClimax ? "climax" : "medium");
    out.push({
      action: trimmed.length > 160 ? trimmed.slice(0, 160) : trimmed,
      isClimax,
      intensity: isClimax ? "climax" : intensity,
    });
  }
  if (out.length && !out.some((b) => b.isClimax)) {
    out[out.length - 1].isClimax = true;
    out[out.length - 1].intensity = "climax";
  }
  return out;
}

// intensity 별 권장 컷 분배 가중치 — 평균 컷 시간(초)에 곱해 차등 분배 산출.
const INTENSITY_CUT_PROFILE = {
  low:     { cutCountHint: "1-2 컷, 컷당 3~5초", cutWeight: 1.4, varietyHint: "정적·롱테이크 1컷 또는 가벼운 카메라 무브" },
  medium:  { cutCountHint: "2-3 컷, 컷당 2~3초", cutWeight: 1.0, varietyHint: "shotType 2종 이상, 1회 이상 cameraMove 변주" },
  high:    { cutCountHint: "3-4 컷, 컷당 1.5~2초", cutWeight: 0.7, varietyHint: "shotType 3종 이상, push-in/whip/quick-pan 등 강한 무브 포함" },
  climax:  { cutCountHint: "3-5 컷, 컷당 1~2초", cutWeight: 0.5, varietyHint: "ECU·CU 짧은 컷 다수, 무브 변주 필수, 정적 컷 금지" },
};

const INTENSITY_CUT_PROFILE_EN = {
  low:     { cutCountHint: "1-2 cuts, 3-5s each", cutWeight: 1.4, varietyHint: "static long take or one gentle camera move" },
  medium:  { cutCountHint: "2-3 cuts, 2-3s each", cutWeight: 1.0, varietyHint: ">=2 shotTypes, at least one cameraMove change" },
  high:    { cutCountHint: "3-4 cuts, 1.5-2s each", cutWeight: 0.7, varietyHint: ">=3 shotTypes, include strong move (push-in/whip/quick-pan)" },
  climax:  { cutCountHint: "3-5 cuts, 1-2s each", cutWeight: 0.5, varietyHint: "many ECU/CU short cuts, varied moves required, no static cut" },
};

function formatStoryBeatsForPrompt(beats, lang) {
  if (!Array.isArray(beats) || !beats.length) return "";
  const isEn = lang === "en";
  const profile = isEn ? INTENSITY_CUT_PROFILE_EN : INTENSITY_CUT_PROFILE;
  const lines = beats.map((b, i) => {
    const intensity = b.intensity || (b.isClimax ? "climax" : "medium");
    const climaxMark = b.isClimax ? (isEn ? " [CLIMAX]" : " [클라이맥스]") : "";
    const prof = profile[intensity] || profile.medium;
    const intensityLabel = isEn ? `intensity=${intensity}` : `강도=${intensity}`;
    return `  ${i + 1}. ${b.action}${climaxMark}\n     → ${intensityLabel}, ${prof.cutCountHint}, ${prof.varietyHint}`;
  });
  const header = isEn
    ? "Story beats with intensity-based cut allocation (MANDATORY COVERAGE — every beat below must be visibly represented; the CLIMAX beat must pay off in the final scene; DO NOT use uniform durations like 3-3-3-3-6-6-6, follow the per-beat cut hints below to create varied rhythm):"
    : "이야기 비트 + 강도 기반 컷 분배(필수 커버리지 — 아래 모든 비트가 시각적으로 드러나야 한다. [클라이맥스] 비트는 반드시 마지막 씬에서 페이오프. 균등 분배(3·3·3·3·6·6·6 식) 금지 — 아래 비트별 컷 가이드를 따라 리듬감 있는 차등 분배로 작성하라):";
  const rhythmRule = isEn
    ? "\n[CUT RHYTHM RULES]\n- Forbidden: 3+ consecutive scenes with identical estSec.\n- Forbidden: all scenes within ±0.5s of each other (monotonous).\n- Climax beat's scene MUST have the most cuts (shortest avg).\n- Vary scene estSec following the per-beat hints above; use decimals (e.g. 1.5, 2.5, 4) when needed."
    : "\n[컷 리듬 규칙]\n- 금지: 동일 estSec 씬이 3개 이상 연속.\n- 금지: 모든 씬의 estSec이 ±0.5초 이내로 균일 (단조로움).\n- 클라이맥스 비트의 씬은 반드시 가장 많은 컷 수(가장 짧은 평균)를 가진다.\n- 위 비트 가이드를 따라 씬 estSec을 다르게 배정하고, 필요하면 소수(예: 1.5, 2.5, 4)도 적극 사용한다.";
  return `${header}\n${lines.join("\n")}${rhythmRule}\n\n`;
}

function formatScenarioSpecForPrompt(spec = {}) {
  if (!spec) return "";
  const lang = spec.lang === "en" ? "en" : "ko";
  const activeSignals = Object.entries(spec.signals || {}).filter(([, value]) => value).map(([key]) => key).join(", ") || (lang === "en" ? "none" : "없음");
  if (lang === "en") {
    return [
      `Topic analysis: subject=${spec.topicProfile?.subject || spec.topic || "topic"}, keywords=${(spec.topicProfile?.keywords || []).join(", ") || "none"}`,
      `Overview profile: archetype=${spec.profile?.key || "generic"}, audience=${spec.target || "none"}, purpose=${(spec.needs || []).join(", ") || "none"}, tones=${(spec.tones || []).join(", ") || "none"}`,
      `Active signals: ${activeSignals}`,
      `Narrative arc: ${(spec.sceneBlueprint || []).map((item) => item.phaseLabel || item.phaseKey).join(" -> ") || "none"}`,
      `Shared background style: ${spec.continuity?.backgroundStyle || "none"}`,
      `Shared setting: place=${spec.continuity?.place || "none"} / background=${spec.continuity?.background || "none"} / props=${(spec.continuity?.props || []).join(", ") || "none"}`,
      `Required outcomes: ${(spec.requiredOutputsEn || []).join(" / ") || "none"}`,
      `Validation focus: ${(spec.validationRulesEn || []).join(" / ") || "none"}`,
    ].join("\n");
  }
  return [
    `주제 해석: 핵심 대상=${spec.topicProfile?.subject || spec.topic || "주제"}, 키워드=${(spec.topicProfile?.keywords || []).join(", ") || "없음"}`,
    `개요 프로필: 구조=${spec.profile?.key || "generic"}, 타겟=${spec.target || "없음"}, 목적=${(spec.needs || []).join(", ") || "없음"}, 톤=${(spec.tones || []).join(", ") || "없음"}`,
    `활성 시그널: ${activeSignals}`,
    `서사 아크: ${(spec.sceneBlueprint || []).map((item) => item.phaseLabel || item.phaseKey).join(" -> ") || "없음"}`,
    `공용 배경 스타일: ${spec.continuity?.backgroundStyle || "없음"}`,
    `공통 배경: 장소=${spec.continuity?.place || "없음"} / 배경=${spec.continuity?.background || "없음"} / 핵심 프롭=${(spec.continuity?.props || []).join(", ") || "없음"}`,
    `반드시 나와야 할 결과: ${(spec.requiredOutputsKo || []).join(" / ") || "없음"}`,
    `검사 포인트: ${(spec.validationRulesKo || []).join(" / ") || "없음"}`,
  ].join("\n");
}

function formatBlueprintForPrompt(spec = {}) {
  const items = Array.isArray(spec.sceneBlueprint) ? spec.sceneBlueprint : [];
  if (!items.length) return spec.lang === "en" ? "- No blueprint" : "- 블루프린트 없음";
  return items.map((item, idx) => {
    if (spec.lang === "en") return `${idx + 1}. [${item.phaseLabel || item.phaseKey || "Rise"}] ${item.title}: phaseGoal=${item.phaseGoal || "Advance the overall arc"}; goal=${item.goal}; must=${item.must}; location=${item.location || "same world"}; keep the same setting and separate sceneIntent from visual.`;
    return `${idx + 1}. [${item.phaseLabel || item.phaseKey || "승"}] ${item.title}: 막 목표=${item.phaseGoal || "전체 아크를 다음 단계로 보낸다"}; 목표=${item.goal}; 필수=${item.must}; 장소=${item.location || "같은 세계"}; 같은 공간을 유지하고 sceneIntent와 visual을 분리.`;
  }).join("\n");
}

function buildValidationFeedback(validation = {}, lang = "ko") {
  const failed = Array.isArray(validation.failed) ? validation.failed : [];
  if (!failed.length) return "";
  if (lang === "en") {
    return `Revision feedback: the previous draft failed these checks:\n${failed.map((item) => `- ${item.message}`).join("\n")}\nRewrite the scenes so every failed check is clearly satisfied.`;
  }
  return `수정 피드백: 이전 초안은 아래 조건을 충족하지 못했다.\n${failed.map((item) => `- ${item.message}`).join("\n")}\n실패한 조건이 장면 안에서 분명히 보이도록 다시 작성하라.`;
}

function normalizeTextList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[,\n]/)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function firstFilledText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function normalizeKnowledgeHubInput(body = {}, options = {}) {
  const hasNested = body.knowledgeHub && typeof body.knowledgeHub === "object";
  const nested = hasNested ? body.knowledgeHub : {};
  const source = Object.assign({}, body, nested);
  const legacyBanned = !hasNested && !String(source.manualDirectives || source.extraNotes || "").trim()
    ? source.banned
    : "";
  const characterGenerationDisabled = !!options.characterGenerationDisabled;
  return {
    brandVoice: String(source.brandVoice || "").trim(),
    brandStory: String(source.brandStory || "").trim(),
    brandCharacter: characterGenerationDisabled ? "" : String(source.brandCharacter || "").trim(),
    worldSetting: String(source.worldSetting || source.knowledgeWorld || "").trim(),
    brandRules: normalizeTextList(source.brandRules),
    bannedExpressions: normalizeTextList(source.bannedExpressions || legacyBanned),
    referenceContents: normalizeTextList(source.referenceContents),
    successCases: normalizeTextList(source.successCases),
  };
}

function shapeScenesFromModel(rawScenes = [], options = {}) {
  const characters = Array.isArray(options.characters) ? options.characters : [];
  const noCharacterMode = !!options.characterGenerationDisabled || characters.length === 0;
  const narratorSpeaker = "@narrator";
  const cameraContext = {
    lang: options.lang,
    topic: options.topic,
    purposeCategory: options.purposeCategory,
    purposeTags: options.purposeTags,
    toneText: options.toneText,
    tones: options.tones,
    styleText: options.styleText,
    styles: options.styles,
    aspectRatio: options.aspectRatio,
    sceneCount: options.sceneCount,
  };
  return (Array.isArray(rawScenes) ? rawScenes : []).map((s, idx) => {
    const narrationRaw = firstFilledText(s.narration, s.lines, s.story, s.text, s.script, s.content);
    const sceneIntentRaw = firstFilledText(s.sceneIntent, s.intent, s.goal, s.purpose);
    const sceneLocationRaw = firstFilledText(s.sceneLocation, s.location);
    const backgroundStyleRaw = firstFilledText(s.backgroundStyle, s.sharedBackgroundStyle);
    const dialogueRaw = normalizeDialogue(s.dialogue || s.dialogues || []);
    const firstLine = String(narrationRaw || "").split(/(?<=[.!?])\s+/)[0] || narrationRaw || "";
    const visualRaw = firstFilledText(s.visual, s.shot, s.scene_visual, s.camera, s.image, firstLine, `Scene ${idx + 1} visual`);
    const fallbackPer = Math.max(Math.floor((Number(options.duration) || 60) / (Number(options.sceneCount) || 7)), 3);
    const estSec = Math.max(Math.floor(Number(s.estSec || s.duration || s.len || s.length || fallbackPer)), 3);

    const narration = applyCharacterTokenHints(String(narrationRaw || "").trim(), characters);
    const dialogue = normalizeDialogue(dialogueRaw)
      .map((d) => ({
        speaker: applyCharacterTokenHints(String(d.speaker || "").trim(), characters),
        line: applyCharacterTokenHints(String(d.line || "").trim(), characters),
      }))
      .filter((d) => d.speaker || d.line);
    const visualBase = applyCharacterTokenHints(String(visualRaw || "").trim(), characters);
    const visual = ensureCameraDirectionInVisual(visualBase, Object.assign({}, cameraContext, { idx }));
    const noCharacterSafe = enforceNoCharacterPolicy({
      narration,
      dialogue,
      visual,
      noCharacterMode,
      narratorSpeaker,
      dubbingEnabled: !!options.dubbingEnabled,
      lang: options.lang,
    });

    return shapeSceneByMode({
      id: s.id != null ? s.id : idx + 1,
      title: s.title || `Scene ${idx + 1}`,
      estSec,
      sceneIntent: applyCharacterTokenHints(String(sceneIntentRaw || "").trim(), characters),
      sceneLocation: sceneLocationRaw,
      backgroundStyle: backgroundStyleRaw,
      sceneArcPhase: String(s.sceneArcPhase || s.phaseLabel || "").trim(),
      sceneArcKey: String(s.sceneArcKey || s.phaseKey || "").trim(),
      sceneArcGoal: String(s.sceneArcGoal || s.phaseGoal || "").trim(),
      narration: noCharacterSafe.narration,
      dialogue: noCharacterSafe.dialogue,
      visual: noCharacterSafe.visual,
      narrationEnabled: !!options.narrationEnabled,
      dubbingEnabled: !!options.dubbingEnabled,
      defaultSpeaker: characters[0]?.token || narratorSpeaker,
      lang: options.lang,
    });
  });
}

function fitScenesToRequestedCount(scenes = [], requestedCount = 1) {
  const limit = Math.max(1, Number(requestedCount) || 1);
  return (Array.isArray(scenes) ? scenes : []).slice(0, limit);
}

function alignScenesToScenarioSpec(scenes = [], spec = {}, options = {}) {
  const cameraContext = {
    lang: options.lang,
    topic: options.topic,
    purposeCategory: options.purposeCategory,
    purposeTags: options.purposeTags,
    toneText: options.toneText,
    tones: options.tones,
    styleText: options.styleText,
    styles: options.styles,
    aspectRatio: options.aspectRatio,
    sceneCount: options.sceneCount,
  };
  return (Array.isArray(scenes) ? scenes : []).map((scene, idx) => {
    const blueprint = spec.sceneBlueprint?.[idx] || createBlueprintItem({
      lang: spec.lang || options.lang,
      role: "develop",
      idx,
      total: scenes.length,
      topicProfile: spec.topicProfile || { subject: spec.topic || "주제" },
      signals: spec.signals || {},
      profile: spec.profile || {},
    });
    const hints = buildHintText(spec, blueprint, spec.lang || options.lang);
    const estSec = Math.max(Number(scene.estSec) || 0, 3);
    const sceneIntent = selectSceneIntentBase(firstFilledText(scene.sceneIntent, scene.intent, scene.goal), hints.intent);
    const sceneLocation = firstFilledText(scene.sceneLocation, scene.location, hints.location, blueprint.location);
    const backgroundStyle = firstFilledText(scene.backgroundStyle, hints.backgroundStyle, spec.continuity?.backgroundStyle);
    const narration = options.narrationEnabled
      ? fitNarrationToDuration(selectNarrationBase(scene.narration, hints.narration), estSec, options.lang)
      : scene.narration;
    const dialogue = trimDialogueToDuration(repairDialogue(scene.dialogue || [], hints.dialogue, {
      dubbingEnabled: options.dubbingEnabled,
      defaultSpeaker: options.defaultSpeaker || "@narrator",
      forceHumor: !!spec.signals?.humor && blueprint.role === "repeat",
    }), estSec, options.lang);
    const aiVisual = String(scene.visual || "").trim();
    const visual = aiVisual.length > 30
      ? ensureCameraDirectionInVisual(aiVisual, Object.assign({}, cameraContext, { idx, spec }))
      : mergeVisual(aiVisual, hints.visual, Object.assign({}, cameraContext, { idx, spec }));
    return shapeSceneByMode({
      id: scene.id != null ? scene.id : idx + 1,
      title: blueprint.title || scene.title || `Scene ${idx + 1}`,
      estSec,
      sceneIntent,
      sceneLocation,
      backgroundStyle,
      sceneArcPhase: blueprint.phaseLabel,
      sceneArcKey: blueprint.phaseKey,
      sceneArcGoal: blueprint.phaseGoal,
      narration,
      dialogue,
      visual,
      narrationEnabled: !!options.narrationEnabled,
      dubbingEnabled: !!options.dubbingEnabled,
      defaultSpeaker: options.defaultSpeaker || "@narrator",
      lang: options.lang,
    });
  });
}

function pickSceneSublocation(continuity = {}, index = 0, lang = "ko") {
  const list = Array.isArray(continuity.sublocations) ? continuity.sublocations.filter(Boolean) : [];
  if (!list.length) return lang === "en" ? "the same focal area" : "같은 중심 공간";
  return list[index % list.length];
}

function buildLocationBackdrop(location = "", lang = "ko") {
  const raw = String(location || "").trim();
  if (!raw) return lang === "en" ? "Shared world details stay visible in the background." : "공용 배경 디테일이 자연스럽게 이어진다.";
  const lower = raw.toLowerCase();
  if (/마을|village/.test(lower)) return lang === "en" ? "Round houses, a signpost, and a soft path sit behind them." : "뒤쪽에는 둥근 집과 표지판, 부드러운 흙길이 보인다.";
  if (/들판|field|meadow/.test(lower)) return lang === "en" ? "Wide grass, flower patches, and a low hill spread behind them." : "뒤쪽에는 넓은 풀밭과 꽃무리, 낮은 언덕이 펼쳐져 있다.";
  if (/숲|forest|woods/.test(lower)) return lang === "en" ? "Simple trees, leafy shadows, and a winding trail fill the background." : "뒤쪽에는 단순한 나무들과 잎 그림자, 구불한 산책길이 이어진다.";
  if (/하늘|sky/.test(lower)) return lang === "en" ? "Cloud paths, floating platforms, and open sky fill the distance." : "멀리에는 구름길과 떠 있는 발판, 넓게 열린 하늘이 보인다.";
  if (/교실|놀이방|classroom|playroom/.test(lower)) return lang === "en" ? "A bright wall, learning posters, and neat floor props stay in view." : "밝은 벽면과 학습 포스터, 단정한 바닥 소품이 함께 보인다.";
  if (/준비대|테이블|desk|table/.test(lower)) return lang === "en" ? "Neat tools, supporting props, and a clear work surface stay visible behind the subject." : "뒤쪽에는 정돈된 도구와 보조 소품, 분명한 작업면이 함께 보인다.";
  if (/주방|싱크대|조리대|kitchen|counter|stove/.test(lower)) return lang === "en" ? "Utensils, ingredients, and a clean counter line stay visible behind the action." : "뒤쪽에는 조리도구와 재료, 정돈된 조리대 라인이 함께 보인다.";
  if (/광장|골목|전망|거리|plaza|alley|viewpoint|street/.test(lower)) return lang === "en" ? "Signage, footpaths, and local details keep the place readable in the background." : "뒤쪽에는 표지판과 동선, 현장감 있는 지역 디테일이 이어진다.";
  if (/무대|스테이지|stage|arena/.test(lower)) return lang === "en" ? "Stage lights, side props, and a clear performance lane stay in frame." : "무대 조명과 사이드 소품, 분명한 퍼포먼스 동선이 화면에 남아 있다.";
  if (/존|코너|라인|구역|spot|zone|corner|lane/.test(lower)) return lang === "en" ? "Side props, floor markings, and shared environmental details keep the zone readable." : "사이드 소품과 바닥 표시, 공용 환경 디테일이 그 구역의 성격을 살린다.";
  if (/디바이스|디스플레이|콘솔|랩|device|display|console|lab/.test(lower)) return lang === "en" ? "Screens, indicator lights, and tidy devices stay visible around the demo zone." : "주변에는 화면, 상태 표시등, 정리된 기기들이 함께 보인다.";
  if (/현관|주방 테이블|창가|entryway|window seat|living/.test(lower)) return lang === "en" ? "Daily objects, soft light, and lived-in details stay in the background." : "생활 소품과 부드러운 빛, 익숙한 일상 디테일이 뒤쪽에 이어진다.";
  if (/기도|말씀|묵상|prayer|scripture|reflection/.test(lower)) return lang === "en" ? "A quiet table, gentle light, and still surrounding objects keep the scene calm." : "고요한 테이블과 은은한 빛, 차분한 주변 소품이 장면을 감싼다.";
  if (/복도|현관|계단|room|corridor|hall|stairs|door/.test(lower)) return lang === "en" ? "A narrow passage, closed doors, and uneasy shadows remain in the background." : "좁은 통로와 닫힌 문, 불안한 그림자가 뒤쪽에 남아 있다.";
  if (/도킹|홀로그램|관측|control|hologram|docking|observation/.test(lower)) return lang === "en" ? "Panels, glowing interfaces, and structural rails anchor the futuristic background." : "패널과 빛나는 인터페이스, 구조 레일이 미래적인 배경을 만든다.";
  return lang === "en" ? "Shared world details stay visible in the background." : "공용 배경 디테일이 자연스럽게 이어진다.";
}

function pickSceneSpeakers(spec = {}, blueprint = {}) {
  const list = Array.isArray(spec.characters) ? spec.characters.filter((row) => row && row.token) : [];
  if (!list.length) return { primary: "@narrator", secondary: "@narrator", hasCharacters: false };
  const baseIndex = Math.max((blueprint.index || 1) - 1, 0) % list.length;
  const primary = list[baseIndex]?.token || list[0].token;
  const secondary = list[(baseIndex + 1) % list.length]?.token || primary;
  return { primary, secondary, hasCharacters: true };
}

function mapRoleToHintRole(role = "") {
  const alias = {
    setup: "hook",
    inciting: "develop",
    discovery: "develop",
    turn: "develop",
    payoff: "recap",
    intro: "hook",
    build: "develop",
    chorus: "sing",
    variation: "repeat",
    outro: "close",
    prep: "teach",
    cook: "develop",
    plate: "example",
    taste: "summary",
    arrive: "hook",
    explore: "develop",
    highlight: "reinforce",
    routine: "develop",
    moment: "example",
    reflect: "summary",
    firstlook: "hook",
    check: "example",
    compare: "reinforce",
    verdict: "summary",
    twist: "repeat",
    mission: "hook",
    playbeat: "play",
    result: "summary",
    warmup: "invite",
    main: "practice",
    cooldown: "close",
    process: "develop",
    detail: "example",
    reveal: "recap",
    context: "explain",
    point: "reinforce",
    problem: "hook",
    demo: "example",
    benefit: "reinforce",
    takeaway: "summary",
    settle: "hook",
    immerse: "develop",
    breathe: "practice",
    scripture: "explain",
    prayer: "close",
    voice: "example",
    insight: "summary",
    sign: "hook",
    dread: "develop",
    solution: "reinforce",
    escape: "close",
  };
  return alias[role] || role || "develop";
}

function getProfileActors(spec = {}, lang = "ko") {
  const profileActors = spec.profile?.actors;
  const fallback = lang === "en"
    ? ARCHETYPE_LIBRARY.generic.actorsEn
    : ARCHETYPE_LIBRARY.generic.actorsKo;
  return profileActors || fallback;
}

function ensureSentence(text = "", lang = "ko") {
  const clean = String(text || "").trim();
  if (!clean) return "";
  return /[.!?。！？]$/.test(clean) ? clean : `${clean}${lang === "en" ? "." : "."}`;
}

function buildLightingCue(sceneLocation = "", lang = "ko") {
  const lower = String(sceneLocation || "").toLowerCase();
  if (/교실|놀이방|스튜디오|무대|classroom|playroom|studio|stage/.test(lower)) {
    return lang === "en"
      ? "Soft daylight and even overhead light keep the set readable."
      : "부드러운 낮빛과 고른 실내 조명이 소품 윤곽을 또렷하게 남긴다.";
  }
  if (/숲|들판|하늘|광장|골목|전망|forest|field|sky|plaza|alley|viewpoint|street/.test(lower)) {
    return lang === "en"
      ? "Natural light outlines the ground and the object edges clearly."
      : "자연광이 바닥 결과 사물 가장자리를 또렷하게 드러낸다.";
  }
  if (/주방|싱크대|조리대|집|거실|kitchen|sink|counter|home|living/.test(lower)) {
    return lang === "en"
      ? "Warm practical light stays on the work surface and hands."
      : "생활 조명이 작업면과 손동작 위에 고르게 걸린다.";
  }
  return lang === "en"
    ? "The available light keeps the main subject and props readable."
    : "현재 조명이 인물과 소품의 윤곽을 분명하게 남긴다.";
}

function buildStructuredVisual({
  lang = "ko",
  sceneLocation = "",
  placement = "",
  action = "",
  backdrop = "",
  cameraContext = {},
  lighting = "",
}) {
  const locationSentence = lang === "en"
    ? `${sceneLocation || "the same location"}, a medium-wide frame that holds the subject and main props together`
    : `${sceneLocation || "같은 중심 공간"}, 인물과 주요 소품이 함께 들어오는 미디엄 와이드 프레임`;
  const placementSentence = placement || (lang === "en"
    ? "The main subject stays near the center and the supporting props remain visible around it"
    : "주요 인물은 화면 중심 가까이에 서 있고 보조 소품이 주변에 남아 있다");
  const actionSentence = action || (lang === "en"
    ? "One clear physical action happens in the frame"
    : "프레임 안에서 하나의 분명한 물리적 행동이 일어난다");
  const cameraSentence = lang === "en"
    ? `Camera direction: ${buildCameraDirectionSnippet(Object.assign({}, cameraContext, { lang }))}`
    : `카메라 연출: ${buildCameraDirectionSnippet(Object.assign({}, cameraContext, { lang }))}`;
  const lightingSentence = lighting || buildLightingCue(sceneLocation, lang);
  return [
    ensureSentence(locationSentence, lang),
    ensureSentence(placementSentence, lang),
    ensureSentence(actionSentence, lang),
    ensureSentence(cameraSentence, lang),
    ensureSentence(backdrop || lightingSentence, lang),
  ].filter(Boolean).join(" ");
}

function isAudienceReactionIntent(text = "") {
  const clean = String(text || "").trim();
  if (!clean) return false;
  return /(관객이|시청자가|보는 사람이|viewer|audience)/i.test(clean);
}

function containsForbiddenVisualPhrase(text = "") {
  const clean = stripCameraDirection(text);
  if (!clean) return false;
  return /느낌|분위기|아름다운|감동적인|화려한|따뜻한 톤|세련된|역동적인|인상적인|드라마틱한|감성적인|몽환적인|feels like|atmospheric|beautiful|touching|flashy|warm tone|stylish|dynamic|impressive|dramatic|emotional|dreamlike/i.test(clean);
}

function buildAudienceReactionIntent({ role = "", subject = "", lang = "ko", humor = false }) {
  const roleKey = String(role || "").trim();
  if (lang === "en") {
    const intents = {
      hook: `The viewer stops and wonders what will happen with ${subject}.`,
      teach: `The viewer locks onto the first key point of ${subject}.`,
      sing: `The viewer wants to repeat ${subject} with the rhythm.`,
      practice: `The viewer wants to copy ${subject} right away.`,
      repeat: humor
        ? `The viewer laughs at the brief mistake and refocuses on ${subject}.`
        : `The viewer remembers ${subject} after one more repetition.`,
      recap: `The viewer feels the closing recap beat while checking ${subject} one last time.`,
      invite: `The viewer feels pulled into joining ${subject}.`,
      play: `The viewer wants to move along with ${subject} like a game.`,
      explain: `The viewer understands the key point of ${subject} in one glance.`,
      example: `The viewer understands ${subject} through a concrete example.`,
      summary: `The viewer keeps only the essential summary point of ${subject} in memory.`,
      develop: `The viewer expects the next beat of ${subject}.`,
      reinforce: `The viewer does not miss the core point of ${subject}.`,
      close: `The viewer leaves with the final closing image of ${subject} still in mind.`,
    };
    return intents[roleKey] || `The viewer expects the next clear beat of ${subject}.`;
  }
  const intents = {
    hook: `관객이 "${subject}는 어떻게 시작되지?" 하고 화면에 시선을 멈춘다.`,
    teach: `관객이 ${subject}의 첫 핵심을 한눈에 붙잡는다.`,
    sing: `관객이 리듬을 듣고 ${subject}를 바로 따라 하고 싶어진다.`,
    practice: `관객이 지금 바로 ${subject}를 따라 해보고 싶어진다.`,
    repeat: humor
      ? `관객이 잠깐의 실수를 보고 웃다가 ${subject}에 다시 집중한다.`
      : `관객이 한 번 더 반복된 ${subject}를 기억에 남긴다.`,
    recap: `관객이 ${subject}를 함께 확인하며 마무리 감각을 얻는다.`,
    invite: `관객이 화면 안으로 불려 들어온 듯 ${subject}에 참여하고 싶어진다.`,
    play: `관객이 ${subject}를 놀이처럼 따라 움직이고 싶어진다.`,
    explain: `관객이 ${subject}의 핵심을 한 번에 이해한다.`,
    example: `관객이 구체 예시를 보고 ${subject}를 자기 일처럼 이해한다.`,
    summary: `관객이 ${subject}의 핵심만 정리된 상태로 또렷하게 기억한다.`,
    develop: `관객이 다음 장면에서 ${subject}가 어떻게 이어질지 기대한다.`,
    reinforce: `관객이 ${subject}의 핵심 포인트를 놓치지 않는다.`,
    close: `관객이 ${subject}의 마지막 마무리 이미지를 기억한 채 장면을 떠난다.`,
  };
  return intents[roleKey] || `관객이 ${subject}의 다음 전개를 기대한다.`;
}

function buildHintText(spec = {}, blueprint = {}, lang = "ko") {
  const subject = spec.topicProfile?.subject || spec.topic || (lang === "en" ? "the topic" : "주제");
  const backgroundStyle = spec.continuity?.backgroundStyle || (lang === "en" ? "one consistent visual world" : "하나의 일관된 시각 세계");
  const prop = (spec.continuity?.props || [buildSubjectPropCue({ lang, subject, signals: spec.signals || {}, profile: spec.profile || {} })])[0];
  const sceneLocation = blueprint.location || pickSceneSublocation(spec.continuity || {}, Math.max((blueprint.index || 1) - 1, 0), lang);
  const locationBackdrop = buildLocationBackdrop(sceneLocation, lang);
  const speakers = pickSceneSpeakers(spec, blueprint);
  const actors = getProfileActors(spec, lang);
  const primarySpeaker = speakers.primary;
  const secondarySpeaker = speakers.secondary;
  const role = mapRoleToHintRole(blueprint.role || "develop");
  const visualFor = (placement, action) => buildStructuredVisual({
    lang,
    sceneLocation,
    placement,
    action,
    backdrop: locationBackdrop,
    cameraContext: {
      lang,
      idx: Math.max((blueprint.index || 1) - 1, 0),
      spec,
    },
  });
  if (lang === "en") {
    const hints = {
      hook: {
        intent: buildAudienceReactionIntent({ role: "hook", subject, lang }),
        narration: `Hi there! Let's start ${subject} right away together.`,
        location: sceneLocation,
        backgroundStyle,
        visual: visualFor(
          `A smiling child group stands around ${prop} and keeps the center of the frame open for the first move`,
          `The group leans in toward ${prop} and pauses right before starting ${subject}`
        ),
        dialogue: [`${primarySpeaker}: Ready? Let's begin ${subject}!`],
      },
      teach: {
        intent: buildAudienceReactionIntent({ role: "teach", subject, lang }),
        narration: `Let's learn ${subject} one step at a time.`,
        location: sceneLocation,
        backgroundStyle,
        visual: visualFor(
          `One friend stands beside ${prop} while the rest of the group stays behind in a loose row`,
          `The lead friend lifts ${prop} and points to the first visible part of ${subject}`
        ),
        dialogue: [`${primarySpeaker}: Say it with me, ${subject}!`],
      },
      sing: {
        intent: buildAudienceReactionIntent({ role: "sing", subject, lang }),
        narration: `Now sing ${subject} with the beat together.`,
        location: sceneLocation,
        backgroundStyle,
        visual: visualFor(
          `The group forms a shallow arc around ${prop} so every face and the prop stay visible`,
          `They shake ${prop} in rhythm and repeat ${subject} together on the beat`
        ),
        dialogue: [`${primarySpeaker}: ${subject}, one more time!`],
      },
      practice: {
        intent: buildAudienceReactionIntent({ role: "practice", subject, lang }),
        narration: `Watch and repeat ${subject} with me.`,
        location: sceneLocation,
        backgroundStyle,
        visual: visualFor(
          `The friends line up beside ${prop} one after another while the guide keeps one hand ready at the edge of frame`,
          `They tap ${prop} one by one and repeat ${subject} in the same order`
        ),
        dialogue: [`${primarySpeaker}: Follow along with ${subject}!`],
      },
      repeat: {
        intent: buildAudienceReactionIntent({ role: "repeat", subject, lang, humor: !!spec.signals?.humor }),
        narration: spec.signals?.humor
          ? `Oops, that was almost wrong. Let's do ${subject} again together.`
          : `One more time. Let's repeat ${subject} together.`,
        location: sceneLocation,
        backgroundStyle,
        visual: spec.signals?.humor
          ? visualFor(
            `One friend holds ${prop} slightly off center while the others stay packed close enough to react in frame`,
            `The lead friend fumbles the order once, then fixes ${prop} immediately as the others point to the correct part`
          )
          : visualFor(
            `The group stands close together with ${prop} raised between them at chest height`,
            `They repeat ${subject} once more while holding ${prop} still for emphasis`
          ),
        dialogue: spec.signals?.humor
          ? [`${primarySpeaker}: Oops, one more time!`, `${secondarySpeaker}: That's it, ${subject}!`]
          : [`${primarySpeaker}: Once again, ${subject}!`],
      },
      recap: {
        intent: buildAudienceReactionIntent({ role: "recap", subject, lang }),
        narration: `Great job. Let's check ${subject} one last time.`,
        location: sceneLocation,
        backgroundStyle,
        visual: visualFor(
          `Everyone gathers tightly around ${prop} so the final answer and every hand remain in frame`,
          `They point to the last key part of ${subject} together and hold the pose for a beat`
        ),
        dialogue: [`${primarySpeaker}: Great job, ${subject}!`],
      },
      invite: {
        intent: buildAudienceReactionIntent({ role: "invite", subject, lang }),
        narration: `Come on in. Join ${subject} with us.`,
        location: sceneLocation,
        backgroundStyle,
        visual: visualFor(
          `A guide character stands beside ${prop} with one arm already lifted toward the lens`,
          `The guide waves toward the camera and opens a space next to ${prop} for ${subject}`
        ),
        dialogue: [`${primarySpeaker}: Come join ${subject}!`],
      },
      play: {
        intent: buildAudienceReactionIntent({ role: "play", subject, lang }),
        narration: `Let's enjoy ${subject} like a fun game together.`,
        location: sceneLocation,
        backgroundStyle,
        visual: visualFor(
          `The group circles ${prop} in a loose ring so hands and feet stay visible together`,
          `They clap once and step around ${prop} as ${subject} turns into a game beat`
        ),
        dialogue: [`${primarySpeaker}: Let's play along with ${subject}!`],
      },
      explain: {
        intent: buildAudienceReactionIntent({ role: "explain", subject, lang }),
        narration: `Here is the key point of ${subject}.`,
        location: sceneLocation,
        backgroundStyle,
        visual: visualFor(
          `A presenter stands on one side of ${prop} while the key reference surface stays open on the other side`,
          `The presenter taps the main point of ${subject} with one clear pointing gesture`
        ),
        dialogue: [`${primarySpeaker}: This is the key point of ${subject}.`],
      },
      example: {
        intent: buildAudienceReactionIntent({ role: "example", subject, lang }),
        narration: `This example makes ${subject} easy to understand.`,
        location: sceneLocation,
        backgroundStyle,
        visual: visualFor(
          `The presenter places ${prop} in the foreground while the comparison area stays visible behind it`,
          `A concrete example with ${prop} is demonstrated so ${subject} becomes immediately readable`
        ),
        dialogue: [`${primarySpeaker}: This example makes ${subject} easier to see.`],
      },
      summary: {
        intent: buildAudienceReactionIntent({ role: "summary", subject, lang }),
        narration: `Let's remember the key part of ${subject}.`,
        location: sceneLocation,
        backgroundStyle,
        visual: visualFor(
          `The key words of ${subject} stay fixed beside ${prop} while the presenter holds still next to them`,
          `The presenter draws one short line under the final point and then stops`
        ),
        dialogue: [`${primarySpeaker}: Remember the key point of ${subject}.`],
      },
      develop: {
        intent: buildAudienceReactionIntent({ role: "develop", subject, lang }),
        narration: `Now let's take ${subject} one step further.`,
        location: sceneLocation,
        backgroundStyle,
        visual: visualFor(
          `The group keeps ${prop} near the center while the next position opens up at one side of the frame`,
          `They slide ${prop} into the next marked spot so ${subject} clearly moves forward`
        ),
        dialogue: [`${primarySpeaker}: Now let's take the next step.`],
      },
      reinforce: {
        intent: buildAudienceReactionIntent({ role: "reinforce", subject, lang }),
        narration: `Yes, this is the core of ${subject}.`,
        location: sceneLocation,
        backgroundStyle,
        visual: visualFor(
          `The guide holds ${prop} near the lens while the rest of the set stays softly visible behind`,
          `The guide brings the core part of ${subject} close to camera and holds it there for emphasis`
        ),
        dialogue: [`${primarySpeaker}: Yes, this is the core of ${subject}.`],
      },
      close: {
        intent: buildAudienceReactionIntent({ role: "close", subject, lang }),
        narration: `See you again next time with ${subject}.`,
        location: sceneLocation,
        backgroundStyle,
        visual: visualFor(
          `The group stands beside ${prop} in a clean line with enough empty space to hold the last image`,
          `They wave once toward the camera and leave ${subject} visible in the frame`
        ),
        dialogue: [`${primarySpeaker}: See you again with ${subject}!`],
      },
    };
    return hints[role] || hints.close;
  }

  const hints = {
    hook: {
      intent: buildAudienceReactionIntent({ role: "hook", subject, lang }),
      narration: `안녕! 오늘은 ${subject}를 바로 시작해볼까?`,
      location: sceneLocation,
      backgroundStyle,
      visual: visualFor(
        `${actors.group} ${prop} 앞에 모여 서 있고 프레임 중심이 비어 있어 첫 동작이 바로 보인다`,
        `${actors.group} ${prop} 쪽으로 몸을 기울이며 ${subject}를 시작하기 직전의 멈춤을 만든다`
      ),
      dialogue: [`${primarySpeaker}: 준비됐지? ${subject} 시작!`],
    },
    teach: {
      intent: buildAudienceReactionIntent({ role: "teach", subject, lang }),
      narration: `${subject}를 하나씩 같이 배워보자.`,
      location: sceneLocation,
      backgroundStyle,
      visual: visualFor(
        `${actors.lead} ${prop} 옆에 서 있고 나머지 인물은 뒤쪽에 반원으로 남아 있다`,
        `${actors.lead} ${prop}를 들어 올리고 ${subject}의 첫 핵심을 다른 손으로 가리킨다`
      ),
      dialogue: [`${primarySpeaker}: ${subject}를 같이 따라 해볼까?`],
    },
    sing: {
      intent: buildAudienceReactionIntent({ role: "sing", subject, lang }),
      narration: `${subject}, 박자에 맞춰 함께 불러보자!`,
      location: sceneLocation,
      backgroundStyle,
      visual: visualFor(
        `${actors.group} ${prop}를 가운데 두고 얕은 곡선으로 서 있어 얼굴과 소품이 함께 보인다`,
        `${actors.group} ${prop}를 흔들며 ${subject}를 같은 박자로 반복한다`
      ),
      dialogue: [`${primarySpeaker}: ${subject}, 한 번 더!`],
    },
    practice: {
      intent: buildAudienceReactionIntent({ role: "practice", subject, lang }),
      narration: `이번엔 보고 듣고 ${subject}를 따라 해보자.`,
      location: sceneLocation,
      backgroundStyle,
      visual: visualFor(
        `${actors.group} ${prop} 옆에 한 줄로 서 있고 안내 손동작이 프레임 가장자리에서 기다린다`,
        `${actors.group} ${prop}를 하나씩 짚으며 ${subject}를 같은 순서로 따라 한다`
      ),
      dialogue: [`${primarySpeaker}: 이번엔 우리 같이 ${subject}를 따라 해보자!`],
    },
    repeat: {
      intent: buildAudienceReactionIntent({ role: "repeat", subject, lang, humor: !!spec.signals?.humor }),
      narration: spec.signals?.humor
        ? `어? 잠깐 헷갈렸네. 괜찮아, ${subject} 다시 해보자!`
        : `좋아, ${subject}를 한 번 더 해보자.`,
      location: sceneLocation,
      backgroundStyle,
      visual: spec.signals?.humor
        ? visualFor(
          `${actors.lead} ${prop}를 살짝 비뚤게 들고 있고 ${actors.closer}는 바로 옆에서 반응할 준비를 한다`,
          `${actors.lead} ${subject} 순서를 잠깐 헷갈렸다가 ${actors.closer}가 올바른 쪽을 가리키자 바로 다시 고친다`
        )
        : visualFor(
          `${actors.group} ${prop}를 가슴 높이로 함께 들고 있어 중심 정보가 한눈에 보인다`,
          `${actors.group} ${subject}를 한 번 더 같은 순서로 반복한다`
        ),
      dialogue: spec.signals?.humor
        ? [`${primarySpeaker}: 어? 잠깐 헷갈렸네!`, `${secondarySpeaker}: 괜찮아, ${subject} 다시!`]
        : [`${primarySpeaker}: 좋아, ${subject} 한 번 더!`],
    },
    recap: {
      intent: buildAudienceReactionIntent({ role: "recap", subject, lang }),
      narration: `잘했어! 마지막으로 ${subject}를 한 번만 더 확인하자.`,
      location: sceneLocation,
      backgroundStyle,
      visual: visualFor(
        `${actors.closer} ${prop} 주위로 가까이 모여 손과 표정이 함께 프레임에 남는다`,
        `${actors.closer} ${subject}의 마지막 핵심을 함께 가리킨 채 한 박자 멈춘다`
      ),
      dialogue: [`${primarySpeaker}: 잘했어! ${subject} 기억났지?`],
    },
    invite: {
      intent: buildAudienceReactionIntent({ role: "invite", subject, lang }),
      narration: `우리와 함께 ${subject}를 해볼까?`,
      location: sceneLocation,
      backgroundStyle,
      visual: visualFor(
        `${actors.guide} ${prop} 옆에 서서 한 손을 카메라 쪽으로 내민다`,
        `${actors.guide} 렌즈를 향해 손짓하며 ${subject}에 함께 들어오라고 부른다`
      ),
      dialogue: [`${primarySpeaker}: 같이 해볼까? ${subject}!`],
    },
    play: {
      intent: buildAudienceReactionIntent({ role: "play", subject, lang }),
      narration: `${subject}를 놀이처럼 신나게 즐겨보자!`,
      location: sceneLocation,
      backgroundStyle,
      visual: visualFor(
        `${actors.group} ${prop} 둘레로 느슨한 원을 만들고 손과 발이 모두 보이게 선다`,
        `${actors.group} 한 번 손뼉을 치고 ${prop} 주위를 돌며 ${subject}를 몸으로 체험한다`
      ),
      dialogue: [`${primarySpeaker}: 몸으로도 같이 해보자!`],
    },
    explain: {
      intent: buildAudienceReactionIntent({ role: "explain", subject, lang }),
      narration: `${subject}의 핵심은 바로 이거야.`,
      location: sceneLocation,
      backgroundStyle,
      visual: visualFor(
        `${actors.guide} ${prop} 한쪽에 서 있고 반대편에는 핵심 정보 면이 비어 있다`,
        `${actors.guide} ${subject}의 핵심 지점을 한 번 또렷하게 짚는다`
      ),
      dialogue: [`${primarySpeaker}: 핵심은 ${subject}야.`],
    },
    example: {
      intent: buildAudienceReactionIntent({ role: "example", subject, lang }),
      narration: `이 예시를 보면 ${subject}가 더 쉬워져.`,
      location: sceneLocation,
      backgroundStyle,
      visual: visualFor(
        `${actors.lead} ${prop}를 전경 쪽에 놓고 뒤쪽에는 비교 대상이 함께 남아 있다`,
        `${actors.lead} ${prop}를 이용한 구체 예시를 한 번 시연해 ${subject}를 바로 읽히게 만든다`
      ),
      dialogue: [`${primarySpeaker}: 이렇게 보면 더 쉬워.`],
    },
    summary: {
      intent: buildAudienceReactionIntent({ role: "summary", subject, lang }),
      narration: `${subject}의 핵심만 짧게 기억하자.`,
      location: sceneLocation,
      backgroundStyle,
      visual: visualFor(
        `${actors.guide} ${prop} 옆에 멈춰 서 있고 핵심 단어만 보이는 공간을 남긴다`,
        `${actors.guide} ${subject}의 마지막 요점 아래에 짧은 표시선을 긋고 멈춘다`
      ),
      dialogue: [`${primarySpeaker}: 핵심만 다시 기억하자!`],
    },
    develop: {
      intent: buildAudienceReactionIntent({ role: "develop", subject, lang }),
      narration: `이제 ${subject}를 다음 단계로 가보자.`,
      location: sceneLocation,
      backgroundStyle,
      visual: visualFor(
        `${actors.group} ${prop}를 가운데에 두고 다음 위치로 열리는 공간을 한쪽에 남겨 둔다`,
        `${actors.group} ${prop}를 다음 표시 지점으로 옮기며 ${subject}를 한 단계 더 전개한다`
      ),
      dialogue: [`${primarySpeaker}: 이제 다음으로 가보자!`],
    },
    reinforce: {
      intent: buildAudienceReactionIntent({ role: "reinforce", subject, lang }),
      narration: `맞아, 이게 ${subject}의 핵심이야.`,
      location: sceneLocation,
      backgroundStyle,
      visual: visualFor(
        `${actors.guide} ${prop}를 렌즈 가까이에 들고 뒤쪽 세트는 흐리지 않을 만큼만 남긴다`,
        `${actors.guide} ${subject}의 핵심 포인트를 카메라 가까이에서 다시 보여 준다`
      ),
      dialogue: [`${primarySpeaker}: 맞아, 이게 핵심이야!`],
    },
    close: {
      intent: buildAudienceReactionIntent({ role: "close", subject, lang }),
      narration: `다음에도 ${subject}로 또 만나자!`,
      location: sceneLocation,
      backgroundStyle,
      visual: visualFor(
        `${actors.closer} ${prop} 옆에 가지런히 서 있고 마지막 이미지를 담을 빈 공간이 화면 한쪽에 남아 있다`,
        `${actors.closer} 카메라를 향해 한 번 손을 흔들고 ${subject}가 보이는 상태로 멈춘다`
      ),
      dialogue: [`${primarySpeaker}: 다음에도 ${subject}로 또 만나자!`],
    },
  };
  return hints[role] || hints.close;
}

function validateScenarioAgainstSpec(scenes = [], spec = {}) {
  const results = [];
  const sceneList = Array.isArray(scenes) ? scenes : [];
  const joined = sceneList.map((scene) => {
    const dialogueText = Array.isArray(scene.dialogue) ? scene.dialogue.map((d) => d.line || "").join(" ") : "";
    return [scene.title, scene.sceneIntent, scene.visual, scene.narration, scene.lines, dialogueText].filter(Boolean).join(" ");
  }).join(" ");
  const fullText = String(joined || "").toLowerCase();
  const avgNarrationLength = averageLength(sceneList.map((scene) => scene.narration || ""));
  const avgDialogueLength = averageLength(sceneList.flatMap((scene) => Array.isArray(scene.dialogue) ? scene.dialogue.map((row) => row.line || "") : []));
  const subjectKeywords = uniqueStrings([spec.topicProfile?.subject, ...(spec.topicProfile?.keywords || [])]).slice(0, 3);
  const hasSubject = !subjectKeywords.length || subjectKeywords.some((keyword) => keyword && fullText.includes(String(keyword).toLowerCase()));
  results.push({
    key: "topic_subject",
    passed: hasSubject,
    message: spec.lang === "en"
      ? "The core topic subject should appear in the scenario."
      : "시나리오 안에 핵심 주제가 직접 드러나야 한다.",
  });

  if (spec.signals?.learning) {
    results.push({
      key: "learning_structure",
      passed: /(따라|배워|익혀|복습|다시|하나씩|가르치|연습|follow|repeat|learn|recap|practice)/i.test(joined),
      message: spec.lang === "en"
        ? "Learning-oriented setups need teach/repeat/recap cues."
        : "학습형 개요에는 가르치기, 반복, 복습 단서가 있어야 한다.",
    });
  }
  if (spec.signals?.play) {
    results.push({
      key: "participation",
      passed: /(함께|같이|따라|놀|춤|손뼉|움직|join|follow along|play|together|clap|dance)/i.test(joined),
      message: spec.lang === "en"
        ? "Play-oriented setups need participation cues."
        : "놀이 목적에는 함께 하기 또는 따라 하기 요소가 있어야 한다.",
    });
  }
  if (spec.signals?.song) {
    results.push({
      key: "song_pattern",
      passed: /(동요|노래|리듬|후렴|sing|song|rhythm|melody|랄라|a,\s*b,\s*c|a b c)/i.test(joined),
      message: spec.lang === "en"
        ? "Song-oriented setups need a song or hook pattern."
        : "동요/노래형 개요에는 노래나 반복 훅이 보여야 한다.",
    });
  }
  if (spec.signals?.humor) {
    results.push({
      key: "humor_beat",
      passed: /(웃|실수|헷갈|장난|깜짝|oops|giggle|mistake|funny|joke)/i.test(joined),
      message: spec.lang === "en"
        ? "Humor tone needs a visible humor beat."
        : "유머 톤에는 웃음 포인트가 드러나야 한다.",
    });
  }
  if (spec.signals?.simpleLanguage) {
    results.push({
      key: "simple_language",
      passed: avgNarrationLength <= 52 && avgDialogueLength <= 32,
      message: spec.lang === "en"
        ? "Very young audience setups need short simple lines."
        : "영유아 대상이면 문장이 짧고 단순해야 한다.",
    });
  }
  const profileSignature = getProfileSignaturePattern(spec.profile?.key || "generic");
  if (profileSignature) {
    results.push({
      key: "profile_signature",
      passed: profileSignature.test(joined),
      message: spec.lang === "en"
        ? "The scenario should contain visible beats that match the selected overview profile."
        : "시나리오 안에 선택된 장르/목적 조합에 맞는 구조적 단서가 보여야 한다.",
    });
  }
  results.push({
    key: "duration_safe_voice",
    passed: sceneList.every((scene) => {
      const estSec = Math.max(Number(scene.estSec) || 0, 3);
      const narrationOk = !scene.narration || String(scene.narration).length <= getSpeechCharLimit(estSec, spec.lang, "narration");
      const dialogueOk = !Array.isArray(scene.dialogue) || scene.dialogue.every((row) => String(row.line || "").length <= getSpeechCharLimit(estSec, spec.lang, "dialogue"));
      return narrationOk && dialogueOk;
    }),
    message: spec.lang === "en"
      ? "Voice lines must fit the available scene duration."
      : "나레이션과 대사는 각 씬의 길이 안에 들어가야 한다.",
  });
  results.push({
    key: "blueprint_alignment",
    passed: sceneList.length === (spec.sceneBlueprint || []).length,
    message: spec.lang === "en"
      ? "Scene count should stay aligned with the blueprint."
      : "씬 개수가 블루프린트와 맞아야 한다.",
  });
  results.push({
    key: "arc_progression",
    passed: (() => {
      const phases = (spec.sceneBlueprint || []).map((item) => item.phaseKey).filter(Boolean);
      if (!phases.length) return true;
      const order = { setup: 0, rise: 1, turn: 2, close: 3 };
      for (let i = 1; i < phases.length; i++) {
        if ((order[phases[i]] ?? 0) < (order[phases[i - 1]] ?? 0)) return false;
      }
      if (phases.length >= 4) {
        const uniquePhases = new Set(phases);
        return uniquePhases.has("setup") && uniquePhases.has("rise") && uniquePhases.has("turn") && uniquePhases.has("close");
      }
      return phases[phases.length - 1] === "close";
    })(),
    message: spec.lang === "en"
      ? "The overall scene order should follow a setup-rise-turn-close arc."
      : "전체 씬 순서는 기-승-전-결 또는 그에 준하는 아크를 따라야 한다.",
  });
  results.push({
    key: "last_scene_closure",
    passed: (() => {
      const blueprint = Array.isArray(spec.sceneBlueprint) ? spec.sceneBlueprint : [];
      const expectedLastRole = blueprint[blueprint.length - 1]?.role || "";
      if (!expectedLastRole) return true;
      if (!isClosingRole(expectedLastRole)) return true;
      const lastScene = sceneList[sceneList.length - 1] || {};
      const closingText = [lastScene.sceneIntent, lastScene.narration, lastScene.visual]
        .filter(Boolean)
        .join(" ");
      return /(마무리|끝맺|정리|복습|여운|기억|총평|결론|마지막|탈출|기도|closing|recap|summary|outro|verdict|takeaway|ending|final)/i.test(closingText);
    })(),
    message: spec.lang === "en"
      ? "The last scene should function as a genre-appropriate ending beat."
      : "마지막 씬은 해당 장르와 목적에 맞는 엔딩 구조여야 한다.",
  });
  results.push({
    key: "scene_intent_separated",
    passed: sceneList.every((scene) => {
      const intent = String(scene.sceneIntent || "").trim();
      const visual = stripCameraDirection(scene.visual || "");
      return intent && intent !== visual;
    }),
    message: spec.lang === "en"
      ? "Each scene needs a separate sceneIntent that is not the same as the visual shot."
      : "각 씬에는 visual과 분리된 sceneIntent가 있어야 한다.",
  });
  results.push({
    key: "scene_intent_reaction",
    passed: sceneList.every((scene) => isAudienceReactionIntent(scene.sceneIntent)),
    message: spec.lang === "en"
      ? "Each sceneIntent must be written as a concrete audience reaction."
      : "각 sceneIntent는 관객의 구체적 반응으로 작성되어야 한다.",
  });
  results.push({
    key: "scene_location_present",
    passed: sceneList.every((scene) => String(scene.sceneLocation || "").trim()),
    message: spec.lang === "en"
      ? "Each scene needs its own concrete scene location."
      : "각 씬에는 구체적인 씬 장소가 있어야 한다.",
  });
  results.push({
    key: "scene_location_diversity",
    passed: (() => {
      const locations = sceneList.map((scene) => String(scene.sceneLocation || "").trim()).filter(Boolean);
      if (locations.length <= 1) return true;
      return new Set(locations).size > 1;
    })(),
    message: spec.lang === "en"
      ? "Scene locations should vary across beats inside the shared world."
      : "공용 세계 안에서도 씬 장소는 장면에 맞게 달라져야 한다.",
  });
  results.push({
    key: "visual_concreteness",
    passed: sceneList.every((scene) => analyzeVisualContract(scene.visual, spec).passed && !isAbstractVisualText(scene.visual)),
    message: spec.lang === "en"
      ? "Each visual must concretely include location, background, action, and props."
      : "각 visual에는 공간, 배경, 행동, 프롭이 구체적으로 들어가야 한다.",
  });
  results.push({
    key: "visual_forbidden_language",
    passed: sceneList.every((scene) => !containsForbiddenVisualPhrase(scene.visual)),
    message: spec.lang === "en"
      ? "Visuals must not use forbidden abstract adjectives or mood labels."
      : "visual에는 금지된 추상 형용사나 분위기 표현이 들어가면 안 된다.",
  });
  results.push({
    key: "setting_anchor",
    passed: sceneList.every((scene) => {
      const anchorTerms = Array.isArray(spec.continuity?.anchorTerms) ? spec.continuity.anchorTerms : [];
      if (!anchorTerms.length) return true;
      const location = String(scene.sceneLocation || "").trim();
      const visual = stripCameraDirection(scene.visual || "");
      return anchorTerms.some((term) => term && (location.includes(term) || visual.includes(term)));
    }),
    message: spec.lang === "en"
      ? "All scenes should retain the shared setting anchor."
      : "모든 씬은 공통 배경/장소 앵커를 유지해야 한다.",
  });
  results.push({
    key: "setting_continuity",
    passed: (() => {
      const categories = sceneList
        .map((scene) => detectSettingCategory(String(scene.sceneLocation || "").trim() || stripCameraDirection(scene.visual || "")))
        .filter((category) => category && category !== "generic");
      if (!categories.length) return true;
      const expected = spec.continuity?.category && spec.continuity.category !== "generic"
        ? spec.continuity.category
        : categories[0];
      return categories.every((category, idx) => category === expected || hasExplicitLocationTransition(sceneList[idx]?.visual || ""));
    })(),
    message: spec.lang === "en"
      ? "Scene backgrounds should stay in one consistent location unless a transition is explicitly shown."
      : "명시적 전환이 없다면 씬 간 배경/장소는 일관되어야 한다.",
  });

  const failed = results.filter((item) => !item.passed);
  return {
    passed: failed.length === 0,
    score: results.length ? ((results.length - failed.length) / results.length) : 1,
    failed,
    results,
  };
}

function averageLength(list = []) {
  const rows = (Array.isArray(list) ? list : []).map((item) => String(item || "").trim()).filter(Boolean);
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + row.length, 0) / rows.length;
}

function stripCameraDirection(text = "") {
  return String(text || "")
    .replace(/\.\s*카메라 연출:\s*[^.]+\.?/gi, "")
    .replace(/\.\s*Camera direction:\s*[^.]+\.?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isPlaceholderText(text = "") {
  return /(전개\s*\d+|핵심 장면 설명|관련 대사\s*\d+|Scene\s*\d+\s*(?:visual|key visual direction|line)|장면을 설명하는 나레이션이 이어진다|The narrator describes the scene clearly|내레이터가 장면을 설명한다|Speak a line that matches the scene)/i.test(String(text || "").trim());
}

function mergeSentence(base = "", hint = "") {
  const cleanBase = String(base || "").trim();
  const cleanHint = String(hint || "").trim();
  if (!cleanHint) return cleanBase;
  if (!cleanBase || isPlaceholderText(cleanBase)) return cleanHint;
  if (cleanBase.includes(cleanHint)) return cleanBase;
  return `${cleanBase} ${cleanHint}`.replace(/\s{2,}/g, " ").trim();
}

function selectNarrationBase(base = "", hint = "") {
  const cleanBase = String(base || "").trim();
  const cleanHint = String(hint || "").trim();
  if (!cleanBase || isPlaceholderText(cleanBase)) return cleanHint;
  return cleanBase;
}

function selectSceneIntentBase(base = "", hint = "") {
  const cleanBase = String(base || "").trim();
  const cleanHint = String(hint || "").trim();
  if (!cleanBase || isPlaceholderText(cleanBase)) return cleanHint;
  if (!isAudienceReactionIntent(cleanBase) && cleanHint) return cleanHint;
  if (cleanBase.length > 90) return cleanHint || cleanBase;
  return cleanBase;
}

function isAbstractVisualText(text = "") {
  const clean = stripCameraDirection(text);
  if (!clean) return true;
  if (isPlaceholderText(clean)) return true;
  return /(보여 주는 장면|드러나는 장면|구성된 장면|시작하는 장면|마무리하는 장면|분위기|추상|scene that|scene showing|mood|composition)/i.test(clean)
    || containsForbiddenVisualPhrase(clean);
}

function analyzeVisualContract(text = "", spec = {}) {
  const clean = stripCameraDirection(text);
  const lower = clean.toLowerCase();
  const continuity = spec.continuity || {};
  const anchorTerms = Array.isArray(continuity.anchorTerms) ? continuity.anchorTerms : [];
  const firstSegment = clean.split(/[.!?。！？]/)[0].trim();
  const locationPrefixCue = firstSegment && firstSegment.length <= 30 && firstSegment.length !== clean.length && !/(친구|인물|진행자|요리사|플레이어|안내자|the |presenter|friend|group|cook|player|guide)/i.test(firstSegment);
  const placeCue = locationPrefixCue
    || anchorTerms.some((term) => term && clean.includes(term))
    || /(교실|놀이방|유치원|스튜디오|무대|집|거실|숲|바다|우주|공원|마당|실내|실외|준비대|테이블|데스크|코너|구역|존|라인|조리대|싱크대|플레이팅|콘솔|도킹|전망 포인트|classroom|playroom|studio|stage|home|forest|sea|space|park|yard|indoors|outdoors|table|desk|corner|zone|lane|counter|sink|plating|console|docking)/i.test(lower);
  const backgroundCue = /(벽|창|창밖|바닥|뒤쪽|배경|하늘|조명|포스터|매트|보드|선반|표지판|그림자|레일|작업면|디테일|보인다|이어진다|펼쳐져|남아 있다|floor|background|sky|lighting|poster|mat|board|shelf|sign|shadow|rail|work surface|details|stay visible|remain)/i.test(lower);
  const actionCue = /(모이|모여|준비|들|가리키|흔들|춤|노래|외치|웃|넘어지|고치|짚|걷|뛰|손짓|옮기|시연|담|올리|놓|정리|tap|hold|point|wave|dance|sing|laugh|trip|fix|step|run|gesture|gather|prepare|move|demonstrate|plate|place)/i.test(lower);
  const propCue = anchorTerms.some((term) => term && clean.includes(term))
    || /(카드|블록|포스터|매트|북|탬버린|칠판|풍선|스티커|책상|소품|도구|재료|기기|지도|패널|콘솔|카드|조명|card|block|poster|mat|drum|tambourine|board|sticker|desk|prop|tool|ingredient|device|map|panel|console|light)/i.test(lower);
  return {
    placeCue,
    backgroundCue,
    actionCue,
    propCue,
    passed: placeCue && backgroundCue && actionCue && propCue,
  };
}

function hasExplicitLocationTransition(text = "") {
  return /(장소를 바꿔|다른 장소|이동해|장면 전환|컷 전환|시간 후|같은 장소|scene transition|move to|new location|cut to|hours later|same place)/i.test(String(text || ""));
}

function ensureContinuityAnchorInVisual(text = "", spec = {}, lang = "ko") {
  const clean = String(text || "").trim();
  if (!clean) return clean;
  const continuity = spec.continuity || {};
  const prop = String((continuity.props || [])[0] || "").trim();
  let out = clean;
  if (prop && !out.includes(prop) && !/(카드|블록|포스터|매트|북|탬버린|소품|card|block|poster|mat|drum|tambourine|prop)/i.test(out)) {
    out = lang === "en" ? `${out} ${prop} stays in view.` : `${out} ${prop}가 화면 안에 함께 보인다.`;
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

function mergeVisual(base = "", hint = "", context = {}) {
  const cleanBase = stripCameraDirection(base);
  const lang = context.lang === "en" ? "en" : "ko";
  const spec = context.spec || {};
  let merged = cleanBase;
  const baseContract = analyzeVisualContract(cleanBase, spec);
  if (!cleanBase || isAbstractVisualText(cleanBase) || !baseContract.passed) merged = String(hint || "").trim();
  else if (hint && !hasExplicitLocationTransition(cleanBase)) merged = ensureContinuityAnchorInVisual(cleanBase, spec, lang);
  merged = ensureContinuityAnchorInVisual(merged, spec, lang);
  if (!analyzeVisualContract(merged, spec).passed && hint) merged = ensureContinuityAnchorInVisual(mergeSentence(merged, hint), spec, lang);
  return ensureCameraDirectionInVisual(merged, context);
}

function getSpeechCharLimit(estSec = 3, lang = "ko", mode = "narration") {
  const sec = Math.max(Number(estSec) || 0, 3);
  const perSec = lang === "en" ? 12 : 8;
  const base = Math.max(Math.floor(sec * perSec), lang === "en" ? 18 : 12);
  return mode === "dialogue" ? Math.max(base - (lang === "en" ? 6 : 4), 10) : base;
}

function trimTextToCharLimit(text = "", limit = 0) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean || !limit || clean.length <= limit) return clean;
  const pieces = clean.split(/(?<=[.!?。！？])/).map((part) => part.trim()).filter(Boolean);
  if (pieces.length > 1) {
    let acc = "";
    for (const piece of pieces) {
      const candidate = acc ? `${acc} ${piece}` : piece;
      if (candidate.length > limit) break;
      acc = candidate;
    }
    if (acc) return acc.trim();
  }
  return clean.slice(0, Math.max(limit - 1, 1)).trim() + "...";
}

function fitNarrationToDuration(text = "", estSec = 3, lang = "ko") {
  return trimTextToCharLimit(text, getSpeechCharLimit(estSec, lang, "narration"));
}

function trimDialogueToDuration(dialogue = [], estSec = 3, lang = "ko") {
  const rows = normalizeDialogue(dialogue || []);
  if (!rows.length) return rows;
  const totalLimit = getSpeechCharLimit(estSec, lang, "dialogue");
  const perLine = Math.max(Math.floor(totalLimit / rows.length), lang === "en" ? 8 : 6);
  let remaining = totalLimit;
  return rows.map((row, idx) => {
    const localLimit = Math.max(idx === rows.length - 1 ? remaining : perLine, lang === "en" ? 8 : 6);
    const line = trimTextToCharLimit(row.line, localLimit);
    remaining = Math.max(remaining - line.length, 0);
    return {
      speaker: row.speaker,
      line,
    };
  }).filter((row) => row.line);
}

function repairDialogue(dialogue = [], hintLines = [], options = {}) {
  const normalized = normalizeDialogue(dialogue);
  const lines = uniqueStrings((Array.isArray(hintLines) ? hintLines : []).map((line) => String(line || "").trim()).filter(Boolean));
  if (!options.dubbingEnabled) return normalized;
  if (!normalized.length || normalized.every((row) => isPlaceholderText(row.line))) {
    return lines.map((line) => splitDialogueLine(line, options.defaultSpeaker));
  }
  const first = normalized[0];
  const hintLine = lines[0] || "";
  const extracted = extractDialogueLine(hintLine);
  if (extracted && (!String(first.line || "").trim() || isPlaceholderText(first.line))) {
    normalized[0] = {
      speaker: first.speaker || options.defaultSpeaker,
      line: extracted,
    };
  }
  if (options.forceHumor && lines[1]) {
    const secondLine = extractDialogueLine(lines[1]);
    if (secondLine && !normalized.some((row) => row.line === secondLine)) {
      normalized.push({
        speaker: normalized[0]?.speaker || options.defaultSpeaker,
        line: secondLine,
      });
    }
  }
  return normalized;
}

function splitDialogueLine(line = "", fallbackSpeaker = "@narrator") {
  const raw = String(line || "").trim();
  const idx = raw.indexOf(":");
  if (idx === -1) return { speaker: fallbackSpeaker, line: raw };
  const speaker = raw.slice(0, idx).trim() || fallbackSpeaker;
  return { speaker, line: raw.slice(idx + 1).trim() };
}

function extractDialogueLine(line = "") {
  const raw = String(line || "").trim();
  const idx = raw.indexOf(":");
  return idx === -1 ? raw : raw.slice(idx + 1).trim();
}

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function retryAsync(task, maxRetries = 3, baseDelayMs = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= Math.max(1, maxRetries); attempt++) {
    try {
      return await task();
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries || !isRetryableError(err)) throw err;
      await wait(baseDelayMs * attempt);
    }
  }
  throw lastError;
}

function isRetryableError(err) {
  const text = String(err?.message || err || "").toLowerCase();
  return /\b429\b/.test(text) || /\b500\b|\b502\b|\b503\b|\b504\b/.test(text) || /timeout|temporar|rate limit|overloaded/.test(text);
}

function isCreditExhaustedError(err) {
  const text = String(err?.message || err || "");
  return /CREDIT_EXHAUSTED/.test(text) || /\b402\b/.test(text) || /billing_error|credit_balance|insufficient.{0,10}credit/i.test(text);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function buildChunkGuide({ lang = "ko", index = 0, total = 1, requestedSceneCount = 1 }) {
  if (total <= 1) return "";
  if (lang === "en") {
    return `Chunk guide: this request handles part ${index + 1}/${total} of a long source. Generate only ${requestedSceneCount} scenes from this part, keep continuity with the same project, and do not summarize omitted parts.`;
  }
  return `청크 가이드: 이 요청은 긴 원문의 ${index + 1}/${total}번째 파트만 처리합니다. 이 파트 내용만 기반으로 정확히 ${requestedSceneCount}개 씬을 만들고, 다른 파트 내용을 요약하거나 끌어오지 마세요.`;
}

function splitLongTextIntoChunks(text = "", maxChunkSize = 2200) {
  const source = String(text || "").trim();
  if (!source) return [""];
  const paragraphs = source.split(/\n{2,}/).map((part) => String(part || "").trim()).filter(Boolean);
  const chunks = [];
  let currentChunk = "";

  const flush = () => {
    const normalized = currentChunk.trim();
    if (normalized) chunks.push(normalized);
    currentChunk = "";
  };

  const pushUnit = (unit) => {
    const candidate = currentChunk ? `${currentChunk}\n\n${unit}` : unit;
    if (candidate.length <= maxChunkSize) {
      currentChunk = candidate;
      return;
    }
    flush();
    currentChunk = unit;
  };

  const longUnits = paragraphs.length ? paragraphs : [source];
  longUnits.forEach((paragraph) => {
    if (paragraph.length <= maxChunkSize) {
      pushUnit(paragraph);
      return;
    }
    const sentences = paragraph.split(/(?<=[.!?。！？])\s+/).map((sentence) => String(sentence || "").trim()).filter(Boolean);
    if (!sentences.length) {
      for (let cursor = 0; cursor < paragraph.length; cursor += maxChunkSize) {
        pushUnit(paragraph.slice(cursor, cursor + maxChunkSize));
      }
      return;
    }
    sentences.forEach((sentence) => {
      if (sentence.length <= maxChunkSize) {
        const candidate = currentChunk ? `${currentChunk} ${sentence}` : sentence;
        if (candidate.length <= maxChunkSize) {
          currentChunk = candidate;
        } else {
          flush();
          currentChunk = sentence;
        }
        return;
      }
      flush();
      for (let cursor = 0; cursor < sentence.length; cursor += maxChunkSize) {
        chunks.push(sentence.slice(cursor, cursor + maxChunkSize).trim());
      }
    });
  });
  flush();
  return chunks.length ? chunks : [source];
}

function collapseChunksToSceneBudget(chunks = [], maxChunks = 1) {
  const list = (Array.isArray(chunks) ? chunks : []).map((chunk) => String(chunk || "").trim()).filter(Boolean);
  if (!list.length) return [""];
  const limit = Math.max(1, Number(maxChunks) || 1);
  if (list.length <= limit) return list;
  const grouped = [];
  for (let i = 0; i < limit; i++) {
    const start = Math.floor((i * list.length) / limit);
    const end = Math.floor(((i + 1) * list.length) / limit);
    grouped.push(list.slice(start, Math.max(start + 1, end)).join("\n\n").trim());
  }
  return grouped.filter(Boolean);
}

function distributeIntegerByWeight(items = [], target = 0, minPerItem = 1) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const safeTarget = Math.max(Number(target) || 0, list.length * Math.max(0, Number(minPerItem) || 0));
  const base = Math.max(0, Number(minPerItem) || 0);
  const lengths = list.map((item) => Math.max(String(item || "").length, 1));
  const totalWeight = lengths.reduce((sum, value) => sum + value, 0) || list.length;
  const allocations = list.map(() => base);
  let remaining = safeTarget - allocations.reduce((sum, value) => sum + value, 0);
  if (remaining <= 0) return allocations;

  const remainders = lengths.map((weight, index) => {
    const raw = (weight / totalWeight) * remaining;
    const whole = Math.floor(raw);
    allocations[index] += whole;
    return { index, frac: raw - whole };
  });

  let distributed = allocations.reduce((sum, value) => sum + value, 0);
  let leftovers = safeTarget - distributed;
  remainders.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < leftovers; i++) {
    const targetRow = remainders[i % remainders.length];
    allocations[targetRow.index] += 1;
  }
  return allocations;
}

function cleanJsonResponse(text = "") {
  let cleaned = String(text || "").trim();
  if (!cleaned) return '{"scenes":[]}';

  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  const firstBracket = cleaned.search(/[\[{]/);
  if (firstBracket === -1) return '{"scenes":[]}';
  const firstToken = cleaned[firstBracket];
  cleaned = cleaned.slice(firstBracket);

  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let lastValidIndex = -1;

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      escapeNext = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "[" || char === "{") depth += 1;
    if (char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) {
        lastValidIndex = i;
        break;
      }
    }
  }

  if (lastValidIndex !== -1) {
    return cleaned.slice(0, lastValidIndex + 1).trim();
  }

  const lastCompleteEnd = findLastCompleteSceneObject(cleaned);
  if (lastCompleteEnd <= 0) {
    return firstToken === "[" ? "[]" : '{"scenes":[]}';
  }
  let recovered = cleaned.slice(0, lastCompleteEnd);
  if (recovered.includes('"scenes"')) recovered += "]}";
  else if (firstToken === "[") recovered += "]";
  else recovered += "}";
  return recovered.trim();
}

function findLastCompleteSceneObject(json = "") {
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let lastCompleteEnd = -1;

  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      escapeNext = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 1) lastCompleteEnd = i + 1;
    }
  }
  return lastCompleteEnd;
}

function repairJsonString(text = "") {
  // Phase 1: fix unescaped control characters
  let out = text.replace(/[\x00-\x1f]/g, (ch) => {
    if (ch === "\n") return "\\n";
    if (ch === "\r") return "\\r";
    if (ch === "\t") return "\\t";
    return "";
  });
  // Phase 2: remove trailing commas before } or ]
  out = out.replace(/,\s*([}\]])/g, "$1");
  // Quick check
  try { JSON.parse(out); return out; } catch (_) { /* need deeper repair */ }
  // Phase 3: walk character by character, fix unescaped quotes inside strings
  const len = out.length;
  const result = [];
  let inStr = false;
  let i = 0;
  while (i < len) {
    const c = out[i];
    if (inStr) {
      if (c === "\\" && i + 1 < len) {
        result.push(c, out[i + 1]);
        i += 2; continue;
      }
      if (c === '"') {
        // Is this the real end of the string?
        let j = i + 1;
        while (j < len && (out[j] === " " || out[j] === "\t")) j++;
        const next = out[j] || "";
        if (next === ":" || next === "," || next === "}" || next === "]" || next === "" || next === '"') {
          inStr = false; result.push(c); i++; continue;
        }
        // Unescaped quote inside string — escape it
        result.push("\\", '"'); i++; continue;
      }
      result.push(c); i++; continue;
    }
    // Not in string
    if (c === '"') { inStr = true; }
    result.push(c); i++;
  }
  out = result.join("");
  // Phase 4: iterative positional repair — find error position, escape the offending char
  for (let attempt = 0; attempt < 5; attempt++) {
    try { JSON.parse(out); return out; } catch (e) {
      const m = e.message.match(/position\s+(\d+)/i);
      if (!m) break;
      const pos = Number(m[1]);
      if (pos <= 0 || pos >= out.length) break;
      // Insert backslash before the problematic character
      out = out.slice(0, pos) + "\\" + out.slice(pos);
    }
  }
  return out;
}

function buildModePrompt({ lang, narrationEnabled, dubbingEnabled, characters, topic }) {
  const formatCharacter = (character) => {
    const token = String(character?.token || "").trim();
    const displayName = String(character?.displayName || "").trim();
    const personality = String(character?.personality || "").trim();
    if (lang === "en") {
      return personality
        ? `${token}(${displayName} | traits: ${personality})`
        : `${token}(${displayName})`;
    }
    return personality
      ? `${token}(${displayName} · 성격: ${personality})`
      : `${token}(${displayName})`;
  };

  const charGuide = characters.length
    ? (lang === "en"
      ? `Characters: ${characters.map(formatCharacter).join(", ")}.
If traits are provided, keep each character's speaking style and behavior consistent with those traits.`
      : `등록 캐릭터: ${characters.map(formatCharacter).join(", ")}.
성격이 주어진 캐릭터는 말투와 행동이 해당 성격에 맞게 일관되게 유지되도록 작성.
캐릭터 이름이 문장에 등장하면 가능하면 @토큰으로 표기.`)
    : (lang === "en" ? "No registered characters." : "등록된 캐릭터 없음.");

  // Pass 1 캐릭터 일관성 강제: 활성 캐릭터가 등록된 경우 모든 씬 visual 첫 문장에
  // 해당 @토큰이 1회 이상 반드시 등장해야 한다. 다운스트림(이미지/영상 생성)에서
  // @토큰을 키로 캐릭터 시트(레퍼런스)를 주입하기 때문에, 토큰이 없는 컷은
  // 다른 인형/생물로 렌더되는 회귀가 잦았다. (Scene 1/2/3 cut2 사례)
  const characterEnforcement = characters.length
    ? (lang === "en"
      ? `MANDATORY character consistency rules (apply to EVERY scene without exception):
- Each scene's "visual" MUST include at least one registered @token (e.g., ${characters.map((c) => c.token).join(", ")}) within the first sentence.
- Do NOT refer to a registered character only by descriptive nouns ("the yellow plush", "the doll"); always pair the description with its @token.
- If multiple characters are active, name the primary subject of the shot by @token in sentence 1 and any co-appearing character by @token in sentence 2.
- This rule overrides stylistic brevity: tokens are non-negotiable.`
      : `필수 캐릭터 일관성 규칙(모든 씬에 예외 없이 적용):
- 각 씬의 "visual" 첫 문장에 등록된 @토큰(예: ${characters.map((c) => c.token).join(", ")}) 중 최소 1개를 반드시 포함한다.
- 등록 캐릭터를 "노란 봉제인형", "그 인형" 같은 일반 명사로만 지칭하지 말고 항상 @토큰과 함께 표기한다.
- 복수 캐릭터가 활성화된 경우, 그 씬의 주인공을 첫 문장에 @토큰으로, 공동 등장 캐릭터를 두 번째 문장에 @토큰으로 명시한다.
- 이 규칙은 간결성보다 우선한다. @토큰 표기는 선택이 아니라 필수다.`)
    : "";

  const taggingHint = characters.length && topic
    ? (lang === "en"
      ? "If topic or lines mention a character name, prefer token form like @name."
      : "주제나 문장에 캐릭터 이름이 있으면 @토큰 형태를 우선 사용.")
    : "";
  const noCharacterRule = !characters.length
    ? (lang === "en"
      ? `- Characterless mode: do not create characters, people, mascots, named protagonists/supporting characters, or @tokens.
- Keep scene text focused on environment, objects, motion, and atmosphere only.
- If dubbingEnabled=true with no characters, use narrator-only speaker "@narrator".`
      : `- 캐릭터 미등록 모드: 캐릭터, 사람, 마스코트, 임의 주연/조연 이름, @토큰을 생성하지 마세요.
- 장면 설명은 환경, 사물, 움직임, 분위기 중심으로 작성하세요.
- 캐릭터 없이 dubbingEnabled=true 인 경우 화자는 "@narrator"만 사용하세요.`)
    : "";

  const mode = narrationEnabled
    ? (dubbingEnabled ? "A" : "B")
    : (dubbingEnabled ? "C" : "D");

  if (lang === "en") {
    return `Scenario mode ${mode} rules (must follow):
A) narrationEnabled=true, dubbingEnabled=true:
- scene fields: sceneIntent(string), sceneLocation(string), narration(string), dialogue(array<{speaker,line}>), visual(string)
B) narrationEnabled=true, dubbingEnabled=false:
- scene fields: sceneIntent(string), sceneLocation(string), narration(string), visual(string)
C) narrationEnabled=false, dubbingEnabled=true:
- scene fields: sceneIntent(string), sceneLocation(string), dialogue(array<{speaker,line}>), visual(string)
D) narrationEnabled=false, dubbingEnabled=false:
- scene fields: sceneIntent(string), sceneLocation(string), lines(string), visual(string)
- Every visual must include camera direction (shot size, camera angle, camera movement, framing).
- sceneIntent: the concrete audience reaction this scene should trigger.
  - Forbidden: "show the product's strengths", "deliver emotion", "build brand awareness"
  - Allowed: "the viewer locks onto the object on screen", "the viewer expects the next scene", "the viewer feels tension from the trembling hand"
- visual writing method:
  - Write one paragraph with 3 to 5 sentences.
  - Sentence 1: place and framing range
  - Sentence 2: visible placement of people/objects
  - Sentence 3: physical action happening in the scene
  - Sentence 4: camera direction
  - Sentence 5 optional: lighting or time of day
  - Test: a cinematographer should be able to set the camera immediately after reading it.
- If narrationEnabled is true, narration must be a full spoken sentence (not empty).
- If dubbingEnabled is true, dialogue must contain at least one line with speaker and line.
- Keep narration/dialogue text ready for TTS usage.
${charGuide}
${characterEnforcement}
${noCharacterRule}
${taggingHint}`;
  }

  return `시나리오 모드 ${mode} 규칙(반드시 준수):
A) narrationEnabled=ON, dubbingEnabled=ON
- sceneIntent(string), sceneLocation(string), narration(string), dialogue(array<{speaker,line}>), visual(string)
B) narrationEnabled=ON, dubbingEnabled=OFF
- sceneIntent(string), sceneLocation(string), narration(string), visual(string)
C) narrationEnabled=OFF, dubbingEnabled=ON
- sceneIntent(string), sceneLocation(string), dialogue(array<{speaker,line}>), visual(string)
D) narrationEnabled=OFF, dubbingEnabled=OFF
- sceneIntent(string), sceneLocation(string), lines(string), visual(string)
- narrationEnabled가 ON이면 narration은 비어있지 않은 완전한 문장으로 생성.
- dubbingEnabled가 ON이면 dialogue는 최소 1개 이상의 {speaker,line}를 반드시 생성.
- sceneIntent: 이 씬을 본 관객이 느끼거나 행동하는 구체적 반응.
  - 금지: "제품의 장점을 보여준다", "감정을 전달한다", "브랜드를 인지시킨다"
  - 허용: "관객이 화면 속 물체에 시선을 고정한다", "관객이 '어떻게 되는 거지?' 하고 다음 장면을 기대한다", "관객이 주인공의 손떨림을 보고 긴장감을 느낀다"
- visual 작성법:
  - 한 문단, 3~5문장으로 쓴다.
  - 문장 1: 장소와 프레임 범위
  - 문장 2: 프레임 안에 보이는 사물/인물 배치
  - 문장 3: 이 씬에서 일어나는 물리적 행동
  - 문장 4: 카메라
  - 문장 5(선택): 조명/시간대
  - 검증: 이 visual을 읽고 촬영감독이 바로 카메라를 세팅할 수 있어야 한다.
- narration/dialogue 문구는 이후 TTS(음성 합성)에 바로 사용할 수 있는 문장으로 작성.
${charGuide}
${characterEnforcement}
${noCharacterRule}
${taggingHint}`;
}

function hasCameraDirectionText(text = "") {
  const t = String(text || "").toLowerCase();
  if (!t) return false;
  const cameraPatterns = [
    /camera|angle|lens|shot|framing|composition|close[-\s]?up|medium shot|wide shot|over[-\s]?the[-\s]?shoulder/i,
    /zoom|pan|tilt|dolly|tracking|handheld|crane|aerial|rack focus/i,
    /카메라|앵글|렌즈|샷|구도|프레이밍|클로즈업|미디엄샷|와이드샷|오버숄더|줌|패닝|틸트|돌리|트래킹|핸드헬드|크레인|항공샷/i,
  ];
  return cameraPatterns.some((re) => re.test(t));
}

function isDynamicToneText(input = "") {
  const t = String(input || "").toLowerCase();
  if (!t) return false;
  return /(dynamic|action|fast|tense|thrill|urgent|energetic|긴박|액션|역동|빠른|스릴|긴장)/i.test(t);
}

function buildCameraDirectionSnippet(context = {}) {
  const idx = Number(context.idx || 0);
  const lang = context.lang === "en" ? "en" : "ko";
  const toneMerged = [context.toneText, context.tones].filter(Boolean).join(" ");
  const dynamic = isDynamicToneText(toneMerged);
  const calmKo = [
    "미디엄 샷, 아이레벨 앵글, 느린 돌리 인, 안정적인 중앙 구도",
    "와이드 샷, 하이앵글, 부드러운 패닝, 전경과 배경이 보이는 레이어 구도",
    "클로즈업, 로우앵글, 아주 느린 줌 인, 피사체 중심 구도",
  ];
  const dynamicKo = [
    "미디엄 클로즈업, 로우앵글, 빠른 푸시 인, 비대칭 긴장 구도",
    "와이드 샷, 아이레벨, 트래킹 이동, 속도감 있는 대각선 구도",
    "클로즈업, 하이앵글, 짧은 핸드헬드 무빙, 강한 대비 구도",
  ];
  const calmEn = [
    "medium shot, eye-level angle, slow dolly-in, stable centered framing",
    "wide shot, high angle, gentle pan, layered foreground-background composition",
    "close-up, low angle, very slow zoom-in, subject-centered framing",
  ];
  const dynamicEn = [
    "medium close-up, low angle, quick push-in, asymmetrical tension framing",
    "wide shot, eye-level angle, tracking move, diagonal dynamic composition",
    "close-up, high angle, short handheld move, high-contrast framing",
  ];
  const pool = dynamic ? (lang === "en" ? dynamicEn : dynamicKo) : (lang === "en" ? calmEn : calmKo);
  return pool[idx % pool.length];
}

function ensureCameraDirectionInVisual(visual = "", context = {}) {
  const base = String(visual || "").trim();
  const lang = context.lang === "en" ? "en" : "ko";
  const camera = buildCameraDirectionSnippet(context);
  const fallback = lang === "en"
    ? `Scene direction, ${camera}.`
    : `장면 연출, ${camera}.`;
  if (!base) return fallback;
  if (hasCameraDirectionText(base)) return base;
  if (lang === "en") return `${base}. Camera direction: ${camera}.`;
  return `${base}. 카메라 연출: ${camera}.`;
}

function normalizeCharacters(list = []) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map((c, idx) => {
      const displayName = String(c?.displayName || c?.name || c?.token || "").replace(/^@+/, "").trim();
      if (!displayName) return null;
      const token = `@${displayName}`;
      return {
        characterId: String(c?.characterId || c?.id || `char_${String(idx + 1).padStart(3, "0")}`),
        displayName,
        token,
        personality: String(c?.personality || c?.description || c?.profile || c?.note || "").trim(),
      };
    })
    .filter(Boolean)
    .filter((c) => {
      const key = c.token.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeDialogue(value = []) {
  if (Array.isArray(value)) {
    return value
      .map((d) => ({
        speaker: String(d?.speaker || "").trim(),
        line: String(d?.line || "").trim(),
      }))
      .filter((d) => d.speaker || d.line);
  }
  if (typeof value === "string") {
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(":");
        if (idx > -1) {
          return {
            speaker: line.slice(0, idx).trim(),
            line: line.slice(idx + 1).trim(),
          };
        }
        return { speaker: "", line };
      })
      .filter((d) => d.speaker || d.line);
  }
  return [];
}

function applyCharacterTokenHints(text, characters = []) {
  let out = String(text || "");
  (Array.isArray(characters) ? characters : []).forEach((c) => {
    const display = String(c?.displayName || "").trim();
    const token = String(c?.token || "").trim();
    if (!display || !token) return;
    if (!out.includes(display) || out.includes(token)) return;
    out = out.replaceAll(display, token);
  });
  return out;
}

/**
 * Pass 1 사후 보정: 활성 캐릭터가 등록되었는데도 모델이 일부 씬 visual 에
 * @토큰을 빠뜨려 다운스트림 이미지/영상 생성기가 캐릭터 시트를 주입하지 못해
 * 다른 인형/생물로 렌더되는 회귀를 막는다.
 *
 * 누락된 씬의 visual 첫 문장 앞에 "@token 이(가) 등장한다." 형태로 anchor 문장을
 * 1회 prepend 한다. 이미 토큰이 등장하는 씬은 건드리지 않는다.
 *
 * @param {Array} scenes
 * @param {Array} characters - normalizeCharacters() 결과
 * @param {"ko"|"en"} lang
 * @returns {{scenes: Array, injected: number}}
 */
function enforceCharacterAnchorsInScenes(scenes = [], characters = [], lang = "ko") {
  const list = (Array.isArray(characters) ? characters : [])
    .map((c) => ({
      token: String(c?.token || "").trim(),
      displayName: String(c?.displayName || "").trim(),
    }))
    .filter((c) => c.token);
  if (!list.length) return { scenes, injected: 0 };
  const tokens = list.map((c) => c.token);
  const primary = list[0];
  let injected = 0;
  const next = (Array.isArray(scenes) ? scenes : []).map((scene) => {
    if (!scene || typeof scene !== "object") return scene;
    const visual = String(scene.visual || "").trim();
    if (!visual) return scene;
    const hasAnyToken = tokens.some((tok) => visual.includes(tok));
    if (hasAnyToken) return scene;
    injected += 1;
    const anchor = lang === "en"
      ? `${primary.token} (${primary.displayName}) is on screen.`
      : `${primary.token}(${primary.displayName})이(가) 화면에 등장한다.`;
    const sep = visual.startsWith("@") ? " " : " ";
    return Object.assign({}, scene, { visual: anchor + sep + visual });
  });
  return { scenes: next, injected };
}

function enforceNoCharacterPolicy({
  narration = "",
  dialogue = [],
  visual = "",
  noCharacterMode = false,
  narratorSpeaker = "@narrator",
  dubbingEnabled = false,
  lang = "ko",
}) {
  if (!noCharacterMode) return { narration, dialogue, visual };
  const stripAtTokens = (txt) => String(txt || "")
    .replace(/@[^\s"'`.,!?;:(){}\[\]<>]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const safeNarration = stripAtTokens(narration);
  const safeVisual = stripAtTokens(visual);
  const lineFallback = lang === "en" ? "Narrator explains the scene." : "내레이터가 장면을 설명한다.";
  const mergedLine = normalizeDialogue(dialogue).map((d) => String(d.line || "").trim()).filter(Boolean).join(" ");
  const safeDialogue = dubbingEnabled
    ? [{ speaker: narratorSpeaker, line: stripAtTokens(mergedLine || safeNarration || safeVisual || lineFallback) }]
    : [];
  return {
    narration: safeNarration,
    dialogue: safeDialogue,
    visual: safeVisual,
  };
}

function shapeSceneByMode(input) {
  const narrationRaw = String(input.narration || "").trim();
  const narration = narrationRaw;
  const sceneIntent = String(input.sceneIntent || input.intent || "").trim() || (input.lang === "en" ? "Advance the next scene beat clearly." : "다음 씬 전개를 분명하게 만든다.");
  const sceneLocation = String(input.sceneLocation || input.location || "").trim();
  const backgroundStyle = String(input.backgroundStyle || "").trim();
  const sceneArcPhase = String(input.sceneArcPhase || input.phaseLabel || "").trim();
  const sceneArcKey = String(input.sceneArcKey || input.phaseKey || "").trim();
  const sceneArcGoal = String(input.sceneArcGoal || input.phaseGoal || "").trim();
  const defaultSpeaker = String(input.defaultSpeaker || "@narrator").trim() || "@narrator";
  let dialogue = normalizeDialogue(input.dialogue || []);
  const visual = String(input.visual || "").trim();
  const videoSpeechPrompt = composeVideoSpeechPrompt({
    lang: input.lang || "ko",
    narration,
    dialogue,
    narrationEnabled: !!input.narrationEnabled,
    dubbingEnabled: !!input.dubbingEnabled,
  });
  const subtitleText = composeSubtitleText({
    narration,
    dialogue,
    narrationEnabled: !!input.narrationEnabled,
    dubbingEnabled: !!input.dubbingEnabled,
  });
  const voiceScript = composeVoiceScript({
    narration,
    dialogue,
    narrationEnabled: !!input.narrationEnabled,
    dubbingEnabled: !!input.dubbingEnabled,
  });
  const out = {
    id: input.id,
    title: input.title,
    estSec: input.estSec,
    sceneIntent,
    sceneLocation,
    backgroundStyle,
    sceneArcPhase,
    sceneArcKey,
    sceneArcGoal,
    visual,
    shot: visual,
    videoSpeechPrompt,
    subtitleText,
  };
  if (input.narrationEnabled) out.narration = narration;
  if (input.dubbingEnabled) out.dialogue = dialogue;
  out.script = voiceScript;
  out.lines = subtitleText;
  return out;
}

function composeDialogueOnlyText(dialogue = []) {
  return normalizeDialogue(dialogue || []).map((d) => String(d.line || "").trim()).filter(Boolean).join(" ").trim();
}

function formatDialogueForVideoPrompt(dialogue = [], lang = "ko") {
  return normalizeDialogue(dialogue || []).map((d) => {
    const line = String(d.line || "").trim();
    if (!line) return "";
    const speaker = String(d.speaker || "").trim();
    if (!speaker || speaker === "@narrator") return `"${line}"`;
    const name = speaker.replace(/^@+/, "").trim();
    if (!name) return `"${line}"`;
    return lang === "en"
      ? `${name} speaks. "${line}"`
      : `${name}가 말한다. "${line}"`;
  }).filter(Boolean).join(" ").trim();
}

function composeVideoSpeechPrompt({ lang = "ko", narration = "", dialogue = [], narrationEnabled = false, dubbingEnabled = false }) {
  const parts = [];
  const safeNarration = String(narration || "").trim();
  const dialoguePrompt = formatDialogueForVideoPrompt(dialogue, lang);
  if (narrationEnabled && safeNarration) parts.push(`"${safeNarration}"`);
  if (dubbingEnabled && dialoguePrompt) parts.push(dialoguePrompt);
  return parts.join(" ").trim();
}

function composeSubtitleText({ narration = "", dialogue = [], narrationEnabled = false, dubbingEnabled = false }) {
  const safeNarration = String(narration || "").trim();
  const dialogueOnly = composeDialogueOnlyText(dialogue);
  if (narrationEnabled && dubbingEnabled) return dialogueOnly;
  if (narrationEnabled) return safeNarration;
  if (dubbingEnabled) return dialogueOnly;
  return "";
}

function composeVoiceScript({ narration = "", dialogue = [], narrationEnabled = false, dubbingEnabled = false }) {
  const rows = [];
  const safeNarration = String(narration || "").trim();
  const dialogueOnly = composeDialogueOnlyText(dialogue);
  if (narrationEnabled && safeNarration) rows.push(safeNarration);
  if (dubbingEnabled && dialogueOnly) rows.push(dialogueOnly);
  return rows.join("\n").trim();
}

function rebalanceEstSec(scenes = [], target = 0) {
  const minSec = 3;
  if (!Array.isArray(scenes) || !scenes.length || !target) return scenes;
  const total = scenes.reduce((sum, s) => sum + (Number(s.estSec) || minSec), 0);
  if (!total) return scenes;
  const scaled = scenes.map((s) => {
    const raw = Number(s.estSec) || minSec;
    return Math.max(Math.round((raw / total) * target), minSec);
  });
  const diff = target - scaled.reduce((a, b) => a + b, 0);
  if (scaled.length) {
    scaled[scaled.length - 1] = Math.max(scaled[scaled.length - 1] + diff, minSec);
  }
  return scenes.map((s, i) => Object.assign({}, s, { estSec: scaled[i] || minSec }));
}

function fallbackScenes({ topic, target, duration, sceneCount, narrationEnabled, dubbingEnabled, characters, characterGenerationDisabled = false }) {
  return fallbackScenesV2({
    topic,
    target,
    duration,
    sceneCount,
    narrationEnabled,
    dubbingEnabled,
    characters,
    characterGenerationDisabled,
    lang: "ko",
  });
}

function fallbackScenesV2({
  topic,
  episodeTitle = "",
  story = "",
  target,
  duration,
  sceneCount,
  narrationEnabled,
  dubbingEnabled,
  characters,
  characterGenerationDisabled = false,
  lang = "ko",
  purposeCategory = "",
  purposeTags = "",
  toneText = "",
  tones = "",
  styleText = "",
  styles = "",
  aspectRatio = "",
  spec = null,
  knowledgeHub = {},
}) {
  const count = Number(sceneCount) || 4;
  const per = Math.max(Math.floor((Number(duration) || 60) / count), 5);
  const t = String(topic || "Untitled").trim();
  const scenarioSpec = spec || buildScenarioSpec({
    lang,
    topic: t,
    episodeTitle: episodeTitle || "",
    story: story || t,
    target,
    purposeCategory,
    purposeTags,
    needs: "",
    toneText,
    tones,
    styleText,
    styles,
    knowledgeHub,
    characters,
    duration: String(duration || ""),
    sceneCount: count,
  });
  const defaultSpeaker = characters[0]?.token || "@narrator";
  const scenes = [];
  const cameraContext = {
    lang,
    topic: t,
    purposeCategory,
    purposeTags,
    toneText,
    tones,
    styleText,
    styles,
    aspectRatio,
    sceneCount: count,
  };

  for (let i = 0; i < count; i++) {
    const blueprint = scenarioSpec.sceneBlueprint?.[i] || createBlueprintItem({
      lang,
      role: "develop",
      idx: i,
      total: count,
      topicProfile: scenarioSpec.topicProfile,
      signals: scenarioSpec.signals,
      profile: scenarioSpec.profile || {},
    });
    const hints = buildHintText(scenarioSpec, blueprint, lang);
    const narration = narrationEnabled ? hints.narration : "";
    const visualSeed = hints.visual || (lang === "en" ? `Scene ${i + 1} key visual direction` : `Scene ${i + 1}의 핵심 장면 설명`);
    const visual = ensureCameraDirectionInVisual(ensureContinuityAnchorInVisual(visualSeed, scenarioSpec, lang), Object.assign({}, cameraContext, { idx: i, spec: scenarioSpec }));
    const dialogue = dubbingEnabled ? hints.dialogue.map((line) => splitDialogueLine(line, defaultSpeaker)) : [];

    scenes.push(shapeSceneByMode({
      id: i + 1,
      title: blueprint.title || `Scene ${i + 1}`,
      estSec: per,
      sceneIntent: hints.intent,
      sceneLocation: hints.location || blueprint.location || "",
      backgroundStyle: hints.backgroundStyle || scenarioSpec.continuity?.backgroundStyle || "",
      sceneArcPhase: blueprint.phaseLabel,
      sceneArcKey: blueprint.phaseKey,
      sceneArcGoal: blueprint.phaseGoal,
      narration,
      dialogue,
      visual,
      narrationEnabled,
      dubbingEnabled,
      characterGenerationDisabled,
      defaultSpeaker,
      lang,
    }));
  }
  return scenes;
}

function toBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(v)) return true;
    if (["false", "0", "no", "off"].includes(v)) return false;
  }
  return !!fallback;
}

function jsonError(message, status = 500, origin = null) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: corsHeaders(origin),
  });
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
