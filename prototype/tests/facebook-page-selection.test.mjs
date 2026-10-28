import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const oauth = read('prototype/functions/api/_shared/meta-oauth.js');
const facebook = oauth.slice(oauth.indexOf('async facebook('), oauth.indexOf('async youtube('));

// 한 Facebook 사용자가 여러 nkstudio 계정(예: 개인 계정·회사 계정)에 서로 다른 페이지를 붙인다.
// 운영자 전용 FACEBOOK_PAGE_ID 가 고객 연결의 페이지 선택에 끼어들면 안 된다.
test('Facebook 연결 요청의 페이지 힌트는 서버 티켓에만 저장된다', () => {
  assert.match(read('prototype/functions/api/sns/connect/facebook.ts'), /startMetaOAuth\(request, env, 'facebook'\)/);
  assert.match(oauth, /platform === 'facebook' \? String\(new URL\(request\.url\)\.searchParams\.get\('page'\)/);
  assert.match(oauth, /\.\.\.\(pageHint \? \{ pageHint \} : \{\}\)/);
  assert.doesNotMatch(oauth, /const data = \{[^}]*pageHint/);
});

test('완료 단계는 힌트 → 저장된 페이지 → 첫 번째 순으로 페이지를 고른다', () => {
  assert.match(facebook, /const page = byHint \|\| pages\.find\(pg => pg\.id === savedPageId\) \|\| pages\[0\];/);
  assert.match(facebook, /sns\?\.facebook\?\.pageId/);
  assert.doesNotMatch(facebook, /FACEBOOK_PAGE_ID/);
  // 힌트 페이지에 권한이 없으면 엉뚱한 페이지를 저장하지 않고 실패로 돌려준다
  assert.match(facebook, /if \(hint && !byHint\) throw new Error\('facebook_page_not_granted'\)/);
  // 페이지 토큰이 들어 있는 응답 원문을 로그에 남기지 않는다
  assert.doesNotMatch(oauth, /console\.log/);
});
