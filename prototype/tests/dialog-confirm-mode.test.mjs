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
  // CSS 가 덮지 못하도록 !important 로 강제한다
  assert.match(core, /setProperty\('display', wantsCancel \? 'inline-flex' : 'none', 'important'\)/);
  assert.match(core, /refs\.cancel\.hidden = !wantsCancel;/);
  // 그래도 안 보이면 그 확인창을 버리고 네이티브로 대체한다
  assert.match(core, /wantsCancel && !isVisible\(refs\.cancel\)/);
  assert.match(core, /네이티브로 대체/);
  assert.match(core, /nativeConfirm\(msg\) : window\.confirm\(msg\)/);
});

test("가운데 큰 버튼 스타일(is-simple)은 alert 에만 붙는다", () => {
  const core = read("prototype/core.js");
  assert.match(core, /var simple = mode === 'alert';/);
  const css = read("prototype/styles.css");
  // 이 세 규칙이 합쳐져 "취소 없이 가운데 큰 버튼" 모습을 만든다
  assert.match(css, /\.nk-dialog-root\.is-simple \.nk-dialog-actions \{[^}]*justify-content: center/);
  assert.match(css, /\.nk-dialog-root\.is-simple #nk-dialog-ok \{/);
});

/**
 * 오류·경고 문구는 그대로 복사해 공유해야 할 때가 많다. 예전에는 호출부가
 * { copy: true } 를 넘겨야만 복사 버튼이 나와서, 정작 긴 서버 오류를 그대로 띄우는
 * alert() 경로에는 복사 수단이 없었다.
 */
test("알림창의 복사 아이콘은 옵션 없이도 항상 보인다", () => {
  const core = read("prototype/core.js");
  // opts.copy 로 노출을 가르지 않는다 (입력창이 주인공인 prompt 만 제외)
  assert.doesNotMatch(core, /refs\.copy\.style\.display = opts\.copy/);
  assert.match(core, /refs\.copy\.style\.display = useInput \? 'none' : 'inline-flex';/);
});

test("복사 버튼은 아이콘이고, 상태가 바뀌어도 폭이 흔들리지 않는다", () => {
  const core = read("prototype/core.js");
  const css = read("prototype/styles.css");
  // 아이콘 버튼이라 textContent 로 라벨을 갈아끼우면 SVG 가 날아간다
  assert.match(core, /id="nk-dialog-copy"[^>]*aria-label="복사"><\/button>/);
  assert.doesNotMatch(core, /refs\.copy\.textContent/);
  assert.match(core, /function setCopyState\(state\)/);
  // 복사됨/복사 실패 라벨은 title·aria-label 로만 바뀐다
  assert.match(core, /var label = state === 'ok' \? '복사됨' : \(state === 'fail' \? '복사 실패' : '복사'\);/);
  // 고정 폭 (상태가 바뀌어도 버튼이 커지거나 줄지 않는다)
  assert.match(css, /\.nk-dialog-copy \{[^}]*min-width: 35px/);
  assert.match(css, /\.nk-dialog-copy\.is-copied \{/);
});

test("큐의 머리를 참조하지 않는다 (낡은 모달이 다시 그려지는 것 차단)", () => {
  const core = read("prototype/core.js");
  // queue[0] 을 렌더하고 닫을 때 다시 queue[0] 을 읽으면, 머리를 한 번이라도 못
  // 치웠을 때 이후 모든 모달이 그 낡은 항목을 계속 다시 그린다.
  // (연결 성공 알림 자리에 지난 '해제 확인창'이 뜨는 증상)
  assert.doesNotMatch(core, /queue\[0\]/);
  // 표시 중인 항목을 별도로 들고 있어야 한다
  assert.match(core, /var showing = null;/);
  // 큐에서 즉시 빼낸다
  assert.match(core, /var item = queue\.shift\(\);\s*\n\s*showing = item;/);
  // 닫을 때는 showing 을 쓰고 비운다
  assert.match(core, /var item = showing;\s*\n\s*showing = null;/);
});

test("표시 중인 항목 없이 close 가 불려도 큐가 멈추지 않는다", () => {
  const core = read("prototype/core.js");
  assert.match(core, /if \(!showing\) \{/);
  assert.match(core, /표시 중인 항목 없이 close 가 호출됐다/);
  // busy 를 풀고 다시 굴려야 이후 모달이 막히지 않는다
  assert.match(core, /if \(busy\) \{ busy = false; flushQueue\(\); \}/);
});

test("다이얼로그는 런타임 로컬라이저의 대상에서 제외된다", () => {
  const core = read("prototype/core.js");
  const common = read("prototype/js/ui/common.js");

  // common.js 의 localizeSubtree 는 요소별로 '첫 텍스트'를 저장해 두고 이후 변경을
  // 그 저장본으로 되돌린다. 제목/메시지는 모든 모달이 재사용하는 단일 노드라,
  // 제외하지 않으면 처음 떴던 모달 문구가 이후 모든 모달을 덮어쓴다.
  assert.match(common, /if \(!el\.hasAttribute\(storeAttr\)\) \{\s*\n\s*el\.setAttribute\(storeAttr, text\);/);
  // 제외 장치가 실제로 동작하는 조건
  assert.match(common, /closest\('\[data-no-i18n\], \[data-i18n-skip\]'\)/);
  assert.match(common, /el\.hasAttribute\('data-i18n-skip'\)[\s\S]{0,200}return;/);

  // 다이얼로그 루트가 그 제외 표시를 단다
  assert.match(core, /root\.setAttribute\('data-i18n-skip', ''\)/);
});

test("다이얼로그 문구는 렌더할 때마다 새로 번역한다 (캐시 없음)", () => {
  const core = read("prototype/core.js");
  assert.match(core, /function localizeOnce\(text\)/);
  assert.match(core, /title = localizeOnce\(title\);/);
  assert.match(core, /message = localizeOnce\(message\);/);
  // 번역 결과를 요소나 맵에 저장하지 않는다
  assert.doesNotMatch(core, /setAttribute\('data-nk-original/);
});

test("렌더된 모드와 요청 모드가 어긋나면 감지하고, 반환은 요청 모드를 따른다", () => {
  const core = read("prototype/core.js");
  // 그린 모드를 DOM 에 남긴다
  assert.match(core, /refs\.root\.dataset\.mode = mode;/);
  // 닫을 때 대조 + 경고
  assert.match(core, /renderedMode && renderedMode !== mode/);
  assert.match(core, /렌더 모드와 요청 모드가 다르다/);
  // 반환 기준은 큐에 들어간(=호출부가 요청한) 모드다
  assert.match(core, /if \(mode === 'confirm'\) item\.resolve\(!!ok\);/);
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
