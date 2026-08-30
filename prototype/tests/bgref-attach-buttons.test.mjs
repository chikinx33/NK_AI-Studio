import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");
const pipeline = () => read("prototype/ui/pipeline.js");

/**
 * 배경 레퍼런스 모달의 이미지 등록 경로.
 *   공간(배경 플레이트) — 배경 생성 · 파일 등록 · 저장소
 *   소품(오브젝트)      — 소품 생성 · 파일 등록 · 저장소 · 드래그/붙여넣기
 *
 * 저장소에서 고르면 프록시 URL 이 돌아오는데, 그 URL 에는 토큰이 붙어 있어 그대로
 * 저장하면 나중에 만료된다. objectName 으로 되돌려 저장해야 한다.
 */

test("★공간 행에 파일 등록·저장소 버튼이 있다", () => {
  const src = pipeline();
  const start = src.indexOf('class="bgref-item"');
  const row = src.slice(start, src.indexOf('class="bgref-variant"', start));
  assert.match(row, /class="btn-secondary compact bgref-pick"/);
  assert.match(row, /class="btn-secondary compact bgref-lib"/);
  assert.match(row, /class="bgref-file" accept="image\/\*"/);
  // 생성 중에는 누를 수 없다.
  assert.match(row, /bgref-pick"[\s\S]{0,60}l\._busy \? ' disabled' : ''/);
});

test("★소품 행에 저장소 버튼이 있다", () => {
  const src = pipeline();
  const start = src.indexOf('class="bgprop-item"');
  const row = src.slice(start, src.indexOf("overlay.innerHTML", start));
  assert.match(row, /class="btn-secondary compact bgprop-lib"/);
  // 기존 파일 등록도 그대로 있다.
  assert.match(row, /class="btn-secondary compact bgprop-pick"/);
});

test("★두 목록이 같은 등록 경로를 쓴다", () => {
  const src = pipeline();
  assert.match(src, /function refRowOf\(kind, i\)/);
  assert.match(src, /async function attachRefImageFile\(kind, i, file\)/);
  assert.match(src, /async function pickRefFromLibrary\(kind, i\)/);
  // 공간·소품 양쪽에서 부른다.
  assert.match(src, /attachRefImageFile\('loc', i, f\)/);
  assert.match(src, /pickRefFromLibrary\('loc', i\)/);
  assert.match(src, /pickRefFromLibrary\('prop', i\)/);
});

test("★저장소에서 고른 것은 objectName 으로 저장한다", () => {
  const src = pipeline();
  const fn = src.slice(src.indexOf("async function pickRefFromLibrary"), src.indexOf("// 업로드하거나 끌어다 놓은 이미지를"));
  // 프록시 URL 을 그대로 저장하면 토큰이 만료돼 나중에 깨진다.
  assert.match(fn, /NK\.api\.objectNameFromUrl\(url\)/);
  assert.match(fn, /row\.refObjectName = objectName;/);
  assert.doesNotMatch(fn, /row\.refObjectName = url/);
  // 저장소가 비면 알려 준다.
  assert.match(fn, /if \(!items\.length\) \{ alert\(T\(\)\.libraryEmpty\); return; \}/);
});

test("★저장소 창은 다른 스코프에 있으므로 네임스페이스로 부른다", () => {
  const src = pipeline();
  // openLibraryModal 은 IIFE 안에, 배경 레퍼런스 모달은 최상위에 있다.
  // 그대로 부르면 ReferenceError 가 난다.
  assert.match(src, /NK\.uiPipeline\.openLibraryModal = openLibraryModal;/);
  assert.match(src, /var openLib = NK\.uiPipeline && NK\.uiPipeline\.openLibraryModal;/);
  assert.match(src, /if \(typeof openLib !== 'function'\)/);
});

test("★버튼 문구가 한/영 짝으로 있다", () => {
  const src = pipeline();
  ["pickFile", "pickLibrary", "libraryEmpty", "libraryFail"].forEach((key) => {
    const hits = src.match(new RegExp("\\b" + key + ":", "g")) || [];
    assert.equal(hits.length, 2, key + " 가 한/영 두 번 있어야 한다");
  });
  assert.match(src, /pickLibrary: '저장소'/);
  assert.match(src, /pickLibrary: 'Library'/);
});
