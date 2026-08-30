import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

/**
 * 브랜드 허브의 접이식 섹션(캐릭터 자산 등)이 펼쳐질 때의 연출.
 *
 * 예전에는 CSS grid-template-rows 0fr→1fr 에만 기댔는데, 닫힌 <details> 의 내용을
 * 렌더하지 않는 브라우저에서는 시작 프레임이 없어 그냥 툭 펼쳐졌다. 닫힘은 네이티브가
 * 내용을 즉시 감춰버려 아예 애니메이션이 없었다.
 * 이제 common.js 가 여닫는 동안 높이를 직접 잡는다.
 */

// 실제 코드에서 함수 본문을 떼어 와 그대로 실행한다 (동작을 흉내 내지 않는다).
function loadBindDisclosureMotion() {
  const src = read("prototype/js/ui/common.js");
  const pick = (signature) => {
    const start = src.indexOf(signature);
    assert.ok(start > -1, `${signature} 가 있어야 한다`);
    const end = src.indexOf("\n    }", start) + "\n    }".length;
    return src.slice(start, end);
  };
  const pickLine = (signature) => {
    const start = src.indexOf(signature);
    assert.ok(start > -1, `${signature} 가 있어야 한다`);
    return src.slice(start, src.indexOf("\n", start));
  };
  const bindStart = src.indexOf("    common.bindDisclosureMotion = function (root) {");
  assert.ok(bindStart > -1);
  const bindEnd = src.indexOf("\n    };", bindStart) + "\n    };".length;

  const factory = new Function(
    "window",
    "document",
    `
    var common = {};
    ${pickLine("var DISCLOSURE_MOTION_MS =")}
    ${pickLine("var DISCLOSURE_REVEAL_MS =")}
    ${pick("function prefersReducedMotion() {")}
    ${pick("function getDisclosureBody(details) {")}
    ${pick("function getDisclosureInner(body) {")}
    ${pick("function clearDisclosureMotionStyles(body) {")}
    ${pick("function runDisclosureMotion(details, body, fromHeight, toHeight, onDone) {")}
    ${src.slice(bindStart, bindEnd)}
    return { bind: common.bindDisclosureMotion, motionMs: DISCLOSURE_MOTION_MS, revealMs: DISCLOSURE_REVEAL_MS };
  `
  );
  return factory;
}

// ── 최소 DOM ────────────────────────────────────────────────
class ClassList {
  constructor() {
    this.set = new Set();
  }
  add(name) {
    this.set.add(name);
  }
  remove(name) {
    this.set.delete(name);
  }
  contains(name) {
    return this.set.has(name);
  }
}

class El {
  constructor(tag, className) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.style = {};
    this.classList = new ClassList();
    this.listeners = {};
    this.open = false;
    this.height = 0;
  }
  get firstChild() {
    return this.children[0] || null;
  }
  set className(value) {
    String(value || "")
      .split(/\s+/)
      .filter(Boolean)
      .forEach((name) => this.classList.add(name));
  }
  get className() {
    return Array.from(this.classList.set).join(" ");
  }
  appendChild(child) {
    if (child.parentNode) {
      const at = child.parentNode.children.indexOf(child);
      if (at > -1) child.parentNode.children.splice(at, 1);
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this.listeners[type] || [];
    const at = list.indexOf(fn);
    if (at > -1) list.splice(at, 1);
  }
  dispatchEvent(evt) {
    (this.listeners[evt.type] || []).slice().forEach((fn) => fn(evt));
  }
  get offsetHeight() {
    // 애니메이션 중에는 인라인 높이가 곧 보이는 높이다.
    if (this.style.height) return parseFloat(this.style.height) || 0;
    if (this.height) return this.height;
    return this.children.reduce((sum, child) => sum + child.offsetHeight, 0);
  }
}

function buildDisclosure({ bodyClass = "knowledge-hub-disclosure-body", contentHeight = 240 } = {}) {
  const details = new El("details");
  const summary = new El("summary");
  const body = new El("div");
  body.classList.add(bodyClass);
  const content = new El("section");
  content.height = contentHeight;
  body.appendChild(content);
  details.appendChild(summary);
  details.appendChild(body);
  return { details, summary, body, content };
}

function makeEnv({ reducedMotion = false } = {}) {
  const timers = [];
  const window = {
    matchMedia: () => ({ matches: reducedMotion }),
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: (id) => {
      if (timers[id - 1]) timers[id - 1].cancelled = true;
    },
    CustomEvent: class {
      constructor(type) {
        this.type = type;
      }
    },
  };
  const document = { createElement: (tag) => new El(tag) };
  return { window, document, runTimers: () => timers.forEach((t) => !t.cancelled && t.fn()) };
}

function bindOne(parts, env) {
  const { window, document } = env;
  const api = loadBindDisclosureMotion()(window, document);
  api.bind({ querySelectorAll: () => [parts.details] });
  return api;
}

const heightTransitionEnd = (body) => ({ type: "transitionend", target: body, propertyName: "height" });

