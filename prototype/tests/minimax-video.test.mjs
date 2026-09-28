// MiniMax H3 계열 영상 모델(2026-09-28 Atlas 스키마 확인) — AI 영상·AI 시네마·캔버스·에이전트 대화 공통.
// 핵심 계약:
//  1) 모델 하나(minimax-h3 등)로 받고 입력을 보고 엔드포인트를 고른다 — 참조 → 참조→영상, 시작(·끝) 이미지 → 이미지→영상, 없음 → 텍스트→영상.
//  2) 해상도·길이·화면비는 등급·모드별 공급자 집합 안에서만 보낸다(조용히 바꾸지 않고 400 으로 이유를 준다).
//  3) 참조→영상은 refers: [{ url, type }] 한 배열(이미지·영상·오디오, 상한 12)이고 오디오만으로는 못 만든다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  MINIMAX_MODELS, MINIMAX_REFS_MODELS, resolveMinimaxRoute, minimaxRatioFor, snapDurationFor, durationChoicesFor, isMinimaxModel,
} from '../functions/api/_shared/video-specs.ts';
import { quoteCredits } from '../functions/api/_shared/credit-rates.js';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const IDS = ['minimax-h3', 'minimax-h3-max', 'minimax-h3-max-turbo', 'minimax-h3-fast', 'minimax-h3-dev'];
const none = { hasStart: false, hasEnd: false, refImages: 0, refVideos: 0, hasAudio: false };

test('입력으로 엔드포인트를 고른다: 없음=텍스트, 시작(·끝)=이미지, 참조=참조→영상', () => {
  const t2v = resolveMinimaxRoute('minimax-h3', none);
  assert.equal(t2v.ok && t2v.model, 'minimax/h3/text-to-video');
  const i2v = resolveMinimaxRoute('minimax-h3', { ...none, hasStart: true, hasEnd: true });
  assert.equal(i2v.ok && i2v.model, 'minimax/h3/image-to-video');
  const r2v = resolveMinimaxRoute('minimax-h3', { ...none, hasStart: true, refImages: 2, refVideos: 1, hasAudio: true });
  assert.equal(r2v.ok && r2v.model, 'minimax/h3/reference-to-video');
  const dev = resolveMinimaxRoute('minimax-h3-dev', { ...none, refVideos: 1 });
  assert.equal(dev.ok && dev.model, 'minimax/h3-developer/reference-to-video');
  const turbo = resolveMinimaxRoute('minimax-h3-max-turbo', { ...none, hasStart: true });
  assert.equal(turbo.ok && turbo.model, 'minimax/h3-max-turbo/image-to-video');
});

test('공급자가 못 받는 조합은 이유와 함께 거부한다', () => {
  const noR2v = resolveMinimaxRoute('minimax-h3-max', { ...none, refImages: 1 });
  assert.equal(noR2v.ok, false); assert.equal(!noR2v.ok && noR2v.error, 'minimax_refs_unsupported');
  const endRefs = resolveMinimaxRoute('minimax-h3', { ...none, hasStart: true, hasEnd: true, refImages: 1 });
  assert.equal(!endRefs.ok && endRefs.error, 'minimax_end_with_refs');
  const audioOnly = resolveMinimaxRoute('minimax-h3', { ...none, hasAudio: true });
  assert.equal(!audioOnly.ok && audioOnly.error, 'minimax_audio_only');
  const endOnly = resolveMinimaxRoute('minimax-h3', { ...none, hasEnd: true });
  assert.equal(!endOnly.ok && endOnly.error, 'minimax_end_needs_start');
  // 오디오 + 시작 스틸이면 스틸이 이미지 참조가 되므로 허용
  assert.equal(resolveMinimaxRoute('minimax-h3', { ...none, hasStart: true, hasAudio: true }).ok, true);
});

