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
    var pan = Number.isFinite(Number(n.pan)) ? Number(n.pan) : CAMERA_FRONT_PAN;
    var tilt = Number(n.tilt || 0);
    var dist = Number.isFinite(Number(n.distance)) ? Number(n.distance) : 1;
    return pan === CAMERA_FRONT_PAN && tilt === 0 && dist === 1;
  }
  function shotFromDistance(distance) {
    var v = clamp(distance, 0, 2);
    if (v <= 0) return 'close-up portrait';
    if (v <= 1) return 'medium shot';
    return 'wide shot';
  }
  function viewFromPan(pan) {
    var v = relativePan(pan);
    if (v <= -170) return 'rear view';
    if (v <= -150) return 'rear 3/4 left view';
    if (v <= -80) return 'left side view';
    if (v <= -20) return '3/4 left view';
    if (v < 20) return 'front view';
    if (v < 80) return '3/4 right view';
    if (v < 150) return 'right side view';
    if (v < 170) return 'rear 3/4 right view';
    return 'rear view';
  }
  function angleFromTilt(tilt) {
    var v = clamp(tilt, -30, 60);
    if (v >= 36) return 'top-down view';
    if (v >= 12) return 'high angle';
    if (v > -10) return 'eye-level';
    if (v > -22) return 'low angle';
    return 'dramatic low angle';
  }
  function applyPresetOverride(preset, shot, view, angle) {
    var p = String(preset || 'custom').toLowerCase();
    if (p === 'front') { view = 'front view'; angle = 'eye-level'; }
    else if (p === 'rear') { view = 'rear view'; angle = 'eye-level'; }
    else if (p === 'left45') { view = '3/4 left view'; }
    else if (p === 'right45') { view = '3/4 right view'; }
    else if (p === 'upperleft45') { view = '3/4 left view'; angle = 'high angle'; }
    else if (p === 'upperright45') { view = '3/4 right view'; angle = 'high angle'; }
    else if (p === 'lowerleft45') { view = '3/4 left view'; angle = 'low angle'; }
    else if (p === 'lowerright45') { view = '3/4 right view'; angle = 'low angle'; }
    else if (p === 'highangle') { angle = 'high angle'; }
    else if (p === 'lowangle') { angle = 'low angle'; }
    else if (p === 'closeup') { shot = 'close-up portrait'; }
    else if (p === 'wide') { shot = 'wide shot'; }
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
    if (p === 'rear') return 'rear view, eye-level';
    if (p === 'left45') return '3/4 left view';
    if (p === 'right45') return '3/4 right view';
    if (p === 'upperleft45') return '3/4 left view, high angle';
    if (p === 'upperright45') return '3/4 right view, high angle';
    if (p === 'lowerleft45') return '3/4 left view, low angle';
    if (p === 'lowerright45') return '3/4 right view, low angle';
    if (p === 'highangle') return 'front view, high angle';
    if (p === 'lowangle') return 'front view, low angle';
    if (p === 'closeup') return 'close-up portrait';
    if (p === 'wide') return 'wide shot';
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
  // === Virtual Cinematographer Pro 매핑 (원본 App.tsx handleGenerate 이식) ===
  // azimuth 12구간 / elevation 6구간 / distance 5구간 / lens 3구간
  function cineAzimuthDesc(az) {
    var a = wrapPan(az, 0);
    if (a >= 345 || a < 15) return 'front center view, facing subject directly';
    if (a < 45) return 'slight 3/4 front view angle';
    if (a < 75) return 'broad 3/4 side view';
    if (a < 105) return 'pure side profile view, 90 degree angle';
    if (a < 135) return 'rear 3/4 side view from behind';
    if (a < 165) return 'over-the-shoulder perspective from back-right';
    if (a < 195) return 'full back view, behind the subject';
    if (a < 225) return 'over-the-shoulder perspective from back-left';
    if (a < 255) return 'opposite rear 3/4 side view';
    if (a < 285) return 'opposite pure side profile view, 270 degree angle';
    if (a < 315) return 'opposite broad 3/4 side view';
    return 'opposite slight 3/4 front view';
  }
  function cineElevationDesc(el) {
    var e = clamp(el, -85, 85);
    if (e > 75) return "extreme top-down bird's eye view, vertical plunge";
    if (e > 45) return 'high-angle cinematic shot looking down';
    if (e > 15) return 'slight high-angle, looking down at subject';
    if (e >= -15) return 'perfectly horizontal eye-level shot';
    if (e >= -45) return 'low-angle hero shot, looking up at subject';
    return "extreme low-angle worm's eye view, ground-level looking up";
  }
  function cineShotSizeDesc(dist) {
    var d = clamp(dist, 0.1, 3.5);
    if (d < 0.45) return 'extreme close-up detail shot';
    if (d < 0.75) return 'tight close-up portrait';
    if (d < 1.1) return 'medium portrait shot';
    if (d < 1.6) return 'full body shot';
    return 'wide cinematic establishment shot';
  }
  function cineLensDesc(fl) {
    var f = Math.round(clamp(fl, 12, 200));
    if (f < 24) return 'ultra-wide ' + f + 'mm lens, dramatic perspective distortion, deep depth of field';
    if (f <= 50) return 'naturalistic ' + f + 'mm lens, human-eye perspective';
    if (f > 85) return 'compressed telephoto ' + f + 'mm lens, creamy bokeh, shallow depth of field, background compression';
    return 'portrait ' + f + 'mm lens, flattering compression';
  }
  function normalizeCineCamera(raw) {
    var c = raw && typeof raw === 'object' ? raw : {};
    return {
      azimuth: wrapPan(c.azimuth, 0),
      elevation: clamp(c.elevation, -85, 85),
      distance: clamp(Number.isFinite(Number(c.distance)) ? Number(c.distance) : 0.8, 0.1, 3.5),
      focalLength: Math.round(clamp(Number.isFinite(Number(c.focalLength)) ? Number(c.focalLength) : 35, 12, 200)),
      style: String(c.style || 'None')
    };
  }
  // 공간 지시문(카메라 위치·앵글·프레이밍·렌즈)만 생성 — 스타일 미포함
  function buildCineSpatialInstruction(raw) {
    var c = normalizeCineCamera(raw);
    return 'Camera Setup: [Position: ' + cineAzimuthDesc(c.azimuth)
      + ', Angle: ' + cineElevationDesc(c.elevation)
      + ', Framing: ' + cineShotSizeDesc(c.distance)
      + ', Lens: ' + cineLensDesc(c.focalLength)
      + ']. Technical: (azimuth: ' + c.azimuth.toFixed(1) + '°, elevation: ' + c.elevation.toFixed(1) + '°).';
  }
  // 최종 생성 프롬프트: 공간 지시문 + (사용자가 고른 스타일 프리셋 텍스트)
  function buildCinematicPrompt(raw, styleText) {
    var spatial = buildCineSpatialInstruction(raw);
    var style = String(styleText || '').trim();
    var parts = ['Professional cinematography.', spatial];
    if (style) parts.push(style);
    parts.push('Sharp details, coherent lighting and perspective.');
    return parts.join(' ');
  }

  utils.mapCameraToPrompt = mapCameraToPrompt;
  utils.mapPresetToPrompt = mapPresetToPrompt;
  utils.buildCameraPrompt = buildCameraPrompt;
  utils.normalizeCineCamera = normalizeCineCamera;
  utils.buildCineSpatialInstruction = buildCineSpatialInstruction;
  utils.buildCinematicPrompt = buildCinematicPrompt;
  utils.cineDescriptors = {
    azimuth: cineAzimuthDesc,
    elevation: cineElevationDesc,
    shotSize: cineShotSizeDesc,
    lens: cineLensDesc
  };
  if (typeof window.mapCameraToPrompt !== 'function') window.mapCameraToPrompt = mapCameraToPrompt;
  if (typeof window.buildCameraPrompt !== 'function') window.buildCameraPrompt = buildCameraPrompt;
})(); 
