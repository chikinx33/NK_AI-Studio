import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const nav = () => read("prototype/js/navigation.js");

/**
 * "사이드바 메뉴를 아무리 눌러도 안 열린다" 를 막는다.
 *
 * loadStage 는 중복 클릭을 막으려고 진행 중인 URL(__pendingUrl)과 같으면 무시했다.
 * 그런데 이 표시를 지우는 곳이 iframe load 성공 경로뿐이라, 로드가 끝나지 않으면
 * (스테이지 뷰 생성 실패, 로드 에러 등) 그 메뉴가 새로고침 전까지 영구히 잠겼다.
 */

test("진행 중 표시는 시간 제한이 있다 (영구 잠금 금지)", () => {
  const s = nav();
  // 무기한 비교로 되돌아가면 안 된다
  assert.doesNotMatch(s, /if \(url === __pendingUrl\) return;/);
  assert.match(s, /url === __pendingUrl && \(now - __pendingAt\) < PENDING_TTL_MS/);
  assert.match(s, /var PENDING_TTL_MS = \d+;/);
});

test("진행 중 표시를 지우는 경로가 성공 말고도 있다", () => {
  const s = nav();
  assert.match(s, /function clearPending\(\)/);
  // 로드 실패
  assert.match(s, /iframe\.addEventListener\('error', onError\)/);
  // 로드가 영영 끝나지 않는 경우
  assert.match(s, /if \(__pendingUrl === url\) \{[\s\S]*?clearPending\(\);/);
  // 스테이지 뷰를 못 만든 경우
  assert.match(s, /if \(!iframe\) \{[\s\S]*?clearPending\(\);/);
});

test("스테이지 뷰 생성에 실패해도 클릭이 무반응으로 끝나지 않는다", () => {
  const s = nav();
  // 잠금만 풀고 끝내면 사용자는 여전히 아무 일도 안 일어난 것으로 본다 → 직접 이동
  assert.match(s, /스테이지 뷰 생성 실패[\s\S]{0,200}window\.location\.href = targetName/);
});

test("이미 활성인 nav-item 클릭을 무시하는 규칙은 유지된다", () => {
  // 이 규칙 자체는 정상이다. 다만 활성 판정이 틀리면 안 열리는 것처럼 보이므로
  // 규칙이 남아 있다는 것만 확인해 둔다(회귀 시 원인 후보를 좁히기 위함).
  const s = read("prototype/script.js");
  assert.match(s, /link\.classList\.contains\('nav-item'\) && link\.classList\.contains\('active'\)/);
});
