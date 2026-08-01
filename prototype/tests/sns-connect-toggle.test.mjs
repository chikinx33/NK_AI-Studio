import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const src = () => read("prototype/js/ui/sns-settings.js");

/**
 * "연결 해제 직후 다시 연결을 누르면 Disconnect 확인창이 뜨는" 버그를 막는다.
 *
 * 원인은 화면과 _settings 가 갈라진 것이었다. 클릭 분기는 _settings 를 보는데,
 * 저장이 실패하거나 조용히 무시되면 화면만 '연결 안됨'으로 바뀌고 _settings 는
 * connected 로 되돌아온다.
 */

test("저장이 진행 중이어도 요청을 버리지 않는다", () => {
  const s = src();
  // 예전엔 진행 중이면 그냥 무시해서(return Promise.resolve()) 연결 해제가
  // 서버에 반영되지 않은 채 화면만 바뀌었다.
  assert.doesNotMatch(s, /if \(_saving\) return Promise\.resolve\(\);/);
  // 대신 이전 저장 뒤로 직렬화한다
  assert.match(s, /_savePromise = \(_savePromise \|\| Promise\.resolve\(\)\)\.then\(_doSave, _doSave\)/);
});

test("saveSettings 는 성공 여부를 반환한다 (호출부가 롤백을 판단할 수 있게)", () => {
  const s = src();
  assert.match(s, /return \{ ok: true \};/);
  assert.match(s, /return \{ ok: false, error: msg \};/);
});

test("해제 처리 중에는 버튼이 잠기고 재클릭이 무시된다", () => {
  const s = src();
  assert.match(s, /if \(_togglingPlatforms\[pid\]\) return;/);
  assert.match(s, /_togglingPlatforms\[pid\] = true;/);
  // 렌더도 잠금을 반영해야 화면상 다시 눌리지 않는다
  assert.match(s, /var isToggling = !!_togglingPlatforms\[platform\.id\];/);
  assert.match(s, /\(isToggling \? 'disabled ' : ''\)/);
  // 처리 종료 시 반드시 해제 + 재렌더
  assert.match(s, /delete _togglingPlatforms\[pid\];/);
});

test("해제 저장이 실패하면 화면을 연결됨으로 되돌린다", () => {
  const s = src();
  // 롤백 스냅샷을 뜬다
  assert.match(s, /var prev = Object\.assign\(\{\}, s\);/);
  assert.match(s, /if \(!res \|\| !res\.ok\) \{[\s\S]*?_settings\.sns\[pid\] = prev;/);
  // 사용자에게도 알린다 (조용히 되돌리면 왜 다시 연결됐는지 알 수 없다)
  assert.match(s, /The channel is still connected|계속 연결된 상태/);
});

test("화면과 상태가 갈라지면 콘솔 경고를 남긴다", () => {
  const s = src();
  assert.match(s, /function warnIfConnectStateDrifted/);
  assert.match(s, /aria-pressed'\) === 'true'/);
  assert.match(s, /화면\/상태 불일치/);
  // render() 안에서 실제로 호출돼야 의미가 있다.
  // (buildPlatformCard 는 render 보다 앞에 정의돼 있어 경계로 쓸 수 없다 —
  //  render 다음에 오는 최상위 함수 선언까지를 본문으로 잘라낸다)
  const start = s.indexOf("function render() {");
  assert.ok(start > 0, "render() 를 찾지 못했다");
  const after = s.indexOf("\n  function ", start + 1);
  const render = s.slice(start, after > 0 ? after : s.length);
  assert.match(render, /warnIfConnectStateDrifted\(root\)/);
});
