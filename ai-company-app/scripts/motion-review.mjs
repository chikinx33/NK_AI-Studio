// 인포그래픽 영상 검수(확인 루프, 2026-10-22 엔케 "보완점 6번").
// 감독이 쓴 장면 코드를 렌더 전에 찍어 보고, 사람이 볼 문제를 감독에게 되돌려 고치게 한다.
//  1) 0.25초마다 작은 화면(192px)을 찍어 거의 빈 화면·암전 구간을 숫자로 찾는다(밝기 편차).
//  2) 고르게 12장 + 찾은 구간 장면을 크게(768px) 찍어 감독에게 보여 준다(KIT.md 5.5 품질 점검표로 판단).
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { pickFfmpeg, renderMotionStills } from "./render-motion-page.mjs";

// 빈 화면 판정(0~255, 32x18 회색조 축소). 채플린 장면 코드(2026-10-22) 실측:
//   장면 사이 암전 = 평균 13~29·편차 6~17, 닫힌 커튼 = 평균 64~69·편차 12~16, 보통 장면 = 편차 30 이상.
//   → 어둡고 평평함(평균 < 40, 편차 < 20) 또는 아무것도 없음(편차 < 8)
export const DARK_MEAN = 40;
export const DARK_STD = 20;
export const FLAT_STD = 8;
export const isEmptyFrame = ({ mean, std }) => (mean < DARK_MEAN && std < DARK_STD) || std < FLAT_STD;
export const SCAN_EVERY = 0.25;
// 끝 장면은 일부러 어두워지며 닫히므로 마지막 1.2초는 보지 않는다
export const SCAN_TAIL_SKIP = 1.2;

// 프레임별 밝기 통계([{ mean, std }], times) → 빈 화면 구간 [{ from, to }]
export function emptySpans(stats, times, { duration = Infinity, tailSkip = SCAN_TAIL_SKIP, step = SCAN_EVERY } = {}) {
  const spans = [];
  stats.forEach((stat, i) => {
    const t = times[i];
    if (!isEmptyFrame(stat) || t > duration - tailSkip) return;
    const last = spans[spans.length - 1];
    if (last && t - last.to <= step + 0.01) last.to = t;
    else spans.push({ from: t, to: t });
  });
  return spans;
}

// 32x18 회색조로 줄여 밝기 편차를 잰다(ffmpeg 한 번에)
async function frameStats(ffmpeg, directory, prefix, count) {
  const raw = await new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ["-v", "error", "-start_number", "0", "-i", path.join(directory, `${prefix}_%03d.jpg`),
      "-frames:v", String(count), "-vf", "scale=32:18,format=gray", "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const out = [];
    let err = "";
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.trim() || `ffmpeg exit=${code}`))));
  });
  const size = 32 * 18;
  const stats = [];
  for (let offset = 0; offset + size <= raw.length; offset += size) {
    const frame = raw.subarray(offset, offset + size);
    let mean = 0;
    for (const v of frame) mean += v;
    mean /= size;
    let variance = 0;
    for (const v of frame) variance += (v - mean) ** 2;
    stats.push({ mean, std: Math.sqrt(variance / size) });
  }
  return stats;
}

const dataUrl = async (file) => `data:image/jpeg;base64,${(await fs.readFile(file)).toString("base64")}`;

// 반환: { findings: [문장], frames: [{ t, dataUrl }], spans }
export async function reviewMotionPage({ page, directory, allowRoots, log = () => {} }) {
  const scanDirectory = path.join(directory, "review", "scan");
  const shotDirectory = path.join(directory, "review", "shots");
  await fs.rm(path.join(directory, "review"), { recursive: true, force: true });
  const scans = await renderMotionStills({ page, outDir: scanDirectory, every: SCAN_EVERY, scale: 0.1, quality: 70, prefix: "scan", allowRoots });
  const stats = await frameStats(pickFfmpeg(), scanDirectory, "scan", scans.length);
  const spans = emptySpans(stats, scans.map((s) => s.t), { duration: scans.duration });
  const findings = spans.map(({ from, to }) => `${from.toFixed(2)}~${(to + SCAN_EVERY).toFixed(2)}초: 화면이 어둡고 거의 비어 있다(장면 사이 암전일 수 있음). 그 시각 정지 화면을 보고, 의도한 장면이 아니면 이어지는 전환으로 바꾼다.`);
  log(`검수: 빈 화면 구간 ${spans.length}곳`);
  // 고르게 12장 + 빈 구간 가운데 장면(최대 4장)
  const even = Array.from({ length: 12 }, (_, i) => Math.round((0.3 + (Math.max(0.1, scans.duration - 0.6) * i) / 11) * 100) / 100);
  const extra = spans.slice(0, 4).map(({ from, to }) => Math.round(((from + to) / 2) * 100) / 100)
    .filter((t) => !even.some((e) => Math.abs(e - t) < 0.2)); // 고른 장면과 거의 같은 시각이면 한 장으로
  const times = [...new Set([...even, ...extra])].sort((a, b) => a - b).slice(0, 16);
  const shots = await renderMotionStills({ page, outDir: shotDirectory, times, scale: 0.4, quality: 78, prefix: "shot", allowRoots });
  const frames = [];
  for (const shot of shots) frames.push({ t: shot.t, dataUrl: await dataUrl(path.join(shotDirectory, shot.file)) });
  return { findings, frames, spans };
}
