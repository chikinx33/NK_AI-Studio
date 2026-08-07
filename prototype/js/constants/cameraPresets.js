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

  // === Virtual Cinematographer Pro (3D 카메라 스튜디오) ===
  // 원본: F:\Download\virtual cinematographer pro (constants.ts)
  constants.CINE_INITIAL_CAMERA = {
    azimuth: 0,       // 0~360°
    elevation: 0,     // -85~85°
    distance: 0.8,    // 0.1~3.5 (radius = distance * 5)
    focalLength: 35,  // 12~200mm
    style: 'None'
  };

  constants.CINE_ANGLE_PRESETS = {
    'Eye Level': { azimuth: 0, elevation: 0 },
    'Low Angle': { elevation: -20 },
    'High Angle': { elevation: 40 },
    "Bird's Eye": { elevation: 85, azimuth: 0 },
    '45° Side': { azimuth: 45 },
    'Profile': { azimuth: 90 },
    'Over the Shoulder': { azimuth: 160, elevation: 15 },
    "Worm's Eye": { elevation: -40 }
  };

  constants.CINE_SHOT_SIZE_PRESETS = {
    'Extreme CU': 0.4,
    'Close Up': 0.6,
    'Bust': 0.8,
    'Medium': 1.0,
    'American': 1.4,
    'Full Shot': 1.8,
    'Wide': 2.2
  };

  // 스타일 프리셋: 사용자가 명시적으로 선택했을 때만 프롬프트에 반영.
  // 'None'은 참조 이미지의 스타일을 그대로 유지(스타일 하드코딩 금지 원칙).
  constants.CINE_STYLE_PRESETS = {
    'None': 'Maintain the exact art style, features and identity of the reference image, high fidelity.',
    'Cinematic': 'High-end digital cinema, anamorphic lens flares, rich shadows, 8k, masterwork.',
    'Film Noir': 'Black and white, high contrast, dramatic chiaroscuro lighting, moody atmosphere, 1940s detective aesthetic.',
    'Anime': 'High-quality modern anime style, vibrant colors, clean lines, Makoto Shinkai inspired lighting.',
    'Cyberpunk': 'Neon lights, rainy streets, futuristic tech, purple and teal color grade, high detail.',
    'Vintage 70s': 'Warm film grain, faded colors, 35mm film stock, retro aesthetic, soft focus.',
    'Oil Painting': 'Thick brushstrokes, impasto technique, classical lighting, artistic texture.'
  };

  constants.CINE_SENSOR_HEIGHT = 24; // 35mm full frame sensor height in mm
})();
