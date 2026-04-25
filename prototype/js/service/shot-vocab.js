/**
 * shot-vocab.js — 클라이언트용 shotType / cameraMove 어휘 + 자연어 힌트.
 *
 * functions/api/scenario/shots/vocab.js 와 키 셋이 동일해야 한다.
 * 이미지·영상 프롬프트 빌드 시 사용된다 (예: "MS" → "medium shot, waist-up framing").
 */
;(function () {
  var NK = window.NK || (window.NK = {});
  var service = NK.service || (NK.service = {});

  var SHOT_TYPES = {
    ECU:      { ko: '익스트림 클로즈업', en: 'Extreme Close-Up',  hint: '눈동자/입술 등 신체 일부만',         enHint: 'extreme close-up of a small detail (eyes, lips)' },
    CU:       { ko: '클로즈업',          en: 'Close-Up',           hint: '얼굴 한 명, 표정 디테일',           enHint: 'close-up of one face, emphasizing expression' },
    MCU:      { ko: '미디엄 클로즈업',   en: 'Medium Close-Up',    hint: '가슴 위, 어깨~머리',                enHint: 'medium close-up framed from chest up' },
    MS:       { ko: '미디엄 샷',         en: 'Medium Shot',        hint: '허리 위, 행동과 표정 동시',         enHint: 'medium shot framed from the waist up' },
    MLS:      { ko: '미디엄 롱샷',       en: 'Medium Long Shot',   hint: '무릎 위, 인물과 환경 균형',         enHint: 'medium long shot from the knees up, subject balanced with surroundings' },
    WS:       { ko: '와이드 샷',         en: 'Wide Shot',          hint: '전신 + 주변 공간',                  enHint: 'wide shot showing full body and the surrounding space' },
    EWS:      { ko: '익스트림 와이드샷', en: 'Extreme Wide Shot',  hint: '인물이 점처럼 작고 풍경이 주',      enHint: 'extreme wide shot, subject is tiny within a vast landscape' },
    OTS:      { ko: '오버숄더',          en: 'Over-the-Shoulder',  hint: '한 인물 어깨 너머로 다른 인물',     enHint: 'over-the-shoulder shot looking past one character toward another' },
    POV:      { ko: '주관적 시점',       en: 'Point-of-View',      hint: '특정 인물의 눈으로 보는 화면',       enHint: 'point-of-view shot through a character\'s eyes' },
    INSERT:   { ko: '인서트',            en: 'Insert',             hint: '사물·소품·디테일의 단독 컷',         enHint: 'insert shot of an isolated object or detail' },
    TWO_SHOT: { ko: '투샷',              en: 'Two-Shot',           hint: '두 인물을 한 프레임에',              enHint: 'two-shot with both subjects in frame' },
    GROUP:    { ko: '그룹샷',            en: 'Group Shot',         hint: '3명 이상을 한 프레임에',            enHint: 'group shot with three or more characters in frame' },
  };

  var CAMERA_MOVES = {
    static:   { ko: '고정',     en: 'Static',     hint: '삼각대 고정, 움직임 없음',            enHint: 'locked tripod, no camera movement' },
    pan:      { ko: '팬',       en: 'Pan',        hint: '좌우 회전',                            enHint: 'horizontal pan, camera rotates left or right' },
    tilt:     { ko: '틸트',     en: 'Tilt',       hint: '상하 회전',                            enHint: 'vertical tilt, camera rotates up or down' },
    dolly:    { ko: '달리',     en: 'Dolly',      hint: '전체 카메라가 앞/뒤로 이동',          enHint: 'dolly move, the camera physically travels forward or backward' },
    track:    { ko: '트래킹',   en: 'Tracking',   hint: '피사체와 평행 이동',                  enHint: 'tracking shot, camera moves parallel to the subject' },
    crane:    { ko: '크레인',   en: 'Crane',      hint: '수직 상승/하강',                       enHint: 'crane shot, camera rises or descends vertically' },
    handheld: { ko: '핸드헬드', en: 'Handheld',   hint: '손으로 들고 자연스러운 흔들림',       enHint: 'handheld camera with natural subtle shake' },
    zoom:     { ko: '줌',       en: 'Zoom',       hint: '렌즈 초점거리 변화 (위치 고정)',      enHint: 'zoom (focal-length change) while the camera stays in place' },
    push_in:  { ko: '푸시인',   en: 'Push-In',    hint: '피사체를 향해 천천히 다가감 (긴장감)', enHint: 'slow push-in toward the subject, building tension' },
    pull_out: { ko: '풀아웃',   en: 'Pull-Out',   hint: '피사체에서 천천히 멀어짐 (해소감)',   enHint: 'slow pull-out away from the subject, providing release' },
  };

  function normalizeShotType(raw) {
    if (!raw) return null;
    var key = String(raw).trim().toUpperCase().replace(/[\s-]/g, '_');
    return Object.prototype.hasOwnProperty.call(SHOT_TYPES, key) ? key : null;
  }

  function normalizeCameraMove(raw) {
    if (!raw) return null;
    var key = String(raw).trim().toLowerCase().replace(/[\s-]/g, '_');
    return Object.prototype.hasOwnProperty.call(CAMERA_MOVES, key) ? key : null;
  }

  function describeShotType(raw, lang) {
    var key = normalizeShotType(raw);
    if (!key) return '';
    var v = SHOT_TYPES[key];
    return lang === 'ko' ? (v.ko + ' — ' + v.hint) : v.enHint;
  }

  function describeCameraMove(raw, lang) {
    var key = normalizeCameraMove(raw);
    if (!key) return '';
    var v = CAMERA_MOVES[key];
    return lang === 'ko' ? (v.ko + ' — ' + v.hint) : v.enHint;
  }

  /**
   * 이미지/영상 프롬프트에 붙일 한 줄짜리 카메라 힌트.
   * 예: shotType="MS", cameraMove="push_in"
   *     → "Camera: medium shot framed from the waist up; slow push-in toward the subject, building tension."
   */
  function buildShotCameraHint(shotType, cameraMove, lang) {
    var l = lang === 'ko' ? 'ko' : 'en';
    var parts = [];
    var s = describeShotType(shotType, l);
    var c = describeCameraMove(cameraMove, l);
    if (s) parts.push(s);
    if (c) parts.push(c);
    if (!parts.length) return '';
    if (l === 'ko') {
      return '카메라: ' + parts.join(' / ') + '.';
    }
    return 'Camera: ' + parts.join('; ') + '.';
  }

  function getShotTypeLabel(raw, lang) {
    var key = normalizeShotType(raw);
    if (!key) return String(raw || '');
    var v = SHOT_TYPES[key];
    return lang === 'ko' ? v.ko : v.en;
  }

  function getCameraMoveLabel(raw, lang) {
    var key = normalizeCameraMove(raw);
    if (!key) return String(raw || '');
    var v = CAMERA_MOVES[key];
    return lang === 'ko' ? v.ko : v.en;
  }

  service.shotVocab = {
    SHOT_TYPES: SHOT_TYPES,
    CAMERA_MOVES: CAMERA_MOVES,
    SHOT_TYPE_KEYS: Object.keys(SHOT_TYPES),
    CAMERA_MOVE_KEYS: Object.keys(CAMERA_MOVES),
    normalizeShotType: normalizeShotType,
    normalizeCameraMove: normalizeCameraMove,
    describeShotType: describeShotType,
    describeCameraMove: describeCameraMove,
    buildShotCameraHint: buildShotCameraHint,
    getShotTypeLabel: getShotTypeLabel,
    getCameraMoveLabel: getCameraMoveLabel,
  };
})();
