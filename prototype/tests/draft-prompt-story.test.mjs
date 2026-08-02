import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * 플랫폼별 초안 프롬프트는 "이 에피소드의 이야기"를 재료로 써야 한다.
 *
 * 실제로 Threads / X 프롬프트에 다른 작품의 캐릭터('뚜뮤', 뚜비뚜바 행성)가 통째로
 * 박혀 있었다. 두 프롬프트는 에피소드 스토리를 한 번도 언급하지 않았고
 * "브랜드 직접 언급 금지"까지 걸어 둬서, Generate 를 눌러도 지금 만드는 이야기와
 * 무관한 글이 나왔다. 화자는 브랜드 컨텍스트에서 와야 한다.
 *
 * (같은 원칙의 이미지 쪽 규칙: 프롬프트에 특정 화풍을 박지 않는다)
 */

const SRC = path.join(process.cwd(), "prototype/functions/api/draft-generate.js");
const src = fs.readFileSync(SRC, "utf8");

/** PLATFORM_PROMPTS 를 실제로 평가해 플랫폼별 프롬프트 문자열을 얻는다. */
function loadPrompts() {
  const at = src.indexOf("const PLATFORM_PROMPTS = {");
  assert.ok(at > 0, "PLATFORM_PROMPTS 를 찾지 못했다");
  let depth = 0;
  let i = src.indexOf("{", at);
  const from = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const ctx = vm.createContext({});
  vm.runInContext(`globalThis.__p = ${src.slice(from, i + 1)}`, ctx);
  return ctx.__p;
}

const PROMPTS = loadPrompts();

test("프롬프트가 실제로 평가된다", () => {
  const names = Object.keys(PROMPTS);
  assert.ok(names.length >= 10, `플랫폼 수가 이상하다 (${names.length}개)`);
  for (const [name, p] of Object.entries(PROMPTS)) {
    assert.equal(typeof p, "string", `${name} 프롬프트가 문자열이 아니다`);
    assert.ok(p.length > 100, `${name} 프롬프트가 비어 있다`);
  }
});

test("모든 플랫폼 프롬프트가 에피소드 스토리를 재료로 쓴다", () => {
  const offenders = Object.entries(PROMPTS)
    .filter(([, p]) => !/에피소드|스토리|씬/.test(p))
    .map(([name]) => name);
  assert.deepEqual(offenders, [], `이야기를 참조하지 않는 플랫폼: ${offenders.join(", ")}`);
});

test("특정 작품의 캐릭터·세계관을 프롬프트에 박아 두지 않는다", () => {
  // 화자는 브랜드 컨텍스트(톤앤매너·브랜드 캐릭터)에서 와야 한다.
  const HARDCODED = ["뚜뮤", "뚜비뚜바", "모양새 친구들", "네모·세모·동그라미"];
  const offenders = [];
  for (const [name, p] of Object.entries(PROMPTS)) {
    for (const word of HARDCODED) {
      if (p.includes(word)) offenders.push(`${name}: "${word}"`);
    }
  }
  assert.deepEqual(offenders, [], `프롬프트에 특정 작품이 박혀 있다:\n${offenders.join("\n")}`);
});

test("화자를 고정하는 플랫폼은 브랜드 컨텍스트에서 화자를 가져온다", () => {
  for (const name of ["threads", "x"]) {
    const p = PROMPTS[name];
    assert.match(p, /브랜드 컨텍스트/, `${name} 이 화자 출처를 밝히지 않는다`);
    assert.match(p, /임의로 만들어 내지 말/, `${name} 에 인물 창작 금지 지시가 없다`);
  }
});

test("해시태그는 caption 이 아니라 hashtags 필드로 간다", () => {
  // TikTok 프롬프트가 "인라인 포함"이라 캡션 안에 해시태그를 넣게 시켰다.
  // 카드에는 해시태그 입력칸이 따로 있어 값이 두 군데로 갈렸다.
  const offenders = Object.entries(PROMPTS)
    .filter(([, p]) => /해시태그[^\n]*인라인/.test(p))
    .map(([name]) => name);
  assert.deepEqual(offenders, [], `해시태그를 캡션에 인라인으로 넣게 시킨다: ${offenders.join(", ")}`);
});

