import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

/**
 * ★타임라인(beats)이 화면에 한 번도 나타나지 않았던 진짜 이유.
 *
 * 서버는 beats 를 만들어 보냈는데, 클라이언트가 컷 분할 결과를 화면용으로 다시 만드는
 * normalizeScenes 가 고정된 필드 목록으로 객체를 새로 조립하면서 beats 를 통째로 버렸다.
 * 프롬프트를 고치고 재요청을 넣어도 소용이 없었던 것은 값이 문 앞에서 버려졌기 때문이다.
 *
 * 층마다 "이 층에 코드가 있다" 만 확인하는 테스트는 이 버그를 못 잡는다.
 * 값이 지나가는 모든 길목을 하나씩 짚는다.
 */

const scenarioUi = () => read("prototype/js/ui/scenario.js");

test("★씬을 새로 조립하는 모든 자리가 beats 를 지킨다", () => {
  // 씬 모양 객체를 만드는 자리 = composition 을 채우는 객체 리터럴.
  // 그런 자리마다 beats 가 함께 있어야 한다. 하나라도 빠지면 그 길목에서 값이 사라진다.
  const src = scenarioUi();
  const sites = [];
  const re = /composition:/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const line = src.slice(0, m.index).split("\n").length;
    const around = src.slice(Math.max(0, m.index - 1500), m.index + 1500);
    sites.push({ line, hasBeats: around.includes("beats") });
  }
  assert.ok(sites.length >= 4, `씬 조립 자리를 찾지 못했다 (${sites.length}곳)`);
  const dropped = sites.filter((s) => !s.hasBeats).map((s) => s.line);
  assert.deepEqual(dropped, [], `이 줄에서 beats 가 빠진다: ${dropped.join(", ")}`);
});

test("★서버 → 화면 첫 관문(normalizeScenes)이 beats 를 넘긴다", () => {
  const src = scenarioUi();
  const fn = src.slice(src.indexOf("const normalizeScenes = (scenes = []) => {"), src.indexOf("const normalizePublishResults"));
  assert.ok(fn, "normalizeScenes 를 찾아야 한다");
  assert.match(fn, /beats: normalizeSceneBeats\(s\.beats\),/);
  // 두 줄 미만은 시간표가 아니다(변화 없음).
  assert.match(src, /if \(!Array\.isArray\(raw\) \|\| raw\.length < 2\) return null;/);
  // 첫 줄은 언제나 컷의 시작(=스틸컷).
  const helper = src.slice(src.indexOf("const normalizeSceneBeats = (raw) => {"), src.indexOf("const normalizeScenes = (scenes = []) => {"));
  assert.match(helper, /out\[0\]\.at = 0;/);
});

test("★복사 → 붙여넣기 왕복에서도 살아남는다", () => {
  const src = scenarioUi();
  // 복사 텍스트에 싣고
  assert.match(src, /if \(beatsLine\) lines\.push\(`타임라인: \$\{beatsLine\}`\);/);
  // 붙여넣기 파서가 읽고
  assert.match(src, /장소\|화면\|행동\|타임라인\|시각화\|나레이션\|대사/);
  assert.match(src, /'타임라인': 'beats'/);
  // 다시 배열로 되돌린다
  assert.match(src, /beats: textToBeats\(String\(p\.beats \|\| ''\)/);
});

test("★편집 수집·스냅샷 머지도 지킨다", () => {
  const src = scenarioUi();
  assert.match(src, /const beats = beatsEl \? textToBeats\(/);
  assert.match(src, /const beats = \(s\.beats !== undefined \? s\.beats : prev\.beats\) \|\| null;/);
});

test("★서버가 컷 분할 결과에 beats 를 실어 보낸다", () => {
  const flatten = read("prototype/functions/api/scenario-shots.js");
  assert.match(flatten, /beats: Array\.isArray\(sh\.beats\) && sh\.beats\.length \? sh\.beats : null,/);
});

test("★★서버 저장·불러오기가 beats 를 지킨다", () => {
  // 여기가 마지막 관문이었다. 서버는 씬을 고정 목록으로 다시 만드는데 beats 가 없어서,
  // 저장하면 서버가 버리고 새로고침하면 사라졌다. 클라이언트만 고쳐서는 소용이 없다.
  ["prototype/functions/api/project/save.ts", "prototype/functions/api/project/get.ts"].forEach((file) => {
    const src = read(file);
    assert.match(src, /const normalizeBeats = \(value: any\) => \{/, file);
    assert.match(src, /beats: normalizeBeats\(s\?\.beats\),/, file);
    // 첫 줄은 언제나 컷의 시작(=스틸컷).
    assert.match(src, /out\[0\]\.at = 0;/, file);
    // 두 줄 미만은 시간표가 아니다.
    assert.match(src, /if \(!Array\.isArray\(value\) \|\| value\.length < 2\) return null;/, file);
  });
});

test("★시나리오 카드의 글자가 잘리지 않는다", () => {
  // 높이를 못 박아 두면 두 줄 넘는 타임라인·화면 설명이 잘려 글자가 겹쳐 보인다.
  const css = read("prototype/styles.css");
  const block = css.slice(
    css.indexOf(".scenario-card .view-lines,"),
    css.indexOf(".scenario-card .view-shot-lines {")
  );
  assert.doesNotMatch(block, /max-height: var\(--scene-field-height\)/);
  assert.match(block, /min-height: var\(--scene-field-height\)/, "한 줄 칸이 쪼그라들면 안 된다");
  assert.match(block, /overflow: visible/);
  // 여러 줄이 흐르도록 블록으로 둔다(가운데 정렬 flex 는 늘어나지 않는다).
  assert.match(block, /display: block/);
  // 개별 칸도 잘리지 않게 못박는다.
  assert.match(css, /\.scenario-card \.view-beats-lines,[\s\S]{0,120}max-height: none/);
});

test("★프로젝트 저장·복원이 알 수 없는 필드를 버리지 않는다", () => {
  // project.js 의 씬 정규화는 Object.assign 으로 원본을 깔고 시작한다.
  // 이 방식이라야 나중에 늘어나는 필드(beats 같은)가 조용히 사라지지 않는다.
  const src = read("prototype/js/service/project.js");
  const fn = src.slice(src.indexOf("return source.map(function (item, index) {"), src.indexOf("function normalizePublishResults"));
  assert.match(fn, /return Object\.assign\(\{\}, raw, \{/);
});
