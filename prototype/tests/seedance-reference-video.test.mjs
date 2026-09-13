// Seedance 2.0/2.5 참조→영상 개선(2026-09-14 시장조사 반영):
//  1) 영상 생성에 참조 묶음(첫 프레임·세트 플레이트·캐릭터 시트·부감 마스터·직전 컷) 첨부 + 순서 매니페스트 + 팔레트 잠금
//  2) Seedance 2.5 엔드포인트(reference_images ≤30, reference_videos ≤10, 4~30초, 네이티브 오디오)
//  3) 세트 플레이트 게이트(서버 scene_still/scene_video + 캔버스 버튼)
//  4) 계보 videoRefs, 캔버스·제작 화면 모델 목록
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('★video.ts: seedance-2.5 분기 — 스틸이 reference_images[0], 참조 영상, 4~30초, 오디오, 잡 id 접두 · status 가 같은 접두를 안다', () => {
  const v = read('prototype/functions/api/video.ts');
  assert.match(v, /"seedance-r2v", "seedance-2\.5", "vidu-q3"\]/, 'supportedModels');
  assert.match(v, /model: "bytedance\/seedance-2\.5\/reference-to-video",/);
  assert.match(v, /const startResolved = imageDataUrl \? await toAtlasImageUrl\(imageDataUrl, `start-\$\{sceneId\}`\)\.catch\(\(\) => ""\) : "";\s*\n\s*if \(startResolved\) refResolved\.push\(startResolved\);/, '스틸이 첫 참조');
  assert.match(v, /for \(let i = 0; i < referenceImages\.length && refResolved\.length < 30; i\+\+\)/, '상한 30');
  assert.match(v, /if \(vidsResolved\.length > 0\) atlasBody\.reference_videos = vidsResolved;/);
  assert.match(v, /generate_audio: \(body as any\)\?\.generateAudio !== false,/);
  assert.match(v, /snapDurationFor\("seedance-2\.5", durationSeconds\)/);
  assert.match(v, /job_id: predictionId \? `seedance-2\.5:\$\{predictionId\}` : ""/);
  const st = read('prototype/functions/api/video/status.ts');
  assert.match(st, /const isSeedance25 = jobId\.startsWith\('seedance-2\.5:'\);/);
  assert.match(st, /'seedance-2\.5:': 'seedance-2\.5:',/);
  const specs = read('prototype/functions/api/_shared/video-specs.ts');
  assert.match(specs, /"seedance-2\.5": DURATIONS_SEEDANCE_25,/);
  assert.match(specs, /"seedance-2\.5": CHOICES_SEEDANCE_25,/);
});

