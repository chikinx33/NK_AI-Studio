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
  const items = [];
  const missing = [];
  let bgm = null;
  for (const item of manifest.items || []) {
    const fileName = safeAssetName(item.fileName);
    const source = fileName ? path.join(rawDirectory, fileName) : "";
    if (!source || !existsSync(source)) { missing.push(item.id); continue; }
    if (IMAGE_ROLES.has(item.role)) {
      await fs.copyFile(source, path.join(assetsDirectory, fileName));
      const info = /\.svg$/i.test(fileName) ? { width: null, height: null } : await mediaInfo(ffmpeg, source);
      items.push({ id: item.id, role: item.role, name: item.name, file: `assets/${fileName}`, width: info.width, height: info.height });
    } else if (item.role === "video") {
      const out = `${fileName.replace(/\.[^.]+$/, "")}.mp4`;
      log(`클립 변환: ${fileName}`);
      await run(ffmpeg, ["-y", "-v", "error", "-i", source, "-t", MAX_CLIP_SEC, "-an",
        "-vf", "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))':flags=lanczos,fps=60,format=yuv420p",
        "-c:v", "libx264", "-g", 1, "-crf", 14, "-preset", "veryfast", "-movflags", "+faststart", path.join(assetsDirectory, out)]);
      const info = await mediaInfo(ffmpeg, path.join(assetsDirectory, out));
      items.push({ id: item.id, role: "video", name: item.name, file: `assets/${out}`, ...info });
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
      const info = await mediaInfo(ffmpeg, source);
      bgm = { name: item.name, file: `assets/${fileName}`, durationSec: info.durationSec, bpm: Math.round(result.bpm * 10) / 10,
        beatCount: result.beats.length, beats: "assets/beats.json", beatsScript: "assets/beats.js" };
    }
  }
  const kit = path.relative(jobDirectory, MOTION_KIT_DIRECTORY).split(path.sep).join("/");
  const prepared = {
    schema: "motion-assets-prepared/v1",
    workId: manifest.workId || null,
    brand: manifest.brand || null,
    noMusic: !bgm && manifest.noMusic === true,
    bgm,
    items,
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
