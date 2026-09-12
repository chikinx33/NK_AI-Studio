// 연속성 2단계: 장소 플레이트가 "파이프라인 필수 단계"가 됐는지 고정한다.
//  - 컷 이미지 생성(씬·샷 두 경로) 전에 세트 준비 게이트가 돈다.
//  - 일괄 생성은 모든 장소의 플레이트를 먼저 준비한다.
//  - 프롬프트·방위 사양은 set-plates 서비스가 단일 원천이고 모달은 그것을 쓴다.
//  - 순수 로직: 장소 찾기, 필요한 방위 계산, 빠진 플레이트 계산, 한/영 사전 짝.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

function loadService(extra) {
  const src = read('prototype/js/service/set-plates.js');
  const sandbox = { window: {}, console };
  sandbox.window.NK = Object.assign({ state: { runtime: { lang: 'ko' } } }, extra || {});
  vm.runInNewContext(src, sandbox);
  return { mod: sandbox.window.NK.service.setPlates, NK: sandbox.window.NK };
}

test('★findLocationForScene: sceneIds → 이름 완전 일치 → 텍스트 포함 순서, 플레이트 없는 장소도 찾는다', () => {
  const { mod } = loadService();
  const locs = [
    { id: 'pool', name: '수영장', sceneIds: ['3'] },
    { id: 'street', name: '길거리', sceneIds: [] },
  ];
  assert.equal(mod.findLocationForScene(locs, { id: '3', sceneLocation: '길거리' }).id, 'pool', 'sceneIds 가 최우선');
  assert.equal(mod.findLocationForScene(locs, { id: '9', sceneLocation: '길거리' }).id, 'street');
  assert.equal(mod.findLocationForScene(locs, { id: '9', composition: '수영장 가장자리에서' }).id, 'pool', '텍스트 포함');
  assert.equal(mod.findLocationForScene(locs, { id: '9', composition: '우주' }), null);
});

test('★neededDirections: 컷들이 실제로 쓰는 비정면 방위만 모은다(안 쓰는 방위는 만들지 않는다)', () => {
  const { mod } = loadService();
  const locs = [{ id: 'room', name: '거실', sceneIds: ['1', '2'] }, { id: 'roof', name: '옥상', sceneIds: ['3'] }];
  const scenes = [
    { id: '1', cameraDirection: 'front', shots: [{ cameraDirection: 'back' }] },
    { id: '2', cameraDirection: 'left' },
    { id: '3', cameraDirection: 'right' },
  ];
  assert.deepEqual([...mod.neededDirections(locs, locs[0], scenes)].sort(), ['back', 'left']);
  assert.deepEqual([...mod.neededDirections(locs, locs[1], scenes)], ['right']);
  assert.deepEqual([...mod.directionsOfScene({ cameraDirection: 'front' })], []);
});

test('★missingPlates: 마스터 → 방위 순서로 빠진 것만 돌려준다', () => {
  const { mod } = loadService();
  assert.deepEqual([...mod.missingPlates({ name: 'x' }, ['back'])], ['master', 'back']);
  const loc = { name: 'x', refObjectName: 'o', variants: [{ id: 'dir-back', refObjectName: 'b' }] };
  assert.deepEqual([...mod.missingPlates(loc, ['back', 'left'])], ['left']);
  assert.deepEqual([...mod.missingPlates(loc, [])], []);
  mod.setDirectionPlate(loc, 'left', 'l-obj', '좌측');
  assert.deepEqual([...mod.missingPlates(loc, ['back', 'left'])], []);
  assert.equal(loc.variants.find((v) => v.id === 'dir-left').refObjectName, 'l-obj');
});

