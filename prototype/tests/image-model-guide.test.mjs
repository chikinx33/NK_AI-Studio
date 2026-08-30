import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

const guide = () => read("prototype/ui/pipeline-model-guide.js");
const pipeline = () => read("prototype/ui/pipeline.js");
const css = () => read("prototype/styles.css");

/**
 * 이미지 모델 안내 모달 — 영상 모델 가이드와 같은 자리·같은 방식.
 *
 * 값의 출처는 공급자 공식 문서다(2026-08-30 확인). 앱이 추측한 값을 싣지 않는다.
 *   OpenAI gpt-image-2 /v1/images/edits : 16장, 1M 토큰당 텍스트 $5 / 이미지 입력 $8 / 출력 $30
 *   Gemini 3.1 Flash Image             : 14장, 출력 1K $0.067 · 2K $0.101 · 4K $0.151
 */

const imageDict = () => {
  const src = guide();
  return src.slice(src.indexOf("var IMAGE_TEXT = {"), src.indexOf("function imageText()"));
};

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
  const dict = imageDict();
  assert.match(dict, /openai: \{[\s\S]{0,120}refs: '16장'/);
  assert.match(dict, /gemini: \{[\s\S]{0,120}refs: '14장'/);
  // 코드의 실제 상한과 어긋나면 안내가 거짓이 된다.
  const client = read("prototype/ui/pipeline-image.js");
  assert.equal(Number(client.match(/var MAX_REFERENCE_IMAGES = (\d+);/)[1]), 16);
  const server = read("prototype/functions/api/imagen.ts");
  assert.equal(Number(server.match(/const GEMINI_MAX_REFERENCE_IMAGES = (\d+);/)[1]), 14);
});

test("★두 모델의 차이(구분 방식·비용·약점)를 설명한다", () => {
  const dict = imageDict();
  // 표 머리
  assert.match(dict, /레퍼런스 최대/);
  assert.match(dict, /이미지 구분 방식/);
  // 본문: 왜 구분 방식이 다른지, 몇 장이 적당한지, 폴백이 어떻게 되는지
  assert.match(dict, /Gemini 는 각 이미지 <b>바로 옆<\/b>/);
  assert.match(dict, /보내는 순서/);
  assert.match(dict, /4장까지<\/b>를 권합니다/);
  assert.match(dict, /폴백/);
  // 우선순위(무엇이 먼저 남는지)를 사용자에게 알려준다.
  assert.match(dict, /각 캐릭터의 첫 시트 → 컷 레퍼런스 → /);
});

test("★비용은 공급자 공식 가격표를 확인 날짜와 함께 밝힌다", () => {
  const dict = imageDict();
  assert.match(dict, /2026-08-30 확인/);
  assert.match(dict, /이미지 출력 \$30/);
  assert.match(dict, /1K \$0\.067/);
  // 영문도 같은 근거를 밝힌다.
  assert.match(dict, /checked 2026-08-30/);
});

test("★한/영 사전이 짝을 이룬다", () => {
  const src = guide();
  const dict = imageDict();
  assert.match(dict, /ko: \{/);
  assert.match(dict, /en: \{/);
  // 두 언어의 키가 같아야 한다(한쪽만 만들고 미루지 않게).
  const koBlock = dict.slice(dict.indexOf("ko: {"), dict.indexOf("en: {"));
  const enBlock = dict.slice(dict.indexOf("en: {"));
  const keysOf = (block) => (block.match(/^\s{6}([a-zA-Z]+):/gm) || []).map((m) => m.trim());
  assert.deepEqual(keysOf(koBlock), keysOf(enBlock));
  // 언어를 따라가고, 열린 채 바꿔도 다시 그린다.
  assert.match(src, /function guideLang\(\)/);
  assert.match(src, /window\.addEventListener\('nk:lang-changed'/);
  assert.match(src, /openState\.kind === 'image'/);
  // 적합도 배지도 영문이 있다.
  assert.match(src, /'best':\s+\{ label: '추천',\s+en: 'Best'/);
});

test("★이미지 표는 칸 수에 맞는 폭 규칙을 쓴다", () => {
  const src = guide();
  // 영상 표(9칸)와 폭 규칙을 공유하면 강점이 짜부라진다 — 전용 클래스로 분리.
  assert.match(src, /class="vmg-table vmg-table-image"/);
  const block = css().slice(css().indexOf(".vmg-table.vmg-table-image th:nth-child(1)"));
  const widths = [];
  for (let i = 1; i <= 8; i++) {
    const m = block.match(new RegExp("vmg-table-image td:nth-child\\(" + i + "\\) \\{ width: ([\\d.]+)%"));
    assert.ok(m, i + "번 칸 폭이 정의돼야 한다");
    widths.push(Number(m[1]));
  }
  assert.equal(widths.length, 8);
  assert.ok(Math.abs(widths.reduce((a, b) => a + b, 0) - 100) < 1, "폭 합이 100% 여야 한다");
  // 강점(6번)은 넓게, 적합도(8번)는 배지만 들어가면 되니 좁게.
  assert.ok(widths[5] >= 20, "강점 칸이 좁으면 문장이 세로로 짜부라진다");
  assert.ok(widths[7] <= 10, "적합도는 배지 하나라 넓을 이유가 없다");
  assert.ok(widths[5] > widths[7] * 2);
});

test("★영상 가이드와 같은 방법으로 닫힌다", () => {
  const src = guide();
  const render = src.slice(src.indexOf("guide.renderImage = function"), src.indexOf("guide.openImage = function"));
  assert.match(render, /data-vmg-close/);
  // 닫기 핸들러(✕·배경·Esc)는 모듈 하나를 공유한다.
  assert.match(src, /t\.id === 'video-model-guide-modal'/);
});
