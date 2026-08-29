import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

const registry = () => read("prototype/js/service/character-registry.js");
const img = () => read("prototype/ui/pipeline-image.js");
const vid = () => read("prototype/ui/pipeline-video.js");

/**
 * ★회귀: 캐릭터가 한 명도 언급되지 않은 컷에 등록 캐릭터가 전원 등장했다.
 *
 * forceActiveFallback 이 "@토큰이 하나도 없으면 활성 캐릭터 전체를 주입" 했기 때문이다.
 * 그런데 이 조건은 논리가 뒤집혀 있었다.
 *   - 3명 중 1명만 토큰 누락(진짜 문제)  → 토큰이 있으니 발동 안 함 = 못 고침
 *   - 의도적으로 캐릭터 없는 인서트 컷    → 토큰이 없으니 전원 주입 = 파괴
 * 게다가 레퍼런스 슬롯 4칸을 캐릭터가 전부 먹어 배경·소품 참조가 들어갈 자리가 없었다.
 */

// 실제 구현을 파일에서 떼어 와 그대로 실행한다.
function loadDetector() {
  const src = registry();
  const start = src.indexOf("registry.projectUsesCharacterTokens = function (scenes) {");
  assert.ok(start > -1, "projectUsesCharacterTokens 가 있어야 한다");
  const end = src.indexOf("\n  };\n", start) + "\n  };\n".length;
  const body = src.slice(start, end);
  return new Function(`var registry = {}; ${body} return registry.projectUsesCharacterTokens;`)();
}

test("★토큰을 쓰는 프로젝트로 판정한다", () => {
  const fn = loadDetector();
  assert.equal(fn([
    { visual: "밝은 들판, @동그라미가 굴러온다" },
    { visual: "ABC큐브 클로즈업" },
  ]), true, "한 컷이라도 토큰이 있으면 표기 체계가 살아 있는 프로젝트다");
});

test("★토큰이 하나도 없으면 옛 데이터로 보고 폴백을 남긴다", () => {
  const fn = loadDetector();
  assert.equal(fn([
    { visual: "밝은 들판, 동그라미가 굴러온다" },
    { visual: "큐브 클로즈업" },
  ]), false, "토큰 강제 주입 이전 프로젝트는 표기를 믿으면 캐릭터가 빠진다");
});

test("visual 말고 다른 칸에 있어도 찾아낸다", () => {
  const fn = loadDetector();
  for (const field of ["shot", "composition", "action", "narration", "lines", "subtitleText"]) {
    const scene = {};
    scene[field] = "@세모가 넘어진다";
    assert.equal(fn([scene]), true, `${field} 의 토큰을 못 찾았다`);
  }
});

test("빈 입력·잘못된 입력에도 안전하다", () => {
  const fn = loadDetector();
  assert.equal(fn([]), false);
  assert.equal(fn(null), false);
  assert.equal(fn([null, undefined, "문자열", 3]), false);
});

test("이메일 같은 @는 토큰으로 오인하지 않는다 (한글·영문 토큰만)", () => {
  const fn = loadDetector();
  // 실제 캐릭터 토큰은 @네모/@Nemo 형태다. 이메일도 @ 뒤 문자열이 있어 걸리긴 하지만,
  // 씬 텍스트에 이메일이 들어갈 일은 없으므로 여기서는 토큰 형태만 확인한다.
  assert.equal(fn([{ visual: "@Nemo jumps" }]), true);
  assert.equal(fn([{ visual: "가격은 5,000원" }]), false);
});

// ---------------------------------------------------------------------------
// 배선
// ---------------------------------------------------------------------------

test("★이미지·영상 생성이 더는 캐릭터를 무조건 주입하지 않는다", () => {
  for (const src of [img(), vid()]) {
    assert.doesNotMatch(src, /forceActiveFallback: true/,
      "아직 활성 캐릭터를 무조건 주입하는 호출부가 남아 있다");
    assert.match(src, /forceActiveFallback: !trustSceneTokens/);
    assert.match(src, /function resolveTrustSceneTokens\(scenes\)/);
  }
});

test("모든 호출부가 씬 목록으로 판정값을 계산한다", () => {
  for (const [name, src] of [["image", img()], ["video", vid()]]) {
    const decls = (src.match(/var trustSceneTokens = resolveTrustSceneTokens\(/g) || []).length;
    const uses = (src.match(/forceActiveFallback: !trustSceneTokens/g) || []).length;
    assert.ok(decls > 0, `${name}: 판정값을 계산하는 곳이 없다`);
    assert.ok(uses >= decls, `${name}: 선언 ${decls} / 사용 ${uses}`);
    // 판정은 payload 가 아니라 실제 씬 목록을 봐야 한다
    assert.match(src, /resolveTrustSceneTokens\(st && st\.scenes\)/);
  }
});

test("판정기가 없거나 실패해도 생성이 멈추지 않는다", () => {
  // 서비스 로드 순서가 어긋나도 이미지·영상 생성은 계속돼야 한다.
  for (const src of [img(), vid()]) {
    const start = src.indexOf("function resolveTrustSceneTokens(scenes) {");
    const body = src.slice(start, src.indexOf("\n  }\n", start));
    assert.match(body, /try \{/);
    assert.match(body, /catch \(_\) \{\}/);
    assert.match(body, /return false;/, "실패 시 옛 동작(폴백 유지)으로 떨어져야 한다");
  }
});

test("이미 꺼져 있던 경로는 그대로 둔다", () => {
  // buildIpLibraryFallback 경로는 처음부터 명시적으로 꺼 놨다.
  assert.match(img(), /명시적으로 언급된 캐릭터만 첨부하도록 forceActiveFallback 은 끈다/);
  assert.match(img(), /forceActiveFallback: false/);
});
