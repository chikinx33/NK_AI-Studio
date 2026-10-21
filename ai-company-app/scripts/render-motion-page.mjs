// 모션 키트 페이지(HTML 한 장, seek(t)) → MP4 렌더러.
// 원본 키트(promo/_motion/tools/render.py + build.py)와 같은 결과를 Node만으로 낸다:
// 이 PC의 크롬을 DevTools 프로토콜로 직접 조종해 1초에 fps*sub 장을 찍고,
// ffmpeg tmix로 섞어 모션블러를 만들고, 배경음악·효과음을 박자에 얹어 -14 LUFS로 맞춘다.
// 새 npm 패키지를 쓰지 않는다(Node 22+ 기본 WebSocket).
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const WIDTH = 1080;
export const HEIGHT = 1920;

const CHROME_CANDIDATES = [
  process.env.MOTION_CHROME,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];
// tmix·framestep·afade·loudnorm 이 있는 전체 빌드가 필요하다(Remotion 동봉 ffmpeg에는 tmix가 없다).
const FFMPEG_CANDIDATES = [
  process.env.MOTION_FFMPEG,
  "D:\\Programs\\REAL-Video-Enhancer\\bin\\ffmpeg.exe",
];

function pickExecutable(candidates, label) {
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate;
  throw new Error(`${label} 실행 파일을 찾지 못했습니다. 환경 변수로 위치를 지정하세요.`);
}

// 렌더는 CPU를 오래 쓴다. 사용자의 다른 앱이 끊기지 않게 낮은 우선순위로 돌린다.
function lowPriority(pid) {
  try { os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (_) { /* 권한 없으면 그대로 */ }
}

// ---------- 순수 함수(테스트 대상) ----------

// 효과음 시점: 박자 번호(소수 허용) 또는 "s<초>"
export function cueTime(at, beats = []) {
  if (typeof at === "string" && at.startsWith("s")) return Number(at.slice(1));
  const index = Number(at);
  const k = Math.floor(index);
  const f = index - k;
  if (k + 1 >= beats.length) throw new Error(`박자표에 ${at}번 박자가 없습니다.`);
  return beats[k] + f * (beats[k + 1] - beats[k]);
}

// 페이지가 읽어도 되는 주소인가: 허용 폴더 안의 파일과 data/blob/about 만. 인터넷 요청은 모두 막는다.
export function isAllowedUrl(url, roots) {
  if (/^(data|blob|about):/i.test(url)) return true;
  if (!/^file:/i.test(url)) return false;
  let target;
  try { target = path.resolve(fileURLToPath(url)); } catch (_) { return false; }
  const norm = (value) => (process.platform === "win32" ? value.toLowerCase() : value);
  return roots.some((root) => {
    const relative = path.relative(norm(path.resolve(root)), norm(target));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

// 원본 build.py 와 같은 소리 그래프. cues: [{ delayMs, gain }]
export function audioFilterGraph({ duration, bgmVolume = 0.55, hasBgm = true, cues = [] }) {
  const dur = duration.toFixed(3);
  const parts = [hasBgm
    ? `[0:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${dur},afade=t=out:st=${Math.max(0, duration - 0.9).toFixed(3)}:d=0.9,volume=${bgmVolume}[m]`
    : `[0:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${dur}[m]`];
  const labels = ["[m]"];
  cues.forEach((cue, i) => {
    const d = Math.max(0, Math.floor(cue.delayMs));
    parts.push(`[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${cue.gain},adelay=${d}|${d}[s${i + 1}]`);
    labels.push(`[s${i + 1}]`);
  });
  parts.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0,atrim=0:${dur},loudnorm=I=-14:TP=-1.5:LRA=11[out]`);
  return parts.join(";");
}

// ---------- 크롬 DevTools 프로토콜 ----------

class Cdp {
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => resolve(new Cdp(ws));
      ws.onerror = () => reject(new Error("크롬 DevTools 연결 실패"));
    });
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const waiter = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (!waiter) return;
        if (message.error) waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
        else waiter.resolve(message.result || {});
        return;
      }
      for (const handler of this.handlers.get(`${message.sessionId || ""}:${message.method}`) || []) handler(message.params || {});
    };
    ws.onclose = () => {
      for (const waiter of this.pending.values()) waiter.reject(new Error("크롬 연결이 끊겼습니다."));
      this.pending.clear();
    };
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(sessionId, method, handler) {
    const key = `${sessionId || ""}:${method}`;
    if (!this.handlers.has(key)) this.handlers.set(key, []);
    this.handlers.get(key).push(handler);
    return () => this.handlers.set(key, this.handlers.get(key).filter((h) => h !== handler));
  }

  close() { try { this.ws.close(); } catch (_) { /* 이미 닫힘 */ } }
}

async function launchChrome(chrome, profileDirectory) {
  const child = spawn(chrome, [
    "--headless=new",
    `--user-data-dir=${profileDirectory}`,
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--hide-scrollbars",
    "--mute-audio",
    "--autoplay-policy=no-user-gesture-required",
    "--allow-file-access-from-files",
    `--window-size=${WIDTH},${HEIGHT}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  lowPriority(child.pid);
  const wsUrl = await new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("크롬 시작 시간 초과")), 30000);
    child.stderr.on("data", (chunk) => {
      buffer += chunk;
      const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`크롬이 종료됐습니다(exit=${code})`)); });
  });
  return { child, wsUrl };
}

