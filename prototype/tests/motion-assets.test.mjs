import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { detectBeats } from "../../ai-company-app/scripts/motion-beats.mjs";
import { parseMediaInfo, safeAssetName } from "../../ai-company-app/scripts/prepare-motion-assets.mjs";

// 인포그래픽 영상 2단계(2026-10-21): 자산 입력. 비용 0원 — 이미 가진 브랜드·업무 파일·사운드 라이브러리만 쓴다.
const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
const esbuild = createRequire(import.meta.url)("../../ai-company-app/node_modules/esbuild");
function evaluate(source, deps = {}) {
  const module = { exports: {} };
  const code = esbuild.transformSync(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];[ \t]*$/gm, ""), { loader: "ts", format: "cjs" }).code;
  vm.runInNewContext(code, { module, exports: module.exports, console, URL, ...deps });
  return module.exports;
}
const assets = evaluate(read("prototype/functions/api/agent/_motion-assets.ts"));

test("자산 선택은 브랜드 id·업무 파일 경로·배경음악만 받고 위험한 경로는 버린다", () => {
  const selection = assets.normalizeMotionAssetSelection({
    brandId: "nekoban",
    files: ["mkt/logo.png", "../secret.png", "a/./b.mp4", "mkt/logo.png", "/clips/play.mp4"],
    bgm: { source: "sound", value: "0b5e-uuid" },
    noMusic: true,
  });
  assert.equal(selection.brandId, "nekoban");
  assert.deepEqual([...selection.files], ["mkt/logo.png", "clips/play.mp4"]);
  assert.deepEqual({ ...selection.bgm }, { source: "sound", value: "0b5e-uuid" });
  assert.equal(selection.noMusic, false, "배경음악을 골랐으면 음악 없음 표시는 무시");
  assert.equal(assets.normalizeMotionAssetSelection({ brandId: "../x" }).brandId, null);
  assert.equal(assets.normalizeMotionAssetSelection({ noMusic: true }).noMusic, true);
  assert.equal(assets.normalizeMotionAssetSelection({ files: new Array(30).fill(0).map((_, i) => `f${i}.png`) }).files.length, 20);
});

test("브랜드에서 로고·캐릭터 대표 시트·배경 그림을 미디어 프록시 경로로 꺼낸다", () => {
  const items = assets.brandAssetItems({
    brandTitle: "NEKOBAN",
    brandLogoObjectName: "base/users/u1/ai-video/brands/nb/logo.png",
    characterSheets: [{ displayName: "고양이", items: [{ imageDataUrl: "gs://bucket/base/ip/cat/a.png" }, { imageDataUrl: "gs://bucket/base/ip/cat/b.webp", isPrimary: true }] }],
    environmentAssets: [{ displayName: "거실", items: [{ imageDataUrl: "gs://bucket/base/env/room.jpg" }] }, { displayName: "빈칸", items: [] }],
  });
  assert.deepEqual([...items.map((item) => item.role)], ["logo", "character", "environment"]);
  assert.equal(items[0].url, `/api/media/proxy?objectName=${encodeURIComponent("base/users/u1/ai-video/brands/nb/logo.png")}`);
  assert.match(items[1].url, /ip%2Fcat%2Fb\.webp$/, "대표(isPrimary) 시트를 쓴다");
  assert.match(items[1].fileName, /^character-1-.+\.webp$/);
  assert.match(items[2].fileName, /\.jpg$/);
});

test("업무 파일은 그림·영상·소리만 넣고 다운로드 경로를 만든다", () => {
  const items = assets.fileAssetItems(["a/hero.PNG", "a/play.mov", "a/hit.wav", "a/brief.pdf"]);
  assert.deepEqual([...items.map((item) => item.role)], ["image", "video", "audio"]);
  assert.equal(items[0].url, `/api/agent/company-files?path=${encodeURIComponent("a/hero.PNG")}&download=1`);
});

test("사운드 라이브러리의 만료된 서명 URL에서 객체 이름을 다시 꺼낸다", () => {
  assert.equal(
    assets.objectNameFromSignedUrl("https://storage.googleapis.com/my-bucket/base/users/u1/sound/music/instance/abc.mp3?X-Goog-Expires=3600"),
    "base/users/u1/sound/music/instance/abc.mp3",
  );
  assert.equal(assets.objectNameFromSignedUrl("gs://b/x/y.mp3"), "x/y.mp3");
  assert.equal(assets.objectNameFromSignedUrl("https://evil.example.com/b/x.mp3"), "");
});

