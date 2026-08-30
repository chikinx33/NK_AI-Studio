import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

const guide = () => read("prototype/ui/pipeline-model-guide.js");
const pipeline = () => read("prototype/ui/pipeline.js");

/**
 * 이미지 모델 안내 모달 — 영상 모델 가이드와 같은 자리·같은 방식.
 *
 * 값의 출처는 공급자 공식 문서다(2026-08-30 확인). 앱이 추측한 값을 싣지 않는다.
 *   OpenAI gpt-image-2 /v1/images/edits : 16장, 1M 토큰당 텍스트 $5 / 이미지 입력 $8 / 출력 $30
 *   Gemini 3.1 Flash Image             : 14장, 출력 1K $0.067 · 2K $0.101 · 4K $0.151
 */

test("★이미지 모델 셀렉트 옆 ? 버튼이 안내 모달을 연다", () => {
  const src = pipeline();
  assert.match(src, /id="image-model-help-btn"/);
  assert.match(src, /NK\.uiModelGuide\.openImage\(sel \? sel\.value : ''\)/);
  // 이미지 모델 셀렉트 바로 뒤에 온다.
  const selEnd = src.indexOf("'</select>' +\n      // lucide.dev/icons/circle-help — 이미지 모델");
  assert.ok(selEnd > -1, "? 버튼이 이미지 모델 셀렉트 바로 뒤에 있어야 한다");
  // 영상 가이드와 같은 모달 컨테이너를 쓴다.
  assert.match(guide(), /guide\.openImage = function \(currentProvider\)/);
  assert.match(guide(), /getElementById\('video-model-guide-modal'\)/);
});

test("★레퍼런스 최대 장수를 공식 값으로 싣는다", () => {
  const src = guide();
  const table = src.slice(src.indexOf("var IMAGE_MODELS = ["), src.indexOf("function imageRowHtml"));
  assert.match(table, /id: 'openai'[\s\S]{0,200}refs: '16장'/);
  assert.match(table, /id: 'gemini'[\s\S]{0,200}refs: '14장'/);
  // 코드의 실제 상한과 어긋나면 안내가 거짓이 된다.
  const client = read("prototype/ui/pipeline-image.js");
  assert.equal(Number(client.match(/var MAX_REFERENCE_IMAGES = (\d+);/)[1]), 16);
  const server = read("prototype/functions/api/imagen.ts");
  assert.equal(Number(server.match(/const GEMINI_MAX_REFERENCE_IMAGES = (\d+);/)[1]), 14);
});

test("★두 모델의 차이(구분 방식·비용·약점)를 설명한다", () => {
  const src = guide();
  const render = src.slice(src.indexOf("guide.renderImage = function"), src.indexOf("guide.openImage = function"));
  // 표 머리
  assert.match(render, /레퍼런스 최대/);
  assert.match(render, /이미지 구분 방식/);
  assert.match(render, /비용/);
  // 본문: 왜 구분 방식이 다른지, 몇 장이 적당한지, 폴백이 어떻게 되는지
  assert.match(render, /Gemini 는 각 이미지 <b>바로 옆<\/b>/);
  assert.match(render, /보내는 순서/);
  assert.match(render, /4장까지<\/b>를 권합니다/);
  assert.match(render, /폴백/);
  // 우선순위(무엇이 먼저 남는지)를 사용자에게 알려준다.
  assert.match(render, /각 캐릭터의 첫 시트 → 컷 레퍼런스 → /);
});

test("★비용은 공급자 공식 가격표를 확인 날짜와 함께 밝힌다", () => {
  const src = guide();
  const render = src.slice(src.indexOf("guide.renderImage = function"), src.indexOf("guide.openImage = function"));
  assert.match(render, /2026-08-30 확인/);
  assert.match(render, /이미지 출력 \$30/);
  assert.match(render, /1K \$0\.067/);
});

test("★영상 가이드와 같은 방법으로 닫힌다", () => {
  const src = guide();
  const render = src.slice(src.indexOf("guide.renderImage = function"), src.indexOf("guide.openImage = function"));
  assert.match(render, /data-vmg-close/);
  // 닫기 핸들러(✕·배경·Esc)는 모듈 하나를 공유한다.
  assert.match(src, /t\.id === 'video-model-guide-modal'/);
});
