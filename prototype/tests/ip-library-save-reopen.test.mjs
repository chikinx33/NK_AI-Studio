import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 이 저장소 파일은 CRLF 다. 함수 본문을 잘라 쓰려면 줄바꿈을 먼저 통일해야 한다.
const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");
const hub = () => read("prototype/js/ui/knowledge-hub.js");

/**
 * ★회귀: IP 라이브러리에서 저장 → 닫기 → 다시 열기 하면 저장 전 값이 보였다.
 *
 * 저장 자체는 되고 있었다(새로고침하면 값이 살아 있었다). 문제는 화면이 들고 있던
 * 스냅샷이었다. 모달은 열 때마다 `characters`(= brand.brandCharacters)에서 초안을
 * 뜨는데, 저장 경로가 저장소만 갱신하고 이 스냅샷을 그대로 둬서 다음 열기가
 * 저장 전 배열을 다시 집어왔다.
 */

// 실제 코드에서 함수 본문을 떼어 와 그대로 실행한다 (동작을 흉내 내지 않는다).
function loadApplySavedBrandCharacters() {
  const src = hub();
  const start = src.indexOf("function applySavedBrandCharacters(savedBrand, sentPatch) {");
  assert.ok(start > -1, "applySavedBrandCharacters 가 있어야 한다");
  const end = src.indexOf("\n    }\n", start) + "\n    }\n".length;
  const body = src.slice(start, end);

  // brand·characters 를 바깥 스코프 변수로 두고(실제와 같은 구조) 함수를 만든다.
  const factory = new Function(`
    var brand = arguments[0];
    var characters = arguments[1];
    ${body}
    return {
      run: applySavedBrandCharacters,
      getBrand: function () { return brand; },
      getCharacters: function () { return characters; }
    };
  `);
  return factory;
}

test("★저장 후 스냅샷이 갱신돼 다시 열면 새 값이 보인다", () => {
  const factory = loadApplySavedBrandCharacters();
  const oldChars = [{ trigger: "@세모", description: "옛 설명" }];
  const brand = { brandId: "b1", brandCharacters: oldChars };
  const ctx = factory(brand, oldChars);

  const savedBrand = {
    brandId: "b1",
    brandCharacters: [{ trigger: "@세모", description: "발은 매끈한 둥근 캡슐 하나" }],
  };
  ctx.run(savedBrand, savedBrand.brandCharacters);

  // 다음 '열기' 가 읽는 배열에 새 값이 들어 있어야 한다
  assert.equal(ctx.getCharacters().length, 1);
  assert.equal(ctx.getCharacters()[0].description, "발은 매끈한 둥근 캡슐 하나");
  assert.equal(ctx.getBrand().brandCharacters[0].description, "발은 매끈한 둥근 캡슐 하나");
});

test("★같은 배열을 돌려받아도 내용이 지워지지 않는다 (자기 자신 비우기 방지)", () => {
  // characters 는 brand.brandCharacters 를 복사 없이 그대로 가리킨다.
  // 저장 결과가 같은 배열 참조로 돌아오면, 제자리 비우기가 원본을 먼저 날린다.
  const factory = loadApplySavedBrandCharacters();
  const shared = [{ trigger: "@뚜뮤", description: "키 50cm, 성인 무릎 높이" }];
  const brand = { brandId: "b1", brandCharacters: shared };
  const ctx = factory(brand, shared);

  // persistShared 가 같은 배열 참조를 그대로 돌려주는 경우
  ctx.run({ brandId: "b1", brandCharacters: shared }, shared);

  assert.equal(ctx.getCharacters().length, 1, "내용이 지워졌다");
  assert.equal(ctx.getCharacters()[0].description, "키 50cm, 성인 무릎 높이");
});

test("저장 결과가 비어 오면(구 update 폴백) 보낸 패치로 대신 맞춘다", () => {
  const factory = loadApplySavedBrandCharacters();
  const oldChars = [{ trigger: "@네모", description: "옛 설명" }];
  const ctx = factory({ brandId: "b1", brandCharacters: oldChars }, oldChars);

  const patch = [{ trigger: "@네모", description: "키 25cm, 축구공보다 조금 큰 크기" }];
  ctx.run(null, patch); // persistShared 없이 update 폴백을 탄 경우

  assert.equal(ctx.getCharacters()[0].description, "키 25cm, 축구공보다 조금 큰 크기");
  assert.equal(ctx.getBrand().brandCharacters[0].description, "키 25cm, 축구공보다 조금 큰 크기");
});

test("저장 결과도 패치도 없으면 아무것도 건드리지 않는다", () => {
  const factory = loadApplySavedBrandCharacters();
  const oldChars = [{ trigger: "@동그라미", description: "그대로" }];
  const ctx = factory({ brandId: "b1", brandCharacters: oldChars }, oldChars);

  ctx.run(null, null);

  assert.equal(ctx.getCharacters().length, 1);
  assert.equal(ctx.getCharacters()[0].description, "그대로");
});

test("저장 흐름이 갱신 함수를 실제로 호출한다", () => {
  const src = hub();
  const save = src.slice(src.indexOf("if (action === 'character-manager-save')"));
  const block = save.slice(0, save.indexOf(".finally("));
  // persistShared 의 반환값(저장된 brand)을 받아서 넘겨야 한다
  assert.match(block, /\.then\(function \(savedBrand\) \{/);
  assert.match(block, /applySavedBrandCharacters\(savedBrand, brandCharsPatch\)/);
  // 갱신이 knowledge 재조립(readKnowledge(brand))보다 먼저여야 한다
  const applyIdx = block.indexOf("applySavedBrandCharacters(");
  const readIdx = block.indexOf("readKnowledge(brand)");
  assert.ok(applyIdx > -1 && readIdx > -1);
  assert.ok(applyIdx < readIdx, "스냅샷 갱신이 knowledge 재조립보다 먼저여야 한다");
});

test("모달은 여전히 characters 에서 초안을 뜬다 (고친 지점이 맞는지 확인)", () => {
  const src = hub();
  assert.match(src, /modalBrandCharsDraft = JSON\.parse\(JSON\.stringify\(Array\.isArray\(characters\) \? characters : \[\]\)\)/);
  // 닫을 때 초안을 버리므로, 다음 열기는 반드시 characters 를 다시 읽는다
  assert.match(src, /function closeCharacterManagerModal\(\)[\s\S]{0,300}modalBrandCharsDraft = null/);
});
