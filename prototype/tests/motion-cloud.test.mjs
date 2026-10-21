import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";
import { orderedFrameSink } from "../../ai-company-app/scripts/render-motion-page.mjs";

// 2026-10-22 엔케 "PC가 꺼져 있어도 되게": 인포그래픽 영상 클라우드 렌더러(Cloud Run Jobs, us-central1)
const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
const esbuild = createRequire(import.meta.url)("../../ai-company-app/node_modules/esbuild");
function evaluate(source) {
  const module = { exports: {} };
  const code = esbuild.transformSync(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];[ \t]*$/gm, ""), { loader: "ts", format: "cjs" }).code;
  vm.runInNewContext(code, { module, exports: module.exports, console, JSON, Date });
  return module.exports;
}
const cloud = evaluate(read("prototype/functions/api/agent/_motion-cloud.ts"));
// vm 안에서 만든 객체는 원형이 달라 JSON 으로 옮겨 비교한다
const plain = (value) => JSON.parse(JSON.stringify(value));

test("촬영 장면은 번호가 섞여 들어와도 순서대로, 앞이 밀리면 기다렸다가 인코더에 넘긴다", async () => {
  const stream = new PassThrough({ highWaterMark: 4 });
  const out = [];
  stream.on("data", (chunk) => out.push(chunk[0]));
  const sink = orderedFrameSink(stream, { limit: 3 });
  // 일꾼 3개가 번갈아 찍는 순서(0,3,6 / 1,4,7 / 2,5,8)를 흉내 낸다
  await Promise.all([[0, 3, 6], [1, 4, 7], [2, 5, 8]].map(async (frames, worker) => {
    for (const k of frames) {
      await new Promise((resolve) => setTimeout(resolve, (2 - worker) * 3));
      await sink.put(k, Buffer.from([k]));
    }
  }));
  await sink.end();
  assert.deepEqual(out, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(sink.written, 9);
});

test("인코더가 죽으면 촬영이 멈추고 오류를 돌려준다", async () => {
  const stream = new PassThrough();
  const sink = orderedFrameSink(stream, { limit: 2 });
  await sink.put(0, Buffer.from([0]));
  stream.destroy(new Error("ffmpeg 종료"));
  await assert.rejects(() => sink.put(5, Buffer.from([5])), /ffmpeg 종료/);
});

test("렌더러: 장면을 디스크에 쌓지 않고 ffmpeg 표준 입력으로 흘려보낸다(클라우드 디스크=메모리)", () => {
  const renderer = read("ai-company-app/scripts/render-motion-page.mjs");
  assert.match(renderer, /"-f", "image2pipe", "-c:v", "mjpeg"/);
  assert.match(renderer, /tmix=frames=\$\{sub\},framestep=\$\{sub\}/, "모션블러는 그대로");
  assert.match(renderer, /export const LOUDNESS_TARGET = -14;/);
  assert.doesNotMatch(renderer, /f_%05d\.jpg/);
  assert.match(renderer, /MOTION_CHROME_FLAGS/);
  assert.match(renderer, /"\/usr\/bin\/google-chrome-stable"/);
});

test("클라우드 작업 입력: 새 영상은 기획 작업 id, 부분 수정은 장면 코드·요청·가리킨 시점을 받는다", () => {
  const html = '<div id="stage"></div><script>window.READY = Promise.resolve(10)</script>';
  const job = "11111111-2222-4333-8444-555555555555";
  const work = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  assert.deepEqual(plain(cloud.normalizeMotionCloudStart({ mode: "new", skillJobId: job })), { ok: true, value: { mode: "new", workId: null, skillJobId: job, input: { lang: "ko" } } });
  assert.equal(cloud.normalizeMotionCloudStart({ mode: "new" }).ok, false);
  assert.equal(cloud.normalizeMotionCloudStart({ mode: "revise", workId: work, html: "<html></html>", request: "x" }).ok, false, "장면 코드 검사");
  assert.equal(cloud.normalizeMotionCloudStart({ mode: "revise", workId: work, html }).ok, false, "수정 요청 필수");
  const revise = cloud.normalizeMotionCloudStart({ mode: "revise", workId: work, html, request: " 글꼴을 둥글게 ", frameTimes: [3.8, "12.2", -1, 999, 1, 2, 3] });
  assert.equal(revise.ok, true);
  assert.equal(revise.value.input.request, "글꼴을 둥글게");
  assert.deepEqual(plain(revise.value.input.frameTimes), [3.8, 12.2, 1, 2]);
  const render = cloud.normalizeMotionCloudStart({ mode: "render", workId: work, html, lang: "en" });
  assert.deepEqual(plain(render.value.input), { lang: "en", html, episode: { bgm: null, cues: [] } });
});

test("클라우드 작업 상태: 10분 넘게 보고가 없으면 멈춘 것으로 보여 주고, 끝난 작업은 그대로 둔다", () => {
  const now = Date.parse("2026-10-22T10:00:00Z");
  const old = "2026-10-22T09:49:00Z";
  assert.equal(cloud.isStaleRun({ status: "running", updated_at: old }, now), true);
  assert.equal(cloud.isStaleRun({ status: "running", updated_at: "2026-10-22T09:55:00Z" }, now), false);
  assert.equal(cloud.isStaleRun({ status: "done", updated_at: old }, now), false);
  const dto = cloud.toMotionCloudRunDto({ id: "r", status: "running", phase: "render", progress: 40, updated_at: "2000-01-01T00:00:00Z", input: { html: "비밀" } });
  assert.equal(dto.status, "error");
  assert.equal(dto.error, "motion_cloud_stale");
  assert.equal("input" in dto, false, "큰 입력·장면 코드는 상태에 싣지 않는다");
});

test("사이트 → Cloud Run Jobs: 고정된 작업 하나를 위임 토큰·작업 id 로만 재정의해 실행한다", () => {
  const source = read("prototype/functions/api/agent/_motion-cloud.ts");
  assert.equal(cloud.MOTION_CLOUD_JOBS.prep, "projects/arboreal-lane-477616-d4/locations/us-central1/jobs/nk-motion-prep");
  assert.equal(cloud.MOTION_CLOUD_JOBS.render, "projects/arboreal-lane-477616-d4/locations/us-central1/jobs/nk-motion-render");
  assert.match(source, /https:\/\/run\.googleapis\.com\/v2\/\$\{MOTION_CLOUD_JOBS\[args\.job\]\}:run/);
  // 기다림이 긴 기획·감독은 작은 작업, AI 없이 바꾼 장면 코드만 바로 렌더 작업
  assert.match(source, /const job = args\.value\.mode === "render" \? "render" : "prep";/);
  assert.match(source, /runMotionCloudJob\(env, \{ job: "render", runId: String\(run\.id\), token, origin \}\)/, "넘겨받으면 렌더 작업");
  assert.match(source, /issueSessionToken\(args\.userId, env, MOTION_CLOUD_TOKEN_TTL_SEC, \{ persistent: false \}\)/);
  assert.match(source, /ensureSchemaOnce\(sql, "motion_cloud_runs_v1"/);
  assert.match(source, /error: "motion_cloud_busy"/, "한 사람당 한 번에 하나");
  const deploy = read("cloud-motion-renderer/deploy.sh");
  assert.match(deploy, /PROJECT=arboreal-lane-477616-d4/);
  assert.match(deploy, /REGION=us-central1/);
  assert.match(deploy, /JOB=nk-motion-render/);
  assert.match(deploy, /PREP_JOB=nk-motion-prep/);
  assert.match(deploy, /--cpu 1 --memory 2Gi --tasks 1 --max-retries 0 --task-timeout 3600 --service-account "\$SA" --set-env-vars MOTION_STAGE=prep/);
  assert.match(deploy, /--cpu 8 --memory 8Gi --tasks 1 --max-retries 0 --task-timeout 3600 --service-account "\$SA" --set-env-vars MOTION_STAGE=render/);
  const job = read("ai-company-app/scripts/motion-cloud-job.mjs");
  assert.match(job, /if \(!pageReady && STAGE === "prep"\) \{\n\s+clearInterval\(heartbeat\);\n\s+silenced = true;/, "넘긴 뒤엔 보고하지 않는다");
  assert.match(job, /action: "handoff", runId: RUN_ID, workId, html, episode, timings/);
  const docker = read("cloud-motion-renderer/Dockerfile");
  assert.match(docker, /google-chrome-stable/);
  // GPU 없는 컨테이너: 소프트웨어 합성(SwiftShader GL 흉내보다 3.6배 빠름), WebGL 만 SwiftShader, 일꾼 6·크롬 3(8 vCPU 실측 25초 영상 160초)
  assert.match(docker, /MOTION_CHROME_FLAGS="--no-sandbox --disable-dev-shm-usage --disable-gpu --enable-unsafe-swiftshader"/);
  assert.match(docker, /MOTION_WORKERS=6/);
  assert.match(docker, /MOTION_BROWSERS=3/);
  assert.match(read("ai-company-app/scripts/render-motion-page.mjs"), /const browserCount = Math\.max\(1, Math\.min\(workers, Number\(options\.browsers \?\? process\.env\.MOTION_BROWSERS\) \|\| 1\)\);/);
  assert.match(docker, /motion-cloud-job\.mjs/);
  // 기획 회의는 만들기만 하고(defer=1) 실행은 클라우드 작업이 맡는다
  assert.match(read("prototype/functions/api/agent/skills/[skillId]/jobs.ts"), /if \(result\.created && !defer\)/);
});

test("화면: 클라우드 상태는 진행 중일 때만 읽고, 완성 정지 화면으로 부분 수정한다", () => {
  const context = read("ai-company-app/src/contexts/AgentVideoWorkspaceContext.tsx");
  assert.match(context, /if \(!cloudRun \|\| !\["queued", "running"\]\.includes\(cloudRun\.status\)\) return;/);
  assert.match(context, /if \(document\.hidden\) return;/);
  assert.match(context, /mode: "revise", workId: source\.workId, html, episode: source\.episode, request, frameTimes/);
  assert.match(context, /stills: cloudRun\?\.status === "done" \? cloudRun\.output\?\.stills \|\| \[\] : \[\]/);
  const panel = read("ai-company-app/src/components/MotionRevisionPanel.tsx");
  assert.match(panel, /const \{ activeWork, reviseVideo, saveAsExample, stills \} = useAgentVideoWorkspace\(\);/);
  assert.doesNotMatch(panel, /makeMotionStills/);
});

test("감독 출력 한도: 모델 상한 128K·30분, 잘리면 생각/장면 코드 사용량을 남기고 화면은 읽을 수 있는 말로 알린다", () => {
  const shared = read("prototype/functions/api/_shared/motion-director.js");
  assert.match(shared, /export const MOTION_DIRECTOR_MAX_TOKENS = 128000;/);
  const api = read("prototype/functions/api/agent/motion-director.ts");
  assert.match(api, /const TIMEOUT_MS = 1_800_000;/, "프록시(nk-openai-proxy) 3600초 안");
  assert.match(api, /throw new Error\(`motion_director_max_tokens \$\{JSON\.stringify\(usage\)\}`\)/);
  assert.match(api, /const usage = \{ outputTokens, textChars: text\.length, thinkingChars \};/);
  assert.match(read("ai-company-app/scripts/motion-cloud-job.mjs"), /timings\[tokenKey\] = Number\(event\.usage\.outputTokens\) \|\| 0;/);
  const picker = read("ai-company-app/src/components/MotionAssetPicker.tsx");
  assert.match(picker, /if \(message\.includes\("motion_director_max_tokens"\)\) return t\.directorTooLong;/);
  assert.match(picker, /if \(message\.includes\("motion_director_timeout"\)\) return t\.directorTimeout;/);
  assert.equal((picker.match(/directorTooLong: "/g) || []).length, 2, "한/영 둘 다");
});

test("화면 단순화: 설명 문구는 개요 옆 물음표 도움말 한 곳에, 왼쪽 패널엔 입력만", () => {
  const workspace = read("ai-company-app/src/components/AgentVideoWorkspace.tsx");
  assert.match(workspace, /<h2 className="text-sm font-bold text-strong">개요<\/h2>\n\s+<MotionHelp \/>/);
  assert.doesNotMatch(workspace, /제작할 결과물의 기준을 입력합니다/);
  assert.doesNotMatch(workspace, /<FieldLabel>(길이|화면비)<\/FieldLabel>/, "고른 값이 곧 설명");
  assert.match(workspace, /<SelectField label="길이"/, "화면 읽기용 이름은 남긴다");
  assert.doesNotMatch(workspace, /motionText\.(planningNote|cloudNote|previewPlaceholderHint)/);
  assert.doesNotMatch(workspace, /로컬 Remotion 렌더/);
  const picker = read("ai-company-app/src/components/MotionAssetPicker.tsx");
  assert.doesNotMatch(picker, /\{t\.(hint|bgmHint)\}<\/p>/);
  const help = read("ai-company-app/src/components/MotionHelp.tsx");
  for (const key of ["promptExample", "hint", "bgmHint", "planningNote", "cloudNote"]) assert.match(help, new RegExp(`t\.${key}\}`), key);
  assert.match(help, /M9\.09 9a3 3 0 0 1 5\.83 1c0 2-3 3-3 3/, "lucide circle-help");
  assert.match(help, /if \(event\.key === "Escape"\) setOpen\(false\);/);
});
