import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

/**
 * ★컷↔레퍼런스 컷 참조(cutRefId)·컷별 공통 프롬프트(common)·프롬프트 계보(lineage)가
 * 서버 왕복에서 증발하던 구멍.
 *
 * beats·lyrics 때와 똑같다. 서버 save/get 은 씬을 고정 목록으로 다시 만들기 때문에
 * 목록에 없는 필드는 저장 한 번에 사라진다. 노드 캔버스가 컷↔컷 참조선과
 * "어떤 프롬프트·어떤 이미지에서 이 영상이 나왔나" 를 그리려면 길목마다 살아 있어야 한다.
 */

const SERVER_FILES = ["prototype/functions/api/project/save.ts", "prototype/functions/api/project/get.ts"];

// normalizeScene 이 돌려주는 객체 리터럴만 잘라낸다.
const sceneReturnBlock = (src) => {
  const start = src.indexOf("const normalizeScene = (s: any, idx: number) => {");
  assert.ok(start > -1, "normalizeScene 을 찾아야 한다");
  const ret = src.indexOf("return {", start);
  const end = src.indexOf("\n    };", ret);
  return src.slice(ret, end);
};

const helperBlock = (src, name) => {
  const start = src.indexOf(`const ${name} = (value) => {`);
  assert.ok(start > -1, `${name} 헬퍼를 찾아야 한다`);
  const end = src.indexOf("\n    };", start);
  return src.slice(start, end + "\n    };".length);
};

test("★★서버 저장·불러오기 화이트리스트가 계보 필드를 지킨다 (save.ts + get.ts)", () => {
  SERVER_FILES.forEach((file) => {
    const src = read(file);
    const block = sceneReturnBlock(src);
    [
      /common: typeof s\?\.common === "string"/,
      /promptText: typeof s\?\.promptText === "string"/,
      /promptEdited: !!s\?\.promptEdited,/,
      /imageHistory: normalizeImageHistory\(s\?\.imageHistory\),/,
      /cutRefId: /,
      /cutRefEnabled: !!s\?\.cutRefEnabled,/,
      /lineage: normalizeLineage\(s\?\.lineage\),/,
    ].forEach((re) => assert.match(block, re, `${file}: ${re}`));
  });
});

test("★save.ts 와 get.ts 의 헬퍼 본문이 글자 그대로 같다", () => {
  // 한쪽만 고치면 저장은 되는데 불러오기가 버리거나, 그 반대가 된다.
  const [a, b] = SERVER_FILES.map(read);
  ["normalizeLineage", "normalizeImageHistory"].forEach((name) => {
    assert.equal(helperBlock(a, name), helperBlock(b, name), `${name} 이 두 파일에서 다르다`);
  });
});

test("★normalizeLineage 가 data:/blob: videoFromImage 를 버린다 (소스 계약)", () => {
  SERVER_FILES.forEach((file) => {
    const block = helperBlock(read(file), "normalizeLineage");
    assert.match(block, /videoFromImage: isInlineUrl\(value\.videoFromImage\) \? "" : str\(value\.videoFromImage\)/, file);
    // 계보가 없거나 깨졌으면 빈 객체가 아니라 null 이어야 한다.
    assert.match(block, /if \(!value \|\| typeof value !== "object" \|\| Array\.isArray\(value\)\) return null;/, file);
    const src = read(file);
    assert.match(src, /const isInlineUrl = \(v\) => typeof v === "string" && \(v\.startsWith\("data:"\) \|\| v\.startsWith\("blob:"\)\);/, file);
  });
});

test("★★normalizeLineage 를 실제로 실행해 정규화 모양을 검증한다", () => {
  // 헬퍼는 타입 주석 없이 쓰여 있어 .ts 본문을 그대로 실행할 수 있다.
  const src = read(SERVER_FILES[0]);
  const isInline = src.slice(src.indexOf("const isInlineUrl ="), src.indexOf("\n", src.indexOf("const isInlineUrl =")));
  const body = isInline + "\n" + helperBlock(src, "normalizeLineage") + "\n" + helperBlock(src, "normalizeImageHistory") +
    "\nreturn { normalizeLineage, normalizeImageHistory };";
  const { normalizeLineage, normalizeImageHistory } = new Function(body)();

  const out = normalizeLineage({ videoFromImage: "data:abc", imageAttempts: "3" });
  assert.equal(out.videoFromImage, "");
  assert.equal(out.imageAttempts, 3);
  assert.deepEqual(out, {
    imagePrompt: "", videoPrompt: "", videoFromImage: "", imageContinuity: "",
    imageAttempts: 3, videoAttempts: 0, agentJobId: "", updatedAt: "",
  });
  assert.equal(normalizeLineage({ videoFromImage: "blob:xyz" }).videoFromImage, "");
  assert.equal(normalizeLineage({ videoFromImage: "https://cdn/x.png", videoAttempts: -2.7 }).videoFromImage, "https://cdn/x.png");
  assert.equal(normalizeLineage({ videoAttempts: -2.7 }).videoAttempts, 0);
  assert.equal(normalizeLineage({ videoAttempts: 2.7 }).videoAttempts, 2);
  // 없거나 깨진 계보는 null (빈 객체를 내보내지 않는다).
  assert.equal(normalizeLineage(undefined), null);
  assert.equal(normalizeLineage("x"), null);
  assert.equal(normalizeLineage([1]), null);

  // 이미지 이력: data:/blob:·빈값·중복 제거, 최근 10개만.
  const hist = normalizeImageHistory(["data:1", "blob:2", "", "  ", "a", "a", 7, null, "b"]);
  assert.deepEqual(hist, ["a", "b"]);
  const many = Array.from({ length: 14 }, (_, i) => "u" + i);
  assert.deepEqual(normalizeImageHistory(many), many.slice(4));
  assert.deepEqual(normalizeImageHistory("nope"), []);
});

