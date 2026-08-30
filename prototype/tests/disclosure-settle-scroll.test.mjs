import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

/**
 * 펼친 뒤 화면을 맞춰 주는 "안착 스크롤".
 *
 * 예전에는 scrollTop 에 델타를 그냥 더해 한 프레임에 점프했다. 펼침은 부드러운데
 * 화면만 툭 튀어서 눈이 따라가기 힘들었다. 이제 시작은 빠르고 끝은 천천히 멈추는
 * 슬로우 아웃 트윈으로 움직이고, 사용자가 조작하면 즉시 손을 뗀다.
 */

// 실제 코드에서 함수 본문을 떼어 와 그대로 실행한다 (동작을 흉내 내지 않는다).
function loadScrollByEased(window, document) {
  const src = read("prototype/js/ui/common.js");
  const pick = (signature, tail = "\n    }") => {
    const start = src.indexOf(signature);
    assert.ok(start > -1, `${signature} 가 있어야 한다`);
    return src.slice(start, src.indexOf(tail, start) + tail.length);
  };
  const pickLine = (signature) => {
    const start = src.indexOf(signature);
    assert.ok(start > -1, `${signature} 가 있어야 한다`);
    return src.slice(start, src.indexOf("\n", start));
  };
  const factory = new Function(
    "window",
    "document",
    `
    var common = {};
    ${pickLine("var SCROLL_EASE_MIN_MS =")}
    ${pickLine("var SCROLL_EASE_MAX_MS =")}
    ${pickLine("var SCROLL_CANCEL_EVENTS =")}
    ${pick("function prefersReducedMotion() {")}
    ${pick("function easeOutQuint(t) {")}
    ${pick("function isPageScroller(scroller) {")}
    ${pick("function readScrollTop(scroller) {")}
    ${pick("function writeScrollTop(scroller, value) {")}
    ${pick("    common.scrollByEased = function (scroller, delta, options) {", "\n    };")}
    return common.scrollByEased;
  `
  );
  return factory(window, document);
}

function makeEnv({ reducedMotion = false } = {}) {
  const frames = [];
  const listeners = {};
  const window = {
    matchMedia: () => ({ matches: reducedMotion }),
    requestAnimationFrame: (fn) => {
      frames.push(fn);
      return frames.length;
    },
    cancelAnimationFrame: (id) => {
      frames[id - 1] = null;
    },
    addEventListener: (type, fn) => {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener: (type, fn) => {
      const list = listeners[type] || [];
      const at = list.indexOf(fn);
      if (at > -1) list.splice(at, 1);
    },
    scrollTo: () => {},
    pageYOffset: 0,
  };
  const document = { body: {}, documentElement: {}, scrollingElement: {} };
  return {
    window,
    document,
    // 프레임을 원하는 시각으로 직접 돌린다 (실시간 대기 없이 이징 곡선을 잰다).
    tick(now) {
      const pending = frames.splice(0, frames.length);
      pending.forEach((fn) => fn && fn(now));
    },
    fire(type) {
      (listeners[type] || []).slice().forEach((fn) => fn({ type }));
    },
    listenerCount: (type) => (listeners[type] || []).length,
    pendingFrames: () => frames.filter(Boolean).length,
  };
}

const makeScroller = (top = 0) => ({ scrollTop: top });

test("★안착 스크롤은 시작이 빠르고 끝이 느리다 (슬로우 아웃)", () => {
  const env = makeEnv();
  const scrollByEased = loadScrollByEased(env.window, env.document);
  const scroller = makeScroller(0);

  scrollByEased(scroller, 400);
  env.tick(0);
  const startTop = scroller.scrollTop;

  // 절반 시점에 이미 절반을 훌쩍 넘겨 두고, 남은 절반을 천천히 좁힌다.
  env.tick(200);
  const halfway = scroller.scrollTop;
  assert.ok(halfway > 200, `절반 시점에 ${halfway}px — 등속(200px)보다 앞서 있어야 한다`);

  env.tick(400);
  const late = scroller.scrollTop;
  assert.ok(late > halfway, "계속 나아간다");
  assert.ok(late - halfway < halfway - startTop, "뒤로 갈수록 이동량이 줄어든다 (감속)");

  env.tick(10000);
  assert.equal(Math.round(scroller.scrollTop), 400, "목적지에 정확히 안착한다");
  assert.equal(env.pendingFrames(), 0, "끝나면 프레임을 더 잡지 않는다");
});

test("★사용자가 스크롤·클릭하면 즉시 손을 뗀다", () => {
  const env = makeEnv();
  const scrollByEased = loadScrollByEased(env.window, env.document);
  const scroller = makeScroller(0);

  scrollByEased(scroller, 400);
  env.tick(0);
  env.tick(100);
  const interrupted = scroller.scrollTop;

  env.fire("wheel");
  env.tick(300);
  assert.equal(scroller.scrollTop, interrupted, "휠을 굴린 뒤에는 더 끌고 가지 않는다");
  assert.equal(env.listenerCount("wheel"), 0, "리스너를 정리한다");
  assert.equal(env.listenerCount("pointerdown"), 0);
});

test("★새 목적지가 진행 중이던 스크롤을 대신한다", () => {
  const env = makeEnv();
  const scrollByEased = loadScrollByEased(env.window, env.document);
  const scroller = makeScroller(0);

  scrollByEased(scroller, 400);
  env.tick(0);
  env.tick(100);
  scrollByEased(scroller, 120);
  env.tick(0);
  env.tick(10000);

  const settled = scroller.scrollTop;
  assert.ok(settled > 0);
  assert.ok(settled < 400 + 120, "두 스크롤이 겹쳐 목적지를 지나치지 않는다");
});

test("★모션을 줄이는 설정에서는 예전처럼 즉시 이동한다", () => {
  const env = makeEnv({ reducedMotion: true });
  const scrollByEased = loadScrollByEased(env.window, env.document);
  const scroller = makeScroller(50);

  scrollByEased(scroller, 400);
  assert.equal(scroller.scrollTop, 450);
  assert.equal(env.pendingFrames(), 0, "애니메이션 프레임을 잡지 않는다");
});

test("★이동량이 0이면 아무것도 하지 않는다", () => {
  const env = makeEnv();
  const scrollByEased = loadScrollByEased(env.window, env.document);
  const scroller = makeScroller(30);

  scrollByEased(scroller, 0);
  assert.equal(scroller.scrollTop, 30);
  assert.equal(env.pendingFrames(), 0);
});

test("★펼침 후 안착 스크롤이 이 트윈을 쓴다 (브랜드 허브·스튜디오 모두)", () => {
  ["prototype/js/ui/knowledge-hub.js", "prototype/js/ui/brand-studio.js"].forEach((file) => {
    const src = read(file);
    const start = src.indexOf("if (!targetDelta) return;");
    assert.ok(start > -1, `${file} 에 안착 스크롤이 있어야 한다`);
    const block = src.slice(start, start + 700);
    assert.match(block, /NK\.ui\.common\.scrollByEased\(scroller, targetDelta\)/, file);
  });
});
