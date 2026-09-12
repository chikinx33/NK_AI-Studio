// 연속성 5단계: 이미지 연속성을 "세트 위에서 카메라만 옮기기"로.
//  (B) 같은 순간·같은 배치(블로킹 동일, 이동 없음) → 직전 스틸을 1번 소스로 image-to-image(scene) 카메라 재구성
//  (A) 배치가 다르고 플레이트가 붙어 있음 → 직전 스틸을 붙이지 않는다(구도를 끌고 가므로)
//  (C) 플레이트가 없음 → 예전대로 룩 참조로만 붙인다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

function createContext() {
  const imagenCalls = [];
  const context = {
    console, setTimeout, clearTimeout, AbortController,
    alert() {},
    window: null,
    NK: {
      api: {
        async imagen(payload) {
          imagenCalls.push(JSON.parse(JSON.stringify(payload || {})));
          return { dataUrl: 'data:image/png;base64,AA==', objectName: 'out-' + imagenCalls.length };
        },
        mediaProxyObjectUrl(obj) { return obj ? '/api/media/proxy?objectName=' + obj : ''; },
        async projectGet() { return { data: null }; },
        async brandGet() { return { data: null }; },
        async libraryIP() { return { items: [] }; },
      },
      service: {
        brand: { getById() { return null; }, async hydrateFromServer() { return null; } },
        project: {
          getBrandId(input) { const p = input && input.payload ? input.payload : input; return String((p && p.brandId) || ''); },
          getDraftById() { return null; },
          getKnowledgeHub() { return null; },
        },
      },
    },
  };
  context.window = context;
  context.__imagenCalls = imagenCalls;
  return vm.createContext(context);
}
function loadScript(ctx, rel) {
  const full = path.join(process.cwd(), rel);
  vm.runInContext(fs.readFileSync(full, 'utf8'), ctx, { filename: full });
}
function opts(idx, ctxObj) {
  return {
    idx, ctx: ctxObj,
    cleanHeader(t) { return String(t || '').trim(); },
    toBool(v, f) { return typeof v === 'boolean' ? v : !!f; },
    resolveEffectiveAspectRatio() { return '16:9'; },
    ensureStateAspectRatio(c) { return c; },
    updateSceneRow() {},
    retryImage() { throw new Error('no retry'); },
    async enforceImageAspectRatio() { return null; },
  };
}

test('★순수 판정: isSameMomentCoverage — 같은 인물 집합·같은 자리·이동 없음일 때만 true', () => {
  const ctx = createContext();
  loadScript(ctx, 'prototype/ui/pipeline-image.js');
  const h = ctx.NK.uiPipelineImage._helpers;
  const prev = { blocking: [{ token: '@네모', x: 'left', depth: 'mid', facing: 'camera' }, { token: '@세모', x: 'right', depth: 'mid', facing: 'left' }] };
  const same = { action: '@네모가 웃는다', blocking: [{ token: '@세모', x: 'right', depth: 'mid', facing: 'camera' }, { token: '@네모', x: 'left', depth: 'mid', facing: 'right' }] };
  assert.equal(h.isSameMomentCoverage(prev, same), true, 'facing 이 달라도 자리(x/depth)가 같으면 같은 순간');
  assert.equal(h.isSameMomentCoverage(prev, { action: 'x', blocking: [{ token: '@네모', x: 'left', depth: 'mid' }] }), false, '인물 집합이 다르면 false');
  assert.equal(h.isSameMomentCoverage(prev, { action: 'x', blocking: [{ token: '@네모', x: 'center', depth: 'mid' }, { token: '@세모', x: 'right', depth: 'mid' }] }), false, '자리가 다르면 false');
  assert.equal(h.isSameMomentCoverage(prev, { action: '@네모가 창가로 걸어간다', blocking: same.blocking }), false, '이동 서술이 있으면 false');
  assert.equal(h.isSameMomentCoverage(prev, { action: 'x', beats: [{ at: 0, what: '@네모 발' }, { at: 2, what: '@네모가 일어난다' }], blocking: same.blocking }), false, '비트의 이동도 본다');
  assert.equal(h.isSameMomentCoverage({}, same), false, '블로킹이 없으면 판단하지 않는다');
});

