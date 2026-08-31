import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

/**
 * UI 문구는 한국어와 영어를 "함께" 만든다. 한쪽만 만들고 나머지를 나중으로 미루면
 * 반대 언어 사용자에게는 그대로 결함으로 보인다.
 *
 * 실제로 TikTok 확인 모달을 영어 전용으로 만들어, 한국어 모드에서도 영어가 그대로
 * 노출됐다. 심사 문구를 고정해야 한다는 이유였지만, 그건 영어를 "바꾸지 말라"는
 * 뜻이지 한국어를 "만들지 말라"는 뜻이 아니었다.
 *
 * 규칙: 언어 사전을 가진 UI 모듈은 ko/en 키가 정확히 짝을 이뤄야 한다.
 * 새 모듈을 만들면 아래 목록에 추가할 것.
 */

// [파일, 사전 시작 표식, 사전 끝 표식]
const DICTIONARIES = [
  ["prototype/js/ui/sns-settings.js", "var T = {", "\n  function _lang"],
  ["prototype/js/ui/format-media-spec.js", "var LOCK_TEXT = {", "\n  function lockLabel"],
  ["prototype/js/ui/format-media-spec.js", "var DELIVERY_TEXT = {", "\n  function deliveryText"],
  ["prototype/js/ui/format-media-spec.js", "var CHANNEL_LABEL = {", "\n  /** 라벨이 없으면"],
];

/** `{` 위치부터 짝이 맞는 `}` 까지의 본문을 돌려준다. */
function objectBodyAt(src, braceAt) {
  let depth = 0;
  let i = braceAt;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(braceAt + 1, i);
}

/**
 * 객체 본문에서 최상위 키 이름만 뽑는다(중첩 객체·함수 본문 안쪽은 세지 않는다).
 *
 * 줄 단위로 훑으면 `a: 1, b: 2` 처럼 한 줄에 여러 키가 있을 때 첫 개만 잡힌다.
 * 실제 사전이 그렇게 쓰여 있어서 문자 단위로 훑는다.
 * 괄호도 깊이에 포함시켜 `n === 1 ? x : y` 같은 삼항 연산자를 키로 오인하지 않는다.
 */
