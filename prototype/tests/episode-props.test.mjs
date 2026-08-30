import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

/**
 * 에피소드 전용 소품(오브젝트).
 *
 * 브랜드 허브의 배경·소품 자산은 IP 전체에서 오래 쓰는 공용 자산이다. 그런데 한 에피소드에서만
 * 반복 등장하는 물건(예: 이번 화의 큐브)은 거기 쌓으면 안 된다. 그래서 에피소드 레퍼런스 모달에
 * 소품 목록을 두고, 생성 / 파일 등록 / 드래그 앤 드롭으로 이미지를 붙일 수 있게 했다.
 * 이름은 함께 저장되고, 컷 생성 때 그 이름이 씬 텍스트에 나오면 소품 레퍼런스로 붙는다.
 */

const pipeline = () => read("prototype/ui/pipeline.js");
const pipelineImage = () => read("prototype/ui/pipeline-image.js");

const bgRefModal = () => {
  const src = pipeline();
  const start = src.indexOf("var props = (st0.payload && Array.isArray(st0.payload.episodeProps))");
  assert.ok(start > -1, "에피소드 소품 상태가 있어야 한다");
  return src;
};

test("★에피소드 소품은 이름·묘사·이미지가 함께 저장된다", () => {
  const src = bgRefModal();

  // 불러오기
  assert.match(src, /st0\.payload\.episodeProps/);
  // 입력 동기화(이름·묘사)
  assert.match(src, /\.bgprop-name'\);\s*if \(nm\) props\[i\]\.name = nm\.value;/);
  assert.match(src, /\.bgprop-desc'\);\s*if \(ds\) props\[i\]\.description = ds\.value;/);
  // 저장
  const save = src.slice(src.indexOf("function doSave()"), src.indexOf("function doSave()") + 1800);
  assert.match(save, /episodeProps: cleanedProps/);
  assert.match(save, /name: String\(p\.name \|\| ''\)\.trim\(\)/);
  assert.match(save, /description: String\(p\.description \|\| ''\)\.trim\(\)/);
  assert.match(save, /refObjectName: p\.refObjectName \|\| ''/);
  // 이미지가 아직 없어도 이름만으로 남는다(입력 유실 방지).
  assert.match(save, /\.filter\(function \(p\) \{ return String\(p\.name \|\| ''\)\.trim\(\); \}\)/);
});

test("★소품 이미지는 생성·파일 선택·드래그 앤 드롭 세 경로로 등록된다", () => {
  const src = bgRefModal();

  // 생성
  assert.match(src, /async function generateProp\(i\)/);
  // 파일 선택
  assert.match(src, /class="bgprop-file" accept="image\/\*"/);
  assert.match(src, /pick\.onclick = function \(\) \{ syncFromInputs\(\); file\.click\(\); \}/);
  // 드래그 앤 드롭
  assert.match(src, /drop\.ondrop = function \(ev\)/);
  assert.match(src, /function handlePropDrop\(i, ev\)/);
  // 파일 드롭과 화면 안 이미지(URL) 드롭 둘 다 받는다.
  assert.match(src, /dt\.files && dt\.files\[0\]/);
  assert.match(src, /getData\('text\/uri-list'\)/);
  assert.match(src, /getData\('text\/html'\)/);
  assert.match(src, /async function urlToImageFile\(url, nameHint\)/);
  // 업로드는 공용 업로드 API 를 쓰고 objectName 을 저장한다.
  assert.match(src, /NK\.api\.imageUpload\(st\.draftId, file, \{ kind: 'image' \}\)/);
  assert.match(src, /p\.refObjectName = objectName;/);
});

test("★소품 생성 프롬프트는 물건 하나만 크게, 배경은 비운다", () => {
  const src = bgRefModal();
  const fn = src.slice(
    src.indexOf("async function generateProp(i)"),
    src.indexOf("async function attachPropImage(i, file)")
  );
  assert.match(fn, /SUBJECT: the prop/);
  assert.match(fn, /one isolated object, centered, filling most of the frame/);
  assert.match(fn, /Plain neutral empty background/);
  assert.match(fn, /No characters, no people, no hands/);
  // 화풍은 공통 프롬프트가 단일 출처 — 여기서 특정 화풍을 박지 않는다.
  assert.match(fn, /commonPromptOf\(st\)/);
  assert.doesNotMatch(fn, /3D animation|photorealistic|anime style/i);
});

test("★등록한 에피소드 소품이 컷 생성에서 실제로 참조된다", () => {
  const src = pipelineImage();
  assert.match(src, /function episodePropAssets\(payload, projectRecord\)/);

  const fn = src.slice(
    src.indexOf("function episodePropAssets(payload, projectRecord)"),
    src.indexOf("function collectEnvironmentAssets(payload, options)")
  );
  // 배경·소품 자산과 같은 모양으로 바꿔 같은 매칭 경로를 탄다.
  assert.match(fn, /kind: 'prop'/);
  assert.match(fn, /mediaProxyObjectUrl\(objectName\)/);
  assert.match(fn, /items: \[\{ sheetId: 'episode', imageDataUrl: url, isPrimary: true \}\]/);

  // 소스 목록 맨 앞 — 같은 이름이면 에피소드 등록분이 브랜드 공용 자산을 이긴다.
  const sources = src.slice(
    src.indexOf("return mergeEnvironmentAssetSources(["),
    src.indexOf("return mergeEnvironmentAssetSources([") + 700
  );
  const propAt = sources.indexOf("episodePropAssets(safePayload, projectRecord)");
  const brandAt = sources.indexOf("brandKnowledge && brandKnowledge.environmentAssets");
  assert.ok(propAt > -1 && brandAt > propAt, "에피소드 소품이 브랜드 자산보다 앞에 와야 한다");
});

test("★소품 목록은 배경 목록과 같은 모달 안에 따로 구분돼 있다", () => {
  const src = bgRefModal();
  assert.match(src, /에피소드 레퍼런스 \(배경·소품\)/);
  assert.match(src, /공간 \(배경 플레이트\)/);
  assert.match(src, /소품 \(오브젝트\)/);
  assert.match(src, /id="bgprop-add"/);
});
