import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildMotionDirectorRequest, buildMotionDirectorSystem, parseMotionDirectorOutput, STAGE_SIZES,
} from "../functions/api/_shared/motion-director.js";
import { buildMotionDirectorKit, OUTPUT as KIT_OUTPUT } from "../../ai-company-app/scripts/build-motion-director-kit.mjs";

// 인포그래픽 영상 3단계(2026-10-21): 감독이 영상마다 장면 코드를 새로 쓴다. 비용 0원 — Claude 구독 전용.
const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");

const prepared = {
  kit: { motion: "../../../ai-company-app/motion-kit/lib/motion.js", baseCss: "b.css", fontsCss: "f.css" },
  bgm: { name: "lobby", file: "assets/bgm.mp3", bpm: 120, beatCount: 300, beats: "assets/beats.json", beatsScript: "assets/beats.js" },
  beatTimes: [0.5, 1, 1.5, 2, 40],
  items: [{ id: "logo", role: "logo", name: "NK", file: "assets/logo.png", width: 1200, height: 240 }, { id: "file-1", role: "audio", name: "hit", file: "assets/file-1-hit.wav", durationSec: 1, peakSec: 0.05 }],
};
const fence = (lang, body) => "```" + lang + "\n" + body + "\n```";
const goodPage = `<!doctype html><html lang="ko"><head><link rel="stylesheet" href="f.css"></head><body><div id="stage"></div>
<script src="../../../ai-company-app/motion-kit/lib/motion.js"></script><script>const keys = { transition: 1 };
async function seek(t) {}
window.READY = M.ready({}).then(() => { seek(0); return 25; });</script></body></html>`;

test("감독 지침 모듈은 키트 원본(KIT.md·실례·효과음 목록)과 같다 — 고치면 build-motion-director-kit.mjs 를 다시 돌릴 것", async () => {
  assert.equal(fs.readFileSync(KIT_OUTPUT, "utf8"), await buildMotionDirectorKit());
});

test("시스템 지침에 키트 사용법·쇼츠 문법·시즌1 실례 2편·효과음 목록이 들어간다", () => {
  const system = buildMotionDirectorSystem();
  assert.match(system, /async function seek\(t\)/);
  assert.match(system, /2026 쇼츠 문법/);
  assert.match(system, /확인되지 않은 수치는 만들지 않는다/);
  assert.match(system, /실례 1: NEKOBAN/);
  assert.match(system, /실례 2: ELIDUS/);
  assert.match(system, /synth\/whoosh\.wav/);
  assert.match(system, /game\/puzzleknight-level_up\.wav/);
});

test("요청 메시지에 화면 크기·경로·자산·박자가 들어가고 길이 밖 박자는 뺀다", () => {
  const text = buildMotionDirectorRequest({
    input: { prompt: "청소년 스마트폰", durationSec: 25, aspectRatio: "16:9", audience: "학부모", tone: "경쾌", style: "쇼츠" },
    spec: { title: "폰 내려놓기", scenes: [{ kind: "hero", title: "하루 4.7시간", body: "평균", visualData: { dataMode: "quantitative", values: [4.7], labels: ["하루"], unit: "시간" } }] },
    prepared,
  });
  assert.match(text, /data-size="1920x1080"/);
  assert.match(text, /\.\.\/\.\.\/\.\.\/ai-company-app\/motion-kit\/lib\/motion\.js/);
  assert.match(text, /"file": "assets\/logo\.png"/);
  assert.match(text, /하루 4\.7시간/);
  assert.match(text, /0\.5, 1, 1\.5, 2/);
  assert.doesNotMatch(text, /\b40\b, |, 40\b/, "영상 길이보다 한참 뒤 박자는 넣지 않는다");
});

test("결과 검사: 계약을 지키면 통과하고, 무대 크기는 요청 화면비로 고정한다", () => {
  const out = parseMotionDirectorOutput(
    fence("html", goodPage.replace('<html lang="ko"', '<html lang="ko" data-size="1080x1080"'))
      + "\n" + fence("json", JSON.stringify({ bgm: { volume: 2 }, cues: [[1, "synth/pop.wav", 1], ["s2.5", "assets/file-1-hit.wav", 9], [2, "../../secret.wav", 1], [3, "assets/unknown.wav", 1], ["soon", "synth/tick.wav", 1]] })),
    { aspectRatio: "9:16", prepared },
  );
  assert.deepEqual(out.problems, []);
  assert.match(out.html, /data-size="1080x1920"/);
  assert.deepEqual(out.episode.bgm, { file: "assets/bgm.mp3", start: 0, volume: 0.9 });
  assert.equal(out.episode.beats, "assets/beats.json");
  assert.deepEqual(out.episode.cues, [[1, "synth/pop.wav", 1], ["s2.5", "assets/file-1-hit.wav", 1.5]]);
  assert.equal(STAGE_SIZES["1:1"], "1080x1080");
});

