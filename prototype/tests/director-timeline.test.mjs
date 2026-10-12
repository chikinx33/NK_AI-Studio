// 디렉터 시퀀스 → 편집기 타임라인: 테이크 하나를 컷 구간 클립으로 자르고, 부분 재생성 테이크로 덮는다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const src = fs.readFileSync(path.join(root, "prototype/js/ui/post-production.js"), "utf8").replace(/\r\n/g, "\n");

function load() {
  const helper = (name) => {
    const start = src.indexOf(`  function ${name}(`);
    return src.slice(start, src.indexOf("\n  }\n", start) + 4);
  };
  const start = src.indexOf("  function buildSequenceTimeline(");
  const fn = src.slice(start, src.indexOf("  function buildTimelineModel(", start));
  return new Function(helper("toNumber") + helper("firstFilled") + fn + "\nreturn buildSequenceTimeline;")();
}

const cuts = [
  { id: "C01", label: "CUT 1", start: 0, end: 1.5 },
  { id: "C02", label: "CUT 2", start: 1.5, end: 2.3 },
  { id: "C03", label: "CUT 3", start: 2.3, end: 3.0 },
  { id: "C04", label: "CUT 4", start: 3.0, end: 4.2 },
];

test("선택한 테이크가 없으면 기존 씬 경로를 쓴다", () => {
  const build = load();
  assert.equal(build({ payload: {} }), null);
  assert.equal(build({ payload: { sequences: [{ id: "a", cuts, takes: [{ id: "t1", videoPath: "gs://b/t1.mp4" }] }] } }), null);
});

test("테이크 하나를 컷 시간 구간 클립으로 자른다(videoOffset = 컷 시작)", () => {
  const build = load();
  const r = build({ payload: { sequences: [{ id: "a", cuts, selectedTakeIds: ["t1"], takes: [{ id: "t1", videoPath: "gs://b/t1.mp4" }] }] } });
  assert.equal(r.visuals.length, 4);
  assert.deepEqual(r.visuals.map((c) => c.id), ["vis-cut-a-C01", "vis-cut-a-C02", "vis-cut-a-C03", "vis-cut-a-C04"]);
  assert.deepEqual(r.visuals.map((c) => c.videoOffset), [0, 1.5, 2.3, 3.0]);
  assert.ok(r.visuals.every((c) => c.url === "gs://b/t1.mp4"));
  assert.ok(Math.abs(r.duration - 4.2) < 1e-9);
  assert.ok(Math.abs(r.visuals[3].start - 3.0) < 1e-9);
});

test("부분 재생성 테이크가 덮는 컷은 patch 영상과 상대 오프셋을 쓴다", () => {
  const build = load();
  const r = build({ payload: { sequences: [{ id: "a", cuts, selectedTakeIds: ["t1", "p1"], takes: [
    { id: "t1", videoPath: "gs://b/t1.mp4" },
    { id: "p1", kind: "patch", range: { start: 2.3, end: 4.2 }, replacesCuts: ["C03", "C04"], videoPath: "gs://b/p1.mp4" },
  ] }] } });
  assert.deepEqual(r.visuals.map((c) => c.url), ["gs://b/t1.mp4", "gs://b/t1.mp4", "gs://b/p1.mp4", "gs://b/p1.mp4"]);
  assert.ok(Math.abs(r.visuals[2].videoOffset - 0) < 1e-9);
  assert.ok(Math.abs(r.visuals[3].videoOffset - 0.7) < 1e-9);
});

test("시퀀스 여러 개는 order 순서로 이어 붙인다", () => {
  const build = load();
  const r = build({ payload: { sequences: [
    { id: "b", order: 2, cuts: [{ id: "X", start: 0, end: 2 }], selectedTakeIds: ["tb"], takes: [{ id: "tb", videoPath: "gs://b/tb.mp4" }] },
    { id: "a", order: 1, cuts: [{ id: "Y", start: 0, end: 3 }], selectedTakeIds: ["ta"], takes: [{ id: "ta", videoPath: "gs://b/ta.mp4" }] },
  ] } });
  assert.deepEqual(r.visuals.map((c) => c.id), ["vis-cut-a-Y", "vis-cut-b-X"]);
  assert.equal(r.visuals[1].start, 3);
});

test("렌더는 같은 소스 영상을 한 번만 연다", () => {
  const render = fs.readFileSync(path.join(root, "prototype/js/service/postprod-render.js"), "utf8");
  assert.match(render, /var videoByUrl = new Map\(\);/);
  assert.match(render, /if \(!videoByUrl\.has\(url\)\) videoByUrl\.set\(url, loadVideo\(url, 12000\)\);/);
});
