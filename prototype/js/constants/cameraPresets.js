;(function () {
  var NK = window.NK || (window.NK = {});
  var constants = NK.constants || (NK.constants = {});
  var CAMERA_PRESETS = {
    front: { orbitPan: true, pan: 270, tilt: 0, distance: 3 },
    left45: { orbitPan: true, pan: 225, tilt: 0, distance: 3 },
    right45: { orbitPan: true, pan: 315, tilt: 0, distance: 3 },
    topdown: { orbitPan: true, pan: 270, tilt: -32, distance: 4 },
    lowangle: { orbitPan: true, pan: 270, tilt: 18, distance: 3 },
    closeup: { orbitPan: true, pan: 270, tilt: 4, distance: 1 },
    medium: { orbitPan: true, pan: 270, tilt: 0, distance: 3 }
  };
  constants.CAMERA_PRESETS = CAMERA_PRESETS;
})(); 
