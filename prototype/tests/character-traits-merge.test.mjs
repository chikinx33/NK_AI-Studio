import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * 캐릭터 텍스트 속성 5칸 → 2칸 통합 계약.
 *
 * 배경(왜 줄였나):
 *   - description 과 fixedTraits 는 같은 말을 두 번 적는 칸이었다. 둘을 이어붙인 뒤
 *     180자에서 자르는 구조라, 중복이 예산을 먹고 뒤쪽 정보가 잘려 나갔다.
 *   - bannedTraits 와 negativePrompt 는 이미지에서 결국 같은 프롬프트에 부정문 두 줄
 *     ("Avoid: …" / "Do not include: …")로 합류했다. 언어까지 서로 달랐다.
 *   - 정작 ip/analyze 지시문은 "이미지 모델은 부정문을 약하게 처리하니 긍정문으로 쓰라"고
 *     말하고 있었다. 시스템이 자기 원칙과 어긋나 있었다.
 *   - styleGuide 는 캐릭터마다 화풍을 따로 두게 해, 한 화면에서 그림체가 갈릴 수 있었다.
 *
 * 여기서 지키는 것: 옛 데이터가 사라지지 않을 것, 부정문이 프롬프트 본문에 다시
 * 새어 들어가지 않을 것.
 */

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

/** 브라우저 IIFE 모듈을 window 스텁 위에서 평가한다. */
function loadTraits() {
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(read("prototype/js/service/character-traits.js"), ctx);
  return ctx.window.NK.service.characterTraits;
}
const T = loadTraits();

// 실제 IP 라이브러리에 저장돼 있던 형태(옛 5칸). description 과 fixedTraits 가 겹친다.
const LEGACY = {
  description: "파란 라운드 큐브 몸체와 얼굴이 하나로 합쳐진 캐릭터, 베이지색 얼굴 영역, 짧은 발, 두꺼운 검은 눈썹",
  fixedTraits: ["파란 큐브형 몸", "둥근 모서리", "전면 일체형 얼굴", "짧은 발", "베이지색 얼굴 영역"],
  bannedTraits: ["삼각형 팔로 해석 금지", "귀 없음", "목 없음"],
  negativePrompt: "triangular arms, ears, neck, separate head",
  styleGuide: "3D 애니메이션 스타일, 키즈 캐릭터",
};

test("옛 5칸 데이터의 내용이 하나도 사라지지 않는다", () => {
  const appearance = T.mergeAppearance(LEGACY);
  assert.ok(appearance.includes("파란 라운드 큐브 몸체"), "description 유실");
  assert.ok(appearance.includes("둥근 모서리"), "fixedTraits 유실");
  assert.ok(appearance.includes("3D 애니메이션 스타일"), "styleGuide 유실");

  const negative = T.mergeNegative(LEGACY);
  assert.ok(negative.includes("triangular arms"), "negativePrompt 유실");
  assert.ok(negative.includes("귀 없음"), "bannedTraits 유실");
});

test("칸끼리 겹치던 표현은 한 번만 남는다 (180자 예산 낭비 제거)", () => {
  const appearance = T.mergeAppearance(LEGACY);
  // '짧은 발'·'베이지색 얼굴 영역'은 description 과 fixedTraits 양쪽에 있었다.
  assert.equal(appearance.split("짧은 발").length - 1, 1);
  assert.equal(appearance.split("베이지색 얼굴 영역").length - 1, 1);
});

test("표기가 다르면 지우지 않는다 (애매하면 살리는 쪽)", () => {
  // '파란 큐브형 몸' 과 '파란 라운드 큐브 몸체' 는 뜻이 비슷해도 글자가 달라 둘 다 남는다.
  const appearance = T.mergeAppearance(LEGACY);
  assert.ok(appearance.includes("파란 큐브형 몸"));
  assert.ok(appearance.includes("파란 라운드 큐브 몸체"));
});

test("이미 2칸 형식이면 그대로 통과한다", () => {
  const modern = { description: "파란 큐브형 몸, 둥근 모서리", negativePrompt: "fingers, ears" };
  assert.equal(T.mergeAppearance(modern), "파란 큐브형 몸, 둥근 모서리");
  assert.equal(T.mergeNegative(modern), "fingers, ears");
});