test('★프롬프트 단일 원천: 모달(ui/pipeline.js)이 서비스의 사양·프롬프트를 쓰고 중복 정의가 없다', () => {
  const pipeline = read('prototype/ui/pipeline.js');
  assert.match(pipeline, /var DIRECTION_PLATE_SPECS = NK\.service\.setPlates\.DIRECTION_PLATE_SPECS;/);
  assert.match(pipeline, /NK\.service\.setPlates\.buildMasterPlatePrompt\(commonPromptOf\(st\), l\)/);
  assert.match(pipeline, /NK\.service\.setPlates\.buildDirectionPlatePrompt\(commonPromptOf\(st\), l, spec\)/);
  assert.doesNotMatch(pipeline, /REVERSE ANGLE of the exact same place/, '방위 지시문이 모달에 중복 정의돼 있습니다');
  assert.doesNotMatch(pipeline, /Empty location background plate of this place/, '마스터 지시문이 모달에 중복 정의돼 있습니다');
  const { mod } = loadService();
  const master = mod.buildMasterPlatePrompt('스타일: 수채화', { name: '거실', description: '햇빛 드는 거실' });
  assert.ok(master.startsWith('스타일: 수채화\n햇빛 드는 거실\nEmpty location background plate'));
  const back = mod.buildDirectionPlatePrompt('스타일: 수채화', { name: '거실', description: '햇빛 드는 거실' }, mod.specFor('back'));
  assert.match(back, /SUBJECT: the back-facing view of 거실\./);
  assert.match(back, /REVERSE ANGLE of the exact same place/);
  assert.match(back, /CONTEXT \(materials, palette and lighting only\): 햇빛 드는 거실/);
});

test('★컷 이미지 생성 두 경로 모두 세트 준비 게이트를 먼저 통과한다', () => {
  const src = read('prototype/ui/pipeline-image.js');
  assert.match(src, /async function ensureSetForCut\(ctx, opts, sceneIdx, shotIdx, rowHint\)/);
  // 씬 경로
  const sceneStart = src.indexOf('image.generateImageForIdx = async function');
  const sceneGate = src.indexOf('await ensureSetForCut(ctx, opts, opts.idx, -1', sceneStart);
  const scenePromptBuild = src.indexOf('buildImagePrompt(scene, sceneCommon', sceneStart);
  assert.ok(sceneGate > sceneStart && sceneGate < scenePromptBuild, '씬 경로: 게이트가 프롬프트 조립보다 앞에 있어야 합니다');
  assert.match(src.slice(sceneGate, scenePromptBuild), /if \(!setReady\.ok\) return;/);
  // 샷 경로
  const shotStart = src.indexOf('image.generateImageForShot = async function');
  const shotGate = src.indexOf('await ensureSetForCut(ctx, opts, opts.sceneIdx, shotIdx', shotStart);
  const shotPromptBuild = src.indexOf('buildShotImagePrompt(scene, shot, shotCommon', shotStart);
  assert.ok(shotGate > shotStart && shotGate < shotPromptBuild, '샷 경로: 게이트가 프롬프트 조립보다 앞에 있어야 합니다');
  assert.match(src.slice(shotGate, shotPromptBuild), /if \(!setReadyShot\.ok\) return;/);
  // 실패 시 컷 행에 이유를 남긴다
  assert.match(src, /sp\.text\('plateFailed'\)/);
});

test('★일괄 생성은 모든 장소의 플레이트를 먼저 준비한다', () => {
  const src = read('prototype/ui/pipeline.js');
  const start = src.indexOf("var bulkGen = document.getElementById('bulk-generate')");
  const loop = src.indexOf('await ui.generateImageForIdx(i);', start);
  const ensure = src.indexOf('NK.service.setPlates.ensureAll(ctx', start);
  assert.ok(ensure > start && ensure < loop, 'ensureAll 이 컷 루프보다 앞에 있어야 합니다');
});

test('★씬 행이 세트 준비 단계를 보여 주고, scenes.html 이 서비스를 싣는다', () => {
  const row = read('prototype/ui/pipeline-scene-row.js');
  assert.match(row, /NK\.service\.setPlates\.text\(scene\.imgStage\)/);
  assert.match(row, /NK\.service\.setPlates\.text\(shot\.imgStage\)/);
  const html = read('prototype/scenes.html');
  const svc = html.indexOf('js/service/set-plates.js');
  const img = html.indexOf('ui/pipeline-image.js');
  assert.ok(svc > 0 && svc < img, 'set-plates.js 가 pipeline-image.js 보다 먼저 로드돼야 합니다');
});