test("작업 입력·실행기·agent-video·자산 목록 API가 자산 선택을 끝까지 전달한다", () => {
  assert.match(read("prototype/functions/api/agent/_company-skill-registry.ts"), /assets = normalizeMotionAssetSelection\(input\.assets\)/);
  assert.match(read("prototype/functions/api/agent/_company-skill-executors.ts"), /assets: options\.assets \|\| null/);
  assert.match(read("prototype/functions/api/agent/agent-video.ts"), /assets: normalizeMotionAssetSelection\(body\?\.assets\)/);
  const api = read("prototype/functions/api/agent/motion-assets.ts");
  assert.match(api, /WHERE id = \$1 AND user_id = \$2/, "본인 업무만");
  assert.match(api, /metadata\?\.input\?\.assets/);
  // 음악을 새로 생성하는 경로를 부르지 않는다(비용 0원)
  assert.doesNotMatch(read("prototype/functions/api/agent/_motion-assets.ts"), /music-generate|sfx-generate/);
});

test("화면: 배경음악을 안 고르면 감독이 기본 음악에서 고르고, 자산 선택을 작업 입력에 싣는다", () => {
  const context = read("ai-company-app/src/contexts/AgentVideoWorkspaceContext.tsx");
  assert.doesNotMatch(context, /appDialog\.confirm\(t\.confirmNoMusic/, "기본 음악이 생겨 확인 창은 없앴다");
  assert.match(context, /options: \{ durationSec, aspectRatio, assets: selectedAssets \},\n\s+\}, \{ wait: true \}\);/);
  const picker = read("ai-company-app/src/components/MotionAssetPicker.tsx");
  assert.match(picker, /<option value="">\{t\.bgmAuto\}<\/option>/);
  assert.match(picker, /<option value="none">\{t\.bgmNone\}<\/option>/);
  assert.match(picker, /noMusic: raw === "none"/);
  assert.match(read("ai-company-app/src/components/AgentVideoWorkspace.tsx"), /<MotionAssetPicker value=\{assets\} onChange=\{setAssets\} \/>/);
  assert.match(read("ai-company-app/vite.config.ts"), /"\/local-motion": "http:\/\/localhost:14000"/);
});

test("이 PC 렌더러: 목록에 있는 파일만 받고, 이름으로 폴더를 벗어나지 못한다", () => {
  const server = read("server.js");
  assert.match(server, /pathname === '\/local-motion\/jobs' && req\.method === 'POST'/);
  assert.match(server, /motionAssetName\(item\.fileName\) === item\.fileName/);
  assert.match(server, /자산 목록에 없는 파일입니다/);
  assert.match(server, /MOTION_MAX_ASSET_BYTES/);
  assert.equal(safeAssetName("logo.png"), "logo.png");
  assert.equal(safeAssetName("character-1-고양이.webp"), "character-1-고양이.webp");
  assert.equal(safeAssetName("../evil.png"), "evil.png");
  assert.equal(safeAssetName(".hidden"), "");
  assert.equal(safeAssetName("a b.png"), "");
});

test("ffmpeg 출력에서 그림·영상 크기와 길이를 읽는다", () => {
  const info = parseMediaInfo("  Duration: 00:01:02.50, start: 0.000000, bitrate: 4638 kb/s\n  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt470bg/unknown/unknown, progressive), 1080x1920 [SAR 1:1 DAR 9:16], 60 fps");
  assert.deepEqual(info, { width: 1080, height: 1920, durationSec: 62.5 });
  assert.deepEqual(parseMediaInfo("Stream #0:0: Video: png, rgba(pc), 1201x236, 25 fps"), { width: 1201, height: 236, durationSec: null });
});

test("박자 분석은 일정한 박자의 클릭 음에서 그 간격을 찾는다", () => {
  const sr = 22050;
  const bpm = 120;
  const samples = new Float32Array(sr * 12);
  for (let beat = 0.5; beat < 12; beat += 60 / bpm) {
    const at = Math.round(beat * sr);
    for (let i = 0; i < 400 && at + i < samples.length; i++) samples[at + i] = Math.sin(i * 0.9) * Math.exp(-i / 80);
  }
  const { beats, guessedBpm } = detectBeats(samples);
  assert.ok(Math.abs(guessedBpm - bpm) < 3, `추정 BPM ${guessedBpm}`);
  const gaps = beats.slice(1).map((b, i) => b - beats[i]);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  assert.ok(Math.abs(mean - 0.5) < 0.02, `평균 간격 ${mean}`);
});

test("기본 효과음·글꼴 라이브러리가 파일과 함께 들어 있다", () => {
  const kit = path.join(root, "ai-company-app", "motion-kit");
  const sfx = JSON.parse(read("ai-company-app/motion-kit/sfx/index.json"));
  assert.ok(sfx.filter((item) => item.source === "synth").length >= 14);
  assert.ok(sfx.filter((item) => item.source === "kenney").length >= 400, "Kenney CC0 효과음");
  for (const item of sfx) {
    assert.ok(fs.existsSync(path.join(kit, "sfx", item.file)), item.file);
    assert.ok(item.ko && item.en && item.durationSec > 0, item.id);
  }
  const fonts = read("ai-company-app/motion-kit/lib/fonts.css");
  for (const [, file] of fonts.matchAll(/url\(\.\.\/fonts\/([^)]+)\)/g)) assert.ok(fs.existsSync(path.join(kit, "fonts", file)), file);
  assert.match(fonts, /"NK Sans"/);
});
