;(function () {
  var NK = window.NK || (window.NK = {});
  var constants = NK.constants || (NK.constants = {});
  var CAMERA_PRESETS = {
    front: { orbitPan: true, pan: 0, tilt: 0, distance: 1 },
    rear: { orbitPan: true, pan: 180, tilt: 0, distance: 1 },
    left45: { orbitPan: true, pan: 315, tilt: 0, distance: 1 },
    right45: { orbitPan: true, pan: 45, tilt: 0, distance: 1 },
    upperleft45: { orbitPan: true, pan: 315, tilt: 24, distance: 1 },
    upperright45: { orbitPan: true, pan: 45, tilt: 24, distance: 1 },
    lowerleft45: { orbitPan: true, pan: 315, tilt: -24, distance: 1 },
    lowerright45: { orbitPan: true, pan: 45, tilt: -24, distance: 1 },
    highangle: { orbitPan: true, pan: 0, tilt: 24, distance: 1 },
    lowangle: { orbitPan: true, pan: 0, tilt: -24, distance: 1 },
    closeup: { orbitPan: true, pan: 0, tilt: 0, distance: 0 },
    wide: { orbitPan: true, pan: 0, tilt: 0, distance: 2 }
  };
  constants.CAMERA_PRESETS = CAMERA_PRESETS;
})(); 
