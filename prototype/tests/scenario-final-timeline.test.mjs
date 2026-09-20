import test from "node:test";
import assert from "node:assert/strict";
import { fitFlatTimelineDurations } from "../functions/api/_shared/timeline-durations.js";

test("★최종 컷 7개의 합을 프로젝트 30초와 정확히 맞춘다", () => {
  const scenes = [5, 4, 4, 5, 4, 5, 4].map((estSec, index) => ({
    id: index + 1,
    estSec,
    beats: [{ at: 0, what: "시작" }, { at: Math.max(0.1, estSec - 0.5), what: "끝" }],
  }));
  const result = fitFlatTimelineDurations(scenes, 30);
  assert.equal(result.feasible, true);
  assert.equal(result.before, 31);
  assert.equal(result.after, 30);
  assert.equal(result.scenes.reduce((sum, scene) => sum + scene.estSec, 0), 30);
  result.scenes.forEach((scene) => {
    assert.ok(scene.estSec >= 4 && scene.estSec <= 6);
    assert.ok(scene.beats.at(-1).at < scene.estSec);
  });
});

test("★지원 가능한 컷 길이 범위를 넘으면 거짓 성공 대신 infeasible을 보고한다", () => {
  const result = fitFlatTimelineDurations([{ estSec: 6 }, { estSec: 6 }], 20);
  assert.equal(result.feasible, false);
  assert.equal(result.after, 12);
});
