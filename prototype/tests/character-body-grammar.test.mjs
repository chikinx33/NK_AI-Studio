import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildBodyGrammar,
  compileBodyConstraints,
  enforceBodyConstraintsInScenes,
  negativeNouns,
  repairCharacterBodyText,
  stripNegationSuffix,
  validateCharacterBodyText,
} from "../functions/api/_shared/body-grammar.js";
import { mergeCharacterBodySpecsFromBrand } from "../functions/api/_shared/brand-body-specs.js";
import { buildShotUserPromptKo, buildShotUserPromptEn } from "../functions/api/scenario/shots/decomposer.js";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

/**
 * ★손가락 없는 캐릭터가 손가락으로 가리키던 이유.
 *
 * 시나리오·컷 분해를 쓰는 AI 는 캐릭터의 이름과 성격만 받았다. 신체 스펙
 * (짧은 육면체 팔 · 손가락 없음)은 이미지 생성 직전에야 "Do not include: 손가락 없음"
 * 으로 붙었는데, 행동 텍스트에 이미 "손가락으로 가리킨다" 는 긍정 명령이 있으면
 * 마지막 네거티브로는 절대 못 이긴다. 몸을 정하는 문서와 몸을 움직이는 문서가
 * 서로를 몰랐다. 그래서 신체 문법을 글이 써지는 모든 단계에 주입한다.
 */

const NEMO = {
  token: "@네모",
  displayName: "네모",
  appearance: "파란 큐브형 몸, 짧은 육면체 팔, 짧은 두 발",
  negative: "삼각형 팔로 해석 금지, 귀 없음, 목 없음, 손가락 없음, 코 없음",
};

test("★이중부정을 편다 — '손가락 없음' 은 명사 '손가락' 이 된다", () => {
  assert.equal(stripNegationSuffix("손가락 없음"), "손가락");
  assert.equal(stripNegationSuffix("삼각형 팔로 해석 금지"), "삼각형 팔로 해석");
  assert.equal(stripNegationSuffix("no fingers"), "fingers");
  assert.deepEqual(negativeNouns(NEMO.negative), ["삼각형 팔로 해석", "귀", "목", "손가락", "코"]);
});

test("★신체 문법 블록에 몸·없는 부위·대체 표현이 모두 있다", () => {
  const ko = buildBodyGrammar([NEMO], "ko");
  assert.match(ko, /\[캐릭터 신체 문법 — 절대 제약\]/);
  assert.match(ko, /@네모: 몸: 파란 큐브형 몸/);
  assert.match(ko, /몸에 없는 것: .*손가락/);
  // 금지만 하면 작가가 표현을 잃는다 — 대체 문형까지 알려 준다.
  assert.match(ko, /팔 끝으로 가리킨다/);
  const en = buildBodyGrammar([NEMO], "en");
  assert.match(en, /does NOT have: .*손가락/);
  assert.match(en, /points with the tip of its arm/);
});

test("★스펙 없는 캐릭터뿐이면 블록을 만들지 않는다", () => {
  assert.equal(buildBodyGrammar([{ token: "@나레이터" }], "ko"), "");
  assert.equal(buildBodyGrammar([], "ko"), "");
  assert.equal(buildBodyGrammar(null, "ko"), "");
});

test("★실제 회귀 문장을 손가락 없는 네모의 '팔 끝' 행동으로 교정한다", () => {
  const sentence = "@네모가 두 눈을 동그랗게 키우며 시선을 바닥으로 내리꽂고, 오른손 검지를 천천히 바닥 방향으로 뻗어 ABC큐브를 가리킨다.";
  const constraints = compileBodyConstraints([NEMO]);
  assert.deepEqual(constraints[0].absentParts.sort(), ["ear", "finger", "neck", "nose"].sort());
  const violations = validateCharacterBodyText(sentence, [NEMO]);
  assert.ok(violations.some((item) => item.bodyPart === "finger" && item.matched.includes("검지")));

  const repaired = repairCharacterBodyText(sentence, [NEMO]);
  assert.equal(
    repaired.text,
    "@네모가 두 눈을 동그랗게 키우며 시선을 바닥으로 내리꽂고, 오른팔 끝을 천천히 바닥 방향으로 뻗어 ABC큐브를 가리킨다."
  );
  assert.equal(repaired.remainingViolations.length, 0);
});

