import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

const guide = () => read("prototype/ui/pipeline-model-guide.js");
const pipeline = () => read("prototype/ui/pipeline.js");
const html = () => read("prototype/scenes.html");
const css = () => read("prototype/styles.css");
const specs = () => read("prototype/functions/api/_shared/video-specs.ts");
const videoGen = () => read("prototype/js/ui/ai-video-gen.js");

test("모델 셀렉트 오른쪽에 ? 버튼이 있고 모달을 연다", () => {
  const src = pipeline();
  assert.match(src, /id="video-model-help-btn"/);
  // 셀렉트가 닫힌 직후에 온다
  const selEnd = src.indexOf("'</select>' +\n      // lucide.dev/icons/circle-help");
  assert.ok(selEnd > -1, "? 버튼이 모델 셀렉트 바로 뒤에 있어야 한다");
  assert.match(src, /NK\.uiModelGuide\.open\(modelSelect \? modelSelect\.value : ''\)/);
  assert.match(html(), /id="video-model-guide-modal"/);
  assert.match(html(), /ui\/pipeline-model-guide\.js/);
});

test("모달은 ✕·배경 클릭·Esc 로 닫힌다", () => {
  const src = guide();
  assert.match(src, /data-vmg-close/);
  assert.match(src, /t\.id === 'video-model-guide-modal'/);
  assert.match(src, /if \(e\.key !== 'Escape'\) return;/);
});

test("★스크롤이 생기지 않도록 세로를 화면 높이로 묶는다", () => {
  const src = css();
  const box = src.slice(src.indexOf(".vmg-box {"), src.indexOf(".vmg-head {"));
  assert.match(box, /max-height:\s*9\d vh|max-height:\s*9\dvh/);
  assert.match(box, /overflow:\s*hidden/);
  // 표나 본문에 세로 스크롤을 허용하는 선언이 없어야 한다
  const modalCss = src.slice(src.indexOf("/* ── 영상 모델 가이드 모달"));
  assert.doesNotMatch(modalCss, /overflow-y:\s*(auto|scroll)/);
  assert.doesNotMatch(modalCss, /overflow:\s*(auto|scroll)/);
  // 낮은 화면에서 더 압축하는 규칙이 있어야 한 화면에 들어간다
  assert.match(modalCss, /@media \(max-height: 780px\)/);
});

test("표의 길이 정보가 video-specs.ts 와 어긋나지 않는다", () => {
  // 가이드가 실제 허용값과 다르면 사용자가 못 고르는 조합을 고르게 된다.
  const src = guide();
  const spec = specs();
  // Veo/Grok 계열 4·6·8
  assert.match(spec, /DURATIONS_VEO = \[4, 6, 8\]/);
  assert.match(src, /id: 'veo',[\s\S]{0,120}dur: '4·6·8'/);
  assert.match(src, /id: 'grok',[\s\S]{0,120}dur: '4·6·8'/);
  // Kling 5 또는 10
  assert.match(spec, /DURATIONS_KLING = \[5, 10\]/);
  assert.match(src, /id: 'kling-final',[\s\S]{0,140}dur: '5 또는 10'/);
  // Seedance / Wan 4~15
  assert.match(spec, /DURATIONS_SEEDANCE = \[4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15\]/);
  assert.match(src, /id: 'wan',[\s\S]{0,120}dur: '4~15'/);
  assert.match(src, /id: 'seedance',[\s\S]{0,120}dur: '4~15'/);
  // Vidu
  assert.match(spec, /DURATIONS_VIDU = \[4, 5, 6, 8, 10\]/);
  assert.match(src, /id: 'vidu-q3',[\s\S]{0,140}dur: '4·5·6·8·10'/);
});

test("레퍼런스 지원 표기가 ai-video-gen.js 의 caps 와 일치한다", () => {
  const src = guide();
  const gen = videoGen();
  // caps 에 refs 가 있는 모델만 '✓'
  for (const id of ["grok-r2v", "seedance-r2v", "wan", "vidu-q3"]) {
    assert.match(gen, new RegExp(`id: '${id}',[\\s\\S]{0,160}'refs'`), `${id} 는 refs 를 지원해야 한다`);
    assert.match(src, new RegExp(`id: '${id}',[\\s\\S]{0,200}refs: '✓`), `가이드에 ${id} refs 표기 누락`);
  }
  // caps 에 refs 가 없는 모델은 '✗'
  for (const id of ["veo", "veo-full", "grok", "seedance", "kling-final"]) {
    assert.match(src, new RegExp(`id: '${id}',[\\s\\S]{0,200}refs: '✗'`), `가이드에 ${id} 는 참조 없음이어야 한다`);
  }
});

test("★R2V 가 시작 이미지를 버린다는 사실이 표와 설명에 모두 있다", () => {
  // video.ts 의 실제 동작 — 이걸 모르면 이름만 보고 잘못 고른다.
  const api = read("prototype/functions/api/video.ts");
  assert.match(api, /R2V: 캐릭터 레퍼런스로만 생성 \(시작 이미지 미사용\)/);
  const src = guide();
  assert.match(src, /id: 'grok-r2v',[\s\S]{0,200}start: '✗ 버림'/);
  assert.match(src, /id: 'seedance-r2v',[\s\S]{0,200}start: '✗ 버림'/);
  assert.match(src, /시작 이미지를 <b>버립니다<\/b>/);
});

test("최소 4초 스냅으로 비용이 더 나간다는 점을 알려준다", () => {
  // pipeline-video.js 가 2초 컷을 4초로 스냅한다 → 짧은 컷일수록 낭비가 크다.
  assert.match(read("prototype/ui/pipeline-video.js"), /snapVideoDuration\(capped\)/);
  assert.match(guide(), /모든 모델의 최소가 4초/);
  assert.match(guide(), /잘라 쓰므로 그만큼 비용이 더 나갑니다/);
});

test("★비용은 지어내지 않고 상대 등급임을 밝힌다", () => {
  // 공급자 단가표가 앱에 없다. 정확한 금액을 지어내면 사용자가 그걸 믿고 결정한다.
  const src = guide();
  assert.match(src, /상대 등급/);
  assert.match(src, /정확한 금액은 공급자 콘솔에서 확인하세요/);
  // 달러 금액을 표에 박아두지 않았는지 확인
  assert.doesNotMatch(src, /\$\s?\d/, "확인되지 않은 금액이 표에 들어가 있다");
});

test("표에 9개 모델이 모두 있고 셀렉트 목록과 일치한다", () => {
  const src = guide();
  const pipe = pipeline();
  const ids = ["veo", "veo-full", "grok", "grok-r2v", "kling-final", "seedance", "seedance-r2v", "wan", "vidu-q3"];
  for (const id of ids) {
    assert.match(src, new RegExp(`id: '${id}'`), `가이드에 ${id} 없음`);
    assert.match(pipe, new RegExp(`__mopt\\('${id}'`), `셀렉트에 ${id} 없음`);
  }
  // 셀렉트에 없는 모델을 가이드가 보여주면 고를 수 없는 걸 추천하게 된다
  assert.doesNotMatch(src, /id: 'grok-extend'/);
});

test("현재 선택된 모델이 표에서 구분된다", () => {
  const src = guide();
  assert.match(src, /m\.id === currentModel \? 'is-current' : ''/);
  assert.match(src, /vmg-now">현재/);
  assert.match(css(), /\.vmg-table tr\.is-current/);
});