test("빈 값·null·문자열로 온 배열 필드에도 안전하다", () => {
  assert.equal(T.mergeAppearance({}), "");
  assert.equal(T.mergeNegative({}), "");
  assert.equal(T.mergeAppearance(null), "");
  // 옛 데이터가 배열 대신 쉼표 문자열로 저장된 경우
  assert.equal(T.mergeAppearance({ description: "", fixedTraits: "a, b" }), "a, b");
});

test("normalizeTextProps 는 2칸에 담고 옛 칸을 비운다", () => {
  const out = T.normalizeTextProps(LEGACY);
  assert.ok(out.description.length > 40);
  assert.ok(out.negativePrompt.length > 20);
  // vm 컨텍스트 객체라 프로토타입 realm 이 달라 deepEqual 은 쓰지 않는다.
  assert.equal(out.fixedTraits.length, 0);
  assert.equal(out.bannedTraits.length, 0);
  assert.equal(out.styleGuide, "");
});

// ── 배선 계약 ───────────────────────────────────────────────────────────────
test("프롬프트 본문에 캐릭터 부정문이 다시 새어 들어가지 않는다", () => {
  const src = read("prototype/js/service/character-registry.js");
  // 'Fixed traits:' · 'Style guide:' 줄은 description 한 줄로 합쳐졌다.
  assert.doesNotMatch(src, /'Fixed traits: '/);
  assert.doesNotMatch(src, /'Style guide: '/);
  // 'Avoid:' 는 남지만 브랜드 금지 표현 전용 — 캐릭터 bannedTraits 를 긁어오지 않는다.
  assert.doesNotMatch(src, /c\.bannedTraits.*forEach/);
  assert.match(src, /bannedExpressions\.forEach/);
});

test("참조 이미지 캡션은 description 한 칸만 쓴다", () => {
  const src = read("prototype/ui/pipeline-image.js");
  assert.doesNotMatch(src, /character\.fixedTraits\.join/);
  assert.doesNotMatch(src, /character && character\.styleGuide/);
});

test("두 정규화 경로 모두 통합기를 거친다 (한쪽만 옛 형식으로 남지 않게)", () => {
  const brand = read("prototype/js/service/brand.js");
  assert.match(brand, /description: mergeCharacterAppearance\(item\)/);
  assert.match(brand, /negativePrompt: mergeCharacterNegative\(item\)/);

  const registry = read("prototype/js/service/character-registry.js");
  assert.match(registry, /var description = mergeAppearance\(src\)/);
  assert.match(registry, /var negativePrompt = mergeNegative\(src\)/);
});

test("통합기가 없는 페이지를 대비한 폴백이 양쪽에 있다", () => {
  // character-traits.js 를 못 불러온 페이지에서도 옛 데이터가 그대로 노출되면 안 된다.
  for (const file of ["prototype/js/service/brand.js", "prototype/js/service/character-registry.js"]) {
    const src = read(file);
    assert.match(src, /function fallbackMerge/, `${file} 에 폴백 없음`);
    assert.match(src, /NK\.service\.characterTraits/, `${file} 에 통합기 조회 없음`);
  }
});

test("편집 화면은 두 칸만 보여준다", () => {
  const hub = read("prototype/js/ui/knowledge-hub.js");
  assert.match(hub, /data-char-prop="description"/);
  assert.match(hub, /data-char-prop="negativePrompt"/);
  assert.doesNotMatch(hub, /data-char-prop="fixedTraits"/);
  assert.doesNotMatch(hub, /data-char-prop="bannedTraits"/);
  assert.doesNotMatch(hub, /data-char-prop="styleGuide"/);
});

test("통합기 모듈이 두 서비스를 쓰는 모든 페이지에 실려 있다", () => {
  const pages = fs
    .readdirSync(path.join(root, "prototype"))
    .filter((f) => f.endsWith(".html"))
    .filter((f) => {
      const src = read(`prototype/${f}`);
      return src.includes("js/service/brand.js") || src.includes("js/service/character-registry.js");
    });
  assert.ok(pages.length > 0, "대상 페이지를 못 찾음");
  for (const page of pages) {
    assert.match(read(`prototype/${page}`), /js\/service\/character-traits\.js/, `${page} 에 미등록`);
  }
});
