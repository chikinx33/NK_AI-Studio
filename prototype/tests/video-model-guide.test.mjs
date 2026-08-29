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

test("★가이드·caps 가 공급자 스키마와 일치한다 (앱 내부 표를 근거로 삼지 않는다)", () => {
  // v3.1588 가이드는 ai-video-gen.js 의 caps 를 믿고 만들었는데, 그 표 자체가 틀려서
  // "Wan 2.7 = 시작 이미지 + 참조 동시 사용 / 추천" 이라는 거짓이 화면에 실렸다.
  const src = guide();
  const gen = videoGen();

  // Wan i2v 스키마에는 reference_images 가 없다 → caps 와 가이드 모두 참조 없음이어야 한다
  assert.doesNotMatch(gen, /id: 'wan',[\s\S]{0,160}'refs'/, "caps 가 아직 wan 에 refs 를 달고 있다");
  assert.match(src, /id: 'wan',[\s\S]{0,200}refs: '✗'/);
  assert.match(src, /참조 미지원 — i2v 스키마에 파라미터가 없음/);

  // 참조 장수는 스키마 값과 같아야 한다
  assert.match(gen, /id: 'grok-r2v',[\s\S]{0,200}maxRefs: 7/);
  assert.match(src, /id: 'grok-r2v',[\s\S]{0,220}refs: '✓ 7장'/);
  assert.match(gen, /id: 'seedance-r2v',[\s\S]{0,220}maxRefs: 9/);
  assert.match(src, /id: 'seedance-r2v',[\s\S]{0,220}refs: '✓ 9장'/);
  assert.match(gen, /id: 'vidu-q3',[\s\S]{0,220}maxRefs: 4/);
  assert.match(src, /id: 'vidu-q3',[\s\S]{0,240}refs: '✓ 1~4장'/);
});

test("★시작 이미지와 참조는 택일임을 명시한다", () => {
  // 둘을 동시에 받는 모델은 없다. 이걸 모르면 R2V 를 골라 스틸컷을 날린다.
  const src = guide();
  assert.match(src, /시작 이미지 vs 참조는 택일입니다/);
  assert.match(src, /참조를 쓰는 모델\(R2V\)은 예외 없이 스틸컷을 버리고/);
  // 참조를 쓰는 모델은 전부 시작 이미지를 못 쓴다고 표기돼야 한다
  for (const id of ["grok-r2v", "seedance-r2v"]) {
    assert.match(src, new RegExp(`id: '${id}',[\\s\\S]{0,200}start: '✗ 버림'`));
  }
  assert.match(src, /id: 'vidu-q3',[\s\S]{0,220}start: '✗ 참조에 섞임'/);
});

test("최소 4초 스냅으로 비용이 더 나간다는 점을 알려준다", () => {
  assert.match(read("prototype/ui/pipeline-video.js"), /snapVideoDuration\(capped\)/);
  assert.match(guide(), /모든 모델의 최소가 4초/);
  assert.match(guide(), /컷이 짧을수록 낭비가 큽니다/);
});

test("★비용은 확인한 실제 단가만 싣고, 못 confirm 한 건 미확인으로 둔다", () => {
  const src = guide();
  // Atlas Cloud 스키마에서 확인한 요청당 단가
  assert.match(src, /'veo':\s*\{ usd: 0\.08/);
  assert.match(src, /'veo-full':\s*\{ usd: 0\.2/);
  assert.match(src, /'kling-final':\s*\{ usd: 0\.06/);
  assert.match(src, /'seedance':\s*\{ usd: 0\.112/);
  assert.match(src, /'wan':\s*\{ usd: 0\.1/);
  assert.match(src, /'vidu-q3':\s*\{ usd: 0\.106/);
  assert.match(src, /'grok-r2v':\s*\{ usd: 0\.05/);
  // 확인 못 한 값은 지어내지 않는다
  assert.match(src, /'grok':\s*\{ usd: null/);
  assert.match(src, /미확인/);
  // 확인 날짜와 출처를 밝힌다
  assert.match(src, /Atlas Cloud <b>요청당 기본 단가<\/b>\(2026-08-30 확인\)/);
});

test("★회귀: Vidu 이미지 상한이 스키마(1~4)를 넘지 않는다", () => {
  // 7장까지 담고 있었다 — 5장 이상이면 공급자가 요청을 거절한다.
  const src = read("prototype/functions/api/video.ts");
  assert.match(src, /if \(viduImages\.length >= 4\) break;/);
  assert.doesNotMatch(src, /viduImages\.length >= 7/);
});

test("★회귀: Wan i2v 에 존재하지 않는 reference_images 를 보내지 않는다", () => {
  // 공급자가 조용히 버려서, 캐릭터 참조가 한 번도 전달된 적이 없었다.
  // seedance-r2v 는 실제로 reference_images 를 받으므로, wan 분기만 떼어 검사한다.
  const src = read("prototype/functions/api/video.ts");
  const wanStart = src.indexOf('if (videoModel === "wan")');
  assert.ok(wanStart > -1, "wan 분기를 찾지 못했다");
  const wanBlock = src.slice(wanStart, src.indexOf("atlasRes", wanStart));
  assert.doesNotMatch(wanBlock, /atlasBody\.reference_images/);
  assert.match(wanBlock, /wan_refs_dropped/);
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
