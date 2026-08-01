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
  assert.match(s, /var dis = isToggling \? ' disabled' : '';/);
  // 처리 종료 시 반드시 해제 + 재렌더
  assert.match(s, /delete _togglingPlatforms\[pid\];/);
});

test("연결과 해제는 서로 다른 버튼이다 (겸용 토글 금지)", () => {
  const s = src();
  // 겸용 토글은 "연결하려는데 해제 확인창"을 구조적으로 허용한다 → 없어야 한다
  assert.doesNotMatch(s, /data-action="sns-connect-toggle"/);
  assert.doesNotMatch(s, /action === 'sns-connect-toggle'/);
  // 연결 버튼은 확인창 없이 곧바로 OAuth 만 시작한다
  assert.match(s, /if \(action === 'sns-connect'\) \{[\s\S]*?startOAuth\(cpid\);/);
  // 해제 버튼은 연결된 상태에서만 그려진다
  assert.match(s, /data-action="sns-disconnect"/);
  assert.match(s, /if \(action === 'sns-disconnect'\)/);
  // 미연결인데 해제 요청이 오면 무시하고 흔적을 남긴다
  assert.match(s, /미연결 상태에서 해제 요청/);
});

test("해제 저장이 실패하면 화면을 연결됨으로 되돌린다", () => {
  const s = src();
  // 롤백 스냅샷을 뜬다
  assert.match(s, /var prev = Object\.assign\(\{\}, s\);/);
  assert.match(s, /if \(!res \|\| !res\.ok\) \{[\s\S]*?_settings\.sns\[pid\] = prev;/);
  // 사용자에게도 알린다 (조용히 되돌리면 왜 다시 연결됐는지 알 수 없다)
  assert.match(s, /The channel is still connected|계속 연결된 상태/);
});

test("언어 전환 시 이 화면의 사전으로 다시 그린다", () => {
  const s = src();
  // 구독하지 않으면 common.js 의 범용 ko→en 치환 사전이 남긴 옛 문구가 그대로 남아
  // 한국어는 최신인데 영어만 예전 표현이 되는 상태가 된다.
  assert.match(s, /window\.addEventListener\('nk:lang-changed'/);
  assert.match(s, /render\(\);/);
  // 같은 언어로 재진입해 무한 렌더가 도는 것을 막는다
  assert.match(s, /__snsSettingsLastLang === newLang\) return;/);
  // 리스너 중복 등록 방지
  assert.match(s, /__snsSettingsLangBound/);
});

test("화면 문구는 자기 사전(T)에서 나온다 — ko/en 키가 짝을 이룬다", () => {
  const s = src();
  const block = s.slice(s.indexOf("var T = {"), s.indexOf("function _lang"));
  const ko = block.slice(block.indexOf("ko: {"), block.indexOf("en: {"));
  const en = block.slice(block.indexOf("en: {"));
  const keysOf = (chunk) =>
    new Set([...chunk.matchAll(/^\s{6}([a-zA-Z]+):/gm)].map((m) => m[1]));
  const koKeys = keysOf(ko);
  const enKeys = keysOf(en);
  assert.ok(koKeys.size > 10, `ko 키 수집 실패 (${koKeys.size})`);
  const missing = [...koKeys].filter((k) => !enKeys.has(k));
  assert.deepEqual(missing, [], `en 사전에 빠진 키: ${missing.join(", ")}`);
});

test("화면과 상태가 갈라지면 콘솔 경고를 남긴다", () => {
  const s = src();
  assert.match(s, /function warnIfConnectStateDrifted/);
  // 미연결인데 해제 버튼이 있거나, 연결됨인데 연결 버튼이 있으면 경고
  assert.match(s, /미연결인데 해제 버튼이 있다/);
  assert.match(s, /연결됨인데 연결 버튼이 있다/);
  // render() 안에서 실제로 호출돼야 의미가 있다.
  // (buildPlatformCard 는 render 보다 앞에 정의돼 있어 경계로 쓸 수 없다 —
  //  render 다음에 오는 최상위 함수 선언까지를 본문으로 잘라낸다)
  const start = s.indexOf("function render() {");
  assert.ok(start > 0, "render() 를 찾지 못했다");
  const after = s.indexOf("\n  function ", start + 1);
  const render = s.slice(start, after > 0 ? after : s.length);
  assert.match(render, /warnIfConnectStateDrifted\(root\)/);
});
