import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

// Virtual Cinematographer Pro 매핑 (azimuth 12구간 / elevation 6구간 / distance 5구간 / lens 구간)

function loadMapper() {
  const fullPath = path.join(process.cwd(), 'prototype/js/utils/cameraPromptMapper.js');
  const code = fs.readFileSync(fullPath, 'utf8');
  const context = { window: {}, console };
  vm.runInNewContext(code, context);
  return context.window.NK.utils;
}

test('cine mapper exposes cinematic builders', () => {
  const utils = loadMapper();
  assert.equal(typeof utils.buildCineSpatialInstruction, 'function');
  assert.equal(typeof utils.buildCinematicPrompt, 'function');
  assert.equal(typeof utils.normalizeCineCamera, 'function');
});

test('azimuth bands map to VCP descriptors', () => {
  const { azimuth } = loadMapper().cineDescriptors;
  assert.match(azimuth(0), /front center view/);
  assert.match(azimuth(30), /slight 3\/4 front view/);
  assert.match(azimuth(60), /broad 3\/4 side view/);
  assert.match(azimuth(90), /pure side profile view, 90 degree/);
  assert.match(azimuth(150), /over-the-shoulder perspective from back-right/);
  assert.match(azimuth(180), /full back view/);
  assert.match(azimuth(210), /over-the-shoulder perspective from back-left/);
  assert.match(azimuth(270), /opposite pure side profile view/);
  assert.match(azimuth(350), /front center view/);
});

test('elevation bands map to VCP descriptors', () => {
  const { elevation } = loadMapper().cineDescriptors;
  assert.match(elevation(80), /bird's eye view/);
  assert.match(elevation(50), /high-angle cinematic shot/);
  assert.match(elevation(20), /slight high-angle/);
  assert.match(elevation(0), /eye-level shot/);
  assert.match(elevation(-30), /low-angle hero shot/);
  assert.match(elevation(-60), /worm's eye view/);
});

test('distance maps to shot size, focal length maps to lens', () => {
  const { shotSize, lens } = loadMapper().cineDescriptors;
  assert.match(shotSize(0.4), /extreme close-up/);
  assert.match(shotSize(0.6), /tight close-up portrait/);
  assert.match(shotSize(0.8), /medium portrait shot/);
  assert.match(shotSize(1.4), /full body shot/);
  assert.match(shotSize(2.2), /wide cinematic establishment shot/);
  assert.match(lens(16), /ultra-wide 16mm/);
  assert.match(lens(35), /naturalistic 35mm/);
  assert.match(lens(70), /portrait 70mm/);
  assert.match(lens(135), /telephoto 135mm/);
});

test('spatial instruction includes technical readout and clamps input', () => {
  const utils = loadMapper();
  const line = utils.buildCineSpatialInstruction({ azimuth: 45, elevation: 20, distance: 0.8, focalLength: 85 });
  assert.match(line, /Camera Setup: \[Position: /);
  assert.match(line, /azimuth: 45\.0°, elevation: 20\.0°/);
  const clamped = utils.normalizeCineCamera({ azimuth: 400, elevation: 200, distance: 99, focalLength: 999 });
  assert.equal(clamped.azimuth, 40);
  assert.equal(clamped.elevation, 85);
  assert.equal(clamped.distance, 3.5);
  assert.equal(clamped.focalLength, 200);
});

test('final prompt appends selected style text but stays spatial-first', () => {
  const utils = loadMapper();
  const prompt = utils.buildCinematicPrompt({ azimuth: 0, elevation: 0, distance: 0.8, focalLength: 35 }, 'Warm film grain, retro aesthetic.');
  assert.match(prompt, /^Professional cinematography\. Camera Setup:/);
  assert.match(prompt, /Warm film grain, retro aesthetic\./);
});

test('legacy mapper functions remain intact', () => {
  const fullPath = path.join(process.cwd(), 'prototype/js/utils/cameraPromptMapper.js');
  const code = fs.readFileSync(fullPath, 'utf8');
  const context = { window: {}, console };
  vm.runInNewContext(code, context);
  assert.equal(typeof context.window.mapCameraToPrompt, 'function');
  assert.equal(typeof context.window.buildCameraPrompt, 'function');
});

test('camera studio module wires 3D overlay into ai-image stage', () => {
  const studio = fs.readFileSync(path.join(process.cwd(), 'prototype/js/ui/camera-studio.js'), 'utf8');
  assert.match(studio, /NK\.cameraStudio = \{/);
  assert.match(studio, /lib\/three\/three\.module\.min\.js/);
  assert.match(studio, /focalLengthToFov/);
  assert.match(studio, /viewMode === 'pov'|viewMode === 'world'/);
  const aiImage = fs.readFileSync(path.join(process.cwd(), 'prototype/js/ui/ai-image.js'), 'utf8');
  assert.match(aiImage, /openCameraStudio\(\)/);
  assert.match(aiImage, /cameraShot/);
  const stage = fs.readFileSync(path.join(process.cwd(), 'prototype/ai-image-stage.html'), 'utf8');
  assert.match(stage, /js\/ui\/camera-studio\.js/);
  assert.match(stage, /styles\.camera-studio\.css/);
});

test('viewport exposes a grid visibility toggle wired to the three.js scene', () => {
  const studio = fs.readFileSync(path.join(process.cwd(), 'prototype/js/ui/camera-studio.js'), 'utf8');
  assert.match(studio, /data-camstudio="toggle-grid"/);
  assert.match(studio, /showGrid: true/);
  assert.match(studio, /ctx\.setGridVisible = function/);
  assert.match(studio, /cellGrid\.visible/);
  assert.match(studio, /sectionGrid\.visible/);
  // 눈 아이콘은 켜짐/꺼짐 상태에 따라 바뀐다
  assert.match(studio, /icon\(studio\.showGrid \? 'eye' : 'eyeOff'\)/);
  assert.match(studio, /gridOn: '그리드 끄기'/);
  assert.match(studio, /gridOn: 'Hide grid'/);
  const css = fs.readFileSync(path.join(process.cwd(), 'prototype/styles.camera-studio.css'), 'utf8');
  // 우측 하단 모서리 고정
  assert.match(css, /\.nk-camstudio-grid-toggle \{[^}]*bottom: 16px;[^}]*right: 16px;/s);
});

test('angle and shot-size presets render in three columns', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'prototype/styles.camera-studio.css'), 'utf8');
  assert.match(css, /\.nk-camstudio-preset-grid \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/s);
  assert.doesNotMatch(css, /\.nk-camstudio-preset-grid \{[^}]*grid-template-columns: 1fr 1fr;/s);
});

test('camera studio UI ships both ko and en dictionaries', () => {
  const studio = fs.readFileSync(path.join(process.cwd(), 'prototype/js/ui/camera-studio.js'), 'utf8');
  assert.match(studio, /ko: \{/);
  assert.match(studio, /en: \{/);
  assert.match(studio, /nk:lang-changed/);
});
