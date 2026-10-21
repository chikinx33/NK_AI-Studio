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
import { once } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";

export const WIDTH = 1080;
export const HEIGHT = 1920;

const CHROME_CANDIDATES = [
  process.env.MOTION_CHROME,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome-stable",
];
// tmix·framestep·afade·loudnorm 이 있는 전체 빌드가 필요하다(Remotion 동봉 ffmpeg에는 tmix가 없다).
const FFMPEG_CANDIDATES = [
  process.env.MOTION_FFMPEG,
  "D:\\Programs\\REAL-Video-Enhancer\\bin\\ffmpeg.exe",
  "/usr/bin/ffmpeg",
];

function pickExecutable(candidates, label) {
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate;
  throw new Error(`${label} 실행 파일을 찾지 못했습니다. 환경 변수로 위치를 지정하세요.`);
}

export const pickFfmpeg = () => pickExecutable(FFMPEG_CANDIDATES, "ffmpeg(전체 빌드)");

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

// 컨테이너(클라우드 렌더러)는 root 로 돌고 /dev/shm 이 작아 MOTION_CHROME_FLAGS="--no-sandbox --disable-dev-shm-usage" 를 더한다
const EXTRA_CHROME_FLAGS = String(process.env.MOTION_CHROME_FLAGS || "").split(/\s+/).filter((flag) => flag.startsWith("--"));