test('해상도는 등급·모드별 집합(텍스트는 ESR 없음), 비우면 등급 기본값, 대소문자는 관대하게', () => {
  assert.deepEqual(MINIMAX_MODELS['minimax-h3'].resolutions.t2v, ['480P', '768P', '2K']);
  const esrI2v = resolveMinimaxRoute('minimax-h3', { ...none, hasStart: true, resolution: '4k-esr' });
  assert.equal(esrI2v.ok && esrI2v.resolution, '4k-esr');
  const esrT2v = resolveMinimaxRoute('minimax-h3', { ...none, resolution: '4k-esr' });
  assert.equal(!esrT2v.ok && esrT2v.error, 'invalid_minimax_resolution');
  assert.deepEqual(!esrT2v.ok && esrT2v.allowedResolutions, ['480P', '768P', '2K']);
  assert.equal(resolveMinimaxRoute('minimax-h3', { ...none, resolution: '2k' }).resolution, '2K');
  assert.equal(resolveMinimaxRoute('minimax-h3-fast', none).resolution, '480P');
  assert.equal(resolveMinimaxRoute('minimax-h3-max', { ...none, resolution: '4k-sr' }).resolution, '4k-sr');
  // 다른 모델 값(720p)은 조용히 바꾸지 않는다 — 캔버스는 모델을 바꿀 때 snapResolution 으로 맞춘다.
  assert.equal(resolveMinimaxRoute('minimax-h3', { ...none, resolution: '720p' }).ok, false);
});

test('길이: H3·Developer 4~15, Max·Max Turbo·Fast 5~15 로 스냅', () => {
  assert.equal(snapDurationFor('minimax-h3', 4), 4);
  assert.equal(snapDurationFor('minimax-h3-dev', 30), 15);
  for (const id of ['minimax-h3-max', 'minimax-h3-max-turbo', 'minimax-h3-fast']) {
    assert.equal(snapDurationFor(id, 4), 5, id);
    assert.equal(durationChoicesFor(id)[0], 5, id);
  }
  assert.equal(snapDurationFor('minimax-h3', 11), 11, '4~15 정수 전체');
});

test('화면비: 이미지→영상은 adaptive, 텍스트·참조는 21:9~9:16 집합 안에서', () => {
  assert.equal(minimaxRatioFor('i2v', '9:16'), 'adaptive');
  assert.equal(minimaxRatioFor('t2v', '21:9'), '21:9');
  assert.equal(minimaxRatioFor('r2v', '3:4'), '3:4');
  assert.equal(minimaxRatioFor('t2v', '2:1'), '16:9');
});

test('참조→영상 등급은 H3·Fast·Developer 뿐', () => {
  assert.deepEqual([...MINIMAX_REFS_MODELS].sort(), ['minimax-h3', 'minimax-h3-dev', 'minimax-h3-fast']);
  for (const id of IDS) assert.equal(isMinimaxModel(id), true, id);
  assert.equal(isMinimaxModel('seedance'), false);
});

