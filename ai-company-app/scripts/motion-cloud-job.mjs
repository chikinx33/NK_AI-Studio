// 인포그래픽 영상 클라우드 렌더 작업(Cloud Run Jobs nk-motion-render 의 본체).
// 사이트(/api/agent/motion-cloud)가 실행시키며 NK_RUN_ID·NK_SESSION_TOKEN(이 사용자 권한, 2시간)·NK_SITE_ORIGIN 을 넘긴다.
// 이 PC 렌더러(server.js /local-motion)와 브라우저가 나눠 하던 일을 혼자 한다:
// 기획 회의 → 자산 받기·정리 → 감독(사이트의 /api/agent/motion-director, Claude 구독) → 렌더 → 정지 화면 → 저장소 저장·업무 완료.
// 폴더 구조는 이 저장소와 같게 둔다(/app/tmp/motion/<workId>, /app/ai-company-app/motion-kit) — 감독이 쓴 상대 경로가 그대로 맞는다.
// 두 단계: MOTION_STAGE=prep(작은 작업, 1 vCPU)은 기획·자산·감독까지 하고 장면 코드를 사이트에 넘긴다(handoff) →
// 사이트가 렌더 작업(4 vCPU)을 띄우고, 렌더 작업은 넘겨받은 장면 코드로 자산 정리·렌더·저장만 한다.
// (감독을 기다리는 4~8분을 큰 작업이 기다리면 그 시간도 4 vCPU 로 매겨진다.)
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { renderMotionPage, renderMotionStills } from "./render-motion-page.mjs";
import { prepareMotionAssets, MOTION_KIT_DIRECTORY } from "./prepare-motion-assets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORIGIN = String(process.env.NK_SITE_ORIGIN || "https://nkstudio.org").replace(/\/$/, "");
const RUN_ID = String(process.env.NK_RUN_ID || "");
const TOKEN = String(process.env.NK_SESSION_TOKEN || "");
const HEARTBEAT_MS = 15_000;
const STAGE = process.env.MOTION_STAGE === "prep" ? "prep" : "render";

const state = { status: "running", phase: "start", progress: 0, chars: 0, workId: null };
const timings = {};
const started = Date.now();
let lastReport = 0;
// 장면 코드를 렌더 작업에 넘긴 뒤에는 이 작업이 더 보고하지 않는다(렌더 작업의 보고를 덮지 않게)
let silenced = false;
const heartbeat = setInterval(() => { void report({}, { force: true }); }, HEARTBEAT_MS);

function api(pathname, init = {}) {
  return fetch(`${ORIGIN}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) },
  });
}

async function apiJson(pathname, init = {}, label = pathname) {
  const res = await api(pathname, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${label}: ${data?.error || `HTTP ${res.status}`}`);
  return data;
}

async function report(patch = {}, { force = false } = {}) {
  Object.assign(state, patch);
  if (silenced) return;
  if (!force && Date.now() - lastReport < 4_000) return;
  lastReport = Date.now();
  await api("/api/agent/motion-cloud", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "report", runId: RUN_ID, ...state }),
  }).catch((error) => console.error(`보고 실패: ${error?.message || error}`));
}

