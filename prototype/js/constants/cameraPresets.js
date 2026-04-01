;(function () {
  var NK = window.NK || (window.NK = {});
  var constants = NK.constants || (NK.constants = {});
  var CAMERA_PRESETS = {
    auto: { pan: 0, tilt: 0, distance: 50 },
    front: { pan: 0, tilt: 0, distance: 50 },
    left45: { pan: -35, tilt: 0, distance: 55 },
    right45: { pan: 35, tilt: 0, distance: 55 },
    topdown: { pan: 0, tilt: -45, distance: 80 },
    lowangle: { pan: 0, tilt: 20, distance: 50 },
    closeup: { pan: 0, tilt: 5, distance: 20 },
    medium: { pan: 0, tilt: 0, distance: 50 }
  };
  constants.CAMERA_PRESETS = CAMERA_PRESETS;
})(); 
