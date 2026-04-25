import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadShotVocab() {
  const code = fs.readFileSync(path.resolve('prototype/js/service/shot-vocab.js'), 'utf8');
  const ctx = { window: {} };
  vm.runInNewContext(code, ctx);
  return ctx.window.NK.service.shotVocab;
}

function loadSceneAssets() {
  const ctx = {
    window: { NK: {} },
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    Date,
  };
  ctx.global = ctx;
  const code = fs.readFileSync(path.resolve('prototype/js/service/scene-assets.js'), 'utf8');
  vm.runInNewContext(code, ctx);
  return ctx.window.NK.service.sceneAssets;
}

test('shotVocab: 12 shot types, 10 camera moves', () => {
  const v = loadShotVocab();
  assert.equal(v.SHOT_TYPE_KEYS.length, 12);
  assert.equal(v.CAMERA_MOVE_KEYS.length, 10);
});

test('shotVocab: normalize handles case + hyphen + space', () => {
  const v = loadShotVocab();
  assert.equal(v.normalizeShotType('two-shot'), 'TWO_SHOT');
  assert.equal(v.normalizeShotType(' cu '), 'CU');
  assert.equal(v.normalizeShotType('UNKNOWN'), null);
  assert.equal(v.normalizeCameraMove('Push In'), 'push_in');
  assert.equal(v.normalizeCameraMove('orbit'), null);
});

test('shotVocab: buildShotCameraHint emits both shot + camera in en/ko', () => {
  const v = loadShotVocab();
  const en = v.buildShotCameraHint('MS', 'push_in', 'en');
  assert.match(en, /Camera:/);
  assert.match(en, /medium shot/i);
  assert.match(en, /push-in/i);
  const ko = v.buildShotCameraHint('CU', 'static', 'ko');
  assert.match(ko, /카메라:/);
  assert.match(ko, /클로즈업/);
});

test('shotVocab: buildShotCameraHint returns "" when both invalid', () => {
  const v = loadShotVocab();
  assert.equal(v.buildShotCameraHint('foo', 'bar', 'en'), '');
});

test('sceneAssets.getShotImageUrl + getShotVideoUrl pick first non-empty', () => {
  const a = loadSceneAssets();
  assert.equal(a.getShotImageUrl({ imageDataUrl: 'a', imagePath: 'b' }), 'a');
  assert.equal(a.getShotImageUrl({ imagePath: 'b' }), 'b');
  assert.equal(a.getShotImageUrl({}), '');
  assert.equal(a.getShotVideoUrl({ videoUrl: 'v', videoPath: 'p' }), 'v');
  assert.equal(a.getShotVideoUrl({ videoPath: 'p' }), 'p');
  assert.equal(a.getShotVideoUrl({}), '');
});

test('sceneAssets.getOrderedSceneClipUrls — uses shot videos when present', () => {
  const a = loadSceneAssets();
  const scene = {
    videoUrl: 'scene.mp4',
    shots: [
      { id: '1.1', videoUrl: 'a.mp4' },
      { id: '1.2', videoUrl: 'b.mp4' },
      { id: '1.3' /* no video */ },
    ],
  };
  assert.deepEqual(Array.from(a.getOrderedSceneClipUrls(scene)), ['a.mp4', 'b.mp4']);
});

test('sceneAssets.getOrderedSceneClipUrls — falls back to scene video when no shot video', () => {
  const a = loadSceneAssets();
  const scene = {
    videoUrl: 'scene.mp4',
    shots: [{ id: '1.1' }, { id: '1.2' }],
  };
  assert.deepEqual(Array.from(a.getOrderedSceneClipUrls(scene)), ['scene.mp4']);
});

test('sceneAssets.getOrderedSceneClipUrls — empty when nothing present', () => {
  const a = loadSceneAssets();
  assert.equal(a.getOrderedSceneClipUrls({}).length, 0);
  assert.equal(a.getOrderedSceneClipUrls({ shots: [] }).length, 0);
});
