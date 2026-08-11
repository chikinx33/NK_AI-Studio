import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const shared = () => read("prototype/functions/api/agent/_shared.ts");
const orch = () => read("prototype/functions/api/agent/_orchestrator.ts");

// 증상: "우리 스튜디오 자산 확인해서 그려줘" → 픽셀이 image_library(생성 결과물)를 조회하고
// "자산이 비어있다"고 답했다. 등록 캐릭터 시트는 ip_library(브랜드 IP)에 있다.

test("image_library 는 캐릭터 시트가 없다는 사실을 알려준다", () => {
  const src = orch();
  assert.match(src, /image_library[\s\S]{0,400}브랜드 허브에 등록된 캐릭터 시트·IP 자산은 여기에 없다/);
  assert.match(src, /여기서 비었다고 자산이 없다고 결론짓지 말 것/);
});

test("ip_library 가 '우리 캐릭터/자산' 요청의 목적지로 명시된다", () => {
  const src = orch();
  assert.match(src, /ip_library[\s\S]{0,300}"우리 캐릭터", "스튜디오\/브랜드 자산"/);
  // brandId 를 모를 때의 경로까지 안내해야 실제로 호출할 수 있다
  assert.match(src, /brandId를 모르면 brand_list로 먼저 확인/);
});

test("등록 시트를 이미지 생성의 신원 가이드로 넘길 수 있다", () => {
  const src = shared();
  assert.match(src, /const referenceImages = \(Array\.isArray\(input\?\.referenceImages\) \? input\.referenceImages : \[\]\)/);
  // ip_library 결과(signedUrl)를 그대로 받아들인다
  assert.match(src, /raw\?\.imageUrl \|\| raw\?\.url \|\| raw\?\.signedUrl \|\| raw\?\.imageDataUrl/);
  assert.match(src, /referenceKind: String\(raw\?\.referenceKind \|\| "character"\)/);
  assert.match(src, /\.slice\(0, 4\)/);
  assert.match(src, /referenceImages,/);
});

test("레퍼런스가 있어도 구도는 프롬프트가 정한다 (text-to-image 고정)", () => {
  // imagen 기본값은 레퍼런스가 있으면 image-to-image → 1번 이미지가 구도 기준이 되어
  // 포스터가 캐릭터 시트 구도를 그대로 베낀다. 그래서 명시하지 않으면 text-to-image 로 둔다.
  assert.match(
    shared(),
    /generationMode: String\(input\?\.generationMode \|\| ""\)\.trim\(\) \|\| \(referenceImages\.length \? "text-to-image" : undefined\)/
  );
  assert.match(read("prototype/functions/api/imagen.ts"), /return hasReferences \? "image-to-image" : "text-to-image"/);
});

test("이미지 도구 설명이 시트 조회를 선행하도록 지시한다", () => {
  assert.match(orch(), /★우리 캐릭터가 등장하는 그림이면 반드시 ip_library로 등록 시트를 먼저 조회해 referenceImages\(최대 4개\)로 넘긴다/);
});
