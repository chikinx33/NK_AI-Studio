/**
 * scenario/shots/vocab.js
 *
 * Shot 분해(Pass 2) 에 쓰이는 통제 어휘.
 * 영상 업계 표준 약어 + 한국어 설명을 함께 담아 LLM 프롬프트에 직접 주입한다.
 *
 * shotType 12종 / cameraMove 10종.
 *
 * enHint 와 buildShotCameraHint / buildCameraDirectionHint 는 브라우저
 * prototype/js/service/shot-vocab.js 와 같은 영어 문장을 내야 한다 — 에이전트가 서버에서
 * 조립하는 프롬프트(_shared/prompt-assembly.js)가 브라우저 프롬프트와 글자까지 같아지는 근거.
 */

export const SHOT_TYPES = Object.freeze({
  ECU:      { ko: "익스트림 클로즈업", en: "Extreme Close-Up",  hint: "눈동자/입술 등 신체 일부만",         enHint: "extreme close-up of a small detail (eyes, lips)" },
  CU:       { ko: "클로즈업",          en: "Close-Up",           hint: "얼굴 한 명, 표정 디테일",           enHint: "close-up of one face, emphasizing expression" },
  MCU:      { ko: "미디엄 클로즈업",   en: "Medium Close-Up",    hint: "가슴 위, 어깨~머리",                enHint: "medium close-up framed from chest up" },
  MS:       { ko: "미디엄 샷",         en: "Medium Shot",        hint: "허리 위, 행동과 표정 동시",         enHint: "medium shot framed from the waist up" },
  MLS:      { ko: "미디엄 롱샷",       en: "Medium Long Shot",   hint: "무릎 위, 인물과 환경 균형",         enHint: "medium long shot from the knees up, subject balanced with surroundings" },
  WS:       { ko: "와이드 샷",         en: "Wide Shot",          hint: "전신 + 주변 공간",                  enHint: "wide shot showing full body and the surrounding space" },
  EWS:      { ko: "익스트림 와이드샷", en: "Extreme Wide Shot",  hint: "인물이 점처럼 작고 풍경이 주",      enHint: "extreme wide shot, subject is tiny within a vast landscape" },
  OTS:      { ko: "오버숄더",          en: "Over-the-Shoulder",  hint: "한 인물 어깨 너머로 다른 인물",     enHint: "over-the-shoulder shot looking past one character toward another" },
  POV:      { ko: "주관적 시점",       en: "Point-of-View",      hint: "특정 인물의 눈으로 보는 화면",       enHint: "point-of-view shot through a character's eyes" },
  INSERT:   { ko: "인서트",            en: "Insert",             hint: "사물·소품·디테일의 단독 컷",         enHint: "insert shot of an isolated object or detail" },
  TWO_SHOT: { ko: "투샷",              en: "Two-Shot",           hint: "두 인물을 한 프레임에",              enHint: "two-shot with both subjects in frame" },
  GROUP:    { ko: "그룹샷",            en: "Group Shot",         hint: "3명 이상을 한 프레임에",            enHint: "group shot with three or more characters in frame" },
});

export const CAMERA_MOVES = Object.freeze({
  static:   { ko: "고정",            en: "Static",        hint: "삼각대 고정, 움직임 없음",            enHint: "locked tripod, no camera movement" },
  pan:      { ko: "팬",              en: "Pan",           hint: "좌우 회전",                            enHint: "horizontal pan, camera rotates left or right" },
  tilt:     { ko: "틸트",            en: "Tilt",          hint: "상하 회전",                            enHint: "vertical tilt, camera rotates up or down" },
  dolly:    { ko: "달리",            en: "Dolly",         hint: "전체 카메라가 앞/뒤로 이동",          enHint: "dolly move, the camera physically travels forward or backward" },
  track:    { ko: "트래킹",          en: "Tracking",      hint: "피사체와 평행 이동",                  enHint: "tracking shot, camera moves parallel to the subject" },
  crane:    { ko: "크레인",          en: "Crane",         hint: "수직 상승/하강",                       enHint: "crane shot, camera rises or descends vertically" },
  handheld: { ko: "핸드헬드",        en: "Handheld",      hint: "손으로 들고 자연스러운 흔들림",       enHint: "handheld camera with natural subtle shake" },
  zoom:     { ko: "줌",              en: "Zoom",          hint: "렌즈 초점거리 변화 (위치 고정)",      enHint: "zoom (focal-length change) while the camera stays in place" },
  push_in:  { ko: "푸시인",          en: "Push-In",       hint: "피사체를 향해 천천히 다가감 (긴장감)", enHint: "slow push-in toward the subject, building tension" },
  pull_out: { ko: "풀아웃",          en: "Pull-Out",      hint: "피사체에서 천천히 멀어짐 (해소감)",   enHint: "slow pull-out away from the subject, providing release" },
});