async function phase(name, fn, key = name) {
  const at = Date.now();
  await report({ phase: name, progress: 0, chars: 0 }, { force: true });
  try {
    return await fn();
  } finally {
    timings[key] = Math.round((Date.now() - at) / 100) / 10;
    console.log(`[${key}] ${timings[key]}초`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isUuid = (value) => /^[0-9a-f-]{36}$/i.test(String(value || ""));
const safeName = (name) => {
  const base = path.basename(String(name || ""));
  return /^[\w가-힣.-]{1,120}$/.test(base) && !base.startsWith(".") ? base : "";
};

// ---------- 기획 회의 ----------

async function runPlanning(skillJobId) {
  // 실행은 요청을 연 채로(wait=1) 끝까지 — 응답 뒤 백그라운드는 30초에 끊긴다
  let job = (await apiJson(`/api/agent/skill-jobs/${encodeURIComponent(skillJobId)}/continue?wait=1`, { method: "POST" }, "기획 회의")).job;
  for (let i = 0; i < 120; i++) {
    if (job?.approvalState?.status === "pending") return { job, awaiting: true };
    if (job?.status === "completed") return { job, awaiting: false };
    if (job?.status === "failed") throw new Error(job?.error?.message || "기획 회의에 실패했습니다.");
    if (job?.status === "cancelled") throw new Error("기획 회의가 취소되었습니다.");
    await sleep(5_000);
    job = (await apiJson(`/api/agent/skill-jobs/${encodeURIComponent(skillJobId)}`, {}, "기획 회의 상태")).job;
    // 실행 리스가 비어 있으면(이전 실행이 끊김) 다시 이어 간다
    if (!["completed", "failed", "cancelled"].includes(job?.status) && job?.approvalState?.status !== "pending" && i % 6 === 5) {
      job = (await apiJson(`/api/agent/skill-jobs/${encodeURIComponent(skillJobId)}/continue?wait=1`, { method: "POST" }, "기획 회의")).job;
    }
  }
  throw new Error("기획 회의가 10분 안에 끝나지 않았습니다.");
}

// ---------- 자산 ----------

async function stageAssets(workId, directory) {
  const manifest = await apiJson(`/api/agent/motion-assets?workId=${encodeURIComponent(workId)}`, {}, "자산 목록");
  const items = (Array.isArray(manifest.items) ? manifest.items : []).filter((item) => safeName(item.fileName) === item.fileName).slice(0, 60);
  await fs.rm(directory, { recursive: true, force: true });
  await fs.mkdir(path.join(directory, "assets", "raw"), { recursive: true });
  await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify({ workId, brand: manifest.brand || null, noMusic: manifest.noMusic === true, items }, null, 2));
  for (const [index, item] of items.entries()) {
    await report({ progress: Math.round((index / Math.max(1, items.length)) * 80) });
    const res = await api(item.url);
    if (!res.ok) throw new Error(`자산을 받지 못했어요: ${item.name} (HTTP ${res.status})`);
    await fs.writeFile(path.join(directory, "assets", "raw", item.fileName), Buffer.from(await res.arrayBuffer()));
  }
  const prepared = await prepareMotionAssets(directory, { log: (line) => console.log(line) });
  return { ...prepared, warnings: manifest.warnings || [] };
}

async function thumbsFor(directory, prepared) {
  const thumbs = [];
  for (const item of (Array.isArray(prepared?.items) ? prepared.items : []).filter((item) => item?.thumb).slice(0, 12)) {
    const bytes = await fs.readFile(path.join(directory, item.thumb)).catch(() => null);
    if (!bytes) continue;
    const size = item.width ? ` ${item.width}x${item.height}` : "";
    const length = item.durationSec ? ` ${item.durationSec}초` : "";
    thumbs.push({ id: item.id, label: `[${item.role}] ${item.name} → ${item.file}${size}${length}`, dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}` });
  }
  return thumbs;
}

// ---------- 감독 ----------

async function runDirector(body) {
  const res = await api("/api/agent/motion-director", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `감독 호출 실패 (HTTP ${res.status})`);
  }
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 2);
      if (!line.startsWith("data:")) continue;
      const event = JSON.parse(line.slice(5).trim());
      if (event.t === "progress") await report({ chars: Number(event.chars) || 0 });
      else if (event.t === "error") throw new Error(String(event.error || "motion_director_error"));
      else if (event.t === "done") {
        if (event.usage) {
          console.log(`감독 출력: ${JSON.stringify(event.usage)}`);
          timings.directorOutputTokens = Number(event.usage.outputTokens) || 0;
        }
        if (event.result?.problems?.length) throw new Error(`motion_director_problems:${event.result.problems.join(" · ")}`);
        return event.result;
      }
    }
  }
  throw new Error("감독 응답이 끝나기 전에 연결이 끊겼어요.");
}

async function writePage(directory, html, episode) {
  if (!/id=["']stage["']/.test(html) || !/window\.READY\s*=/.test(html)) throw new Error("장면 코드가 올바르지 않습니다.");
  await fs.writeFile(path.join(directory, "index.html"), html, "utf8");
  await fs.writeFile(path.join(directory, "episode.json"), JSON.stringify(episode && typeof episode === "object" ? episode : { bgm: null, cues: [] }, null, 2), "utf8");
}

// ---------- 저장 ----------

async function upload(workId, fileName, contentType, bytes) {
  const data = await apiJson(`/api/agent/agent-video-storage?filename=${encodeURIComponent(fileName)}&workId=${encodeURIComponent(workId)}`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: bytes,
  }, `저장(${fileName})`);
  return { ...data.item, checksum: sha256(bytes) };
}

async function main() {
  if (!isUuid(RUN_ID) || !TOKEN) throw new Error("NK_RUN_ID·NK_SESSION_TOKEN 이 필요합니다.");
  const { run, input = {} } = await apiJson(`/api/agent/motion-cloud?runId=${encodeURIComponent(RUN_ID)}&input=1`, {}, "작업 읽기");
  const lang = input.lang === "en" ? "en" : "ko";
  let workId = run.workId;
  let skillJob = null;
  // 장면 코드가 이미 정해졌나: 준비 작업이 넘겨줬거나(prepTimings), AI 없이 바꾼 장면 코드(render)
  const pageReady = run.mode === "render" || !!input.prepTimings;

  if (!pageReady && run.mode === "new" && run.skillJobId) {
    const planned = await phase("plan", () => runPlanning(run.skillJobId));
    skillJob = planned.job;
    if (planned.awaiting) {
      await report({ status: "awaiting-approval" }, { force: true });
      return;
    }
    workId = skillJob.workItemId;
  } else if (run.skillJobId) {
    skillJob = (await apiJson(`/api/agent/skill-jobs/${encodeURIComponent(run.skillJobId)}`, {}, "기획 결과")).job;
  }
  if (!isUuid(workId)) throw new Error("완료된 기획 회의의 회사 업무를 찾지 못했습니다.");
  await report({ workId }, { force: true });
  const work = (await apiJson(`/api/agent/work-items?id=${encodeURIComponent(workId)}`, {}, "회사 업무")).items?.[0];
  if (!work) throw new Error("회사 업무를 찾지 못했습니다.");
  const skillJobId = skillJob?.id || String(work?.metadata?.skill?.skillJobId || "") || null;
  if (!skillJob && skillJobId) skillJob = (await apiJson(`/api/agent/skill-jobs/${encodeURIComponent(skillJobId)}`, {}, "기획 결과").catch(() => ({}))).job || null;
  await apiJson("/api/agent/work-items", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: workId, status: "working" }) }, "업무 상태").catch(() => {});

  const directory = path.join(ROOT, "tmp", "motion", workId.toLowerCase());
  // 렌더 작업도 자산을 다시 받아 정리한다(몇 초, 결과는 같다). 화면에는 렌더 단계로 보인다.
  const prepared = await phase(pageReady ? "render" : "assets", () => stageAssets(workId, directory), "assets");

  let html;
  let episode;
  if (pageReady) {
    html = input.html;
    episode = input.episode;
  } else if (run.mode === "new") {
    const result = await phase("director", async () => runDirector({ workId, prepared, thumbs: await thumbsFor(directory, prepared) }));
    html = result.html;
    episode = result.episode;
  } else if (run.mode === "revise") {
    const result = await phase("director", async () => {
      // 가리킨 장면을 지금 장면 코드로 다시 찍어 감독에게 크게 보여 준다(가로 540px)
      await writePage(directory, input.html, input.episode);
      const frames = [];
      if (input.frameTimes?.length) {
        const shots = await renderMotionStills({ page: path.join(directory, "index.html"), outDir: path.join(directory, "frames"), times: input.frameTimes, scale: 0.5, prefix: "frame", allowRoots: [directory, MOTION_KIT_DIRECTORY] });
        for (const shot of shots) frames.push({ t: shot.t, dataUrl: `data:image/jpeg;base64,${(await fs.readFile(path.join(directory, "frames", shot.file))).toString("base64")}` });
      }
      return runDirector({ workId, prepared, mode: "revise", html: input.html, episode: input.episode, request: input.request, frames });
    });
    html = result.html;
    episode = result.episode;
  }
  if (!pageReady && STAGE === "prep") {
    clearInterval(heartbeat);
    silenced = true;
    timings.prepTotal = Math.round((Date.now() - started) / 100) / 10;
    await apiJson("/api/agent/motion-cloud", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "handoff", runId: RUN_ID, workId, html, episode, timings }),
    }, "렌더 작업 넘기기");
    console.log(`렌더 작업에 넘김 (${timings.prepTotal}초)`);
    return;
  }
  await writePage(directory, html, episode);

  const outPath = path.join(directory, "final", `motion_${lang}.mp4`);
  await phase("render", () => renderMotionPage({
    page: path.join(directory, "index.html"),
    out: outPath,
    lang,
    episode: path.join(directory, "episode.json"),
    audioDirs: [path.join(MOTION_KIT_DIRECTORY, "sfx")],
    allowRoots: [directory, MOTION_KIT_DIRECTORY],
    workers: Number(process.env.MOTION_WORKERS) || 3,
    log: (line) => {
      console.log(line);
      const match = String(line).match(/Rendered\s+(\d+)\/(\d+)/);
      // 촬영과 인코딩이 함께 돈다. 인코딩 마무리가 남았으니 95%에서 멈춘다.
      if (match) void report({ progress: Math.min(95, Math.round((Number(match[1]) / Number(match[2])) * 95)) });
    },
  }));

  const output = await phase("save", async () => {
    const stillsDirectory = path.join(directory, "stills");
    await fs.rm(stillsDirectory, { recursive: true, force: true });
    const stills = await renderMotionStills({ page: path.join(directory, "index.html"), outDir: stillsDirectory, count: 12, allowRoots: [directory, MOTION_KIT_DIRECTORY] });
    await report({ progress: 20 });
    const video = await upload(workId, "agent-video.mp4", "video/mp4", await fs.readFile(outPath));
    await report({ progress: 70 });
    const storedStills = [];
    for (const still of stills) {
      const item = await upload(workId, `motion-${still.file}`, "image/jpeg", await fs.readFile(path.join(stillsDirectory, still.file)));
      storedStills.push({ t: still.t, objectName: item.objectName });
    }
    const json = (value) => Buffer.from(JSON.stringify(value, null, 2));
    const source = await upload(workId, "source.json", "application/json", json({
      schema: "company-skill/infographic-source/v1",
      jobId: skillJobId,
      workItemId: workId,
      spec: work?.metadata?.spec || null,
      // 감독이 쓴 장면 코드·소리 큐와 받은 자산 목록(다시 렌더·수정할 때 쓴다)
      motion: { html, episode, prepared },
      renderer: "cloud",
    }));
    const reportItem = await upload(workId, "report.json", "application/json", json({
      schema: "company-skill/report/v1",
      jobId: skillJobId,
      workItemId: workId,
      agentReports: skillJob?.agentReports || [],
      qualityResults: skillJob?.qualityResults || [],
      warnings: skillJob?.warnings || [],
      costEstimate: skillJob?.costEstimate || null,
      actualCost: skillJob?.actualCost || null,
      providerUsage: skillJob?.providerUsage || {},
      completedAt: skillJob?.completedAt || null,
      cloudRender: { runId: RUN_ID, timings },
    }));
    const manifest = await upload(workId, "manifest.json", "application/json", json({
      schema: "company-skill/manifest/v1",
      version: skillJob?.version || 1,
      lineage: skillJob?.lineage || [],
      jobId: skillJobId,
      workItemId: workId,
      archivedAt: new Date().toISOString(),
      cost: { estimate: skillJob?.costEstimate || null, actual: skillJob?.actualCost || null },
      artifacts: [
        { kind: "final", objectPath: video.objectName, checksum: video.checksum },
        { kind: "source", objectPath: source.objectName, checksum: source.checksum },
        { kind: "report", objectPath: reportItem.objectName, checksum: reportItem.checksum },
      ],
    }));
    if (skillJobId) {
      const version = skillJob?.version || 1;
      const entry = (kind, item, extra = {}) => ({ kind, fileName: item.fileName, objectPath: item.objectName, mimeType: item.contentType, sizeBytes: item.size, checksum: item.checksum, version, ...extra });
      await apiJson(`/api/agent/skill-jobs/${encodeURIComponent(skillJobId)}/artifacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifacts: [
          entry("final", video), entry("source", source), entry("report", reportItem),
          entry("manifest", manifest, { metadata: { lineage: skillJob?.lineage || [] } }),
        ] }),
      }, "산출물 등록").catch((error) => console.error(error.message));
    }
    await apiJson("/api/agent/work-items", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: workId, status: "completed" }) }, "업무 상태").catch(() => {});
    return {
      video: { objectName: video.objectName, fileName: video.fileName, size: video.size },
      source: { objectName: source.objectName },
      report: { objectName: reportItem.objectName },
      manifest: { objectName: manifest.objectName },
      stills: storedStills,
    };
  });
  timings.renderTotal = Math.round((Date.now() - started) / 100) / 10;
  await report({ status: "done", phase: "save", progress: 100, output: { ...output, timings: { ...(input.prepTimings || {}), ...timings } } }, { force: true });
}

main()
  .then(() => { clearInterval(heartbeat); process.exit(0); })
  .catch(async (error) => {
    clearInterval(heartbeat);
    const message = String(error?.message || error || "클라우드 렌더 실패");
    console.error(message);
    silenced = false;
    await report({ status: "error", error: message, output: { timings } }, { force: true });
    process.exit(1);
  });
