import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

/**
 * ★회귀: 프로덕션 페이지를 열면 컷 이미지 자리에 깨진 이미지 아이콘이 깜박이다가
 * 뒤늦게 진짜 이미지가 떴다.
 *
 * 원인은 로딩 신뢰성 장치 자신이었다. 1초마다 도는 스윕이 "아직 안 뜬" 이미지를 전부
 * 재시도 대상으로 보고, 재시도를 이렇게 했다:
 *     img.removeAttribute('src');  →  250ms 뒤  img.setAttribute('src', base)
 * 아직 받는 중인 이미지까지 요청이 취소되고, src 가 비는 순간 깨진 아이콘이 노출된다.
 * 다시 받기 시작하면 또 1초를 넘겨 같은 일이 반복 — 그게 "깜박임"이었다.
 */

const loader = () => {
  const src = read("prototype/ui/pipeline-media.js");
  const start = src.indexOf("// ── 미디어 로딩 신뢰성 ─");
  assert.ok(start > -1, "미디어 로더 블록이 있어야 한다");
  return src.slice(start);
};

test("★재시도가 보이는 이미지의 src 를 비우지 않는다", () => {
  const src = loader();
  assert.doesNotMatch(
    src,
    /removeAttribute\('src'\)/,
    "src 를 비우면 그 순간 깨진 아이콘이 노출되고 진행 중이던 요청도 취소된다"
  );
  // 대신 화면 밖 프리로더로 받아서, 성공한 순간에만 교체한다.
  const reload = src.slice(src.indexOf("function reloadImg(img, attempt)"), src.indexOf("function retryImg(img)"));
  assert.match(reload, /var pre = new Image\(\);/);
  assert.match(reload, /pre\.onload = function \(\) \{[\s\S]*?setAttribute\('src', url\)/);
  // 실패해도 보이는 이미지는 그대로 둔다.
  assert.match(reload, /pre\.onerror/);
  assert.doesNotMatch(reload, /pre\.onerror = function \(\) \{[\s\S]{0,120}img\.setAttribute\('src'/);
});

test("★받는 중인 이미지는 건드리지 않는다", () => {
  const src = loader();
  const sweep = src.slice(src.indexOf("function sweep()"), src.indexOf("function markCompleted()"));
  // 실패(complete && naturalWidth 0) 또는 오래 멈춘 경우에만 재시도한다.
  assert.match(sweep, /var failed = img\.complete && img\.naturalWidth === 0;/);
  assert.match(sweep, /var stalled = !img\.complete && ticks >= STALL_TICKS;/);
  assert.match(sweep, /if \(\(failed \|\| stalled\)/);
  // 예전처럼 "1틱 지났으면 무조건 강제" 하지 않는다.
  assert.doesNotMatch(sweep, /\(failed \|\| ticks >= 1\)/);
  // lazy 대기 중이면 src 는 그대로 두고 즉시 로드만 풀어 준다.
  assert.match(sweep, /getAttribute\('loading'\) === 'lazy'\) img\.removeAttribute\('loading'\)/);
});

test("★실패 응답이 캐시돼 재시도가 막히지 않는다", () => {
  const src = loader();
  const fn = src.slice(src.indexOf("function retryUrl(base, attempt)"), src.indexOf("function reloadImg"));
  assert.match(fn, /if \(!attempt\) return base;/, "첫 요청은 그대로 둬 정상 캐시를 살린다");
  assert.match(fn, /_nkr=/);
});

test("★로드되면 표시가 붙고, 캐시된 이미지는 즉시 표시된다", () => {
  const src = loader();
  assert.match(src, /function markLoaded\(img\)[\s\S]{0,200}classList\.add\('is-loaded'\)/);
  // 자연 로드도 잡는다(capture — load 는 버블되지 않는다)
  assert.match(src, /addEventListener\('load', function \(e\)[\s\S]{0,320}\}, true\)/);
  // 캐시로 이미 완료된 이미지는 1초 스윕을 기다리지 않는다
  assert.match(src, /function markCompleted\(\)/);
  assert.match(src, /new MutationObserver\(markSoon\)/);
  assert.match(src, /requestAnimationFrame\(run\)/);
});

test("★도착 전에는 빈 판, 도착하면 부드럽게 떠오른다", () => {
  const css = read("prototype/styles.css");
  const block = css.slice(
    css.indexOf(".scene-img,\n.shot-img {"),
    css.indexOf("@media (prefers-reduced-motion: reduce) {", css.indexOf(".scene-img,\n.shot-img {"))
  );
  // alt 텍스트·깨진 아이콘이 스치지 않도록
  assert.match(block, /color: transparent;/);
  assert.match(block, /opacity: 0;/);
  assert.match(block, /transition: opacity/);
  assert.match(css, /\.scene-img\.is-loaded,\n\.shot-img\.is-loaded \{\s*opacity: 1;/);
});

test("★세부 배경 묘사는 씬에서 다시 추출해도 남는다", () => {
  const src = read("prototype/ui/pipeline.js");
  const fn = src.slice(src.indexOf("async function reextract()"), src.indexOf("function doSave()"));
  assert.match(fn, /variants:[\s\S]{0,220}description: v\.description \|\| ''/);
});
