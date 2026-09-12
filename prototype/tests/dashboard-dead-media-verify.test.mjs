// 대시보드 썸네일 "죽은 미디어" 기록은 실제 404 일 때만, 유효기간을 두고, 옛 잘못된 기록은 버린다.
// (2026-09-12: 순간적 실패가 영구 기록돼 멀쩡한 썸네일이 전부 빈 칸이 된 사고의 재발 방지)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const src = fs.readFileSync(path.join(process.cwd(), 'prototype/js/ui/dashboard.js'), 'utf8').replace(/\r\n/g, '\n');

function extract(names) {
  // 필요한 함수·상수만 잘라 vm 에서 실행한다.
  const start = src.indexOf("  var DEAD_MEDIA_KEY = 'nk_dead_media_v2';");
  const end = src.indexOf('  // 빈 썸네일(이미지 추가) placeholder SVG');
  assert.ok(start > 0 && end > start, '죽은 미디어 블록을 찾지 못함');
  const body = src.slice(start, end) + '\nthis.__x = { ' + names.join(', ') + ' };';
  return body;
}

function run(fetchImpl, storage) {
  const sandbox = {
    localStorage: storage, fetch: fetchImpl, setTimeout(fn) { fn(); }, Date, Number, Object, JSON, Array, Set, console,
  };
  vm.runInNewContext(extract(['markDeadMedia', 'isDeadMedia', 'handleThumbLoadError', 'DEAD_MEDIA_KEY', 'DEAD_MEDIA_TTL_MS']), sandbox);
  return sandbox.__x;
}
function memStorage(init) {
  const m = Object.assign({}, init || {});
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, _m: m };
}
function fakeImg(src, obj) {
  const attrs = { src, 'data-thumb-obj': obj };
  return { getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); }, get src() { return attrs.src; }, set src(v) { attrs.src = v; }, _attrs: attrs };
}

test('★저장 키가 바뀌어 옛 영구 기록(nk_dead_media)은 더 이상 읽지 않는다', () => {
  const x = run(async () => ({ status: 404 }), memStorage({ nk_dead_media: JSON.stringify(['thumbs/a.png']) }));
  assert.equal(x.DEAD_MEDIA_KEY, 'nk_dead_media_v2');
  assert.equal(x.isDeadMedia('thumbs/a.png'), false, '옛 기록에 잡혀 있던 썸네일이 다시 요청된다');
});

test('★404 를 실제로 받았을 때만 죽은 미디어로 기록한다', async () => {
  const st = memStorage();
  const x = run(async () => ({ status: 404 }), st);
  let swapped = 0;
  x.handleThumbLoadError(fakeImg('/api/media/proxy?objectName=thumbs/gone.png', 'thumbs/gone.png'), () => { swapped++; });
  await new Promise((r) => setImmediate(r));
  assert.equal(swapped, 1);
  assert.equal(x.isDeadMedia('thumbs/gone.png'), true);
});

test('★401/5xx/네트워크 실패는 기록하지 않고 한 번 재시도한다', async () => {
  for (const impl of [async () => ({ status: 401 }), async () => ({ status: 502 }), async () => { throw new Error('offline'); }]) {
    const st = memStorage();
    const x = run(impl, st);
    let swapped = 0;
    const img = fakeImg('/api/media/proxy?objectName=thumbs/ok.png&nk_token=t', 'thumbs/ok.png');
    x.handleThumbLoadError(img, () => { swapped++; });
    await new Promise((r) => setImmediate(r));
    assert.equal(x.isDeadMedia('thumbs/ok.png'), false, '순간 실패는 죽은 미디어가 아니다');
    if (impl.constructor.name === 'AsyncFunction' && (await impl().catch(() => null))) {
      assert.equal(img._attrs['data-thumb-retried'], '1', '한 번 재시도한다');
      assert.match(img.src, /&retry=\d+/);
      assert.equal(swapped, 0, '재시도 중에는 빈 칸으로 바꾸지 않는다');
      // 재시도도 실패하면 이번 렌더만 빈 칸, 여전히 기록하지 않는다
      x.handleThumbLoadError(img, () => { swapped++; });
      await new Promise((r) => setImmediate(r));
      assert.equal(swapped, 1);
      assert.equal(x.isDeadMedia('thumbs/ok.png'), false);
    } else {
      assert.equal(swapped, 1, '네트워크 오류는 이번 렌더만 빈 칸');
    }
  }
});

test('★기록에는 유효기간(7일)이 있어 만료되면 다시 확인한다', () => {
  const old = Date.now() - 8 * 24 * 60 * 60 * 1000;
  const st = memStorage({ nk_dead_media_v2: JSON.stringify({ 'thumbs/old.png': old, 'thumbs/new.png': Date.now() }) });
  const x = run(async () => ({ status: 404 }), st);
  assert.equal(x.DEAD_MEDIA_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(x.isDeadMedia('thumbs/old.png'), false);
  assert.equal(x.isDeadMedia('thumbs/new.png'), true);
});

test('★카드·사이드바 onerror 가 모두 검증 핸들러를 쓰고, 직접 markDeadMedia 를 부르지 않는다', () => {
  const handlers = src.split('img.onerror = function').length - 1 + (src.split('sImg.onerror = function').length - 1);
  assert.equal(handlers, 2);
  assert.equal(src.split('handleThumbLoadError(').length - 1, 3, '정의 1 + 호출 2');
  assert.doesNotMatch(src, /onerror = function \(\) \{\s*markDeadMedia\(/);
});