async function launchChrome(chrome, profileDirectory) {
  const child = spawn(chrome, [
    ...EXTRA_CHROME_FLAGS,
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
  // 무대 크기(기본 1080x1920, 16:9·1:1 페이지는 <html data-size>로 바꾼다)에 맞춰 찍는다
  const [width, height] = await evaluate(send, "(() => { const s = document.getElementById('stage'); return s ? [s.offsetWidth, s.offsetHeight] : [1080, 1920]; })()");
  if (!(width >= 320 && height >= 320 && width <= 3840 && height <= 3840) || width % 2 || height % 2) {
    throw new Error(`무대 크기가 올바르지 않습니다: ${width}x${height}`);
  }
  if (width !== WIDTH || height !== HEIGHT) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  }
  return { send, duration, width, height };
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

// 효과음 용도 태그("tag:click") → 키트 효과음 중 하나. 같은 영상·같은 자리는 늘 같은 소리, 영상이 다르면 다른 소리.
const SFX_INDEX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "motion-kit", "sfx", "index.json");
let sfxIndexCache = null;
export function pickTaggedSfx(index, tag, seed) {
  const candidates = index.filter((item) => item.tags.includes(tag));
  if (!candidates.length) throw new Error(`효과음 태그가 없습니다: ${tag}`);
  let hash = 2166136261;
  for (const ch of `${seed}|${tag}`) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  return candidates[hash % candidates.length].file;
}

async function mixAudio({ ffmpeg, episode, episodeDirectory, audioFolders, duration, outPath }) {
  const beats = episode.beats ? JSON.parse(await fs.readFile(path.resolve(episodeDirectory, episode.beats), "utf8")) : [];
  const bgm = episode.bgm || null;
  const args = ["-y", "-v", "error"];
  if (bgm) args.push("-ss", bgm.start || 0, "-i", resolveAudioFile(bgm.file, audioFolders));
  else args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
  const cues = [];
  for (const [index, [at, name, gain]] of (episode.cues || []).entries()) {
    let fileName = name;
    if (String(name).startsWith("tag:")) {
      sfxIndexCache = sfxIndexCache || JSON.parse(await fs.readFile(SFX_INDEX, "utf8"));
      fileName = pickTaggedSfx(sfxIndexCache, String(name).slice(4), `${episodeDirectory}|${index}`);
    }
    const file = resolveAudioFile(fileName, audioFolders);
    args.push("-i", file);
    cues.push({ delayMs: (cueTime(at, beats) - await peakOffset(ffmpeg, file)) * 1000, gain: gain ?? 1 });
  }
  const graph = audioFilterGraph({ duration, bgmVolume: bgm?.volume ?? 0.55, hasBgm: !!bgm, cues });
  await runProcess(ffmpeg, [...args, "-filter_complex", graph, "-map", "[out]", "-ar", 48000, "-c:a", "pcm_s16le", outPath]);
}

// ---------- 렌더 ----------

// 촬영한 장면을 번호 순서대로 영상 인코더(ffmpeg 표준 입력)에 흘려보낸다. 일꾼 탭들이 번갈아 찍어 순서가 섞여 들어오므로
// 앞 번호가 올 때까지 잠시 들고 있다가 이어서 쓴다. 장면을 디스크에 쌓지 않아 60초 영상(장면 1만 4천 장)도
// 메모리가 곧 디스크인 클라우드 렌더러에서 돈다(2026-10-22).
export function orderedFrameSink(stream, { limit = 48 } = {}) {
  const pending = new Map();
  const waiters = [];
  let next = 0;
  let flushing = false;
  let failed = null;
  const wake = () => { while (waiters.length) waiters.shift()(); };
  stream.on("error", (error) => { failed = failed || error; wake(); });
  return {
    get written() { return next; },
    async put(index, buffer) {
      while (!failed && index - next >= limit) await new Promise((resolve) => waiters.push(resolve));
      if (failed) throw failed;
      pending.set(index, buffer);
      if (flushing) return;
      flushing = true;
      try {
        while (pending.has(next)) {
          const chunk = pending.get(next);
          pending.delete(next);
          next++;
          wake();
          if (!stream.write(chunk)) await once(stream, "drain");
        }
      } finally {
        flushing = false;
      }
    },
    async end() {
      if (failed) throw failed;
      if (pending.size) throw new Error(`빠진 장면이 있습니다(${next}번).`);
      await new Promise((resolve, reject) => stream.end((error) => (error ? reject(error) : resolve())));
    },
  };
}

function startEncoder(ffmpeg, args) {
  const child = spawn(ffmpeg, args.map(String), { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  lowPriority(child.pid);
  let err = "";
  child.stderr.on("data", (chunk) => { err += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split(/\r?\n/).slice(-6).join("\n") || `ffmpeg exit=${code}`))));
  });
  done.catch(() => {});
  return { child, stdin: child.stdin, done };
}

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
  const ffmpeg = pickFfmpeg();
  lowPriority(process.pid);

  const outDirectory = path.dirname(outPath);
  const stem = path.basename(outPath, path.extname(outPath));
  const framesDirectory = path.join(outDirectory, `_frames_${stem}`);
  const profileDirectory = path.join(outDirectory, `_chrome_${stem}_${process.pid}`);
  const mixPath = path.join(outDirectory, `_mix_${stem}.wav`);
  await fs.mkdir(outDirectory, { recursive: true });
  if (options.keepFrames) {
    await fs.rm(framesDirectory, { recursive: true, force: true });
    await fs.mkdir(framesDirectory, { recursive: true });
  }

  const pageUrl = `${pathToFileURL(pagePath).href}?lang=${encodeURIComponent(lang)}`;
  const report = { blocked: new Set(), exceptions: new Set() };
  const { child, wsUrl } = await launchChrome(chrome, profileDirectory);
  let cdp = null;
  let duration = 0;
  let total = 0;
  let encoder = null;
  let hasMix = false;
  const started = Date.now();
  try {
    cdp = await Cdp.connect(wsUrl);
    const pages = [];
    for (let i = 0; i < workers; i++) pages.push(await openPage(cdp, pageUrl, roots, report));
    duration = pages[0].duration;
    const { width, height } = pages[0];
    total = Math.floor(duration * fps * sub);

    // 소리: 길이를 알았으니 먼저 섞어 두고, 영상은 촬영과 동시에 인코딩한다
    if (options.episode) {
      const episodePath = path.resolve(options.episode);
      const episodeDirectory = path.dirname(episodePath);
      const episode = JSON.parse(await fs.readFile(episodePath, "utf8"));
      if (episode.bgm || episode.cues?.length) {
        const audioFolders = [episodeDirectory, path.dirname(pagePath), ...(options.audioDirs || [])];
        await mixAudio({ ffmpeg, episode, episodeDirectory, audioFolders, duration, outPath: mixPath });
        hasMix = true;
      }
    }

    // 영상: sub 장씩 섞어 모션블러, tv 범위
    encoder = startEncoder(ffmpeg, [
      "-y", "-v", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", fps * sub, "-thread_queue_size", 512, "-i", "-",
      ...(hasMix ? ["-i", mixPath] : []),
      "-vf", `tmix=frames=${sub},framestep=${sub},scale=in_range=full:out_range=tv,format=yuv420p`, "-r", fps,
      "-c:v", "libx264", "-preset", "slow", "-crf", 17,
      ...(hasMix ? ["-c:a", "aac", "-b:a", "192k", "-shortest"] : []),
      "-movflags", "+faststart", outPath,
    ]);
    const sink = orderedFrameSink(encoder.stdin);
    let done = 0;
    let lastLogged = 0;
    await Promise.all(pages.map(async ({ send }, index) => {
      for (let k = index; k < total; k += workers) {
        await evaluate(send, `seek(${k / (fps * sub)})`);
        const { data } = await send("Page.captureScreenshot", {
          format: "jpeg", quality: 94, clip: { x: 0, y: 0, width, height, scale: 1 },
        });
        const frame = Buffer.from(data, "base64");
        if (options.keepFrames) await fs.writeFile(path.join(framesDirectory, `f_${String(k).padStart(5, "0")}.jpg`), frame);
        await sink.put(k, frame);
        done++;
        if (done - lastLogged >= 120 || done === total) { lastLogged = done; log(`Rendered ${done}/${total}`); }
      }
    }));
    await sink.end();
    await cdp.send("Browser.close").catch(() => {});
  } catch (error) {
    if (encoder?.child.exitCode === null) encoder.child.kill();
    throw error;
  } finally {
    cdp?.close();
    if (child.exitCode === null) child.kill();
    await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once("exit", resolve)));
    await fs.rm(profileDirectory, { recursive: true, force: true }).catch(() => {});
  }
  if (report.blocked.size) log(`막은 요청 ${report.blocked.size}건: ${[...report.blocked].slice(0, 5).join(", ")}`);
  if (report.exceptions.size) log(`페이지 오류 ${report.exceptions.size}건: ${[...report.exceptions].slice(0, 5).join(" | ")}`);
  log(`촬영 ${total}장 (${duration.toFixed(2)}초) ${Math.round((Date.now() - started) / 1000)}초 걸림`);
  try {
    await encoder.done;
  } finally {
    await fs.rm(mixPath, { force: true });
  }
  log(`완성 → ${outPath}`);
  return { outPath, duration, frames: total, blocked: [...report.blocked], exceptions: [...report.exceptions] };
}

