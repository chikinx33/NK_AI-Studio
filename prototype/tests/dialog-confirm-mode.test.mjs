import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

/**
 * "확인 창인데 취소 버튼이 없고, 확인을 눌러도 아무 일도 안 일어나는" 버그를 막는다.
 *
 * 원인 구조: renderCurrent 가 mode==='alert' 로 그리면 CSS 의 .is-simple 이 붙어
 * 취소가 사라지고 가운데 큰 버튼만 남는다. 그 상태로 닫히면 alert 분기라 resolve()
 * 가 undefined 를 돌려주고, 호출부의 if (!ok) return 이 동작을 조용히 스킵한다.
 */

test("dialog.confirm 은 항상 mode:'confirm' 으로 큐에 넣는다", () => {
  const core = read("prototype/core.js");
  assert.match(core, /dialog\.confirm = function \(message, opts\) \{[\s\S]*?enqueue\('confirm', message/);
  // alert 로 새어나가는 경로가 없어야 한다
  assert.doesNotMatch(core, /dialog\.confirm[\s\S]{0,200}enqueue\('alert'/);
});

test("dialog.confirm 은 boolean 이 아닌 값을 절대 반환하지 않는다", () => {
  const core = read("prototype/core.js");
  assert.match(core, /if \(typeof v === 'boolean'\) return v;/);
  assert.match(core, /boolean 이 아닌 값으로 닫혔다/);
  assert.match(core, /return false;/);
});

test("confirm·prompt 는 취소 버튼을 display 와 hidden 양쪽으로 보장한다", () => {
  const core = read("prototype/core.js");
  assert.match(core, /var wantsCancel = \(mode === 'confirm' \|\| mode === 'prompt'\);/);
  assert.match(core, /refs\.cancel\.style\.display = wantsCancel \? 'inline-flex' : 'none';/);
  // display 를 덮는 CSS 가 있어도 사라지지 않도록 이중 방어
  assert.match(core, /refs\.cancel\.hidden = !wantsCancel;/);
});

test("가운데 큰 버튼 스타일(is-simple)은 alert 에만 붙는다", () => {
  const core = read("prototype/core.js");
  assert.match(core, /var simple = mode === 'alert' && !opts\.copy;/);
  const css = read("prototype/styles.css");
  // 이 세 규칙이 합쳐져 "취소 없이 가운데 큰 버튼" 모습을 만든다
  assert.match(css, /\.nk-dialog-root\.is-simple \.nk-dialog-actions \{[^}]*justify-content: center/);
  assert.match(css, /\.nk-dialog-root\.is-simple #nk-dialog-ok \{/);
});

test("렌더된 모드와 요청 모드가 어긋나면 감지하고, 반환은 요청 모드를 따른다", () => {
  const core = read("prototype/core.js");
  // 그린 모드를 DOM 에 남긴다
  assert.match(core, /refs\.root\.dataset\.mode = mode;/);
  // 닫을 때 대조 + 경고
  assert.match(core, /renderedMode && renderedMode !== mode/);
  assert.match(core, /렌더 모드와 요청 모드가 다르다/);
  // 반환 기준은 큐에 들어간(=호출부가 요청한) 모드다
  assert.match(core, /if \(mode === 'confirm'\) current\.resolve\(!!ok\);/);
});

test("sns-settings 는 confirm 이 boolean 을 못 주면 네이티브로 폴백한다", () => {
  const s = read("prototype/js/ui/sns-settings.js");
  assert.match(s, /if \(typeof ok === 'boolean'\) return ok;/);
  assert.match(s, /네이티브 confirm 폴백/);
  assert.match(s, /return confirm\(msg\);/);
  // 눌렀는데 반응이 없을 때 추적할 로그
  assert.match(s, /연결 해제 확인 결과/);
  assert.match(s, /연결 해제 저장 결과/);
});
