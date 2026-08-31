// cameraDirection(카메라 방위) · blocking(무대 배치) 필드가 씬 체인의 모든 길목을
// 통과하는지 소스 텍스트로 못박는다. beats-survive-chain 과 같은 방식.
// 길목: decomposer → scenario-shots 평탄화 → scenario.js 조립 4자리 →
//        save.ts/get.ts 화이트리스트 → ui/pipeline.js 프로덕션 재조립.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('scenario.js 의 씬 조립 자리마다 cameraDirection 이 실린다', () => {
  const src = read('prototype/js/ui/scenario.js');
  const re = /composition:/g;
  const sites = [];
  let m;
  while ((m = re.exec(src)) !== null) sites.push(m.index);
  assert.ok(sites.length >= 4, `씬 조립 자리가 ${sites.length}곳뿐입니다 (4곳 이상이어야 정상)`);
  sites.forEach((idx) => {
    const around = src.slice(Math.max(0, idx - 1500), idx + 1500);
    const line = src.slice(0, idx).split('\n').length;
    assert.ok(/cameraDirection/.test(around), `scenario.js:${line} 근처 씬 조립 자리에 cameraDirection 이 없습니다`);
    assert.ok(/blocking/i.test(around), `scenario.js:${line} 근처 씬 조립 자리에 blocking 이 없습니다`);
  });
});

test('★ui/pipeline.js 프로덕션 재조립도 같은 열거로 검사한다 (beats 가 여기서 증발했던 전례)', () => {
  const src = read('prototype/ui/pipeline.js');
  const re = /composition: /g;
  const sites = [];
  let m;
  while ((m = re.exec(src)) !== null) sites.push(m.index);
  assert.ok(sites.length >= 3, `pipeline.js 씬/샷 조립 자리가 ${sites.length}곳뿐입니다`);
  sites.forEach((idx) => {
    const around = src.slice(Math.max(0, idx - 1500), idx + 1500);
    const line = src.slice(0, idx).split('\n').length;
    assert.ok(/cameraDirection/.test(around), `pipeline.js:${line} 근처 조립 자리에 cameraDirection 이 없습니다`);
    assert.ok(/beats/.test(around), `pipeline.js:${line} 근처 조립 자리에 beats 가 없습니다 (프로덕션 beats 증발 회귀)`);
    assert.ok(/blocking/.test(around), `pipeline.js:${line} 근처 조립 자리에 blocking 이 없습니다`);
  });
});

test('복사↔붙여넣기 왕복이 방위·블로킹을 나른다', () => {
  const src = read('prototype/js/ui/scenario.js');
  assert.match(src, /방위: \$\{s\.cameraDirection\}/, '복사 텍스트에 방위 줄이 없습니다');
  assert.match(src, /블로킹: \$\{blockingLine\}/, '복사 텍스트에 블로킹 줄이 없습니다');
  assert.match(src, /'방위': 'cameraDirection'/, '붙여넣기 라벨맵에 방위가 없습니다');
  assert.match(src, /'블로킹': 'blocking'/, '붙여넣기 라벨맵에 블로킹이 없습니다');
  assert.match(src, /blockingToText/, '블로킹 직렬화 코덱이 없습니다');
  assert.match(src, /textToBlocking/, '블로킹 역직렬화 코덱이 없습니다');
});

test('서버 저장·불러오기 화이트리스트 (save.ts + get.ts 동시 검사)', () => {
  ['prototype/functions/api/project/save.ts', 'prototype/functions/api/project/get.ts'].forEach((rel) => {
    const src = read(rel);
    assert.match(src, /const normalizeBlocking = \(value: any\)/, rel + ': normalizeBlocking 선언 없음');
    assert.match(src, /cameraDirection,/, rel + ': 씬 반환 객체에 cameraDirection 없음');
    assert.match(src, /blocking: normalizeBlocking\(s\?\.blocking\),/, rel + ': 씬 반환 객체에 blocking 없음');
    assert.match(src, /cameraDirection: typeof sh\.cameraDirection === "string"/, rel + ': 샷 화이트리스트에 cameraDirection 없음');
    assert.match(src, /blocking: normalizeBlocking\(sh\.blocking\),/, rel + ': 샷 화이트리스트에 blocking 없음');
  });
});

test('서버 컷 평탄화가 방위·블로킹을 나른다 (본 경로 + legacy 폴백)', () => {
  const src = read('prototype/functions/api/scenario-shots.js');
  assert.match(src, /cameraDirection: String\(sh\.cameraDirection \|\| "front"\)/);
  assert.match(src, /blocking: Array\.isArray\(sh\.blocking\)/);
  // legacy 폴백 경로에도 기본값이 있어야 한다
  assert.match(src, /cameraDirection: "front",\n\s+beats: null,\n\s+blocking: null,/);
});

test('decomposer 가 방위·블로킹을 만들고, 합치기·폴백에서 잃지 않는다', () => {
  const src = read('prototype/functions/api/scenario/shots/decomposer.js');
  // 파싱 화이트리스트
  assert.match(src, /normalizeCameraDirection\(raw\.cameraDirection\) \|\| "front"/);
  assert.match(src, /const blocking = normalizeBlocking\(raw\.blocking\);/);
  assert.match(src, /out\.push\(\{ id, duration, shotType, cameraMove, cameraDirection, composition, action, dialogue, beats, blocking \}\);/);
  // 컷 합치기(mergeTwoShots)에서 증발 금지
  assert.match(src, /cameraDirection: a\.cameraDirection \|\| b\.cameraDirection \|\| "front"/);
  assert.match(src, /blocking: a\.blocking \|\| b\.blocking \|\| null/);
  // 폴백 싱글샷
  assert.match(src, /cameraDirection: "front",/);
  // 프롬프트 지시(한/영 모두)
  assert.match(src, /cameraDirection : 카메라 방위/);
  assert.match(src, /cameraDirection : which way the camera faces/);
  assert.match(src, /"blocking":\[\{"token"/);
});

test('어휘: 서버·클라이언트 CAMERA_DIRECTIONS 키 셋이 동일하다', async () => {
  const vocab = await import(pathToFileURL(path.join(process.cwd(), 'prototype/functions/api/scenario/shots/vocab.js')).href);
  const clientSrc = read('prototype/js/service/shot-vocab.js');
  const serverKeys = Object.keys(vocab.CAMERA_DIRECTIONS);
  assert.deepEqual(serverKeys.sort(), ['back', 'front', 'left', 'right']);
  serverKeys.forEach((k) => {
    assert.ok(new RegExp(k + ':\\s*\\{').test(clientSrc), `클라이언트 shot-vocab 에 방위 키 ${k} 가 없습니다`);
  });
  assert.equal(vocab.normalizeCameraDirection('REVERSE'), 'back', '리버스 동의어 흡수');
  assert.equal(vocab.normalizeCameraDirection('bogus'), null);
});