test("★'코너' 같은 일반 단어를 코로 오인하지 않고, 사람 손 표현만 교정한다", () => {
  const liveNemo = { ...NEMO, negative: `${NEMO.negative}, 사람 손` };
  const sentence = "@네모가 교실 코너로 이동한 뒤 손으로 ABC큐브를 가리킨다.";
  const repaired = repairCharacterBodyText(sentence, [liveNemo]);
  assert.match(repaired.text, /교실 코너로/);
  assert.match(repaired.text, /팔 끝으로 ABC큐브를 가리킨다/);
  assert.equal(repaired.remainingViolations.length, 0);
});

test("★씬·샷·시간 비트까지 같은 신체 제약으로 검사하고 교정한다", () => {
  const result = enforceBodyConstraintsInScenes([{
    visual: "@네모가 오른손 검지로 바닥을 가리킨다.",
    composition: "@네모와 ABC큐브를 함께 담는다.",
    action: "오른손 검지를 아래로 뻗는다.",
    beats: [{ at: 0, what: "@네모가 고개를 숙인다." }],
  }], [NEMO]);
  assert.equal(result.remainingViolations.length, 0);
  assert.match(result.scenes[0].visual, /오른팔 끝으로/);
  assert.match(result.scenes[0].action, /오른팔 끝을/);
  assert.match(result.scenes[0].beats[0].what, /몸통을 앞으로 기울인다/);
  assert.ok(result.repairs >= 3);
});

test("★서버 브랜드 레코드가 클라이언트 캐시보다 우선하고 시트-스펙 누락을 탐지한다", () => {
  const merged = mergeCharacterBodySpecsFromBrand(
    [{ token: "@네모", appearance: "오래된 캐시", negative: "" }],
    {
      brandCharacters: [{ trigger: "@네모", description: "파란 큐브형 몸, 뭉툭한 팔 끝", negativePrompt: "손가락, 사람 손" }],
      characterSheets: [{ token: "@네모", items: [{ sheetId: "sheet_1" }] }],
    }
  );
  assert.equal(merged.characters[0].appearance, "파란 큐브형 몸, 뭉툭한 팔 끝");
  assert.equal(merged.characters[0].negative, "손가락, 사람 손");
  assert.deepEqual(merged.missingRequired, []);

  const missing = mergeCharacterBodySpecsFromBrand(
    [{ token: "@네모" }],
    { characterSheets: [{ token: "@네모", items: [{ sheetId: "sheet_1" }] }], brandCharacters: [] }
  );
  assert.deepEqual(missing.missingRequired, ["@네모"]);
});

test("★컷 분해(Pass 2) 프롬프트에 신체 문법이 실린다", () => {
  const ko = buildShotUserPromptKo({ id: 1, estSec: 8, visual: "v" }, { characters: [NEMO] });
  assert.match(ko, /몸에 없는 것: .*손가락/);
  const en = buildShotUserPromptEn({ id: 1, estSec: 8, visual: "v" }, { characters: [NEMO] });
  assert.match(en, /does NOT have:/);
  // 스펙 없으면 프롬프트도 그대로다(불필요한 토큰 낭비 없음).
  const bare = buildShotUserPromptKo({ id: 1, estSec: 8, visual: "v" }, {});
  assert.doesNotMatch(bare, /신체 문법/);
});

