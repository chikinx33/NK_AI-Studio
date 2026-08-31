// 방위별 세트 플레이트 + 공간 기하 주입 + 자동 연속성 + 구도 반복 린트.
// "리버스 샷의 배경은 반대편 벽" 을 코드가 실제로 수행하는지 소스로 못박는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('episodeLocationAsset 이 컷의 cameraDirection 으로 방위 플레이트를 고른다', () => {
  const src = read('prototype/ui/pipeline-image.js');
  assert.match(src, /function episodeLocationAsset\(row, cameraDirection\)/, '방위 인자가 없습니다');
  assert.match(src, /directionVariantId/, '방위 variant id 규약을 쓰지 않습니다');
  // 방위 플레이트가 없을 때의 폴백: 마스터를 쓰되 "반대편이다"를 프롬프트로 알린다
  assert.match(src, /this reference shows the FRONT side/, '방위 플레이트 미등록 시 폴백 경고문이 없습니다');
  // 호출부가 scene.cameraDirection 을 넘긴다
  assert.match(src, /\), scene && scene\.cameraDirection\);/, '호출부가 cameraDirection 을 넘기지 않습니다');
});

test('이미지 프롬프트에 방위·블로킹 기하가 주입된다 (씬·컷 両경로)', () => {
  const src = read('prototype/ui/pipeline-image.js');
  assert.match(src, /function appendStageGeometry\(/);
  const count = (src.match(/appendStageGeometry\(/g) || []).length;
  assert.ok(count >= 3, `appendStageGeometry 호출이 ${count}회 — 정의 1 + 씬/컷 두 경로 이상이어야 합니다`);
  assert.match(src, /buildCameraDirectionHint/);
  assert.match(src, /buildBlockingLines/);
});

test('컷 레퍼런스를 고르지 않은 컷은 같은 장소의 직전 스틸을 자동 연속성 앵커로 붙인다', () => {
  const src = read('prototype/ui/pipeline-image.js');
  assert.match(src, /Auto continuity reference \(image\)/, '자동 연속성 로그가 없습니다');
  assert.match(src, /referenceKind: 'continuity',\n\s+imageDataUrl: prevImg/, '직전 스틸을 continuity 로 붙이지 않습니다');
  assert.match(src, /do NOT copy its framing, camera angle/, '연속성 레퍼런스에 구도 복제 금지 지시가 없습니다');
  // 장소가 바뀌면 잇지 않는다
  assert.match(src, /prevLoc !== thisLoc\) break/, '장소 경계에서 연속성을 끊지 않습니다');
});

test('bgref 모달: 4방위 플레이트 생성기가 있고 dir-* id 규약을 쓴다', () => {
  const src = read('prototype/ui/pipeline.js');
  assert.match(src, /function generateDirectionPlates\(/);
  assert.match(src, /DIRECTION_PLATE_SPECS/);
  assert.match(src, /'dir-' \+ spec\.dir/, 'variant id 규약(dir-back 등)이 없습니다');
  assert.match(src, /REVERSE ANGLE of the exact same place/, '리버스 플레이트 지시문이 없습니다');
  // 룩만 잇고 구도는 프롬프트가 정하는 environment-detail 로 참조
  const dirGenIdx = src.indexOf('async function generateDirectionPlates');
  const slice = src.slice(dirGenIdx, dirGenIdx + 4000);
  assert.match(slice, /environment-detail/, '마스터 플레이트를 environment-detail 로 참조해야 합니다');
});

test('bgref 모달 문구는 한/영 사전 짝으로 있다', () => {
  const src = read('prototype/ui/pipeline.js');
  ['dirPlates', 'dirPlatesTitle', 'dirPlatesBusy', 'failDirPlate', 'dirBack', 'dirLeft', 'dirRight'].forEach((key) => {
    const hits = (src.match(new RegExp(key + ':', 'g')) || []).length;
    assert.ok(hits >= 2, `BGREF_TEXT 키 ${key} 가 ko/en 양쪽에 없습니다 (발견 ${hits}회)`);
  });
});

test('씬 카드: 방위 칩과 구도 반복 린트 칩', () => {
  const row = read('prototype/ui/pipeline-scene-row.js');
  assert.match(row, /chip-camera-direction/);
  assert.match(row, /chip-setup-lint/);
  // 린트 판정: 앞 컷과 shotType·cameraMove·cameraDirection 이 모두 같을 때만
  assert.match(row, /prev\.shotType[\s\S]{0,200}prev\.cameraMove[\s\S]{0,200}prev\.cameraDirection/);
  // 린트 문구 한/영
  assert.match(row, /구도 반복/);
  assert.match(row, /SAME SETUP/);
  const css = read('prototype/styles.css');
  assert.match(css, /chip-setup-lint/);
  assert.match(css, /chip-camera-direction/);
});

test('stage-geometry 모듈이 파이프라인 페이지에 로드된다', () => {
  const html = read('prototype/scenes.html');
  assert.match(html, /js\/service\/stage-geometry\.js\?v=/, 'scenes.html 에 stage-geometry.js 스크립트 태그가 없습니다');
  const idxGeo = html.indexOf('stage-geometry.js');
  const idxImg = html.indexOf('ui/pipeline-image.js');
  assert.ok(idxGeo >= 0 && idxImg > idxGeo, 'stage-geometry.js 는 pipeline-image.js 보다 먼저 로드되어야 합니다');
});