test('★한/영 사전이 같은 키를 가진다', () => {
  const { mod } = loadService();
  assert.deepEqual(Object.keys(mod.TEXT.ko).sort(), Object.keys(mod.TEXT.en).sort());
  assert.equal(mod.text('preparingSet', 'en'), 'Preparing the set');
  assert.equal(mod.text('preparingSet', 'ko'), '세트 준비 중');
});

test('★ensureForScene: 마스터 실패면 ok=false, 장소가 없으면 ok=true·loc=null, 방위 실패는 진행', async () => {
  const calls = [];
  const state = {
    draftId: 'p1',
    header: '스타일: 수채화',
    aspectRatio: '16:9',
    payload: { episodeLocations: [{ id: 'room', name: '거실', description: '거실', sceneIds: ['1'] }] },
    scenes: [{ id: '1', cameraDirection: 'back' }, { id: '2', sceneLocation: '우주' }],
  };
  const ctx = { getState: () => state, setState: (s) => Object.assign(state, s) };
  let failMaster = true;
  let failDir = false;
  const { mod } = loadService({
    api: {
      imagen: async (req) => {
        calls.push(req.prompt.split('\n')[1]);
        if (/Empty location background plate/.test(req.prompt) && failMaster) throw new Error('boom');
        if (/SUBJECT: the back-facing/.test(req.prompt) && failDir) throw new Error('dir boom');
        return { objectName: 'obj-' + calls.length };
      },
      mediaProxyObjectUrl: (o) => '/proxy/' + o,
      projectSave: async () => ({}),
    },
  });
  const r1 = await mod.ensureForScene(ctx, 0, {});
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'master_failed');
  assert.ok(!state.payload.episodeLocations[0].refObjectName, '실패한 마스터는 저장되지 않는다');

  failMaster = false; failDir = true;
  const r2 = await mod.ensureForScene(ctx, 0, {});
  assert.equal(r2.ok, true, '마스터가 있으면 방위 실패는 진행한다(폴백 문구가 있다)');
  assert.deepEqual([...r2.failed], ['back']);
  assert.equal(state.payload.episodeLocations[0].refObjectName, 'obj-2', '마스터는 즉시 저장된다');

  failDir = false;
  const r3 = await mod.ensureForScene(ctx, 0, {});
  assert.equal(r3.ok, true);
  const v = state.payload.episodeLocations[0].variants.find((x) => x.id === 'dir-back');
  assert.ok(v && v.refObjectName, '방위 플레이트가 variants 에 저장된다');

  const r4 = await mod.ensureForScene(ctx, 1, {});
  assert.equal(r4.ok, true);
  assert.equal(r4.loc, null, '배정된 장소가 없는 컷은 막지 않는다');
  const r5 = await mod.ensureForScene(ctx, 0, {});
  assert.equal(r5.ok, true);
  assert.equal(calls.length, 4, '이미 준비된 세트는 다시 만들지 않는다');
});

test('★ensureLocations: 장소 목록이 비어 있으면 씬에서 추출해 저장한다', async () => {
  const state = { draftId: 'p1', payload: {}, scenes: [{ id: '1', sceneLocation: '거실' }, { id: '2', sceneLocation: '거실' }] };
  const ctx = { getState: () => state, setState: (s) => Object.assign(state, s) };
  const { mod } = loadService({
    api: {
      imagen: async () => ({ objectName: 'x' }),
      scenarioLocations: async () => ({ locations: [{ id: 'room', name: '거실', description: '거실', sceneIds: ['1', '2'] }] }),
      projectSave: async () => ({}),
    },
  });
  const locs = await mod.ensureLocations(ctx, {});
  assert.equal(locs.length, 1);
  assert.equal(state.payload.episodeLocations[0].name, '거실');
});