function describeException(details) {
  const text = details?.exception?.description || details?.text || "알 수 없는 오류";
  return `${text}${details?.lineNumber != null ? ` (줄 ${details.lineNumber + 1})` : ""}`;
}

async function evaluate(send, expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(`페이지 오류: ${describeException(result.exceptionDetails)}`);
  return result.result?.value;
}

// 탭마다 브라우저 컨텍스트를 따로 둬서 렌더러 프로세스가 나뉘게 한다(같은 file:// 사이트끼리 한 프로세스를 쓰면 병렬이 안 된다).
async function openPage(cdp, pageUrl, roots, report) {
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  cdp.on(sessionId, "Fetch.requestPaused", ({ requestId, request }) => {
    if (isAllowedUrl(request.url, roots)) {
      send("Fetch.continueRequest", { requestId }).catch(() => {});
    } else {
      report.blocked.add(request.url);
      send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => {});
    }
  });
  cdp.on(sessionId, "Runtime.exceptionThrown", ({ exceptionDetails }) => report.exceptions.add(describeException(exceptionDetails)));
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  const loaded = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("페이지 로드 시간 초과")), 60000);
    const off = cdp.on(sessionId, "Page.loadEventFired", () => { clearTimeout(timer); off(); resolve(); });
  });
  await send("Page.navigate", { url: pageUrl });
  await loaded;
  const duration = Number(await evaluate(send, "window.READY"));
  if (!(duration > 0)) throw new Error("페이지가 window.READY 로 영상 길이(초)를 알려야 합니다.");
  return { send, duration };
}

// ---------- ffmpeg ----------

function runProcess(command, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args.map(String), { stdio: ["ignore", capture ? "pipe" : "ignore", "pipe"], windowsHide: true });
    lowPriority(child.pid);
    const out = [];
    let err = "";
    if (capture) child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.trim().split(/\r?\n/).slice(-6).join("\n") || `exit=${code}`))));
  });
}

// 효과음 파일 앞부분에서 가장 큰 소리까지의 시간(초): 타격음이 박자에 정확히 떨어지게 앞당긴다.
async function peakOffset(ffmpeg, file, windowSec = 0.6) {
  const raw = await runProcess(ffmpeg, ["-v", "error", "-i", file, "-t", windowSec, "-ac", 1, "-ar", 48000, "-f", "s16le", "-"], { capture: true });
  const samples = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
  let best = 0;
  let at = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = Math.abs(samples[i]);
    if (value > best) { best = value; at = i; }
  }
  return at / 48000;
}