test("★프로덕션 씬 재조립이 계보 필드를 싣는다 (beats 가 여기서 증발했던 전례)", () => {
  const src = read("prototype/ui/pipeline.js");
  const start = src.indexOf("var scenes = migratedScenes.map(function (s, idx) {");
  assert.ok(start > -1, "프로덕션 씬 재조립 자리를 찾아야 한다");
  const block = src.slice(start, src.indexOf("return { payload: pl, header: hClean, scenes: scenes", start));
  assert.match(block, /common: \(typeof s\.common === 'string' \? s\.common : ''\),/);
  assert.match(block, /cutRefId: String\(s\.cutRefId \|\| ''\),/);
  assert.match(block, /cutRefEnabled: !!s\.cutRefEnabled,/);
  assert.match(block, /lineage: \(s\.lineage && typeof s\.lineage === 'object'\) \? s\.lineage : null,/);
  // 영상 프롬프트 폴백(Common/Visual 합성)은 그대로 살아 있어야 한다.
  assert.match(block, /promptText: \(s\.promptText \|\| \['Common', hClean, 'Visual', \(s\.shot \|\| ''\)\]\.join\('\\n'\)\),/);
});

test("★로컬↔서버 머지가 계보·컷 참조를 서버 우선(비었을 때만 로컬)으로 합친다", () => {
  const src = read("prototype/ui/pipeline.js");
  const start = src.indexOf("var _statusFields = ['videoStatus', 'videoJobId', 'videoMethod', 'videoError'];");
  assert.ok(start > -1);
  const block = src.slice(start, start + 2500);
  assert.match(block, /var _lineageFields = \['common', 'cutRefId', 'cutRefEnabled', 'lineage', 'promptText', 'promptEdited'\];/);
  assert.match(block, /_lineageFields\.forEach\(function \(f\) \{\s*if \(!merged\[f\] && cur\[f\]\) merged\[f\] = cur\[f\];/);
});

test("★이미지 생성 성공 시 계보(imagePrompt·imageAttempts)를 씬에 남긴다", () => {
  const src = read("prototype/ui/pipeline-image.js");
  const start = src.indexOf("var prevLineage = (scene.lineage && typeof scene.lineage === 'object') ? scene.lineage : {};");
  assert.ok(start > -1, "이미지 커밋 자리의 계보 코드를 찾아야 한다");
  const block = src.slice(start, start + 1200);
  assert.match(block, /imagePrompt: String\(finalPrompt \|\| ''\),/);
  assert.match(block, /imageAttempts: \(Number\(prevLineage\.imageAttempts\) \|\| 0\) \+ 1,/);
  // 커밋되는 씬 객체(st.scenes[opts.idx])에 실린다.
  assert.match(block, /st\.scenes\[opts\.idx\] = Object\.assign\(\{\}, scene, \{[\s\S]*?lineage: nextLineage,/);
});

test("★영상 생성 시작 시 계보(videoPrompt·videoFromImage)를 씬에 남긴다", () => {
  const src = read("prototype/ui/pipeline-video.js");
  const start = src.indexOf("var prevLineage = (st.scenes[opts.idx] && st.scenes[opts.idx].lineage");
  assert.ok(start > -1, "영상 시작 자리의 계보 코드를 찾아야 한다");
  const block = src.slice(start, start + 1500);
  assert.match(block, /videoPrompt: String\(finalPrompt \|\| ''\),/);
  // data:/blob: 은 영속화하지 않는다.
  assert.match(block, /videoFromImage: \(imageUrl && imageUrl\.slice\(0, 5\) !== 'data:' && imageUrl\.slice\(0, 5\) !== 'blob:'\) \? imageUrl : '',/);
  assert.match(block, /videoAttempts: \(Number\(prevLineage\.videoAttempts\) \|\| 0\) \+ 1,/);
  // videoJobId 와 같은 커밋에 실린다(같은 씬 객체가 영속화된다).
  assert.match(block, /st\.scenes\[opts\.idx\] = Object\.assign\(\{\}, st\.scenes\[opts\.idx\], \{\s*lineage: nextLineage,[\s\S]*?videoJobId: jobId,/);
});

test("★persistPipeline 은 씬을 통째로 저장한다 (별도 필드 열거 없음)", () => {
  const src = read("prototype/script.js");
  const start = src.indexOf("persistPipeline: function () {");
  assert.ok(start > -1);
  const block = src.slice(start, start + 600);
  assert.match(block, /scenes: this\._state\.scenes,/);
});