function topLevelKeys(body) {
  // 'no-asset' 처럼 따옴표로 감싼 키도 인식한다
  const KEY_RE = /(['"]?)([A-Za-z_][A-Za-z0-9_-]*)\1\s*:/y;
  const keys = new Set();
  let depth = 0;
  let quote = null;
  for (let i = 0; i < body.length; ) {
    const ch = body[i];
    if (quote) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    // 따옴표 처리보다 먼저 본다 — 'no-asset' 같은 키가 문자열로 삼켜지면 안 된다
    if (depth === 0 && !/[A-Za-z0-9_$.]/.test(i > 0 ? body[i - 1] : ",")) {
      KEY_RE.lastIndex = i;
      const m = KEY_RE.exec(body);
      if (m) { keys.add(m[2]); i = KEY_RE.lastIndex; continue; }
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; i++; continue; }
    if (ch === "{" || ch === "(" || ch === "[") { depth++; i++; continue; }
    if (ch === "}" || ch === ")" || ch === "]") { depth--; i++; continue; }
    i++;
  }
  return keys;
}

/** `ko: {` / `en: {` 블록에서 최상위 키 이름을 뽑는다. */
function keysByLang(block) {
  const out = {};
  for (const lang of ["ko", "en"]) {
    const start = block.indexOf(`${lang}: {`);
    if (start < 0) continue;
    out[lang] = topLevelKeys(objectBodyAt(block, block.indexOf("{", start)));
  }
  return out;
}

for (const [file, startMark, endMark] of DICTIONARIES) {
  test(`${path.basename(file)} — ${startMark.trim()} 의 ko/en 키가 짝을 이룬다`, () => {
    const src = read(file);
    const s = src.indexOf(startMark);
    assert.ok(s >= 0, `${startMark} 를 찾지 못했다`);
    const e = src.indexOf(endMark, s);
    assert.ok(e > s, `${endMark} 를 찾지 못했다`);
    const block = src.slice(s, e);

    const { ko, en } = keysByLang(block);
    assert.ok(ko && ko.size > 0, "ko 사전을 찾지 못했다");
    assert.ok(en && en.size > 0, "en 사전을 찾지 못했다 — 한쪽 언어만 만들지 말 것");

    const missingEn = [...ko].filter((k) => !en.has(k));
    const missingKo = [...en].filter((k) => !ko.has(k));
    assert.deepEqual(missingEn, [], `en 에 없는 키: ${missingEn.join(", ")}`);
    assert.deepEqual(missingKo, [], `ko 에 없는 키: ${missingKo.join(", ")}`);
  });
}

/**
 * brand-studio.js 의 bsfT 는 앱에서 가장 큰 사전인데 `ko: {}` / `en: {}` 형태가
 * 아니라 `if (!isEn) return {…}; return {…}` 이라 위 목록 방식으로는 잡히지 않았다.
 * 실제로 새 문구를 한쪽에만 넣어도 아무것도 실패하지 않는 구멍이 있었다.
 */
test("brand-studio.js — bsfT 의 한/영 키가 짝을 이룬다", () => {
  const src = read("prototype/js/ui/brand-studio.js");
  const fnAt = src.indexOf("function bsfT(isEn) {");
  assert.ok(fnAt > 0, "bsfT 를 찾지 못했다");

  const koAt = src.indexOf("if (!isEn) return {", fnAt);
  assert.ok(koAt > fnAt, "한국어 사전을 찾지 못했다");
  const koBody = objectBodyAt(src, src.indexOf("{", koAt + "if (!isEn) return ".length));
  const ko = topLevelKeys(koBody);

  const enAt = src.indexOf("return {", koAt + koBody.length);
  assert.ok(enAt > koAt, "영어 사전을 찾지 못했다 — 한쪽 언어만 만들지 말 것");
  const en = topLevelKeys(objectBodyAt(src, src.indexOf("{", enAt)));

  assert.ok(ko.size > 50 && en.size > 50, `사전 추출이 깨졌다 (ko ${ko.size} / en ${en.size})`);

  const missingEn = [...ko].filter((k) => !en.has(k));
  const missingKo = [...en].filter((k) => !ko.has(k));
  assert.deepEqual(missingEn, [], `en 에 없는 키: ${missingEn.join(", ")}`);
  assert.deepEqual(missingKo, [], `ko 에 없는 키: ${missingKo.join(", ")}`);
});

/**
 * app.html 은 한국어를 그대로 쓰고 common.js 의 ko→en 사전으로 영어를 만든다.
 * 사전에 없는 문구는 영어 모드에서 한국어 그대로 노출된다. 눈으로만 검사할 수 없다.
 */
test("app.html 의 한국어 data-i18n 문구는 모두 영어 사전에 있다", () => {
  // data-i18n 은 core.js 의 NK.core.translations.en 을 본다.
  // common.js 의 EN_TEXT_EXACT 는 JS 로 넣는 문구(translateText)용이라 서로 다른 사전이다.
  // 실제로 여기에 넣을 것을 저기에 넣어, 영어 모드에서 한국어가 그대로 노출된 적이 있다.
  const core = read("prototype/core.js");
  const coreAt = core.indexOf("core.translations = {");
  assert.ok(coreAt > 0, "core.translations 를 찾지 못했다");
  const enAt = core.indexOf("en: {", coreAt);
  assert.ok(enAt > coreAt, "core.translations.en 을 찾지 못했다");
  const dictBody = objectBodyAt(core, core.indexOf("{", enAt));

  const html = read("prototype/app.html");
  const hangul = /[가-힣]/;
  const missing = [];
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) {
    const key = m[1];
    if (!hangul.test(key)) continue; // 키 방식(brand_nav_studio 등)은 다른 경로로 번역된다
    if (!dictBody.includes(`'${key}'`) && !dictBody.includes(`"${key}"`)) missing.push(key);
  }
  assert.deepEqual(missing, [], `영어 사전에 없는 문구:\n${missing.join("\n")}`);
});