// 카메라 방위 — 세트(장소)의 마스터 플레이트가 바라보는 방향이 front.
// 리버스 샷 = back. 배경 방위 플레이트 선택과 공간 기하 조립의 기준 축이다.
export const CAMERA_DIRECTIONS = Object.freeze({
  front: { ko: "정면",       en: "Front",  hint: "마스터 플레이트와 같은 방향 (기본값)", enHint: "front side of the set (same direction as the master plate)" },
  back:  { ko: "후면(리버스)", en: "Back",   hint: "리버스 샷 — 정면의 반대편 공간을 비춘다", enHint: "REVERSE ANGLE — the camera has turned around and now faces the opposite side of the same space; the background behind the subject is the far side of the room, NOT the side seen in front-facing shots" },
  left:  { ko: "좌측",       en: "Left",   hint: "세트 왼쪽 벽을 바라본다", enHint: "the camera faces the left side of the set" },
  right: { ko: "우측",       en: "Right",  hint: "세트 오른쪽 벽을 바라본다", enHint: "the camera faces the right side of the set" },
});

export const SHOT_TYPE_KEYS = Object.freeze(Object.keys(SHOT_TYPES));
export const CAMERA_MOVE_KEYS = Object.freeze(Object.keys(CAMERA_MOVES));
export const CAMERA_DIRECTION_KEYS = Object.freeze(Object.keys(CAMERA_DIRECTIONS));

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

export function normalizeCameraDirection(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase().replace(/[\s-]/g, "_");
  if (CAMERA_DIRECTION_KEYS.includes(key)) return key;
  // LLM 이 쓰기 쉬운 동의어 흡수
  if (key === "reverse" || key === "rear" || key === "behind") return "back";
  return null;
}

// ── 프롬프트용 자연어 힌트 (브라우저 shot-vocab.js 의 이식) ──────────────────

export function describeShotType(raw, lang) {
  const key = normalizeShotType(raw);
  if (!key) return "";
  const v = SHOT_TYPES[key];
  return lang === "ko" ? (v.ko + " — " + v.hint) : v.enHint;
}

export function describeCameraMove(raw, lang) {
  const key = normalizeCameraMove(raw);
  if (!key) return "";
  const v = CAMERA_MOVES[key];
  return lang === "ko" ? (v.ko + " — " + v.hint) : v.enHint;
}

/**
 * 이미지/영상 프롬프트에 붙일 한 줄짜리 카메라 힌트.
 * 예: shotType="MS", cameraMove="push_in"
 *     → "Camera: medium shot framed from the waist up; slow push-in toward the subject, building tension."
 */
export function buildShotCameraHint(shotType, cameraMove, lang) {
  const l = lang === "ko" ? "ko" : "en";
  const parts = [];
  const s = describeShotType(shotType, l);
  const c = describeCameraMove(cameraMove, l);
  if (s) parts.push(s);
  if (c) parts.push(c);
  if (!parts.length) return "";
  if (l === "ko") {
    return "카메라: " + parts.join(" / ") + ".";
  }
  return "Camera: " + parts.join("; ") + ".";
}

// 이미지 프롬프트에 붙일 방위 한 줄. front 는 기본값이라 빈 문자열(굳이 말하지 않는다).
export function buildCameraDirectionHint(raw, lang) {
  const key = normalizeCameraDirection(raw);
  if (!key || key === "front") return "";
  const v = CAMERA_DIRECTIONS[key];
  if (lang === "ko") return "카메라 방위: " + v.ko + ".";
  return "Camera direction: " + v.enHint + ".";
}
