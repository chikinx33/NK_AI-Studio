import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");
const pipeline = () => read("prototype/ui/pipeline.js");

/**
 * 에피소드 레퍼런스(배경·소품) 모달의 한/영 대응.
 *
 * 이 모달은 한국어로만 쓰여 있었다. 영어 화면에서는 제목·안내·버튼·알림이 전부 한국어로 남아
 * 반쪽짜리였다. 사전(BGREF_TEXT)에 ko/en 짝을 두고, 열려 있는 동안 언어를 바꿔도
 * nk:lang-changed 로 다시 그린다.
 */

const dictBlock = () => {
  const src = pipeline();
  const start = src.indexOf("var BGREF_TEXT = {");
  assert.ok(start > -1, "모달 문구 사전이 있어야 한다");
  return src.slice(start, src.indexOf("function T() {", start));
};

const modalBody = () => {
  const src = pipeline();
  const start = src.indexOf("  function render() {", src.indexOf("var BGREF_TEXT = {"));
  assert.ok(start > -1, "모달 렌더 함수를 찾아야 한다");
  // 모달 함수는 마지막에 render() 를 한 번 부르고 닫힌다 — 거기까지만 본다.
  const end = src.indexOf(["", "  render();", "}"].join("\n"), start);
  assert.ok(end > start, "모달 함수의 끝을 찾아야 한다");
  return src.slice(start, end);
};

test("★한/영 사전이 같은 키를 갖는다", () => {
  const dict = dictBlock();
  const koBlock = dict.slice(dict.indexOf("ko: {"), dict.indexOf("en: {"));
  const enBlock = dict.slice(dict.indexOf("en: {"));
  const keysOf = (block) => (block.match(/^\s{6}([a-zA-Z]+):/gm) || []).map((m) => m.trim());
  const koKeys = keysOf(koBlock);
  const enKeys = keysOf(enBlock);
  assert.ok(koKeys.length > 30, "문구가 사전으로 모여 있어야 한다");
  assert.deepEqual(koKeys, enKeys, "한쪽 언어만 채워두면 안 된다");
});

test("★모달 본문에 한국어 리터럴이 남아 있지 않다", () => {
  // 사전 밖에 하드코딩된 한국어가 남으면 영어 화면에서 그 부분만 한국어로 보인다.
  const body = modalBody();
  const leftovers = body
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .filter((line) => /[가-힣]/.test(line));
  assert.deepEqual(leftovers, [], "사전으로 옮기지 않은 문구가 있다");
});

test("★알림 문구도 사전을 쓴다", () => {
  const src = pipeline();
  const modal = src.slice(src.indexOf("var BGREF_TEXT = {"));
  // alert('한국어...') 형태가 남아 있으면 안 된다.
  const hardcoded = modal.match(/alert\('[^']*[가-힣][^']*'/g) || [];
  assert.deepEqual(hardcoded, []);
  // 대표적인 몇 가지가 사전을 통해 나간다.
  assert.match(modal, /alert\(T\(\)\.needBasePlate\)/);
  assert.match(modal, /alert\(T\(\)\.pasteNeedSlotHint\)/);
  assert.match(modal, /alert\(T\(\)\.failProp \+ /);
});

test("★언어를 따라가고, 열린 채 바꿔도 다시 그린다", () => {
  const src = pipeline();
  assert.match(src, /NK\.state && NK\.state\.runtime && NK\.state\.runtime\.lang\) === 'en' \? 'en' : 'ko';\s*\n\s*return BGREF_TEXT\[lang\];/);
  assert.match(src, /window\.addEventListener\('nk:lang-changed', onLangChanged\)/);
  // 다시 그리기 전에 입력값을 먼저 거둬 둬야 타이핑이 날아가지 않는다.
  assert.match(src, /var onLangChanged = function \(\) \{\s*\n\s*try \{ syncFromInputs\(\); \}/);
  // 모달을 닫을 때 리스너도 걷는다.
  assert.match(src, /window\.removeEventListener\('nk:lang-changed', onLangChanged\)/);
});

test("★영문 문구가 실제 동작을 설명한다 (직역 나열이 아니라)", () => {
  const dict = dictBlock();
  const en = dict.slice(dict.indexOf("en: {"));
  // 드롭 존은 세 가지 등록 경로를 모두 알려준다.
  assert.match(en, /Drag an image here, click to pick a file, or click this slot and press Ctrl\+V/);
  // 소품 이름은 씬 표기와 같아야 매칭된다는 점을 짚는다.
  assert.match(en, /match how it is written in the scene text/);
  // 배경 플레이트가 무엇인지 설명한다.
  assert.match(en, /an empty background with no characters/);
});
