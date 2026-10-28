import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 예전 nk-ai-studio.pages.dev 화면은 nkstudio.org 로 넘긴다. 구글 OAuth 승인 도메인에서 pages.dev 를 뺐기 때문에
// pages.dev 화면에 남으면 구글 로그인·YouTube 연결이 막힌다. 미리보기 배포·nkstudio.org 는 그대로 둔다.
const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

function run(file, hostname) {
  const replaced = [];
  const location = { hostname, pathname: '/sns-settings', search: '?a=1', hash: '#x', replace: url => replaced.push(url) };
  const window = { location, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, addEventListener() {}, document: { readyState: 'complete', addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, documentElement: { lang: 'ko', setAttribute() {} } } };
  try { vm.runInNewContext(read(file), { window, location, localStorage: window.localStorage, document: window.document, console, setTimeout() {}, navigator: {} }); } catch { /* 화면 의존 코드는 넘기기 판단과 무관 */ }
  return replaced;
}

for (const file of ['prototype/js/config.js', 'prototype/js/landing.js']) {
  test(`${file}: pages.dev 화면은 같은 경로의 nkstudio.org 로 넘긴다`, () => {
    assert.deepEqual(run(file, 'nk-ai-studio.pages.dev'), ['https://nkstudio.org/sns-settings?a=1#x']);
    assert.deepEqual(run(file, 'nkstudio.org'), []);
    assert.deepEqual(run(file, 'abc123.nk-ai-studio.pages.dev'), [], '미리보기 배포는 넘기지 않는다');
  });
}

test('Functions 라우팅은 /api·/auth 만 — 화면 넘기기를 서버로 하지 않는다(정적 요청이 함수 호출이 되지 않게)', () => {
  assert.deepEqual(JSON.parse(read('prototype/_routes.json')).include, ['/api/*', '/auth/*']);
});
