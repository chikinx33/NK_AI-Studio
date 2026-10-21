import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { buildMotionRevisionRequest, closestName, parseMotionDirectorOutput } from "../functions/api/_shared/motion-director.js";
import { pickTaggedSfx } from "../../ai-company-app/scripts/render-motion-page.mjs";

// 2026-10-21 엔케 "모든 일감 진행": 공개 자료로 키트 확장(출처 표기 필요·비상업용 금지), 기획 회의 정리, 부분 수정, 실례로 저장.
const root = path.resolve(import.meta.dirname, "../..");
const kit = path.join(root, "ai-company-app", "motion-kit");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
const esbuild = createRequire(import.meta.url)("../../ai-company-app/node_modules/esbuild");
function evaluate(source, loader = "ts") {
  const module = { exports: {} };
  const code = esbuild.transformSync(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];[ \t]*$/gm, ""), { loader, format: "cjs" }).code;
  vm.runInNewContext(code, { module, exports: module.exports, console, URL });
  return module.exports;
}
const fence = (lang, body) => "```" + lang + "\n" + body + "\n```";
const prepared = { kit: { motion: "../../../ai-company-app/motion-kit/lib/motion.js" }, items: [] };
const page = `<html><head><link rel="stylesheet" href="KIT/lib/fonts.css"></head><body><div id="stage">
<div style="-webkit-mask:url(KIT/icons/lucide/book-opn.svg)"></div><img src="KIT/emoji/rocket_ship.png"><img src="KIT/emoji/trophy.png">
</div><script src="../../../ai-company-app/motion-kit/lib/motion.js"></script><script>async function seek(t) {}
window.READY = M.ready({}).then(() => 15);</script></body></html>`;

test("효과음 용도 태그는 영상마다 다른 소리를, 같은 자리에는 늘 같은 소리를 고른다", () => {
  const index = JSON.parse(read("ai-company-app/motion-kit/sfx/index.json"));
  const a = pickTaggedSfx(index, "whoosh", "job-a|0");
  assert.equal(a, pickTaggedSfx(index, "whoosh", "job-a|0"));
  const picks = new Set(Array.from({ length: 20 }, (_, i) => pickTaggedSfx(index, "click", `job-${i}|3`)));
  assert.ok(picks.size >= 4, `다양성 ${picks.size}`);
  assert.throws(() => pickTaggedSfx(index, "없는태그", "x"), /태그/);
  for (const item of index) for (const tag of item.tags) assert.ok(JSON.parse(read("ai-company-app/motion-kit/sfx/tags.json"))[tag], `${item.id} ${tag}`);
});

test("감독 결과: 기본 음악을 고르고 박자 스크립트를 넣고, KIT 경로·틀린 아이콘·이모지 이름을 바로잡는다", () => {
  const out = parseMotionDirectorOutput(
    fence("html", page) + fence("json", JSON.stringify({ bgm: { track: "house-progres", volume: 0.5 }, cues: [[1, "tag:whoosh", 1], [2, "tag:없는태그", 1], ["s3", "tag:jingle", 0.8]] })),
    { aspectRatio: "16:9", prepared },
  );
  assert.deepEqual([...out.problems], []);
  assert.match(out.html, /href="\.\.\/\.\.\/\.\.\/ai-company-app\/motion-kit\/lib\/fonts\.css"/);
  assert.match(out.html, /icons\/lucide\/book-open\.svg/);
  assert.match(out.html, /emoji\/rocket\.png/);
  assert.match(out.html, /emoji\/trophy\.png/);
  assert.match(out.html, /<script src="\.\.\/\.\.\/\.\.\/ai-company-app\/motion-kit\/music\/house-progress\.beats\.js"><\/script>\n<\/head>/);
  assert.equal(out.episode.bgm.track, "house-progress");
  assert.equal(out.episode.bgm.file, "../../../ai-company-app/motion-kit/music/house-progress.ogg");
  assert.equal(out.episode.beats, "../../../ai-company-app/motion-kit/music/house-progress.beats.json");
  assert.deepEqual(out.episode.cues.map((cue) => cue[1]), ["tag:whoosh", "tag:jingle"], "모르는 태그는 버린다");
  assert.ok(out.fixes.some((fix) => fix.includes("book-opn → book-open")));
  assert.equal(closestName("light-bulb", ["lightbulb", "light", "bulb-off"], "-"), "lightbulb");
});

