import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

function loadCameraMapper() {
  const fullPath = path.join(process.cwd(), 'prototype/js/utils/cameraPromptMapper.js');
  const code = fs.readFileSync(fullPath, 'utf8');
  const context = { window: {}, console };
  vm.runInNewContext(code, context);
  return context.window;
}

test('camera mapper exposes mapping functions', () => {
  const w = loadCameraMapper();
  assert.equal(typeof w.mapCameraToPrompt, 'function');
  assert.equal(typeof w.buildCameraPrompt, 'function');
});

test('neutral camera state yields empty prompt', () => {
  const w = loadCameraMapper();
  const prompt = w.mapCameraToPrompt({ enabled: true, orbitPan: true, preset: 'custom', pan: 0, tilt: 0, distance: 1 });
  assert.equal(prompt, '');
});

test('rear extreme pan maps to rear view', () => {
  const w = loadCameraMapper();
  const p1 = w.mapCameraToPrompt({ enabled: true, orbitPan: true, preset: 'custom', pan: 180, tilt: 0, distance: 1 });
  assert.match(p1, /\(camera: cinematic medium shot, rear view, eye-level:1\.3\)/);
  const p2 = w.mapCameraToPrompt({ enabled: true, orbitPan: true, preset: 'custom', pan: -180, tilt: 0, distance: 1 });
  assert.match(p2, /rear view/);
});

test('front pan maps to front view and angle labeling follows tilt', () => {
  const w = loadCameraMapper();
  const pFront = w.mapCameraToPrompt({ enabled: true, orbitPan: true, preset: 'custom', pan: 0, tilt: 24, distance: 1 });
  assert.match(pFront, /front view/);
  assert.match(pFront, /high angle/);
});

test('preset mapping symmetry for high/low angle includes front view', () => {
  const w = loadCameraMapper();
  assert.equal(typeof w.NK, 'object');
  assert.equal(typeof w.NK.utils, 'object');
  assert.equal(typeof w.NK.utils.mapPresetToPrompt, 'function');
  const hi = w.NK.utils.mapPresetToPrompt('highangle');
  const lo = w.NK.utils.mapPresetToPrompt('lowangle');
  assert.match(hi, /front view, high angle/);
  assert.match(lo, /front view, low angle/);
});
