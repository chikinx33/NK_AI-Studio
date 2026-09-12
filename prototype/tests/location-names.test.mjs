// 장소 문자열 통일: 같은 세트가 씬마다 다른 표현으로 쓰여 세트 판정이 갈리던 문제(2026-09-13 실제 결과).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { coreLocationName, canonicalizeSceneLocations } from '../functions/api/_shared/location-names.js';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('★구분자 뒤 설명을 버린다', () => {
  assert.equal(coreLocationName('소녀의 방 — 장난감이 바닥 가득 흩어진 실내'), '소녀의 방');
  assert.equal(coreLocationName('밝고 넓은 놀이방 바닥, ABC큐브 주변'), '밝고 넓은 놀이방 바닥');
  assert.equal(coreLocationName('밝고 원색적인 3D 무대 — 알파벳 블록들이 배경에 가득 쌓인 공간'), '밝고 원색적인 3D 무대');
  assert.equal(coreLocationName('교실 (오후)'), '교실');
  assert.equal(coreLocationName('  Kitchen: morning  '), 'Kitchen');
  assert.equal(coreLocationName(''), '');
});

test('★실제 생성 결과 7컷이 세트 3개로 통일된다', () => {
  const scenes = [
    { id: 1, sceneLocation: '소녀의 방 — 장난감이 바닥 가득 흩어진 실내' },
    { id: 2, sceneLocation: '장난감이 흩어진 소녀의 방 안' },
    { id: 3, sceneLocation: '장난감이 흩어진 소녀의 방 안' },
    { id: 4, sceneLocation: '밝고 넓은 놀이방 바닥, ABC큐브 주변' },
    { id: 5, sceneLocation: '밝고 넓은 놀이방 바닥, ABC큐브 주변' },
    { id: 6, sceneLocation: '밝고 원색적인 3D 무대 — 알파벳 블록들이 배경에 가득 쌓인 공간' },
    { id: 7, sceneLocation: '밝고 원색적인 3D 무대 — 알파벳 블록들이 배경에 가득 쌓인 공간' },
  ];
  const r = canonicalizeSceneLocations(scenes);
  assert.deepEqual(r.scenes.map((s) => s.sceneLocation), ['소녀의 방', '소녀의 방', '소녀의 방', '밝고 넓은 놀이방 바닥', '밝고 넓은 놀이방 바닥', '밝고 원색적인 3D 무대', '밝고 원색적인 3D 무대']);
  assert.equal(r.names.length, 3);
  assert.equal(r.renamed, 7);
  assert.equal(scenes[0].sceneLocation, '소녀의 방 — 장난감이 바닥 가득 흩어진 실내', '원본은 건드리지 않는다');
});

test('★이미 짧은 이름이면 그대로, 다른 세트를 잘못 합치지 않는다', () => {
  const r = canonicalizeSceneLocations([{ id: 1, sceneLocation: '교실' }, { id: 2, sceneLocation: '무대' }, { id: 3, sceneLocation: '교실' }]);
  assert.equal(r.renamed, 0);
  assert.deepEqual(r.names, ['교실', '무대']);
  const r2 = canonicalizeSceneLocations([{ id: 1, sceneLocation: '방' }, { id: 2, sceneLocation: '방송국 로비' }]);
  assert.equal(r2.scenes[1].sceneLocation, '방송국 로비', '한 글자짜리 후보는 부분 문자열 병합에 쓰지 않는다');
});

test('★서버는 두 생성 경로 모두에서 통일하고 meta 로 알리며, 클라이언트는 LLM 병합 이름으로 한 번 더 통일한다', () => {
  const srv = read('prototype/functions/api/scenario.js');
  assert.equal((srv.match(/canonicalizeSceneLocations\(normalizedScenes\)/g) || []).length, 2, 'per-beat·legacy 두 경로');
  assert.equal((srv.match(/\n      locationsRenamed,\n/g) || []).length, 2);
  const ui = read('prototype/js/ui/scenario.js');
  assert.match(ui, /nameById\.set\(String\(sid\), String\(\(l && l\.name\) \|\| ''\)\.trim\(\)\)/);
  assert.match(ui, /return Object\.assign\(\{\}, sc, \{ sceneLocation: nm \}\);/);
  assert.match(ui, /컷 장소 이름 통일 \$\{locationsUnified\}건/);
  assert.match(ui, /장소 이름 통일 \(Pass 1\): \$\{m\.locationsRenamed\}씬/);
});