test('★scene_video: 참조→영상 모델이면 첫 프레임 → 플레이트 → 캐릭터 시트 → 마스터 → 직전 컷 순으로 참조를 붙이고 매니페스트·팔레트 잠금을 프롬프트에 더한다', () => {
  const shared = read('prototype/functions/api/agent/_shared.ts');
  const i = shared.indexOf('async function runSceneVideoTool('); const fn = shared.slice(i, shared.indexOf('\n}\n', i));
  assert.match(fn, /const REFS_VIDEO_MODELS = \["seedance-2\.5", "seedance-r2v", "grok-r2v", "vidu-q3", "wan"\];/);
  assert.match(fn, /const startInRefs = videoModel === "seedance-2\.5" \|\| videoModel === "seedance-r2v";/, '2.5·r2v 는 시작 스틸이 참조 1번');
  assert.match(fn, /the exact FIRST FRAME of this shot/);
  assert.match(fn, /assertSetPlateReady\(loc, input\);/, '플레이트 게이트');
  assert.match(fn, /const plate = findPlate\(loc, direction, elevation\);/, '컷의 방위×높이 플레이트');
  assert.match(fn, /const chars = await collectCharacterRefs\(scene, payload0, ctx\);/, '스틸과 같은 캐릭터 묶음');
  assert.match(fn, /if \(videoModel === "seedance-2\.5" && prevClip && \/\^\(https\?:\\\/\\\/\|gs:\\\/\\\/\)\/i\.test\(prevClip\)\) \{ referenceVideos = \[prevClip\];/, '2.5 는 직전 컷 클립을 참조 영상으로');
  assert.match(fn, /the previous shot of this scene \(continuity\) — reuse its look, lighting and character designs only; do NOT copy its camera, framing or action/);
  assert.match(fn, /"The input images are provided in this exact order:", \.\.\.kept\.map\(\(e, i\) => `Image \$\{i \+ 1\}: \$\{e\.line\}\.`\)/, '순서 매니페스트');
  assert.match(fn, /PALETTE LOCK: use only the colors, materials and background treatment of the reference images\./);
  assert.match(fn, /videoRefs: videoRefNotes\.join\(" · "\),/, '계보');
  const rv = shared.slice(shared.indexOf('async function runVideoTool('), shared.indexOf('\n}\n', shared.indexOf('async function runVideoTool(')));
  assert.match(rv, /referenceImages: input\.referenceImages\.map/, 'runVideoTool 이 참조를 /api/video 로 넘긴다');
  assert.match(rv, /referenceVideos: input\.referenceVideos\.map/);
  for (const f of ['prototype/functions/api/project/save.ts', 'prototype/functions/api/project/get.ts']) assert.match(read(f), /videoRefs: str\(value\.videoRefs\),/, f);
});

test('★세트 플레이트 게이트: 서버(scene_still·scene_video)는 마스터도 정면 플레이트도 없으면 거부(force 예외), 캔버스는 버튼을 막고 이유를 보여 준다', () => {
  const shared = read('prototype/functions/api/agent/_shared.ts');
  assert.match(shared, /function assertSetPlateReady\(loc: any, input: any\): void \{\s*\n\s*if \(!loc \|\| input\?\.force === true\) return;\s*\n\s*if \(masterOf\(loc\) \|\| String\(loc\.refObjectName \|\| ""\)\.trim\(\)\) return;/);
  const iS = shared.indexOf('async function runSceneStillTool('); const sfn = shared.slice(iS, shared.indexOf('\n}\n', iS));
  assert.match(sfn, /assertSetPlateReady\(loc, input\);/);
  const src = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(src, /const cutPlateMissing = \(cutId: string\): string => \{/);
  assert.match(src, /disabled=\{saving \|\| !!cutJobState\(selected\.data\.sceneId, "scene_still"\)\.running \|\| !!cutPlateMissing\(selected\.id\)\}/);
  assert.match(src, /\{selected\.data\.lineage\.videoRefs \? <p>영상 참조: /);
});

test('★모델 목록: 캔버스·제작 화면 모두 seedance-r2v·seedance-2.5 를 고를 수 있고 길이 선택지가 서버와 같다', () => {
  const cs = read('ai-company-app/src/lib/canvasSettings.ts');
  assert.match(cs, /\{ id: "seedance-2\.5", label: "Seedance 2\.5 Reference \(참조·30초·오디오\)", i2vOnly: true, resolutions: \["480p", "720p", "1080p"\] \},/);
  assert.match(cs, /"seedance-2\.5": \[4, 5, 6, 8, 10, 15, 20, 30\],/);
  const front = read('prototype/js/ui/ai-video-gen.js');
  assert.match(front, /\{ id: 'seedance-2\.5', label: 'Seedance 2\.5 Reference'/);
  assert.match(front, /var CHOICES_SEEDANCE_25 = \[4, 5, 6, 8, 10, 15, 20, 30\];/);
  const pv = read('prototype/ui/pipeline-video.js');
  assert.match(pv, /var REFS_MODELS = \['grok-r2v', 'wan', 'seedance-r2v', 'seedance-2\.5', 'vidu-q3'\];/);
  assert.match(pv, /'seedance-2\.5': 30,/);
});
