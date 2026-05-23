import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("index.html pre-applies logged-in state to avoid logged-out flash (FOUC)", () => {
  const src = read("prototype/index.html");
  // 로그인 카드 직후 인라인 스크립트가 인증 상태를 동기적으로 선반영
  assert.match(src, /localStorage\.getItem\('nk_is_logged_in'\) === 'true' && !!localStorage\.getItem\('nk_auth_token'\)/);
  // 로그아웃용 폼을 즉시 숨기고 버튼을 로그아웃 상태로
  assert.match(src, /card\.querySelectorAll\('\.form-row'\)\.forEach/);
  assert.match(src, /btn\.dataset\.state = 'logout'/);
});
