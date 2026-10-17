import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

// 한 Facebook 사용자가 여러 nkstudio 계정(예: 개인 계정·회사 계정)에 서로 다른 페이지를 붙인다.
// 전역 FACEBOOK_PAGE_ID 가 항상 이기면 두 번째 계정에도 첫 계정의 페이지가 붙는다.
test('Facebook 연결 요청은 붙일 페이지 힌트를 state 에 싣는다', () => {
  const src = read('prototype/functions/api/sns/connect/facebook.ts');
  assert.match(src, /searchParams\.get\("page"\)/);
  assert.match(src, /pageHint: encodeURIComponent\(pageHint\)/);
});

test('콜백은 힌트 → 저장된 페이지 → env → 첫 번째 순으로 페이지를 고른다', () => {
  const src = read('prototype/functions/auth/facebook/callback.ts');
  assert.match(src, /decodeURIComponent\(String\(decoded\.pageHint\)\)/);
  assert.match(src, /const page = byHint \|\| bySaved \|\| byEnv \|\| pages\[0\];/);
  assert.match(src, /readFacebookRecord\(/);
  // 힌트 페이지에 권한이 없으면 엉뚱한 페이지를 저장하지 않고 실패로 돌려준다
  assert.match(src, /if \(pageHint && !byHint\)/);
});