/**
 * 프롬프트 끝의 출력 형식 예시에서 JSON 키 이름을 뽑는다.
 * 예시 안의 \n 이 실제 개행으로 평가되므로 한 줄로 가정하면 안 된다.
 */
function outputKeys(prompt) {
  const start = prompt.lastIndexOf('{"');
  if (start < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < prompt.length; i++) {
    if (prompt[i] === "{") depth++;
    else if (prompt[i] === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) return null;
  return [...prompt.slice(start, end + 1).matchAll(/"([a-z_]+)"\s*:/g)].map((m) => m[1]);
}

test("모든 플랫폼이 caption·hashtags 를 JSON 으로 돌려주게 지시한다", () => {
  const offenders = [];
  for (const [name, p] of Object.entries(PROMPTS)) {
    const keys = outputKeys(p);
    if (!keys) { offenders.push(`${name}: 출력 형식 없음`); continue; }
    for (const need of ["caption", "hashtags"]) {
      if (!keys.includes(need)) offenders.push(`${name}: ${need} 누락`);
    }
  }
  assert.deepEqual(offenders, [], `출력 형식 문제:\n${offenders.join("\n")}`);
});

test("프롬프트가 요구하는 키를 화면이 모두 반영한다", () => {
  // 서버가 돌려줘도 클라이언트가 그 필드를 안 쓰면 화면에는 아무것도 안 채워진다.
  const bs = fs.readFileSync(path.join(process.cwd(), "prototype/js/ui/brand-studio.js"), "utf8");
  const applied = new Set(
    (bs.match(/\['caption', 'hashtags', 'title', 'first_comment'\]/g) || []).length
      ? ["caption", "hashtags", "title", "first_comment"]
      : []
  );
  assert.ok(applied.size > 0, "브랜드 스튜디오의 필드 반영 목록을 찾지 못했다");

  const missing = [];
  for (const [name, p] of Object.entries(PROMPTS)) {
    for (const key of outputKeys(p) || []) {
      if (!applied.has(key)) missing.push(`${name}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], `서버는 주는데 화면이 안 쓰는 필드:\n${missing.join("\n")}`);
});

test("TikTok 캡션은 훅 한 줄로 끝내지 않는다", () => {
  const p = PROMPTS.tiktok;
  assert.match(p, /3~4줄/, "TikTok 이 여전히 2~3줄 이내로 조여 있다");
  assert.match(p, /무슨 일이 벌어지는지/, "캡션만으로 내용이 그려지라는 지시가 없다");
});

test("로컬 자동 초안도 TikTok 에 문장 하나만 넣지 않는다", () => {
  // 서버 프롬프트를 고쳐도, 저장 버튼 없이 보이는 AUTO 초안이 한 문장이면
  // 화면에서는 여전히 "이야기가 안 채워진" 것으로 보인다.
  const bs = fs.readFileSync(path.join(process.cwd(), "prototype/js/ui/brand-studio.js"), "utf8");
  const at = bs.indexOf("case 'tiktok':");
  assert.ok(at > 0, "TikTok 자동 초안 분기를 찾지 못했다");
  const body = bs.slice(at, bs.indexOf("break;", at));
  assert.match(body, /tkSents\[1\]/, "두 번째 문장을 붙이지 않는다");
  // 쇼츠와 한 덩어리로 묶여 있으면 쇼츠 동작까지 같이 바뀐다
  const shortsAt = bs.indexOf("case 'youtube-shorts':");
  assert.ok(shortsAt >= 0 && bs.slice(shortsAt, at).includes("break;"), "쇼츠와 분기가 분리되지 않았다");
});