test("부분 수정 요청: 지금 장면 코드·소리 큐·가리킨 장면을 주고 그 부분만 고치게 한다", () => {
  const text = buildMotionRevisionRequest({ input: { aspectRatio: "9:16", durationSec: 20 }, prepared, html: "<html>X</html>", episode: { cues: [] }, request: "글꼴을 둥글게", frameTimes: [3.8, 12.2] });
  assert.match(text, /글꼴을 둥글게/);
  assert.match(text, /3\.8초, 12\.2초/);
  assert.match(text, /나머지 장면·타이밍·문장·색·움직임은 한 글자도 바꾸지 않는다/);
  assert.match(text, /```html\n<html>X<\/html>\n```/);
  const api = read("prototype/functions/api/agent/motion-director.ts");
  assert.match(api, /body\?\.mode === "revise"/);
  assert.match(api, /motionExamplesForPrompt\(sql, who\.userId/);
});

test("AI 없이 바로 바꾸기: 글꼴·강조색만 덮어쓰고 다시 바꾸면 이전 덮어쓰기를 지운다", () => {
  const lib = evaluate(read("ai-company-app/src/lib/motionAssets.ts"));
  const once = lib.applyQuickStyle("<html><head></head><body></body></html>", { font: "Gowun Batang", color: "#ff0000" });
  assert.match(once, /font-family: "Gowun Batang", sans-serif !important/);
  assert.match(once, /--k-hi: #ff0000 !important/);
  const twice = lib.applyQuickStyle(once, { font: "Jua" });
  assert.equal((twice.match(/nk-quick-style/g) || []).length, 1);
  assert.doesNotMatch(twice, /Gowun Batang|#ff0000/);
  assert.doesNotMatch(lib.applyQuickStyle(once, { font: "<script>" }), /script>/, "키트 글꼴만");
});

test("기획 회의: 자리 표시 글을 지우고 요청 글·SCENE n 으로 빈칸을 채우지 않는다", () => {
  const source = read("prototype/functions/api/agent/agent-video.ts");
  const { stripPlaceholders } = evaluate(source);
  assert.equal(stripPlaceholders("[채널 로고 / 브랜드명]"), "");
  assert.equal(stripPlaceholders("브랜드 항목 2"), "브랜드");
  assert.equal(stripPlaceholders("OOO 교회 소개"), "교회 소개");
  assert.equal(stripPlaceholders("66권 · 40명"), "66권 · 40명");
  assert.match(source, /eyebrow: compactCopy\(scene\?\.eyebrow, "", 36\)/);
  assert.doesNotMatch(source, /compactCopy\(scene\?\.body, request\.prompt/);
  assert.match(source, /facts: \(Array\.isArray\(scene\?\.facts\)/);
  assert.doesNotMatch(source, /\n핵심 \$\{index \+ 1\}/);
});

test("공개 자료: 배경음악 29곡(CC0)·효과음 Kenney(CC0)·이모지·아이콘·글꼴이 라이선스 문서와 함께 들어 있다", () => {
  const music = JSON.parse(read("ai-company-app/motion-kit/music/index.json"));
  assert.equal(music.length, 29);
  for (const track of music) {
    assert.equal(track.license, "CC0");
    assert.ok(fs.existsSync(path.join(kit, track.file)) && fs.existsSync(path.join(kit, track.beatsScript)), track.id);
    assert.ok(track.bpm > 40 && track.durationSec >= 120, track.id);
  }
  assert.ok(fs.existsSync(path.join(kit, "music", "LICENSE.md")));
  for (const pack of fs.readdirSync(path.join(kit, "sfx", "kenney"))) {
    assert.match(read(`ai-company-app/motion-kit/sfx/kenney/${pack}/License.txt`), /Creative Commons Zero, CC0/, pack);
  }
  assert.ok(fs.readdirSync(path.join(kit, "emoji")).filter((f) => f.endsWith(".png")).length >= 1500);
  assert.match(read("ai-company-app/motion-kit/emoji/LICENSE-fluentui-emoji.txt"), /MIT License/);
  assert.ok(fs.readdirSync(path.join(kit, "icons", "lucide")).length >= 2000);
  assert.match(read("ai-company-app/motion-kit/icons/LICENSE-lucide.txt"), /ISC/);
  for (const name of ["pretendard", "suit", "blackhansans", "dohyeon", "gowundodum", "gowunbatang", "gaegu", "nanumpenscript", "dongle", "himelody"]) {
    assert.match(read(`ai-company-app/motion-kit/fonts/OFL-${name}.txt`), /SIL Open Font License|OFL/i, name);
  }
  for (const lib of ["d3", "flubber", "roughjs", "animejs", "gl-transitions"]) assert.ok(fs.existsSync(path.join(kit, "vendor", `LICENSE-${lib}.txt`)), lib);
  assert.doesNotMatch(read("ai-company-app/motion-kit/vendor/gl-transitions.js"), /License: BSD/, "BSD 전환은 뺐다");
});

test("부분 수정·실례 저장: 이 PC 렌더러 경로, 화면 패널, 실례 API 가 이어져 있다", () => {
  const server = read("server.js");
  assert.match(server, /motionMatch\[2\] === 'page' && req\.method === 'GET'/);
  assert.match(server, /motionMatch\[2\] === 'stills' && req\.method === 'POST'/);
  assert.match(server, /\^still_\\d\+\\\.jpg\$/);
  const context = read("ai-company-app/src/contexts/AgentVideoWorkspaceContext.tsx");
  assert.match(context, /async function reviseVideo\(/);
  assert.match(context, /async function saveAsExample\(/);
  assert.match(read("ai-company-app/src/components/AgentVideoWorkspace.tsx"), /\{finalVideoUrl && <MotionRevisionPanel busy=/);
  const examples = read("prototype/functions/api/agent/_motion-examples.ts");
  assert.match(examples, /ensureSchemaOnce\(sql, "motion_examples_v1"/);
  assert.match(read("prototype/functions/api/agent/motion-examples.ts"), /WHERE id = \$1 AND user_id = \$2/);
});
