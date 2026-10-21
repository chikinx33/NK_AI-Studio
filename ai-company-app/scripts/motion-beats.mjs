// 음악 파일의 실제 박자 시각(초)을 찾는다. 원본 키트 promo/_motion/tools/beats.py 를 그대로 옮겼다
// (스펙트럼 변화량 → 자기상관으로 BPM 추정 → 동적 계획법 박자 추적). 영상의 모든 등장·효과음을 이 격자에 맞춘다.
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// 원본과 같은 해상도: 22050Hz 모노, 창 1024, 간격 128
const SAMPLE_RATE = 22050;
const HOP = 128;
const WIN = 1024;

// 실수 입력 FFT(크기 n=2^k). 크기 스펙트럼 |X[0..n/2]| 를 돌려준다.
function magnitudeSpectrum(frame, re, im, out) {
  const n = frame.length;
  for (let i = 0; i < n; i++) { re[i] = frame[i]; im[i] = 0; }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
  for (let k = 0; k <= n / 2; k++) out[k] = Math.hypot(re[k], im[k]);
}

// 박자 후보 세기(onset envelope): 프레임 사이 로그 스펙트럼 증가량의 합, 평균 0·표준편차 1로 정규화
export function onsetEnvelope(samples, sampleRate = SAMPLE_RATE, hop = HOP, win = WIN) {
  const frames = samples.length >= win ? Math.floor((samples.length - win) / hop) + 1 : 0;
  const hann = new Float64Array(win);
  for (let i = 0; i < win; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1));
  const bins = win / 2 + 1;
  const frame = new Float64Array(win);
  const re = new Float64Array(win);
  const im = new Float64Array(win);
  const mag = new Float64Array(bins);
  let previous = new Float64Array(bins);
  let current = new Float64Array(bins);
  const onset = new Float64Array(Math.max(0, frames - 1));
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    for (let i = 0; i < win; i++) frame[i] = samples[start + i] * hann[i];
    magnitudeSpectrum(frame, re, im, mag);
    for (let k = 0; k < bins; k++) current[k] = Math.log1p(mag[k] * 10);
    if (f > 0) {
      let sum = 0;
      for (let k = 0; k < bins; k++) sum += Math.max(0, current[k] - previous[k]);
      onset[f - 1] = sum;
    }
    [previous, current] = [current, previous];
  }
  let mean = 0;
  for (const v of onset) mean += v;
  mean /= onset.length || 1;
  let variance = 0;
  for (const v of onset) variance += (v - mean) ** 2;
  const std = Math.sqrt(variance / (onset.length || 1));
  for (let i = 0; i < onset.length; i++) onset[i] = (onset[i] - mean) / (std + 1e-9);
  return { onset, fps: sampleRate / hop };
}

// 자기상관이 가장 큰 박자 간격 → BPM (lo~hi 범위 안에서만 계산)
export function guessBpm(onset, fps, lo = 70, hi = 180) {
  let best = -Infinity;
  let bestBpm = 0;
  for (let lag = 1; lag < onset.length; lag++) {
    const bpm = (60 * fps) / lag;
    if (bpm >= hi) continue;
    if (bpm <= lo) break;
    let ac = 0;
    for (let i = lag; i < onset.length; i++) ac += onset[i] * onset[i - lag];
    if (ac > best) { best = ac; bestBpm = bpm; }
  }
  return bestBpm;
}

// 동적 계획법 박자 추적: 박자 후보 세기를 최대로, 간격이 period에서 벗어나면 벌점
export function trackBeats(onset, fps, bpm, alpha = 100) {
  const period = (fps * 60) / bpm;
  const n = onset.length;
  const score = Float64Array.from(onset);
  const back = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    const lo = Math.trunc(t - 2 * period);
    const hi = Math.trunc(t - period / 2);
    if (hi <= 0) continue;
    let best = -Infinity;
    let bestPrev = -1;
    for (let prev = Math.max(lo, 0); prev < hi; prev++) {
      const c = score[prev] - alpha * Math.log((t - prev) / period) ** 2;
      if (c > best) { best = c; bestPrev = prev; }
    }
    score[t] = onset[t] + best;
    back[t] = bestPrev;
  }
  const tail = Math.trunc(period);
  let t = n - tail;
  for (let i = n - tail + 1; i < n; i++) if (score[i] > score[t]) t = i;
  const beats = [];
  while (t >= 0) { beats.push(t); t = back[t]; }
  return beats.reverse().map((frame) => frame / fps);
}

export function detectBeats(samples, { bpm, sampleRate = SAMPLE_RATE } = {}) {
  const { onset, fps } = onsetEnvelope(samples, sampleRate);
  const guessed = guessBpm(onset, fps);
  const beats = trackBeats(onset, fps, bpm || guessed);
  return { beats: beats.map((b) => Math.round(b * 10000) / 10000), bpm: bpm || guessed, guessedBpm: guessed };
}

// ffmpeg 로 아무 음악 파일 → 22050Hz 모노 float
export function decodeMono(ffmpeg, file, sampleRate = SAMPLE_RATE) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ["-v", "error", "-i", file, "-ac", "1", "-ar", String(sampleRate), "-f", "s16le", "-"], { windowsHide: true });
    const chunks = [];
    let err = "";
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `ffmpeg exit=${code}`));
      const raw = Buffer.concat(chunks);
      const ints = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
      const out = new Float32Array(ints.length);
      for (let i = 0; i < ints.length; i++) out[i] = ints[i] / 32768;
      resolve(out);
    });
  });
}

export async function beatsForFile(ffmpeg, file, { bpm } = {}) {
  return detectBeats(await decodeMono(ffmpeg, file), { bpm });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [audio, out] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const bpmIndex = process.argv.indexOf("--bpm");
  const bpm = bpmIndex > 0 ? Number(process.argv[bpmIndex + 1]) : undefined;
  if (!audio || !out) {
    console.error("사용법: node motion-beats.mjs <음악 파일> <out.json> [--bpm 134]");
    process.exit(1);
  }
  const { pickFfmpeg } = await import("./render-motion-page.mjs");
  const result = await beatsForFile(pickFfmpeg(), audio, { bpm });
  await writeFile(out, JSON.stringify(result.beats));
  const gaps = result.beats.slice(1).map((b, i) => b - result.beats[i]);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  console.log(`${result.beats.length}박, ${(60 / mean).toFixed(2)} bpm (추정 ${result.guessedBpm.toFixed(1)}), 첫 박 ${result.beats[0].toFixed(3)}초 → ${out}`);
}
