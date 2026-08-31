// 무대 기하(stage-geometry) 단위 테스트.
// 블로킹은 "정면(front)에서 본 무대" 기준으로 적히고, 카메라 방위가 바뀌면
// 좌우 반전·원근 반전·시선(정면↔등) 변환이 조회표(기하)로 결정된다.
// 리버스 샷에서 "정면을 보던 캐릭터가 등을 보인다"가 추론이 아니라 계산이 되는 근거.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadStageGeometry() {
  const ctx = { window: null };
  ctx.window = ctx;
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(process.cwd(), 'prototype/js/service/stage-geometry.js'), 'utf8');
  vm.runInContext(src, ctx);
  return ctx.NK.service.stageGeometry;
}

const geo = loadStageGeometry();

test('front 카메라는 무대 좌표를 그대로 프레임에 쓴다', () => {
  const f = geo.transformEntry({ token: '@네모', x: 'left', depth: 'far', facing: 'camera' }, 'front');
  assert.equal(f.frameX, 'left');
  assert.equal(f.frameDepth, 'far');
  assert.match(f.facingText, /facing the camera/);
});

test('back(리버스) 카메라: 좌우 반전 + 원근 반전 + 정면→등', () => {
  const f = geo.transformEntry({ token: '@네모', x: 'left', depth: 'near', facing: 'camera' }, 'back');
  assert.equal(f.frameX, 'right', '리버스에서 무대 왼쪽은 프레임 오른쪽');
  assert.equal(f.frameDepth, 'far', '정면 근경은 리버스에서 원경');
  assert.match(f.facingText, /back to the camera/, '정면 카메라를 보던 캐릭터는 리버스에서 등을 보인다');
  const g = geo.transformEntry({ token: '@세모', x: 'center', depth: 'mid', facing: 'away' }, 'back');
  assert.match(g.facingText, /facing the camera/, '등을 보이던 캐릭터는 리버스에서 정면');
});

test('right 카메라(동쪽을 봄): 근경→프레임 우, 무대 좌측→근경, left 시선→카메라 정면', () => {
  const f = geo.transformEntry({ token: '@네모', x: 'left', depth: 'near', facing: 'left' }, 'right');
  assert.equal(f.frameX, 'right');
  assert.equal(f.frameDepth, 'near');
  assert.match(f.facingText, /facing the camera/);
  const g = geo.transformEntry({ token: '@세모', x: 'right', depth: 'far', facing: 'camera' }, 'right');
  assert.equal(g.frameX, 'left');
  assert.equal(g.frameDepth, 'far');
  assert.match(g.facingText, /frame-right/);
});

test('left 카메라(서쪽을 봄): right/left 매핑이 right 카메라와 거울상이다', () => {
  const f = geo.transformEntry({ token: '@네모', x: 'right', depth: 'near', facing: 'right' }, 'left');
  assert.equal(f.frameX, 'left');
  assert.equal(f.frameDepth, 'near');
  assert.match(f.facingText, /facing the camera/);
});

test('buildBlockingLines: allowedTokens 필터가 화면 밖 캐릭터를 문장에서 뺀다', () => {
  const blocking = [
    { token: '@네모', x: 'center', depth: 'far', facing: 'camera' },
    { token: '@세모', x: 'left', depth: 'near', facing: 'away' }
  ];
  const only = geo.buildBlockingLines(blocking, 'front', ['@네모']);
  assert.match(only, /네모/);
  assert.doesNotMatch(only, /세모/, '화면(composition)에 없는 캐릭터는 공간 문장에도 나오면 안 된다');
  const all = geo.buildBlockingLines(blocking, 'front', null);
  assert.match(all, /네모/);
  assert.match(all, /세모/);
});

test('normalizeBlocking: 토큰 보정·기본값·무효 입력', () => {
  const rows = geo.normalizeBlocking([
    { token: '네모', x: 'LEFT', depth: 'bogus', facing: 'camera' },
    { name: '세모' },
    null,
    { x: 'left' } // 토큰 없음 → 버림
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].token, '@네모');
  assert.equal(rows[0].x, 'left');
  assert.equal(rows[0].depth, 'mid', '무효 값은 기본값으로');
  assert.equal(rows[1].token, '@세모');
  assert.equal(geo.normalizeBlocking([]), null);
  assert.equal(geo.normalizeBlocking('x'), null);
});

test('방위 플레이트 variant id 규약', () => {
  assert.equal(geo.directionVariantId('back'), 'dir-back');
  assert.equal(geo.directionVariantId('front'), 'dir-front');
  assert.equal(geo.directionVariantId('bogus'), '');
});