test('video.ts: refers 를 {url,type} 로 만들고(시작 스틸이 1번·중복 제거·상한), 영상·오디오 data: 는 GCS 에 올린다 · status 가 접두를 안다', () => {
  const v = read('prototype/functions/api/video.ts');
  const i = v.indexOf('if (isMinimaxModel(videoModel)) {');
  assert.ok(i > 0, 'MiniMax 분기');
  const block = v.slice(i, v.indexOf('// Seedance R2V branch', i));
  assert.match(block, /const refImagesRaw = referenceImages\.filter\(\(r\) => r !== startRaw\);/, '스틸 중복 제거');
  assert.match(block, /if \(startRaw\) refers\.push\(\{ url: await toAtlasImageUrl\(startRaw, `start-\$\{sceneId\}`\), type: "image" \}\);/, '스틸이 refers 1번');
  assert.match(block, /type: "video"/);
  assert.match(block, /type: "audio"/);
  assert.match(block, /atlasBody\.end_image = await toAtlasImageUrl\(endRaw/, '끝 프레임');
  assert.match(block, /job_id: `minimax:\$\{predictionId\}`/);
  assert.match(v, /const toAtlasMediaUrl = async \(src: string, suffix: string, kind: "video" \| "audio"\)/);
  assert.match(v, /!isKling && !isMinimaxModel\(videoModel\)/, 'supportedModels 검사 통과');
  const st = read('prototype/functions/api/video/status.ts');
  assert.match(st, /const isMinimax = jobId\.startsWith\('minimax:'\);/);
  assert.match(st, /'minimax:': 'minimax:',/);
});

test('크레딧: 초당 요율(정가 올림), 5초부터인 등급은 최소 5초', () => {
  assert.equal(quoteCredits('video', { videoModel: 'minimax-h3', durationSeconds: 10 }, {}).credits, 40);
  assert.equal(quoteCredits('video', { videoModel: 'minimax-h3-dev', durationSeconds: 10 }, {}).credits, 20);
  assert.equal(quoteCredits('video', { videoModel: 'minimax-h3-fast', durationSeconds: 4 }, {}).credits, 25);
});

test('모든 입구에 등록: AI 영상 · AI 시네마(상세·캔버스) · 에이전트 대화', () => {
  const gen = read('prototype/js/ui/ai-video-gen.js');
  const pipe = read('prototype/ui/pipeline.js');
  const pv = read('prototype/ui/pipeline-video.js');
  const cs = read('ai-company-app/src/lib/canvasSettings.ts');
  const orch = read('prototype/functions/api/agent/_orchestrator.ts');
  for (const id of IDS) {
    assert.match(gen, new RegExp(`\\{ id: '${id}',`), `AI 영상 ${id}`);
    assert.match(pipe, new RegExp(`__mopt\\('${id}'`), `AI 시네마 셀렉트 ${id}`);
    assert.match(pv, new RegExp(`'${id}': 'MiniMax`), `AI 시네마 라벨 ${id}`);
    assert.match(cs, new RegExp(`\\{ id: "${id}",`), `캔버스 ${id}`);
    assert.match(orch, new RegExp(id.replace(/-/g, '\\-')), `에이전트 도구 설명 ${id}`);
  }
  // AI 영상: 해상도 미러가 서버 표와 같다
  for (const id of IDS) {
    const tier = MINIMAX_MODELS[id];
    const m = new RegExp(`'${id}':\\s*\\{ t2v: \\[([^\\]]*)\\], i2v: \\[([^\\]]*)\\], def: '([^']+)' \\}`).exec(gen);
    assert.ok(m, `AI 영상 해상도 미러 ${id}`);
    const list = (s) => s.split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
    assert.deepEqual(list(m[1]), [...tier.resolutions.t2v], `${id} t2v`);
    assert.deepEqual(list(m[2]), [...(tier.resolutions.r2v || tier.resolutions.i2v)], `${id} i2v`);
    assert.equal(m[3], tier.defaultResolution, `${id} 기본값`);
  }
  // 캔버스: 모델을 바꾸면 해상도를 새 모델 집합으로 맞춘다(예전 720p 가 MiniMax 로 가면 400)
  assert.match(cs, /export function snapResolution\(model: string, resolution: string\): string \{/);
  for (const f of ['ai-company-app/src/components/GenerationSettingsPopover.tsx', 'ai-company-app/src/components/AgentSettingsPanel.tsx', 'ai-company-app/src/components/ProductionCanvas.tsx']) {
    assert.match(read(f), /resolution: snapResolution\(/, f);
  }
  // 에이전트: 끝 프레임·참조 오디오를 /api/video 로 넘긴다
  const shared = read('prototype/functions/api/agent/_shared.ts');
  assert.match(shared, /input\?\.endImageDataUrl \|\| input\?\.endImageUrl \? \{ endImageDataUrl:/);
  assert.match(shared, /input\?\.audioUrl \|\| input\?\.audioDataUrl \? \{ audioDataUrl:/);
});
