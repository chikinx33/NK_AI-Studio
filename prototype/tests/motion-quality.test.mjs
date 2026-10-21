import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { audioFilterGraph, nextGain, parseLoudnorm } from "../../ai-company-app/scripts/render-motion-page.mjs";
import { emptySpans, isEmptyFrame } from "../../ai-company-app/scripts/motion-review.mjs";
import { buildMotionReviewRequest, buildMotionDirectorRequest, isReviewApproved } from "../functions/api/_shared/motion-director.js";

// 2026-10-22 엔케 "보완점 1~6 전부": 채플린 영상(16:9 30초) 품질 검토에서 나온 여섯 가지
const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");

test("1·2·3 감독 설명서: 화면 채우기·스타일 하나·이어지는 전환 점검표가 있고 감독 지침에 실린다", () => {
  const kit = read("ai-company-app/motion-kit/KIT.md");
  assert.match(kit, /## 5\.5 품질 점검표/);
  assert.match(kit, /주인공 요소는 화면 높이의 40~60%/);
  assert.match(kit, /16:9는 삼분할/);
  assert.match(kit, /\*\*그림 스타일은 한 편에 하나\.\*\*/);
  assert.match(kit, /3D 이모지를 쓰지 않는다\(사물도 SVG·아이콘으로\)/);
  assert.match(kit, /\*\*전환은 이어 붙인다\.\*\*/);
  assert.match(kit, /검게 닫는 아이리스·암전은 끝 카드에만/);
  assert.ok(read("prototype/functions/api/_shared/motion-director-kit.js").includes("5.5 품질 점검표"), "build-motion-director-kit.mjs 를 다시 돌렸다");
  const wide = buildMotionDirectorRequest({ input: { aspectRatio: "16:9", durationSec: 30, prompt: "x" }, prepared: { kit: {} } });
  assert.match(wide, /이 편은 16:9이라 시즌1\(9:16\) 실례 구도를 그대로 옮기지 말고 가로 화면을 채운다/);
  assert.doesNotMatch(buildMotionDirectorRequest({ input: { aspectRatio: "9:16" }, prepared: { kit: {} } }), /시즌1\(9:16\) 실례 구도를/);
});

test("4 키네틱 자막: 둘째 덩어리부터 왼쪽 기준으로 커지고, 덩어리 간격은 글자 크기에 비례한다", () => {
  assert.match(read("ai-company-app/motion-kit/lib/motion.js"), /if \(el\.childElementCount\) w\.style\.transformOrigin = '0% 60%';/);
  assert.match(read("ai-company-app/motion-kit/lib/base.css"), /font-size: var\(--k-size, 124px\); gap: 0 \.28em;/);
});

test("5 소리 크기: 재고 → 차이만큼 키우며 최고치를 4배 늘려 -3dBFS 로 누르고 → 다시 재서 맞춘다(-14 LUFS)", () => {
  const base = { duration: 10, cues: [] };
  assert.match(audioFilterGraph({ ...base, measure: true }), /atrim=0:10\.000,loudnorm=I=-14:TP=-1\.5:LRA=11:print_format=json\[out\]$/, "1차는 재기만");
  assert.match(audioFilterGraph({ ...base, gainDb: 10.44 }), /volume=10\.44dB,aresample=192000,alimiter=limit=0\.708:attack=2:release=80:level=0,aresample=48000\[out\]$/);
  assert.match(audioFilterGraph({ ...base, gainDb: 6, measure: true }), /aresample=48000,loudnorm=I=-14:TP=-1\.5:LRA=11:print_format=json\[out\]$/, "누른 결과를 다시 잰다");
  assert.match(audioFilterGraph(base), /loudnorm=I=-14:TP=-1\.5:LRA=11\[out\]$/, "못 재면 예전 한 번 처리");
  assert.equal(Math.round(nextGain(0, -20.49) * 100) / 100, 6.49);
  assert.equal(Math.round(nextGain(6.49, -15.2) * 100) / 100, 7.69);
  assert.equal(nextGain(0, -60), 24, "너무 크게는 키우지 않는다");
  const report = `[Parsed_loudnorm_3 @ 0x1]\n{\n\t"input_i" : "-21.84",\n\t"input_tp" : "-6.65",\n\t"input_lra" : "5.90",\n\t"input_thresh" : "-32.52",\n\t"output_i" : "-15.51",\n\t"target_offset" : "1.51"\n}\n`;
  assert.deepEqual(parseLoudnorm(report), { I: -21.84, TP: -6.65, LRA: 5.9, thresh: -32.52, offset: 1.51 });
  assert.equal(parseLoudnorm('{ "input_i" : "-inf", "input_tp" : "-inf", "input_lra" : "0", "input_thresh" : "-70", "target_offset" : "0" }'), null, "무음");
});

test("6 검수: 어둡고 평평한 화면(장면 사이 암전)만 빈 화면으로 잡고, 닫힌 커튼·끝 장면은 넘긴다", () => {
  // 채플린 장면 코드 실측값(평균, 편차)
  assert.equal(isEmptyFrame({ mean: 13, std: 17 }), true, "20.5초 암전");
  assert.equal(isEmptyFrame({ mean: 22, std: 6 }), true, "24초 어두운 빈 무대");
  assert.equal(isEmptyFrame({ mean: 69, std: 12 }), false, "닫힌 커튼");
  assert.equal(isEmptyFrame({ mean: 200, std: 46 }), false, "보통 장면");
  assert.equal(isEmptyFrame({ mean: 230, std: 4 }), true, "아무것도 없는 밝은 화면");
  const stats = [{ mean: 200, std: 40 }, { mean: 13, std: 17 }, { mean: 18, std: 16 }, { mean: 190, std: 50 }, { mean: 5, std: 2 }];
  assert.deepEqual(emptySpans(stats, [20, 20.25, 20.5, 20.75, 29.5], { duration: 30 }), [{ from: 20.25, to: 20.5 }], "끝 1.2초는 보지 않는다");
});

test("6 검수: 감독이 정지 화면·자동 검사 결과로 점검표를 보고 고치거나 OK 한 줄", () => {
  const text = buildMotionReviewRequest({
    input: { aspectRatio: "16:9", durationSec: 30 }, prepared: {}, html: "<html>X</html>", episode: { cues: [] },
    frameTimes: [0.3, 20.63], findings: ["20.50~21.00초: 화면이 어둡고 거의 비어 있다"],
  });
  assert.match(text, /정지 화면 2장은 네가 방금 쓴 장면 코드를 실제로 찍은 것이다\(시각: 0\.3초, 20\.63초\)/);
  assert.match(text, /- 20\.50~21\.00초: 화면이 어둡고 거의 비어 있다/);
  assert.match(text, /고칠 것이 없으면 다른 말 없이 OK 한 줄만 쓴다/);
  assert.match(text, /잘 된 장면·타이밍·문장·음악·소리 큐는 그대로 둔다/);
  assert.equal(isReviewApproved("OK"), true);
  assert.equal(isReviewApproved("**OK**"), true);
  assert.equal(isReviewApproved("OK\n```html\n<html></html>\n```"), false, "코드를 냈으면 고친 것");
  assert.equal(isReviewApproved("수정했습니다"), false);
  const api = read("prototype/functions/api/agent/motion-director.ts");
  assert.match(api, /body\?\.mode === "review" && isReviewApproved\(text\)/);
  const job = read("ai-company-app/scripts/motion-cloud-job.mjs");
  assert.match(job, /\(\{ html, episode \} = await phase\("review", \(\) => reviewDirectorPage\(/);
  assert.match(job, /검수 실패 — 처음 장면 코드로 진행/, "검수가 실패해도 영상은 계속");
  assert.match(read("cloud-motion-renderer/deploy.sh"), /motion-cloud-job\.mjs motion-review\.mjs; do/);
  assert.match(read("prototype/functions/api/agent/_motion-cloud.ts"), /"director", "review", "render"/);
  const progress = read("ai-company-app/src/components/MotionProgress.tsx");
  assert.match(progress, /export const MOTION_STAGES: MotionStage\[\] = \["plan", "assets", "director", "review", "render", "save"\];/);
  assert.equal((read("ai-company-app/src/components/MotionAssetPicker.tsx").match(/stageReview: "/g) || []).length, 2, "한/영");
});
