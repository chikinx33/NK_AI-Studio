import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");
const mention = () => read("prototype/ui/pipeline-mention.js");

/**
 * '#' 로 배경·소품 고르기.
 *
 * 컷 생성은 씬 텍스트에 적힌 "이름"으로 레퍼런스를 매칭한다. 손으로 적으면 표기가 어긋나
 * (예: 자산은 "ABC큐브", 프롬프트엔 "ABC 큐브") 매칭이 조용히 실패한다. 캐릭터가 '@' 로
 * 고르듯 배경·소품도 '#' 로 골라 넣게 해서 표기가 어긋날 여지를 없앤다.
 */

// 실제 코드에서 함수 본문을 떼어 와 그대로 실행한다.
function loadCollectEpisodeAssets(env) {
  const src = mention();
  const start = src.indexOf("  function collectEpisodeAssets(st, projectId) {");
  assert.ok(start > -1, "collectEpisodeAssets 가 있어야 한다");
  const tail = "\n  }\n";
  const end = src.indexOf(tail, start) + tail.length;
  return new Function("NK", "projectEnvCache", `
    ${src.slice(start, end)}
    return collectEpisodeAssets;
  `)(env.NK, env.projectEnvCache);
}

function caretMatch(text) {
  const src = mention();
  const m = src.match(/var m = before\.match\((\/[^;]+\/)\);/);
  assert.ok(m, "캐럿 질의 정규식이 있어야 한다");
  const re = new RegExp(m[1].slice(1, -1));
  const hit = text.match(re);
  return hit ? { sigil: hit[1], query: hit[2] } : null;
}

test("★'#' 를 치면 이 에피소드의 배경·소품이 후보로 나온다", () => {
  const collect = loadCollectEpisodeAssets({
    NK: { service: {} },
    projectEnvCache: {},
  });
  const st = {
    payload: {
      episodeLocations: [{ name: "장난감 방" }, { name: "놀이터" }],
      episodeProps: [{ name: "ABC큐브" }],
    },
  };
  const got = collect(st, "");
  assert.deepEqual(got, [
    { name: "장난감 방", kind: "place" },
    { name: "놀이터", kind: "place" },
    { name: "ABC큐브", kind: "prop" },
  ]);
});

test("★서버에서 받은 프로젝트에서도 찾는다 (응답이 감싸여 와도)", () => {
  const cache = {
    p1: { data: { draft: { payload: { episodeProps: [{ name: "빨간 우산" }] } } } },
  };
  const collect = loadCollectEpisodeAssets({ NK: { service: {} }, projectEnvCache: cache });
  const got = collect({ payload: {} }, "p1");
  assert.deepEqual(got, [{ name: "빨간 우산", kind: "prop" }]);
});

test("★이름이 없는 행은 후보에서 빠진다", () => {
  const collect = loadCollectEpisodeAssets({ NK: { service: {} }, projectEnvCache: {} });
  const got = collect({ payload: { episodeProps: [{ name: "  " }, { name: "큐브" }] } }, "");
  assert.deepEqual(got, [{ name: "큐브", kind: "prop" }]);
});

test("★캐럿 앞 글자로 '@' 와 '#' 를 구분한다", () => {
  assert.deepEqual(caretMatch("앞부분 @네"), { sigil: "@", query: "네" });
  assert.deepEqual(caretMatch("앞부분 #큐"), { sigil: "#", query: "큐" });
  assert.deepEqual(caretMatch("앞부분 #"), { sigil: "#", query: "" });
  // 공백이 끼면 더 이상 질의가 아니다.
  assert.equal(caretMatch("#큐브 다음"), null);
  assert.equal(caretMatch("그냥 텍스트"), null);
});

test("★'#' 목록에는 캐릭터가 섞이지 않는다", () => {
  const src = mention();
  const build = src.slice(src.indexOf("function buildSuggestions(sigil)"), src.indexOf("// 캐럿 직전 텍스트가"));
  // 캐릭터 수집은 '@' 일 때만 돈다.
  assert.match(build, /var reg = mark === '@' \? \(NK\.service && NK\.service\.characterRegistry\) : null;/);
  // 에피소드 자산은 '#' 일 때 맨 앞에 들어간다.
  assert.match(build, /if \(mark === '#'\) \{\s*\n\s*collectEpisodeAssets\(st, projectId\)/);
  // 토큰 기호는 고른 기호를 그대로 따른다.
  assert.match(build, /t = mark \+ t;/);
});

test("★고른 토큰은 그 기호 자리에 들어간다", () => {
  const src = mention();
  const applyAt = src.indexOf("function applySelection(i)");
  const apply = src.slice(applyAt, src.indexOf("function closePop", applyAt));
  assert.match(apply, /var mark = state\.sigil === '#' \? '#' : '@';/);
  assert.match(apply, /if \(text\.charAt\(atIndex\) !== mark\)/);
  assert.match(apply, /lastIndexOf\(mark\)/);
  // 팝업을 열 때 기호를 기억한다.
  assert.match(src, /state\.sigil = info\.sigil === '#' \? '#' : '@';/);
});

test("★프롬프트로 나갈 때 '#' 기호는 떼어낸다", () => {
  const src = read("prototype/ui/pipeline-image.js");
  const fn = src.slice(src.indexOf("function stripPromptTokens(text)"), src.indexOf("function replaceFirstCaseInsensitive"));
  assert.match(fn, /replace\(\/@\(\[0-9A-Za-z가-힣_\]\{1,24\}\)\/g, '\$1'\)/);
  assert.match(fn, /replace\(\/#\(\[0-9A-Za-z가-힣_\]\{1,24\}\)\/g, '\$1'\)/);
});

test("★후보 종류 라벨이 한/영으로 있다", () => {
  const src = mention();
  const dict = src.slice(src.indexOf("var KIND_TEXT = {"), src.indexOf("function kindLabel"));
  assert.match(dict, /ko: \{ character: '캐릭터', place: '배경', prop: '소품', asset: '배경·소품' \}/);
  assert.match(dict, /en: \{ character: 'Character', place: 'Place', prop: 'Prop', asset: 'Place\/Prop' \}/);
  assert.match(src, /function mentionLang\(\)/);
  // 실제 후보에 라벨이 붙는다.
  assert.match(src, /kindLabel\(a\.kind\)/);
  assert.match(src, /kindLabel\('character'\)/);
  assert.match(src, /kindLabel\(raw\.kind === 'prop' \? 'prop' : 'asset'\)/);
});
