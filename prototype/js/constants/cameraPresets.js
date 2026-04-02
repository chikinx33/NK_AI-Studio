;(function () {
  var NK = window.NK || (window.NK = {});
  var constants = NK.constants || (NK.constants = {});
  var CAMERA_PRESETS = {
    front: { orbitPan: true, pan: 0, tilt: 0, distance: 1 },
    left45: { orbitPan: true, pan: 315, tilt: 0, distance: 1 },
    right45: { orbitPan: true, pan: 45, tilt: 0, distance: 1 },
    topdown: { orbitPan: true, pan: 0, tilt: 60, distance: 2 },
    lowangle: { orbitPan: true, pan: 0, tilt: -24, distance: 1 },
    closeup: { orbitPan: true, pan: 0, tilt: 6, distance: 0 },
    medium: { orbitPan: true, pan: 0, tilt: 0, distance: 1 }
  };
  constants.CAMERA_PRESETS = CAMERA_PRESETS;
})(); 
