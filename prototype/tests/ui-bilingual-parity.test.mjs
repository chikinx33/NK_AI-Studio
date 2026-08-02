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
  ["prototype/js/ui/tiktok-consent-modal.js", "var COPY = {", "\n  /** 앱 런타임 언어"],
  ["prototype/js/ui/tiktok-consent-modal.js", "var ERROR_COPY = {", "\n  function describeError"],
  ["prototype/js/ui/tiktok-consent-modal.js", "var PRIVACY_LABEL = {", "\n  var BC_POLICY_URL"],
  ["prototype/js/ui/sns-settings.js", "var T = {", "\n  function _lang"],
  ["prototype/js/ui/format-media-spec.js", "var LOCK_TEXT = {", "\n  function lockLabel"],
];

/** `ko: {` / `en: {` 블록에서 최상위 키 이름을 뽑는다. */
function keysByLang(block) {
  const out = {};
  for (const lang of ["ko", "en"]) {
    const start = block.indexOf(`${lang}: {`);
    if (start < 0) continue;
    // 중괄호 깊이를 세어 해당 언어 블록의 끝을 찾는다
    let depth = 0;
    let i = block.indexOf("{", start);
    const from = i;
    for (; i < block.length; i++) {
      if (block[i] === "{") depth++;
      else if (block[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = block.slice(from + 1, i);
    // 중첩 오브젝트 안의 키까지 세지 않도록 깊이 0 인 줄만 본다
    const keys = new Set();
    let d = 0;
    for (const line of body.split("\n")) {
      // 'no-asset' 처럼 따옴표로 감싼 키도 인식한다
      const m = d === 0 ? line.match(/^\s{4,}(['"]?)([A-Za-z_][A-Za-z0-9_-]*)\1\s*:/) : null;
      if (m) keys.add(m[2]);
      for (const ch of line) {
        if (ch === "{") d++;
        else if (ch === "}") d--;
      }
    }
    out[lang] = keys;
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

test("TikTok 확인 모달에 하드코딩된 사용자 문구가 남아 있지 않다", () => {
  const src = read("prototype/js/ui/tiktok-consent-modal.js");
  // 사전 정의부를 제외한 렌더 코드에서 영문 문장이 직접 튀어나오면 안 된다.
  const render = src.slice(src.indexOf("function open(opts)"));
  const strays = [
    "Post to TikTok",
    "Who can view",
    "Allow users to",
    "Branded Content Policy",
    "Music Usage Confirmation",
    "By posting",
    ">Cancel<",
    ">Close<",
  ].filter((phrase) => render.includes(phrase));
  assert.deepEqual(strays, [], `렌더 코드에 하드코딩된 문구: ${strays.join(" | ")}`);
});

test("영문 심사 문구는 명세 원문 그대로 유지된다", () => {
  // ko 를 추가하면서 en 이 흔들리면 심사에서 대조가 깨진다.
  const src = read("prototype/js/ui/tiktok-consent-modal.js");
  // PRIVACY_LABEL 에도 en/ko 가 있으므로 COPY 블록으로 먼저 좁힌다
  const copyAt = src.indexOf("var COPY = {");
  assert.ok(copyAt > 0, "COPY 를 찾지 못했다");
  const enAt = src.indexOf("en: {", copyAt);
  const en = src.slice(enAt, src.indexOf("ko: {", enAt));
  for (const phrase of [
    "Turn on to disclose that this video promotes goods or services in exchange for something of value.",
    "This video will be classified as Brand Organic.",
    "This video will be classified as Branded Content.",
    "Your photo/video will be labeled as 'Promotional content'.",
    "Your photo/video will be labeled as 'Paid partnership'.",
    "Branded content visibility cannot be set to private.",
    "Available after TikTok app review",
    "Turned off in your TikTok account settings",
  ]) {
    assert.ok(en.includes(phrase), `영문 원문이 바뀌었다: ${phrase}`);
  }
});
