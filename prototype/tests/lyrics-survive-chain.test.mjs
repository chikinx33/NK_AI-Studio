import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

/**
 * ★가사가 프로덕션 화면에서 '앞 소절이 이어지는 중' 으로만 보이던 이유.
 *
 * 씬 머리글에는 가사 문장이 그대로 떠 있는데(그건 subtitleText/lines 라 살아남았다),
 * 정작 가사 칸은 비어 있었다. scene.lyrics 가 길목마다 이름이 갈리거나
 * 고정 필드 목록에서 빠지면서 사라졌기 때문이다.
 *
 * beats 때와 똑같은 종류의 구멍이다. 길목을 하나씩 못박는다.
 */

test("★서버 저장·불러오기가 소절 정보를 지킨다", () => {
  // 여기가 가장 큰 구멍이었다. 씬을 고정 목록으로 다시 만드는데 노래 필드가 통째로 없었다.
  ["prototype/functions/api/project/save.ts", "prototype/functions/api/project/get.ts"].forEach((file) => {
    const src = read(file);
    assert.match(src, /lyrics: typeof s\?\.lyrics === "string" \? s\.lyrics : "",/, file);
    assert.match(src, /isRefrain: !!s\?\.isRefrain,/, file);
    assert.match(src, /songSectionId: typeof s\?\.songSectionId === "string"/, file);
    assert.match(src, /songSectionLabel: typeof s\?\.songSectionLabel === "string"/, file);
    // 사용자가 대본을 비운 것도 뜻이 있는 편집이다.
    assert.match(src, /scriptEdited: !!s\?\.scriptEdited,/, file);
  });
});

test("★시나리오 정규화가 lyrics 와 lyricsText 를 함께 내보낸다", () => {
  // 화면 카드는 lyricsText 를, 프로덕션·저장 API 는 lyrics 를 읽는다.
  // 한쪽만 내보내면 저장 한 번에 끊긴다.
  const src = read("prototype/js/ui/scenario.js");
  assert.match(src, /const lyricsClean = String\(s\?\.lyrics \|\| s\?\.lyricsText \|\| ''\)\.replace\(\/@\+\/g, ''\)\.trim\(\);/);
  assert.match(src, /lyricsText: lyricsClean,/);
  assert.match(src, /\n        lyrics: lyricsClean,/);
});

test("★프로덕션 씬 재조립이 가사·자막을 함께 싣는다", () => {
  const src = read("prototype/ui/pipeline.js");
  const start = src.indexOf("var scenes = migratedScenes.map(function (s, idx) {");
  assert.ok(start > -1, "프로덕션 씬 재조립 자리를 찾아야 한다");
  const block = src.slice(start, start + 4000);
  assert.match(block, /lyrics: s\.lyrics \|\| '',/);
  // 가사 폴백(scene.lyrics || scene.subtitleText)이 죽지 않도록 자막 원문도 싣는다.
  assert.match(block, /subtitleText: s\.subtitleText \|\| '',/);
  assert.match(block, /songSectionLabel: s\.songSectionLabel \|\| '',/);
});

test("★컷 분해가 가사를 첫 컷에만 싣고 구간 식별자는 모든 컷에 남긴다", () => {
  // 컷마다 같은 소절이 반복되면 자막이 겹쳐 뜬다. 그러나 중간 컷도
  // 자기가 어느 소절 구간인지는 알아야 '이어지는 중' 을 제대로 표시한다.
  [read("prototype/functions/api/scenario-shots.js"), read("prototype/ui/pipeline.js")].forEach((src) => {
    assert.match(src, /lyrics: isFirst \? \(parent\.lyrics \|\| ["']{2}\) : ["']{2},/);
    assert.match(src, /songSectionId: parent\.songSectionId \|\| ["']{2},/);
  });
});

test("★가사 칸은 lyrics 가 없을 때만 '이어지는 중' 을 보여준다", () => {
  const src = read("prototype/ui/pipeline-scene-row.js");
  assert.match(src, /scene\.lyrics \|\| scene\.subtitleText/);
  assert.match(src, /이어지는 중/);
});