test('★순수 판정: 직전 컷 찾기 — data: 스틸은 imagePath 로 영속 URL, 장소가 바뀌면 끊는다', () => {
  const ctx = createContext();
  loadScript(ctx, 'prototype/ui/pipeline-image.js');
  const h = ctx.NK.uiPipelineImage._helpers;
  const scenes = [
    { id: 1, sceneLocation: '거실', imageDataUrl: 'data:image/png;base64,AA', imagePath: 'p/1.png' },
    { id: 2, sceneLocation: '거실', imageDataUrl: '' },
    { id: 3, sceneLocation: '거실' },
    { id: 4, sceneLocation: '옥상' },
    { id: 5, sceneLocation: '거실' },
  ];
  const r = h.findPrevCutInSameSet(scenes, 2);
  assert.equal(r.row.id, 1);
  assert.equal(r.imageUrl, '/api/media/proxy?objectName=p/1.png');
  assert.equal(h.findPrevCutInSameSet(scenes, 4), null, '사이에 다른 세트가 있으면 잇지 않는다');
  const shotScenes = [
    { id: 1, sceneLocation: '거실', shots: [{ id: '1.1', imageDataUrl: 'https://x/1.png' }, { id: '1.2' }] },
    { id: 2, sceneLocation: '거실', shots: [{ id: '2.1' }, { id: '2.2' }] },
  ];
  assert.equal(h.findPrevShotInSameSet(shotScenes, 1, 1).row.id, '1.1', '같은 씬 앞 샷에 이미지가 없으면 앞 씬의 마지막 이미지 샷');
  assert.equal(h.findPrevShotInSameSet(shotScenes, 0, 0), null);
});

test('★(B) 같은 순간이면 image-to-image(scene) 카메라 재구성: 직전 스틸이 1번 소스, 플레이트는 뒤로', async () => {
  const ctx = createContext();
  loadScript(ctx, 'prototype/ui/pipeline-image.js');
  let state = {
    draftId: 'p1', header: '스타일: 수채화',
    payload: { episodeLocations: [{ id: 'room', name: '거실', description: '거실', refObjectName: 'plates/room.png', sceneIds: ['1', '2'] }] },
    scenes: [
      { id: '1', sceneLocation: '거실', composition: '@네모 상반신', shotType: 'MS', cameraDirection: 'front', estSec: 4,
        imageDataUrl: 'https://cdn/cut1.png', blocking: [{ token: '@네모', x: 'left', depth: 'mid', facing: 'camera' }] },
      { id: '2', sceneLocation: '거실', composition: '@네모 얼굴', shotType: 'CU', cameraDirection: 'back', estSec: 4, action: '@네모가 눈을 깜빡인다',
        blocking: [{ token: '@네모', x: 'left', depth: 'mid', facing: 'right' }] },
    ],
  };
  const ctxObj = { getState() { return state; }, setState(n) { state = n; } };
  await ctx.NK.uiPipelineImage.generateImageForIdx(opts(1, ctxObj));
  assert.equal(ctx.__imagenCalls.length, 1);
  const call = ctx.__imagenCalls[0];
  assert.equal(call.generationMode, 'image-to-image');
  assert.equal(call.cameraTargetMode, 'scene');
  assert.equal(call.referenceImages[0].referenceKind, 'continuity');
  assert.equal(call.referenceImages[0].imageDataUrl, 'https://cdn/cut1.png');
  assert.equal(call.referenceImages[0].referenceId, 1);
  const plate = call.referenceImages.find((r) => r.referenceKind === 'environment');
  assert.ok(plate, '플레이트도 뒤에 남는다');
  assert.ok(plate.referenceId > 1);
  assert.match(call.prompt, /SAME MOMENT, NEW CAMERA: Reference image 1 shows this exact moment/);
  assert.equal(state.scenes[1].lineage.imageContinuity, 'camera-reconstruct');
});

