// 인포그래픽 영상 작업 폴더 준비: 브라우저가 넘긴 원본 자산(assets/raw)을 렌더하기 좋게 정리하고
// 장면 코드를 짜는 AI가 읽을 목록(assets.json)을 만든다.
// - 그림: 그대로 복사 + 크기
// - 클립: 프레임 단위로 정확히 seek 되도록 전부 키프레임(all-intra) 60fps로 변환(원본 키트 prep_clip.py와 같은 방식), 긴 변 1920 이하
// - 배경음악: 박자표(beats.json·beats.js) + 길이·BPM
// - 효과음 후보: 길이·타격 지점
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beatsForFile, decodeMono } from "./motion-beats.mjs";
import { pickFfmpeg } from "./render-motion-page.mjs";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MOTION_KIT_DIRECTORY = path.join(projectDirectory, "motion-kit");
const IMAGE_ROLES = new Set(["logo", "character", "environment", "image"]);
const MAX_CLIP_SEC = 30;

function run(ffmpeg, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args.map(String), { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let err = "";
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve(err) : reject(new Error(err.trim().split(/\r?\n/).slice(-4).join("\n") || `exit=${code}`))));
  });
}

// ffprobe 없이 ffmpeg -i 출력에서 크기·길이를 읽는다(전체 빌드 ffmpeg에는 ffprobe가 없다)
export function parseMediaInfo(text) {
  const size = text.match(/Stream #[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/);
  const duration = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return {
    width: size ? Number(size[1]) : null,
    height: size ? Number(size[2]) : null,
    durationSec: duration ? Math.round((Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 1000) / 1000 : null,
  };
}

async function mediaInfo(ffmpeg, file) {
  const text = await new Promise((resolve) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-i", file], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let err = "";
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("exit", () => resolve(err));
    child.on("error", () => resolve(""));
  });
  return parseMediaInfo(text);
}

function peakSecond(samples, sampleRate, windowSec = 0.6) {
  let best = 0;
  let at = 0;
  const n = Math.min(samples.length, Math.round(windowSec * sampleRate));
  for (let i = 0; i < n; i++) if (Math.abs(samples[i]) > best) { best = Math.abs(samples[i]); at = i; }
  return Math.round((at / sampleRate) * 1000) / 1000;
}

// 감독(AI)이 자산을 직접 보고 장면을 짜도록 긴 변 512px 미리보기(영상은 at초 장면)를 만든다. 투명 배경은 회색 바탕에.
async function makeThumb(ffmpeg, source, thumbsDirectory, id, at = 0) {
  const name = `${safeAssetName(id) || "asset"}.jpg`;
  try {
    const scale = "scale='if(gt(iw,ih),min(512,iw),-2)':'if(gt(iw,ih),-2,min(512,ih))'";
    const filter = at > 0
      ? `${scale},format=yuvj420p`
      : `color=c=0x808080:s=8x8[bg];[0:v]${scale}[fg];[bg][fg]scale2ref[b][f];[b][f]overlay=format=auto,format=yuvj420p`;
    await run(ffmpeg, ["-y", "-v", "error", ...(at > 0 ? ["-ss", at.toFixed(2)] : []), "-i", source, "-frames:v", 1,
      ...(at > 0 ? ["-vf", filter] : ["-filter_complex", filter]), "-q:v", 4, path.join(thumbsDirectory, name)]);
    return `assets/_thumbs/${name}`;
  } catch (_) {
    return null;
  }
}

// ---------- 레퍼런스 영상(연출 참고) ----------
// 화면에 쓰는 자산이 아니다. 감독이 움직임·전환·리듬을 읽도록 일정 간격으로 찍어 4×4 접촉 시트로 모으고,
// 컷이 바뀌는 시각과 (소리가 있으면) 박자를 뽑는다.
const MAX_REFERENCE_SEC = 60;
const SHEET_TILES = 16;
const MAX_SHEETS = 12;
const round2 = (value) => Math.round(value * 100) / 100;

// 길이에 맞춘 촬영 간격: 짧으면 1초에 최대 6장(움직임 곡선이 보이게), 길면 시트 12장 안에 들어가게 성기게
export function referenceSheetPlan(durationSec) {
  const span = Math.min(MAX_REFERENCE_SEC, Math.max(0, Number(durationSec) || 0));
  if (span < 0.5) return null;
  const step = Math.max(1 / 6, span / (SHEET_TILES * MAX_SHEETS));
  const stepMs = Math.ceil(step * 1000);
  const frames = Math.max(1, Math.floor((span * 1000) / stepMs) + 1);
  const sheets = Math.min(MAX_SHEETS, Math.ceil(frames / SHEET_TILES));
  return {
    span: round2(span),
    step: stepMs / 1000,
    // ffmpeg fps 필터는 분수로 받는다(1000/167 = 약 5.99장/초)
    fps: `1000/${stepMs}`,
    sheets,
    ranges: Array.from({ length: sheets }, (_, k) => ({
      from: round2((k * SHEET_TILES * stepMs) / 1000),
      to: round2(Math.min(span, (((k + 1) * SHEET_TILES - 1) * stepMs) / 1000)),
    })),
  };
}

// ffmpeg select+showinfo 출력 → 컷 시각(초). 0.15초 안에 겹친 감지는 하나로
export function parseSceneCuts(text, limit = 80) {
  const cuts = [];
  for (const match of String(text || "").matchAll(/pts_time:\s*([\d.]+)/g)) {
    const at = round2(Number(match[1]));
    if (!Number.isFinite(at) || at < 0.05) continue;
    if (cuts.length && at - cuts[cuts.length - 1] < 0.15) continue;
    cuts.push(at);
  }
  return cuts.slice(0, limit);
}

async function analyzeReference(ffmpeg, source, thumbsDirectory, item) {
  const info = await mediaInfo(ffmpeg, source);
  const plan = referenceSheetPlan(info.durationSec);
  if (!plan) return null;
  const tile = "scale='if(gt(iw,ih),384,-2)':'if(gt(iw,ih),-2,384)':flags=lanczos";
  await run(ffmpeg, ["-y", "-v", "error", "-t", plan.span, "-i", source, "-an",
    "-vf", `fps=${plan.fps},${tile},tile=4x4:padding=4:color=0x808080`,
    "-frames:v", plan.sheets, "-q:v", 4, path.join(thumbsDirectory, "reference_%02d.jpg")]);
  const sheets = [];
  for (const [index, range] of plan.ranges.entries()) {
    const name = `reference_${String(index + 1).padStart(2, "0")}.jpg`;
    if (existsSync(path.join(thumbsDirectory, name))) sheets.push({ thumb: `assets/_thumbs/${name}`, ...range });
  }
  const cutLog = await run(ffmpeg, ["-hide_banner", "-t", plan.span, "-i", source, "-an",
    "-vf", "scale=480:-2,select='gt(scene,0.3)',showinfo", "-f", "null", "-"]).catch(() => "");
  // 소리가 없는 영상이면 박자 분석은 실패한다 → 박자 없이
  const beat = await beatsForFile(ffmpeg, source).catch(() => null);
  const beats = beat ? beat.beats.filter((at) => at <= plan.span).slice(0, 160) : [];
  return {
    name: item.name,
    durationSec: info.durationSec,
    width: info.width,
    height: info.height,
    span: plan.span,
    step: plan.step,
    sheets,
    cuts: parseSceneCuts(cutLog),
    bpm: beat && beats.length >= 8 ? Math.round(beat.bpm * 10) / 10 : null,
    beats: beats.length >= 8 ? beats : [],
  };
}

// 매니페스트의 파일 이름은 사이트가 만든다. 그래도 폴더를 벗어나지 못하게 이름만 받는다.
export function safeAssetName(name) {
  const base = path.basename(String(name || ""));
  return /^[\w가-힣.-]{1,120}$/.test(base) && !base.startsWith(".") ? base : "";
}

export async function prepareMotionAssets(jobDirectory, { log = () => {} } = {}) {
  const ffmpeg = pickFfmpeg();
  const manifest = JSON.parse(await fs.readFile(path.join(jobDirectory, "manifest.json"), "utf8"));
  const rawDirectory = path.join(jobDirectory, "assets", "raw");
  const assetsDirectory = path.join(jobDirectory, "assets");
  const thumbsDirectory = path.join(assetsDirectory, "_thumbs");
  await fs.mkdir(thumbsDirectory, { recursive: true });
  const items = [];
  const missing = [];
  let bgm = null;
  let beatTimes = [];
  let reference = null;
  for (const item of manifest.items || []) {
    const fileName = safeAssetName(item.fileName);
    const source = fileName ? path.join(rawDirectory, fileName) : "";
    if (!source || !existsSync(source)) { missing.push(item.id); continue; }
    if (IMAGE_ROLES.has(item.role)) {
      await fs.copyFile(source, path.join(assetsDirectory, fileName));
      const svg = /\.svg$/i.test(fileName);
      const info = svg ? { width: null, height: null } : await mediaInfo(ffmpeg, source);
      const thumb = svg ? null : await makeThumb(ffmpeg, source, thumbsDirectory, item.id);
      items.push({ id: item.id, role: item.role, name: item.name, file: `assets/${fileName}`, width: info.width, height: info.height, ...(thumb ? { thumb } : {}) });
    } else if (item.role === "video") {
      const out = `${fileName.replace(/\.[^.]+$/, "")}.mp4`;
      log(`클립 변환: ${fileName}`);
      await run(ffmpeg, ["-y", "-v", "error", "-i", source, "-t", MAX_CLIP_SEC, "-an",
        "-vf", "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))':flags=lanczos,fps=60,format=yuv420p",
        "-c:v", "libx264", "-g", 1, "-crf", 14, "-preset", "veryfast", "-movflags", "+faststart", path.join(assetsDirectory, out)]);
      const info = await mediaInfo(ffmpeg, path.join(assetsDirectory, out));
      const thumb = await makeThumb(ffmpeg, path.join(assetsDirectory, out), thumbsDirectory, item.id, (info.durationSec || 0) * 0.4);
      items.push({ id: item.id, role: "video", name: item.name, file: `assets/${out}`, ...info, ...(thumb ? { thumb } : {}) });
    } else if (item.role === "audio") {
      await fs.copyFile(source, path.join(assetsDirectory, fileName));
      const samples = await decodeMono(ffmpeg, source, 48000);
      items.push({ id: item.id, role: "audio", name: item.name, file: `assets/${fileName}`,
        durationSec: Math.round((samples.length / 48000) * 1000) / 1000, peakSec: peakSecond(samples, 48000) });
    } else if (item.role === "bgm") {
      await fs.copyFile(source, path.join(assetsDirectory, fileName));
      log(`박자 분석: ${fileName}`);
      const result = await beatsForFile(ffmpeg, source);
      await fs.writeFile(path.join(assetsDirectory, "beats.json"), JSON.stringify(result.beats));
      await fs.writeFile(path.join(assetsDirectory, "beats.js"), `var B=${JSON.stringify(result.beats)};`);
      beatTimes = result.beats.slice(0, 240);
      const info = await mediaInfo(ffmpeg, source);
      bgm = { name: item.name, file: `assets/${fileName}`, durationSec: info.durationSec, bpm: Math.round(result.bpm * 10) / 10,
        beatCount: result.beats.length, beats: "assets/beats.json", beatsScript: "assets/beats.js" };
    } else if (item.role === "reference") {
      // 레퍼런스는 페이지가 쓰지 않으므로 assets/ 로 복사하지 않는다(접촉 시트·컷·박자만)
      log(`레퍼런스 분석: ${fileName}`);
      reference = await analyzeReference(ffmpeg, source, thumbsDirectory, item).catch((error) => {
        log(`레퍼런스 분석 실패: ${error?.message || error}`);
        return null;
      });
    }
  }
  const kit = path.relative(jobDirectory, MOTION_KIT_DIRECTORY).split(path.sep).join("/");
  const prepared = {
    schema: "motion-assets-prepared/v1",
    workId: manifest.workId || null,
    brand: manifest.brand || null,
    noMusic: !bgm && manifest.noMusic === true,
    bgm,
    beatTimes,
    items,
    reference,
    missing,
    kit: {
      motion: `${kit}/lib/motion.js`,
      baseCss: `${kit}/lib/base.css`,
      fontsCss: `${kit}/lib/fonts.css`,
      sfxDirectory: `${kit}/sfx`,
      sfxIndex: `${kit}/sfx/index.json`,
    },
    preparedAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(jobDirectory, "assets.json"), `${JSON.stringify(prepared, null, 2)}\n`);
  return prepared;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const jobDirectory = process.argv[2];
  if (!jobDirectory) {
    console.error("사용법: node prepare-motion-assets.mjs <작업 폴더(manifest.json, assets/raw/)>");
    process.exit(1);
  }
  prepareMotionAssets(path.resolve(jobDirectory), { log: (line) => console.log(line) })
    .then((prepared) => console.log(JSON.stringify({ items: prepared.items.length, bgm: !!prepared.bgm, missing: prepared.missing })))
    .catch((error) => { console.error(error?.message || error); process.exit(1); });
}
