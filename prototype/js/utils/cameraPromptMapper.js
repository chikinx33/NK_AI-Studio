;(function () {
  var NK = window.NK || (window.NK = {});
  var utils = NK.utils || (NK.utils = {});
  var CAMERA_FRONT_PAN = 0;
  function clamp(n, min, max) { var x = Number(n); if (!Number.isFinite(x)) x = 0; if (x < min) return min; if (x > max) return max; return x; }
  function wrapPan(n, fallback) {
    var x = Number(n);
    if (!Number.isFinite(x)) x = Number(fallback);
    if (!Number.isFinite(x)) x = CAMERA_FRONT_PAN;
    var wrapped = x % 360;
    if (wrapped < 0) wrapped += 360;
    return Math.round(wrapped);
  }
  function relativePan(n) {
    var delta = wrapPan(n, CAMERA_FRONT_PAN) - CAMERA_FRONT_PAN;
    if (delta > 180) delta -= 360;
    if (delta <= -180) delta += 360;
    return delta;
  }
  function legacyDistanceToStage(distance) {
    var raw = Number(distance);
    var v = Number.isFinite(raw) ? clamp(raw, 0, 100) : 50;
    if (v <= 33) return 0;
    if (v <= 66) return 1;
    return 2;
  }
  function normalizeControls(cameraControls) {
    var c = cameraControls && typeof cameraControls === 'object' ? cameraControls : {};
    var panValue = Number(c.pan);
    var distanceValue = Number(c.distance);
    var orbitPan = c.orbitPan === true || (panValue >= 0 && panValue <= 359 && distanceValue >= 0 && distanceValue <= 2);
    return {
      orbitPan: true,
      enabled: !!c.enabled,
      preset: String(c.preset || 'custom').toLowerCase(),
      pan: orbitPan ? wrapPan(panValue, CAMERA_FRONT_PAN) : wrapPan(CAMERA_FRONT_PAN + clamp(panValue, -180, 180), CAMERA_FRONT_PAN),
      tilt: clamp(c.tilt, -30, 60),
      distance: orbitPan ? clamp(distanceValue, 0, 2) : legacyDistanceToStage(distanceValue)
    };
  }
  function isNeutral(c) {
    var n = normalizeControls(c);
    var enabled = !!n.enabled;
    var pan = Number.isFinite(Number(n.pan)) ? Number(n.pan) : CAMERA_FRONT_PAN;
    var tilt = Number(n.tilt || 0);
    var dist = Number.isFinite(Number(n.distance)) ? Number(n.distance) : 1;
    return !enabled && pan === CAMERA_FRONT_PAN && tilt === 0 && dist === 1;
  }
  function shotFromDistance(distance) {
    var v = clamp(distance, 0, 2);
    if (v <= 0) return 'close-up portrait';
    if (v <= 1) return 'medium shot';
    return 'wide shot';
  }
  function viewFromPan(pan) {
    var v = relativePan(pan);
    if (v <= -150) return 'rear 3/4 left view';
    if (v <= -80) return 'left side view';
    if (v <= -20) return '3/4 left view';
    if (v < 20) return 'front view';
    if (v < 80) return '3/4 right view';
    if (v < 150) return 'right side view';
    return 'rear 3/4 right view';
  }
  function angleFromTilt(tilt) {
    var v = clamp(tilt, -30, 60);
    if (v < -18) return 'top-down view';
    if (v < -10) return 'high angle';
    if (v <= 10) return 'eye-level';
    if (v <= 30) return 'low angle';
    return 'dramatic low angle';
  }
  function applyPresetOverride(preset, shot, view, angle) {
    var p = String(preset || 'custom').toLowerCase();
    if (p === 'front') { view = 'front view'; angle = 'eye-level'; }
    else if (p === 'left45') { view = '3/4 left view'; }
    else if (p === 'right45') { view = '3/4 right view'; }
    else if (p === 'topdown') { angle = 'top-down view'; }
    else if (p === 'lowangle') { angle = 'low angle'; }
    else if (p === 'closeup') { shot = 'close-up portrait'; }
    return { shot: shot, view: view, angle: angle };
  }
  function mapCameraToPrompt(cameraControls, options) {
    var c = normalizeControls(cameraControls);
    if (!c.enabled || isNeutral(c)) return '';
    var shot = shotFromDistance(c.distance);
    var view = viewFromPan(c.pan);
    var angle = angleFromTilt(c.tilt);
    var o = applyPresetOverride(c.preset, shot, view, angle);
    var tokens = ['cinematic ' + o.shot, o.view, o.angle].filter(Boolean);
    var weight = (options && Number(options.weight)) || 1.3;
    return '(camera: ' + tokens.join(', ') + ':' + String(weight) + ')';
  }
  function mapPresetToPrompt(preset) {
    var p = String(preset || '').toLowerCase();
    if (p === 'front') return 'front view, eye-level';
    if (p === 'left45') return '3/4 left view';
    if (p === 'right45') return '3/4 right view';
    if (p === 'topdown') return 'top-down view';
    if (p === 'lowangle') return 'low angle';
    if (p === 'closeup') return 'close-up portrait';
    if (p === 'medium') return 'medium shot';
    return '';
  }
  function buildCameraPrompt(cameraControls, options) {
    var c = normalizeControls(cameraControls);
    var p = String(c.preset || 'custom').toLowerCase();
    if (!c.enabled || isNeutral(c)) return '';
    if (p && p !== 'custom') {
      var base = mapPresetToPrompt(p);
      if (base) {
        var w = (options && Number(options.weight)) || 1.3;
        return '(camera: cinematic ' + base + ':' + String(w) + ')';
      }
    }
    return mapCameraToPrompt(c, options);
  }
  utils.mapCameraToPrompt = mapCameraToPrompt;
  utils.mapPresetToPrompt = mapPresetToPrompt;
  utils.buildCameraPrompt = buildCameraPrompt;
  if (typeof window.mapCameraToPrompt !== 'function') window.mapCameraToPrompt = mapCameraToPrompt;
  if (typeof window.buildCameraPrompt !== 'function') window.buildCameraPrompt = buildCameraPrompt;
})(); 