test("★펼칠 때 0에서 실제 높이로 애니메이션한다", () => {
  const parts = buildDisclosure({ contentHeight: 240 });
  const env = makeEnv();
  bindOne(parts, env);

  parts.details.open = true;
  parts.details.dispatchEvent({ type: "toggle" });

  assert.equal(parts.body.style.height, "240px", "목표 높이까지 편다");
  assert.equal(parts.body.style.opacity, "1");
  assert.match(parts.body.style.transition, /height 3\d\dms/);
  assert.ok(parts.details.classList.contains("is-disclosure-revealing"), "행 순차 등장 연출도 켠다");

  // 전환이 끝나면 인라인 높이를 걷어내 내용 변화에 높이가 따라가게 둔다.
  parts.body.dispatchEvent(heightTransitionEnd(parts.body));
  assert.equal(parts.body.style.height, "");
  assert.equal(parts.body.style.transition, "");
});

test("★접을 때는 기본 동작을 막고 접히는 동안 열린 상태를 유지한다", () => {
  const parts = buildDisclosure({ contentHeight: 240 });
  const env = makeEnv();
  bindOne(parts, env);

  parts.details.open = true;
  parts.details.dispatchEvent({ type: "toggle" });
  parts.body.dispatchEvent(heightTransitionEnd(parts.body));

  let prevented = false;
  parts.summary.dispatchEvent({ type: "click", preventDefault: () => { prevented = true; } });

  assert.ok(prevented, "네이티브가 즉시 감추면 접히는 모습을 보여줄 수 없다");
  assert.equal(parts.details.open, true, "애니메이션 동안에는 열린 채로 둔다");
  assert.equal(parts.body.style.height, "0px");
  assert.equal(parts.body.style.opacity, "0");

  parts.body.dispatchEvent(heightTransitionEnd(parts.body));
  assert.equal(parts.details.open, false, "다 접힌 뒤에 실제로 닫는다");
  assert.equal(parts.body.style.height, "");
});

test("★접히는 중 다시 눌러도 상태가 꼬이지 않는다", () => {
  const parts = buildDisclosure();
  const env = makeEnv();
  bindOne(parts, env);

  parts.details.open = true;
  parts.details.dispatchEvent({ type: "toggle" });
  parts.body.dispatchEvent(heightTransitionEnd(parts.body));
  parts.summary.dispatchEvent({ type: "click", preventDefault: () => {} });

  let prevented = false;
  parts.summary.dispatchEvent({ type: "click", preventDefault: () => { prevented = true; } });
  assert.ok(prevented, "접히는 중 클릭은 삼킨다");

  parts.body.dispatchEvent(heightTransitionEnd(parts.body));
  assert.equal(parts.details.open, false);
});

test("★모션을 줄이는 설정에서는 애니메이션 없이 즉시 여닫는다", () => {
  const parts = buildDisclosure();
  const env = makeEnv({ reducedMotion: true });
  bindOne(parts, env);

  parts.details.open = true;
  parts.details.dispatchEvent({ type: "toggle" });
  assert.equal(parts.body.style.height, undefined, "높이를 건드리지 않는다");

  let prevented = false;
  parts.summary.dispatchEvent({ type: "click", preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false, "네이티브 닫기를 그대로 쓴다");
});

test("★다시 그린 뒤 열림 상태 복원은 연출을 재생하지 않는다", () => {
  const parts = buildDisclosure();
  const env = makeEnv();
  bindOne(parts, env);

  // restoreDisclosureOpenState 가 표시해 두는 플래그.
  parts.details.__nkSuppressMotion = true;
  parts.details.open = true;
  parts.details.dispatchEvent({ type: "toggle" });

  assert.equal(parts.body.style.height, undefined);
  assert.equal(parts.details.classList.contains("is-disclosure-revealing"), false);

  // 다음 사용자 토글은 정상적으로 연출된다.
  parts.details.dispatchEvent({ type: "toggle" });
  assert.equal(parts.body.style.height, "240px");
});

test("★재렌더 복원 경로가 실제로 플래그를 세운다", () => {
  const hub = read("prototype/js/ui/knowledge-hub.js");
  const restore = hub.slice(
    hub.indexOf("function restoreDisclosureOpenState(root, state) {"),
    hub.indexOf("function captureActiveFieldState(root) {")
  );
  assert.match(restore, /__nkSuppressMotion = true/);

  const propsRestore = hub.slice(
    hub.indexOf("function restoreCharacterPropsDisclosureState(box, state) {"),
    hub.indexOf("function captureModalActiveFieldState(box) {")
  );
  assert.match(propsRestore, /__nkSuppressMotion = true/);
});

test("★행이 순차로 떠오르는 CSS 연출이 있다", () => {
  const css = read("prototype/styles.css");
  assert.match(css, /@keyframes nk-disclosure-rise \{[\s\S]*?transform: translateY\(/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?\.is-disclosure-revealing/);
  assert.match(
    css,
    /\.is-disclosure-revealing \.knowledge-character-chips > \.knowledge-character-row:nth-child\(1\)/
  );
});