test("★시나리오(Pass 1) 서버가 신체 스펙을 받고 프롬프트에 넣는다", () => {
  const src = read("prototype/functions/api/scenario.js");
  assert.match(src, /import \{ buildBodyGrammar, enforceBodyConstraintsInScenes \} from "\.\/_shared\/body-grammar\.js";/);
  assert.match(src, /resolveServerCharacterBodySpecs/);
  // normalizeCharacters 가 신체 스펙을 떨어뜨리지 않는다.
  assert.match(src, /appearance: String\(c\?\.appearance \|\| ""\)\.trim\(\),/);
  assert.match(src, /negative: String\(c\?\.negative \|\| c\?\.negativePrompt \|\| ""\)\.trim\(\),/);
  // 씬 본문 프롬프트(모드 규칙)와 비트별 프롬프트 양쪽에 주입된다.
  assert.match(src, /const bodyGrammar = buildBodyGrammar\(characters, lang\);/);
  const spliced = src.match(/\$\{charGuide\}\n\$\{bodyGrammar\}/g) || [];
  assert.equal(spliced.length, 2, "KO·EN 모드 프롬프트 양쪽에 있어야 한다");
  assert.match(src, /buildBodyGrammar\(input\.characters, "ko"\)/);
  assert.match(src, /buildBodyGrammar\(input\.characters, "en"\)/);
  assert.match(src, /const bodyAudit = enforceBodyConstraintsInScenes\(scenes, activeCharacters\);/);
  assert.match(src, /bodyConstraintRepairs: bodyAudit\.repairs/);
});

test("★컷 분해 API 가 캐릭터를 분해 프롬프트까지 넘긴다", () => {
  const shots = read("prototype/functions/api/scenario-shots.js");
  assert.match(shots, /decomposeScenes\(auth, scenes, \{ lang, env, characters \}\)/);
  assert.match(shots, /resolveServerCharacterBodySpecs/);
  assert.match(shots, /enforceBodyConstraintsInScenes\(flatScenes, characters\)/);
  const index = read("prototype/functions/api/scenario/shots/index.js");
  assert.match(index, /buildShotUserPromptEn\(scene, opts\) : buildShotUserPromptKo\(scene, opts\)/);
});

test("★클라이언트가 브랜드 허브의 신체 스펙을 캐릭터에 얹어 보낸다", () => {
  const src = read("prototype/js/ui/scenario.js");
  assert.match(src, /const withBodySpecs = \(list = \[\]\) =>/);
  assert.match(src, /registry\.getCharacterByTrigger\(brandId, c\.token\)/);
  assert.match(src, /appearance: sanitizeText\(brandChar\.description \|\| ''\)\.trim\(\),/);
  assert.match(src, /negative: sanitizeText\(brandChar\.negativePrompt \|\| ''\)\.trim\(\)/);
  // 생성 payload 와 컷 분해 호출 모두 스펙을 싣는다.
  assert.match(src, /payload\.characters = withBodySpecs\(/);
  assert.match(src, /characters: withBodySpecs\(Array\.isArray\(currentPayload\?\.characters\)/);
  assert.match(src, /brandId: payload\?\.brandId \|\| payload\?\.seriesId \|\| ''/);
});

test("★이야기 정리 단계도 서버 신체 스펙·프롬프트·결과 검사를 모두 사용한다", () => {
  const src = read("prototype/functions/api/story-structure.js");
  assert.match(src, /resolveServerCharacterBodySpecs/);
  assert.match(src, /buildBodyGrammar\(input\.characters, "ko"\)/);
  assert.match(src, /enforceStoryBodyConstraints\(structured, beats, input\.characters\)/);
  assert.match(src, /appearance: sanitizeText\(raw\.appearance \|\| raw\.description \|\| ""\)/);
});

test("★이미지 네거티브도 이중부정 없이 나간다", () => {
  const src = read("prototype/ui/pipeline-image.js");
  assert.match(src, /function negativeNounsForPrompt\(text\)/);
  const uses = src.match(/negativeNounsForPrompt\(imageCharacterNegativePrompt\)/g) || [];
  assert.equal(uses.length, 2, "네거티브를 붙이는 두 자리 모두에서 써야 한다");
  // 원문 그대로 이어 붙이는 자리가 남아 있으면 안 된다.
  assert.doesNotMatch(src, /'\\nDo not include: ' \+ imageCharacterNegativePrompt;/);
});