test("결과 검사: 타이머·무작위·외부 주소·CSS 애니메이션·빠진 계약을 잡는다", () => {
  const bad = `<html><head><style>.x { transition: opacity 1s }</style><script src="https://cdn.example.com/x.js"></script></head>
<body><script>setTimeout(() => {}, 1); Math.random(); Date.now();</script></body></html>`;
  const out = parseMotionDirectorOutput(fence("html", bad), { aspectRatio: "16:9", prepared });
  const all = out.problems.join("\n");
  for (const expected of ['<div id="stage">', "async function seek", "window.READY", "motion.js 경로", "타이머", "Math.random", "현재 시각", "외부 주소", "CSS transition", "소리 큐"]) {
    assert.ok(all.includes(expected), `${expected} 를 잡아야 함:\n${all}`);
  }
  assert.match(out.html, /<html data-size="1920x1080">/);
  // SVG 네임스페이스는 외부 주소가 아니다
  const svg = goodPage.replace('<div id="stage"></div>', '<div id="stage"><svg xmlns="http://www.w3.org/2000/svg"></svg></div>');
  assert.deepEqual(parseMotionDirectorOutput(fence("html", svg) + fence("json", '{"cues":[]}'), { prepared }).problems, []);
});

test("배경음악이 없으면 소리 큐는 초 단위만 쓴다", () => {
  const noMusic = { ...prepared, bgm: null };
  const out = parseMotionDirectorOutput(fence("html", goodPage) + fence("json", '{"bgm":null,"cues":[[3,"synth/pop.wav",1]]}'), { prepared: noMusic });
  assert.ok(out.problems.some((p) => p.includes("초")));
  assert.equal(out.episode.bgm, null);
});

test("기획 회의·감독은 Claude 구독일 때만, 예비 API 키 없이 돈다(비용 0원)", () => {
  const auth = read("prototype/functions/api/agent/_motion-auth.ts");
  assert.match(auth, /resolved\?\.mode !== "subscription" \|\| !resolved\?\.oauthToken\) return null/);
  assert.match(auth, /fallback: null/);
  const director = read("prototype/functions/api/agent/motion-director.ts");
  assert.match(director, /motionSubscriptionAuth\(sql, who\.userId, env\)/);
  assert.match(director, /MOTION_SUBSCRIPTION_REQUIRED \}, 412/);
  assert.match(director, /stream: true/);
  assert.match(director, /WHERE id = \$1 AND user_id = \$2/);
  const planning = read("prototype/functions/api/agent/agent-video.ts");
  assert.match(planning, /if \(!motionAuth\) return send\(\{ error: MOTION_SUBSCRIPTION_REQUIRED \}, 412, origin\)/);
  assert.match(planning, /resolvedAuth: motionAuth, model: MOTION_PLANNING_MODEL/);
  assert.match(planning, /model: MOTION_PLANNING_MODEL,\n\s+maxTokens: 4200,\n\s+resolvedAuth: motionAuth/);
});

test("이 PC 렌더러: nkstudio.org·localhost 화면만 부를 수 있고, 렌더는 한 번에 하나만 돈다", () => {
  const server = read("server.js");
  const origins = new RegExp(server.match(/const LOCAL_RENDERER_ORIGINS = \/(.+)\/;/)[1]);
  for (const ok of ["https://nkstudio.org", "https://www.nkstudio.org", "http://localhost:5173", "http://127.0.0.1:14000"]) assert.ok(origins.test(ok), ok);
  for (const no of ["https://evil.example.com", "https://nkstudio.org.evil.com", "http://nkstudio.org"]) assert.ok(!origins.test(no), no);
  assert.match(server, /'Access-Control-Allow-Private-Network': 'true'/);
  assert.match(server, /if \(isLocalRendererPath\(pathname\) && localRendererCors\(req, res\)\) return;/);
  assert.match(server, /const busy = \[\.\.\.agentVideoJobs\.values\(\)\]\.some\(\(job\) => job\.status === 'rendering'\)/);
  assert.match(server, /'--allow-root', directory, '--allow-root', kitDirectory/);
  assert.match(server, /\(raw\|prepare\|page\|render\|thumb\)/);
});