test('★(A) 배치가 다르고 플레이트가 있으면 직전 스틸을 붙이지 않는다 (text-to-image)', async () => {
  const ctx = createContext();
  loadScript(ctx, 'prototype/ui/pipeline-image.js');
  let state = {
    draftId: 'p1', header: '스타일: 수채화',
    payload: { episodeLocations: [{ id: 'room', name: '거실', description: '거실', refObjectName: 'plates/room.png', sceneIds: ['1', '2'] }] },
    scenes: [
      { id: '1', sceneLocation: '거실', composition: '@네모 상반신', estSec: 4, imageDataUrl: 'https://cdn/cut1.png',
        blocking: [{ token: '@네모', x: 'left', depth: 'mid', facing: 'camera' }] },
      { id: '2', sceneLocation: '거실', composition: '@네모가 창가로 걸어간다', action: '@네모가 창가로 걸어간다', estSec: 4,
        blocking: [{ token: '@네모', x: 'right', depth: 'far', facing: 'away' }] },
    ],
  };
  const ctxObj = { getState() { return state; }, setState(n) { state = n; } };
  await ctx.NK.uiPipelineImage.generateImageForIdx(opts(1, ctxObj));
  const call = ctx.__imagenCalls[0];
  assert.equal(call.generationMode, 'text-to-image');
  assert.equal(call.cameraTargetMode, undefined);
  assert.ok(!call.referenceImages.some((r) => r.referenceKind === 'continuity'), '직전 스틸이 붙으면 구도를 끌고 간다');
  assert.ok(call.referenceImages.some((r) => r.referenceKind === 'environment'), '플레이트는 붙는다');
  assert.equal(state.scenes[1].lineage.imageContinuity, 'plate');
});

test('★(C) 플레이트가 없으면 예전대로 룩 참조로 직전 스틸을 붙인다', async () => {
  const ctx = createContext();
  loadScript(ctx, 'prototype/ui/pipeline-image.js');
  let state = {
    draftId: 'p1', header: '스타일: 수채화', payload: {},
    scenes: [
      { id: '1', sceneLocation: '거실', composition: '@네모 상반신', estSec: 4, imageDataUrl: 'https://cdn/cut1.png' },
      { id: '2', sceneLocation: '거실', composition: '@네모 얼굴', estSec: 4 },
    ],
  };
  const ctxObj = { getState() { return state; }, setState(n) { state = n; } };
  await ctx.NK.uiPipelineImage.generateImageForIdx(opts(1, ctxObj));
  const call = ctx.__imagenCalls[0];
  assert.equal(call.generationMode, 'text-to-image');
  const cont = call.referenceImages.find((r) => r.referenceKind === 'continuity');
  assert.ok(cont);
  assert.match(cont.subjectDescription, /do NOT copy its framing/);
  assert.equal(state.scenes[1].lineage.imageContinuity, 'look-only');
});

test('★컷(샷) 경로도 같은 결정을 하고, 계보 imageContinuity 가 저장·복원 화이트리스트에 있다', () => {
  const src = read('prototype/ui/pipeline-image.js');
  const shotStart = src.indexOf('image.generateImageForShot = async function');
  const block = src.slice(shotStart);
  assert.match(block, /findPrevShotInSameSet\(st\.scenes \|\| \[\], opts\.sceneIdx, shotIdx\)/);
  assert.match(block, /isSameMomentCoverage\(prevShotCut\.row, shot\)/);
  assert.match(block, /generationMode: imageGenMode,\s*\n\s*cameraTargetMode: imageCameraTarget \|\| undefined/);
  const save = read('prototype/functions/api/project/save.ts');
  const get = read('prototype/functions/api/project/get.ts');
  assert.match(save, /imageContinuity: str\(value\.imageContinuity\)/);
  assert.match(get, /imageContinuity: str\(value\.imageContinuity\)/);
});
