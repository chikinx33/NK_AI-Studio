/**
 * scenario/shots/vocab.js
 *
 * Shot 분해(Pass 2) 에 쓰이는 통제 어휘.
 * 영상 업계 표준 약어 + 한국어 설명을 함께 담아 LLM 프롬프트에 직접 주입한다.
 *
 * shotType 12종 / cameraMove 10종.
 */

export const SHOT_TYPES = Object.freeze({
  ECU:      { ko: "익스트림 클로즈업", en: "Extreme Close-Up",  hint: "눈동자/입술 등 신체 일부만" },
  CU:       { ko: "클로즈업",          en: "Close-Up",           hint: "얼굴 한 명, 표정 디테일" },
  MCU:      { ko: "미디엄 클로즈업",   en: "Medium Close-Up",    hint: "가슴 위, 어깨~머리" },
  MS:       { ko: "미디엄 샷",         en: "Medium Shot",        hint: "허리 위, 행동과 표정 동시" },
  MLS:      { ko: "미디엄 롱샷",       en: "Medium Long Shot",   hint: "무릎 위, 인물과 환경 균형" },
  WS:       { ko: "와이드 샷",         en: "Wide Shot",          hint: "전신 + 주변 공간" },
  EWS:      { ko: "익스트림 와이드샷", en: "Extreme Wide Shot",  hint: "인물이 점처럼 작고 풍경이 주" },
  OTS:      { ko: "오버숄더",          en: "Over-the-Shoulder",  hint: "한 인물 어깨 너머로 다른 인물" },
  POV:      { ko: "주관적 시점",       en: "Point-of-View",      hint: "특정 인물의 눈으로 보는 화면" },
  INSERT:   { ko: "인서트",            en: "Insert",             hint: "사물·소품·디테일의 단독 컷" },
  TWO_SHOT: { ko: "투샷",              en: "Two-Shot",           hint: "두 인물을 한 프레임에" },
  GROUP:    { ko: "그룹샷",            en: "Group Shot",         hint: "3명 이상을 한 프레임에" },
});

export const CAMERA_MOVES = Object.freeze({
  static:   { ko: "고정",            en: "Static",        hint: "삼각대 고정, 움직임 없음" },
  pan:      { ko: "팬",              en: "Pan",           hint: "좌우 회전" },
  tilt:     { ko: "틸트",            en: "Tilt",          hint: "상하 회전" },
  dolly:    { ko: "달리",            en: "Dolly",         hint: "전체 카메라가 앞/뒤로 이동" },
  track:    { ko: "트래킹",          en: "Tracking",      hint: "피사체와 평행 이동" },
  crane:    { ko: "크레인",          en: "Crane",         hint: "수직 상승/하강" },
  handheld: { ko: "핸드헬드",        en: "Handheld",      hint: "손으로 들고 자연스러운 흔들림" },
  zoom:     { ko: "줌",              en: "Zoom",          hint: "렌즈 초점거리 변화 (위치 고정)" },
  push_in:  { ko: "푸시인",          en: "Push-In",       hint: "피사체를 향해 천천히 다가감 (긴장감)" },
  pull_out: { ko: "풀아웃",          en: "Pull-Out",      hint: "피사체에서 천천히 멀어짐 (해소감)" },
});

export const SHOT_TYPE_KEYS = Object.freeze(Object.keys(SHOT_TYPES));
export const CAMERA_MOVE_KEYS = Object.freeze(Object.keys(CAMERA_MOVES));

/**
 * 어휘 표(LLM 프롬프트용 멀티라인 텍스트). KO/EN 두 버전.
 */
export function buildVocabPromptKo() {
  const shotLines = SHOT_TYPE_KEYS.map((k) => {
    const v = SHOT_TYPES[k];
    return `  - ${k} (${v.ko}): ${v.hint}`;
  }).join("\n");
  const moveLines = CAMERA_MOVE_KEYS.map((k) => {
    const v = CAMERA_MOVES[k];
    return `  - ${k} (${v.ko}): ${v.hint}`;
  }).join("\n");
  return `[허용 shotType — 이 12개 중에서만 선택]
${shotLines}

[허용 cameraMove — 이 10개 중에서만 선택]
${moveLines}`;
}

export function buildVocabPromptEn() {
  const shotLines = SHOT_TYPE_KEYS.map((k) => {
    const v = SHOT_TYPES[k];
    return `  - ${k} (${v.en}): ${v.hint}`;
  }).join("\n");
  const moveLines = CAMERA_MOVE_KEYS.map((k) => {
    const v = CAMERA_MOVES[k];
    return `  - ${k} (${v.en}): ${v.hint}`;
  }).join("\n");
  return `[Allowed shotType — pick exactly one from these 12]
${shotLines}

[Allowed cameraMove — pick exactly one from these 10]
${moveLines}`;
}

/**
 * 입력 문자열을 통제 어휘로 정규화.
 * 대소문자/공백/하이픈/언더스코어 차이 흡수.
 */
export function normalizeShotType(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toUpperCase().replace(/[\s-]/g, "_");
  return SHOT_TYPE_KEYS.includes(key) ? key : null;
}

export function normalizeCameraMove(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase().replace(/[\s-]/g, "_");
  return CAMERA_MOVE_KEYS.includes(key) ? key : null;
}
