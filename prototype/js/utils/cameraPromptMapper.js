;(function () {
  var NK = window.NK || (window.NK = {});
  var utils = NK.utils || (NK.utils = {});
  function clamp(n, min, max) { var x = Number(n); if (!Number.isFinite(x)) x = 0; if (x < min) return min; if (x > max) return max; return x; }
  function isNeutral(c) {
    var p = String(c && c.preset || 'auto');
    var pan = Number(c && c.pan || 0);
    var tilt = Number(c && c.tilt || 0);
    var dist = Number(c && c.distance || 50);
    return p === 'auto' && pan === 0 && tilt === 0 && dist === 50;
  }
  function shotFromDistance(distance) {
    var v = clamp(distance, 0, 100);
    if (v <= 20) return 'extreme close-up';
    if (v <= 40) return 'close-up';
    if (v <= 60) return 'medium shot';
    if (v <= 80) return 'full body shot';
    return 'wide shot';
  }
  function viewFromPan(pan) {
    var v = clamp(pan, -90, 90);
    if (v < -25) return 'left side view';
    if (v < -10) return '3/4 left view';
    if (v <= 10) return 'front view';
    if (v <= 25) return '3/4 right view';
    return 'right side view';
  }
  function angleFromTilt(tilt) {
    var v = clamp(tilt, -60, 60);
    if (v < -25) return 'top-down view';
    if (v < -10) return 'high angle';
    if (v <= 10) return 'eye-level';
    if (v <= 25) return 'low angle';
    return 'dramatic low angle';
  }
  function applyPresetOverride(preset, shot, view, angle) {
    var p = String(preset || 'auto').toLowerCase();
    if (p === 'front') { view = 'front view'; angle = 'eye-level'; }
    else if (p === 'left45') { view = '3/4 left view'; }
    else if (p === 'right45') { view = '3/4 right view'; }
    else if (p === 'topdown') { angle = 'top-down view'; }
    else if (p === 'lowangle') { angle = 'low angle'; }
    else if (p === 'closeup') { shot = 'close-up portrait'; }
    return { shot: shot, view: view, angle: angle };
  }
  function mapCameraToPrompt(cameraControls, options) {
    var c = cameraControls && typeof cameraControls === 'object' ? cameraControls : {};
    if (isNeutral(c)) return '';
    var shot = shotFromDistance(c.distance);
    var view = viewFromPan(c.pan);
    var angle = angleFromTilt(c.tilt);
    var o = applyPresetOverride(c.preset, shot, view, angle);
    var tokens = ['cinematic ' + o.shot, o.view, o.angle].filter(Boolean);
    var weight = (options && Number(options.weight)) || 1.3;
    return '(camera: ' + tokens.join(', ') + ':' + String(weight) + ')';
  }
  utils.mapCameraToPrompt = mapCameraToPrompt;
  if (typeof window.mapCameraToPrompt !== 'function') window.mapCameraToPrompt = mapCameraToPrompt;
})(); 