// 장면 정지 화면: 완성 영상에서 장면을 가리켜 고칠 수 있게 count 장을 고르게 찍는다(가로 270px 미리보기).
// 반환 [{ t, file }]. 부분 수정 화면과 감독(그림으로 장면 확인)이 쓴다.
// times 를 주면 그 시점들만 찍는다(클라우드 부분 수정: 사용자가 가리킨 장면을 감독에게 크게 보여 줄 때).
export async function renderMotionStills({ page, outDir, count = 12, times = null, allowRoots, scale = 0.25, prefix = "still", log = () => {} }) {
  const pagePath = path.resolve(page);
  const roots = (allowRoots?.length ? allowRoots : [path.dirname(pagePath)]).map((root) => path.resolve(root));
  const chrome = pickExecutable(CHROME_CANDIDATES, "크롬");
  await fs.mkdir(outDir, { recursive: true });
  const profileDirectory = path.join(outDir, `_chrome_stills_${process.pid}`);
  const report = { blocked: new Set(), exceptions: new Set() };
  const { child, wsUrl } = await launchChrome(chrome, profileDirectory);
  let cdp = null;
  const stills = [];
  try {
    cdp = await Cdp.connect(wsUrl);
    const { send, duration, width, height } = await openPage(cdp, `${pathToFileURL(pagePath).href}?lang=ko`, roots, report);
    const n = Math.max(2, Math.min(24, count));
    // 처음·끝 0.3초는 비우고 고르게
    const moments = Array.isArray(times) && times.length
      ? times.slice(0, 8).map((t) => Math.min(Math.max(0, Number(t) || 0), duration))
      : Array.from({ length: n }, (_, i) => Math.round((0.3 + (Math.max(0.1, duration - 0.6) * i) / (n - 1)) * 100) / 100);
    for (const [i, t] of moments.entries()) {
      await evaluate(send, `seek(${t})`);
      const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 80, clip: { x: 0, y: 0, width, height, scale } });
      const file = `${prefix}_${String(i).padStart(2, "0")}.jpg`;
      await fs.writeFile(path.join(outDir, file), Buffer.from(data, "base64"));
      stills.push({ t, file });
    }
    log(`정지 화면 ${stills.length}장 (${duration.toFixed(2)}초)`);
    await cdp.send("Browser.close").catch(() => {});
  } finally {
    cdp?.close();
    if (child.exitCode === null) child.kill();
    await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once("exit", resolve)));
    await fs.rm(profileDirectory, { recursive: true, force: true }).catch(() => {});
  }
  return stills;
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === "--stills") {
  // node render-motion-page.mjs --stills <page.html> <출력 폴더> [장수] [--allow-root 폴더 …]
  const args = process.argv.slice(3);
  const allowRoots = [];
  const positional = [];
  for (let i = 0; i < args.length; i++) if (args[i] === "--allow-root") allowRoots.push(args[++i]); else positional.push(args[i]);
  renderMotionStills({ page: positional[0], outDir: positional[1], count: Number(positional[2]) || 12, allowRoots, log: (l) => console.log(l) })
    .then((stills) => console.log(JSON.stringify(stills)))
    .catch((error) => { console.error(error?.message || error); process.exit(1); });
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  renderMotionPage(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
