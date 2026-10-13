import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { cutStarts, compactReport, frameTime } = await import("../src/qa.js");
const { compactProject } = await import("../src/mcp/tools.js");

test("콘티 컷 시작 시각: 0 포함·중복 제거·오름차순·이상값 제외", () => {
  assert.deepEqual(cutStarts([4.2, 1.5, "2.3", -1, 1.5, "x", 999]), [0, 1.5, 2.3, 4.2]);
  assert.deepEqual(cutStarts(undefined), [0]);
});

test("검수 보고 요약은 서버 경로를 싣지 않는다", () => {
  const r = compactReport({ video: "/tmp/qa-1/take.mp4", frames: ["/tmp/x.png"], sceneCuts: [1.54], cutAlignment: [{ planned: 1.5, detected: 1.54, diff: 0.04 }],
    audio: { musicSuspect: [[9, 20]], perSecond: [{ t: 0, lines: 0 }, { t: 9, lines: 3.5 }] }, meta: { duration: 20 } });
  assert.deepEqual(r.sceneCuts, [1.54]);
  assert.deepEqual(r.musicSuspect, [[9, 20]]);
  assert.deepEqual(r.musicPerSecond, [[0, 0], [9, 3.5]]);
  assert.equal(JSON.stringify(r).includes("/tmp/"), false);
});

test("프레임 파일 이름 → 시각", () => {
  assert.equal(frameTime("f_004.20.png"), 4.2);
  assert.equal(frameTime("spectrogram.png"), null);
});

test("이미지에는 스킬의 검수 스크립트만 들어간다(단일 원천)", () => {
  const docker = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
  assert.match(docker, /COPY skills\/nk-cf-director\/scripts\/qa_video\.py \.\/qa\/qa_video\.py/);
  assert.match(docker, /python3-scipy/);
  const ignore = readFileSync(new URL("../../.dockerignore", import.meta.url), "utf8");
  assert.match(ignore, /!skills\/nk-cf-director\/scripts\/qa_video\.py/);
});

test("project_overview 는 단계 화면의 프로젝트 기억(directorNotes)을 함께 준다", () => {
  const out = compactProject({ payload: { directorNotes: { rules: "리본 안", lessons: "공은 발뒤꿈치", updatedAt: "x" } } });
  assert.deepEqual(out.directorNotes, { rules: "리본 안", lessons: "공은 발뒤꿈치" });
  assert.equal(compactProject({ payload: {} }).directorNotes, null);
});
