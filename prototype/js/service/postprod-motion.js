; (function () {
  var NK = window.NK || (window.NK = {});
  var service = NK.service || (NK.service = {});
  var motion = service.postprodMotion || (service.postprodMotion = {});

  var PRESETS = {
    none:       { startScale: 1.0,  endScale: 1.0,  startX: 0,     startY: 0,     endX: 0,     endY: 0 },
    zoomIn:     { startScale: 1.0,  endScale: 1.35, startX: 0,     startY: 0,     endX: 0,     endY: 0 },
    zoomOut:    { startScale: 1.35, endScale: 1.0,  startX: 0,     startY: 0,     endX: 0,     endY: 0 },
    panLeft:    { startScale: 1.15, endScale: 1.15, startX: 0.12,  startY: 0,     endX: -0.12, endY: 0 },
    panRight:   { startScale: 1.15, endScale: 1.15, startX: -0.12, startY: 0,     endX: 0.12,  endY: 0 },
    tiltUp:     { startScale: 1.15, endScale: 1.15, startX: 0,     startY: 0.12,  endX: 0,     endY: -0.12 },
    tiltDown:   { startScale: 1.15, endScale: 1.15, startX: 0,     startY: -0.12, endX: 0,     endY: 0.12 },
    kenBurns:   { startScale: 1.0,  endScale: 1.3,  startX: -0.1,  startY: -0.06, endX: 0.1,   endY: 0.06 }
  };

  var LABELS = {
    none:     { ko: '없음',           en: 'None' },
    zoomIn:   { ko: '줌 인',          en: 'Zoom In' },
    zoomOut:  { ko: '줌 아웃',        en: 'Zoom Out' },
    panLeft:  { ko: '좌로 이동',      en: 'Pan Left' },
    panRight: { ko: '우로 이동',      en: 'Pan Right' },
    tiltUp:   { ko: '위로 이동',      en: 'Tilt Up' },
    tiltDown: { ko: '아래로 이동',    en: 'Tilt Down' },
    kenBurns: { ko: 'Ken Burns',      en: 'Ken Burns' }
  };

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function clampOffset(offset, scale) {
    var maxOff = Math.max(0, (scale - 1) / 2);
    return Math.max(-maxOff, Math.min(maxOff, offset));
  }

  motion.computeMotionFrame = function (preset, progress) {
    var p = PRESETS[preset];
    if (!p) return { scale: 1, x: 0, y: 0 };
    var t = easeInOutCubic(Math.max(0, Math.min(1, Number(progress) || 0)));
    var scale = lerp(p.startScale, p.endScale, t);
    var x = clampOffset(lerp(p.startX, p.endX, t), scale);
    var y = clampOffset(lerp(p.startY, p.endY, t), scale);
    return { scale: scale, x: x, y: y };
  };

  motion.getPresetKeys = function () {
    return Object.keys(PRESETS);
  };

  motion.getPresetLabel = function (key, lang) {
    var entry = LABELS[key];
    if (!entry) return key || '';
    return lang === 'en' ? entry.en : entry.ko;
  };
})();