function resolveAudioFile(name, folders) {
  if (path.isAbsolute(name) && existsSync(name)) return name;
  for (const folder of folders) {
    const candidate = path.join(folder, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`소리 파일을 찾지 못했습니다: ${name}`);
}

async function mixAudio({ ffmpeg, episode, episodeDirectory, audioFolders, duration, outPath }) {
  const beats = episode.beats ? JSON.parse(await fs.readFile(path.resolve(episodeDirectory, episode.beats), "utf8")) : [];
  const bgm = episode.bgm || null;
  const args = ["-y", "-v", "error"];
  if (bgm) args.push("-ss", bgm.start || 0, "-i", resolveAudioFile(bgm.file, audioFolders));
  else args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
  const cues = [];
  for (const [at, name, gain] of episode.cues || []) {
    const file = resolveAudioFile(name, audioFolders);
    args.push("-i", file);
    cues.push({ delayMs: (cueTime(at, beats) - await peakOffset(ffmpeg, file)) * 1000, gain: gain ?? 1 });
  }
  const graph = audioFilterGraph({ duration, bgmVolume: bgm?.volume ?? 0.55, hasBgm: !!bgm, cues });
  await runProcess(ffmpeg, [...args, "-filter_complex", graph, "-map", "[out]", "-ar", 48000, "-c:a", "pcm_s16le", outPath]);
}

// ---------- 렌더 ----------

export async function renderMotionPage(options) {
  const pagePath = path.resolve(options.page);
  const outPath = path.resolve(options.out);
  const lang = options.lang || "ko";
  const fps = options.fps || 60;
  const sub = options.sub || 4;
  const workers = Math.max(1, Math.min(options.workers || 3, 6));
  const roots = (options.allowRoots?.length ? options.allowRoots : [path.dirname(pagePath)]).map((root) => path.resolve(root));
  const log = options.log || ((line) => console.log(line));
  const chrome = pickExecutable(CHROME_CANDIDATES, "크롬");
  const ffmpeg = pickExecutable(FFMPEG_CANDIDATES, "ffmpeg(전체 빌드)");
  lowPriority(process.pid);

  const outDirectory = path.dirname(outPath);
  const stem = path.basename(outPath, path.extname(outPath));
  const framesDirectory = path.join(outDirectory, `_frames_${stem}`);
  const profileDirectory = path.join(outDirectory, `_chrome_${stem}_${process.pid}`);
  await fs.mkdir(outDirectory, { recursive: true });
  await fs.rm(framesDirectory, { recursive: true, force: true });
  await fs.mkdir(framesDirectory, { recursive: true });

  const pageUrl = `${pathToFileURL(pagePath).href}?lang=${encodeURIComponent(lang)}`;
  const report = { blocked: new Set(), exceptions: new Set() };
  const { child, wsUrl } = await launchChrome(chrome, profileDirectory);
  let cdp = null;
  let duration = 0;
  let total = 0;
  const started = Date.now();
  try {
    cdp = await Cdp.connect(wsUrl);
    const pages = [];
    for (let i = 0; i < workers; i++) pages.push(await openPage(cdp, pageUrl, roots, report));
    duration = pages[0].duration;
    total = Math.floor(duration * fps * sub);
    let done = 0;
    let lastLogged = 0;
    await Promise.all(pages.map(async ({ send }, index) => {
      for (let k = index; k < total; k += workers) {
        await evaluate(send, `seek(${k / (fps * sub)})`);
        const { data } = await send("Page.captureScreenshot", {
          format: "jpeg", quality: 94, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 },
        });
        await fs.writeFile(path.join(framesDirectory, `f_${String(k).padStart(5, "0")}.jpg`), Buffer.from(data, "base64"));
        done++;
        if (done - lastLogged >= 120 || done === total) { lastLogged = done; log(`Rendered ${done}/${total}`); }
      }
    }));
    await cdp.send("Browser.close").catch(() => {});
  } finally {
    cdp?.close();
    if (child.exitCode === null) child.kill();
    await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once("exit", resolve)));
    await fs.rm(profileDirectory, { recursive: true, force: true }).catch(() => {});
  }
  if (report.blocked.size) log(`막은 요청 ${report.blocked.size}건: ${[...report.blocked].slice(0, 5).join(", ")}`);
  if (report.exceptions.size) log(`페이지 오류 ${report.exceptions.size}건: ${[...report.exceptions].slice(0, 5).join(" | ")}`);
  log(`촬영 ${total}장 (${duration.toFixed(2)}초) ${Math.round((Date.now() - started) / 1000)}초 걸림`);

  // 소리
  let mixPath = null;
  if (options.episode) {
    const episodePath = path.resolve(options.episode);
    const episodeDirectory = path.dirname(episodePath);
    const episode = JSON.parse(await fs.readFile(episodePath, "utf8"));
    if (episode.bgm || episode.cues?.length) {
      mixPath = path.join(outDirectory, `_mix_${stem}.wav`);
      const audioFolders = [episodeDirectory, path.dirname(pagePath), ...(options.audioDirs || [])];
      await mixAudio({ ffmpeg, episode, episodeDirectory, audioFolders, duration, outPath: mixPath });
    }
  }

  // 영상: sub 장씩 섞어 모션블러, tv 범위
  await runProcess(ffmpeg, [
    "-y", "-v", "error", "-framerate", fps * sub, "-i", path.join(framesDirectory, "f_%05d.jpg"),
    ...(mixPath ? ["-i", mixPath] : []),
    "-vf", `tmix=frames=${sub},framestep=${sub},scale=in_range=full:out_range=tv,format=yuv420p`, "-r", fps,
    "-c:v", "libx264", "-preset", "slow", "-crf", 17,
    ...(mixPath ? ["-c:a", "aac", "-b:a", "192k", "-shortest"] : []),
    "-movflags", "+faststart", outPath,
  ]);
  if (mixPath) await fs.rm(mixPath, { force: true });
  if (!options.keepFrames) await fs.rm(framesDirectory, { recursive: true, force: true });
  log(`완성 → ${outPath}`);
  return { outPath, duration, frames: total, blocked: [...report.blocked], exceptions: [...report.exceptions] };
}

function parseArgs(argv) {
  const options = { allowRoots: [], audioDirs: [] };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--lang") options.lang = next();
    else if (arg === "--fps") options.fps = Number(next());
    else if (arg === "--sub") options.sub = Number(next());
    else if (arg === "--workers") options.workers = Number(next());
    else if (arg === "--episode") options.episode = next();
    else if (arg === "--audio-dir") options.audioDirs.push(next());
    else if (arg === "--allow-root") options.allowRoots.push(next());
    else if (arg === "--keep-frames") options.keepFrames = true;
    else positional.push(arg);
  }
  [options.page, options.out] = positional;
  if (!options.page || !options.out) throw new Error("사용법: node render-motion-page.mjs <page.html> <out.mp4> [--lang ko] [--episode episode.json] [--audio-dir 폴더] [--allow-root 폴더] [--workers 3]");
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  renderMotionPage(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