test("키트: 무대 크기를 <html data-size>로 바꾸되 기본 1080x1920은 시즌1과 같은 값을 쓴다", () => {
  const motion = read("ai-company-app/motion-kit/lib/motion.js");
  assert.match(motion, /if \(M\.W !== 1080 \|\| M\.H !== 1920\) \{/);
  assert.match(motion, /const sy = \(v\) => Math\.round\(v \* M\.H \/ 1920\);/);
  assert.match(motion, /M\.count = /);
  const base = read("ai-company-app/motion-kit/lib/base.css");
  assert.match(base, /width: var\(--stage-w, 1080px\); height: var\(--stage-h, 1920px\)/);
  assert.match(base, /transform-origin: var\(--cam-ox, 540px\) var\(--cam-oy, 1000px\)/);
  assert.match(read("ai-company-app/scripts/render-motion-page.mjs"), /document\.getElementById\('stage'\); return s \? \[s\.offsetWidth, s\.offsetHeight\]/);
});

test("화면: 작업이 끝나면 자산 옮기기 → 감독 → 장면 저장 → 렌더 순서로 잇고, nkstudio.org 에서는 이 PC를 직접 부른다", () => {
  const context = read("ai-company-app/src/contexts/AgentVideoWorkspaceContext.tsx");
  const order = ["stageMotionAssets(workId", "fetchMotionThumbs(workId", "runMotionDirector(workId", "saveMotionPage(workId", "startMotionRender(workId)"]
    .map((needle) => context.indexOf(needle));
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), `순서: ${order}`);
  assert.match(context, /motion: motionSourceRef\.current/);
  assert.match(context, /fetch\(localRendererUrl\(renderResult\.downloadUrl\)\)/);
  const api = read("ai-company-app/src/lib/api.ts");
  assert.match(api, /host === "localhost" \|\| host === "127\.0\.0\.1" \? path : `http:\/\/localhost:14000\$\{path\}`/);
  assert.match(read("ai-company-app/src/components/AgentVideoWorkspace.tsx"), /\{finalVideoUrl \? \(/);
});

test("시청 대상·톤·스타일은 따로 받지 않고 요청 글에서 읽는다 — 기본값을 몰래 넣지 않는다(2026-10-21 엔케)", () => {
  const workspace = read("ai-company-app/src/components/AgentVideoWorkspace.tsx");
  assert.doesNotMatch(workspace, /시청 대상|<FieldLabel>톤|<FieldLabel>스타일/);
  const context = read("ai-company-app/src/contexts/AgentVideoWorkspaceContext.tsx");
  assert.doesNotMatch(context, /setAudience|setTone|setStyle|시네마틱 테크 인포그래픽|콘텐츠 제작자와 1인 기업/);
  for (const file of ["prototype/functions/api/agent/_company-skill-registry.ts", "prototype/functions/api/agent/_company-skill-executors.ts", "prototype/functions/api/agent/agent-video.ts", "prototype/functions/api/agent/_shared.ts"]) {
    assert.doesNotMatch(read(file), /"일반 시청자"|"명료하고 신뢰감 있게"|"시네마틱 모션 (인포)?그래픽"/, file);
  }
  const request = buildMotionDirectorRequest({ input: { prompt: "학부모 대상, 따뜻한 톤", durationSec: 20, aspectRatio: "9:16" }, prepared });
  assert.match(request, /영상 요청 글에서 읽어 정한다/);
  assert.doesNotMatch(request, /undefined/);
});

test("작업 시작은 서버가 끝까지 실행하게 기다리고(wait=1), 서버에서 끊겨 굳은 작업은 바로 알린다", () => {
  const api = read("ai-company-app/src/lib/api.ts");
  assert.match(api, /\/jobs\$\{options\.wait \? "\?wait=1" : ""\}/);
  const context = read("ai-company-app/src/contexts/AgentVideoWorkspaceContext.tsx");
  assert.match(context, /Date\.now\(\) - updatedAt > 5 \* 60 \* 1000/);
  assert.match(context, /await cancelCompanySkillJob\(jobId\)/);
  assert.match(context, /motionAssetText\(\)\.jobInterrupted/);
});
