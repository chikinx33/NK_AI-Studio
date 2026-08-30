import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

/**
 * 오브젝트(소품) 일관성 — 에피소드에 반복 등장하는 물건(예: ABC 큐브)이 컷마다 같아야 한다.
 *
 * 배경·소품 자산에는 kind(background|prop) 구분이 원래 있었지만, 클라이언트 정규화가
 * 그 필드를 통째로 떨어뜨리고 있었다. 저장하면 전부 background 가 돼서
 *  - 오브젝트가 "배경 장소"로 모델에 소개되고,
 *  - "레이아웃·구조를 그대로 유지하라"는 배경용 지시를 받았다.
 * 물건에 필요한 것은 정반대다: 생김새는 고정, 화면 안 위치·크기는 컷이 정한다.
 */

const hub = () => read("prototype/js/ui/knowledge-hub.js");
const imagen = () => read("prototype/functions/api/imagen.ts");
const pipelineImage = () => read("prototype/ui/pipeline-image.js");

test("★배경/소품 구분이 저장 경로 전체에서 살아남는다", () => {
  // 세 정규화기 모두 kind 를 보존해야 한 군데서만 지켜도 소용이 없다.
  [
    "prototype/js/ui/knowledge-hub.js",
    "prototype/js/service/project.js",
    "prototype/js/service/brand.js",
  ].forEach((file) => {
    const src = read(file);
    const start = src.indexOf("function normalizeEnvironmentAssets");
    assert.ok(start > -1, `${file} 에 배경·소품 정규화가 있어야 한다`);
    const block = src.slice(start, start + 1600);
    assert.match(block, /kind/, `${file} 이 kind 를 떨어뜨리면 소품 지정이 저장되지 않는다`);
    assert.match(block, /=== 'prop' \? 'prop' : 'background'|normalizeEnvironmentKind/, file);
  });
});

test("★허브에서 배경 ↔ 소품을 전환할 수 있다 (한/영)", () => {
  const src = hub();
  assert.match(src, /data-action="knowledge-environment-kind"/);
  assert.match(src, /action === 'knowledge-environment-kind'/);
  // 전환은 즉시 저장된다.
  const handler = src.slice(
    src.indexOf("if (action === 'knowledge-environment-kind') {"),
    src.indexOf("if (action === 'knowledge-environment-remove') {")
  );
  assert.match(handler, /kind: asset\.kind === 'prop' \? 'background' : 'prop'/);
  assert.match(handler, /persistEnvironmentDraft\(\)/);
  // 한/영 문구가 짝으로 있다.
  assert.match(src, /kindProp: 'Prop'/);
  assert.match(src, /kindProp: '소품'/);
  assert.match(src, /kindBackground: 'Place'/);
  assert.match(src, /kindBackground: '배경'/);
});

test("★토글 버튼은 상태가 바뀌어도 폭이 흔들리지 않는다", () => {
  const css = read("prototype/styles.css");
  const block = css.slice(
    css.indexOf(".knowledge-environment-kind {"),
    css.indexOf(".knowledge-environment-kind.is-prop")
  );
  assert.match(block, /min-width:\s*\d+px/);
});

test("★소품은 배경이 아니라 오브젝트 레퍼런스로 붙는다", () => {
  const src = pipelineImage();
  const block = src.slice(
    src.indexOf("function buildEnvironmentReferenceBundle"),
    src.indexOf("function mergeEnvironmentReferences")
  );
  assert.match(block, /referenceKind: isProp \? 'prop' : 'environment'/);
  // 소품 지시문: 생김새는 고정, 구도는 이 컷이 정한다.
  assert.match(block, /Keep its exact design, shape, proportions, markings, materials, and colors in every cut/);
  assert.match(block, /Render it at the position, size, and angle this shot requires/);
  // 배경 지시문(레이아웃 유지)은 장소에만 남는다.
  assert.match(block, /keep the same layout, architecture, props, materials, colors, and lighting/);
});

test("★레퍼런스 슬롯이 모자라면 소품을 먼저 채운다", () => {
  const src = pipelineImage();
  const block = src.slice(
    src.indexOf("function matchEnvironmentAssets"),
    src.indexOf("function buildEnvironmentReferenceBundle")
  );
  assert.match(block, /kind === 'prop'\) \? 0 : 1/);
});

test("★서버가 prop 레퍼런스를 오브젝트로 다룬다", () => {
  const src = imagen();
  assert.match(src, /rkRaw === "prop" \|\| rkRaw === "object"/);

  const propBranch = src.slice(
    src.indexOf('if (item.referenceKind === "prop") {', src.indexOf("consistencyLines")),
    src.indexOf('if (item.referenceKind === "environment-detail") {', src.indexOf("consistencyLines"))
  );
  assert.ok(propBranch, "consistency 지시문에 소품 분기가 있어야 한다");
  assert.doesNotMatch(
    propBranch,
    /keep the exact same layout/,
    "물건에 배경용 레이아웃 유지 지시가 붙으면 장소처럼 취급된다"
  );
  assert.match(propBranch, /render it at the position, size, and angle this shot requires/);

  // 캐릭터 수 집계에 소품이 섞이면 안 된다(사람으로 렌더될 수 있다).
  assert.match(src, /const isCharacterRef[\s\S]{0,260}item\.referenceKind !== "prop"/);
  // 한 장짜리 소품 레퍼런스도 이미지 옆 라벨을 받는다.
  assert.match(src, /referenceKind === "environment-detail" \|\| item\.referenceKind === "prop"/);
});
