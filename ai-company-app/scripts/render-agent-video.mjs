import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const propsPath = path.resolve(process.argv[2] || "");
const outputPath = path.resolve(process.argv[3] || path.join(projectDirectory, "out", "raviok-agent-video.mp4"));

if (!process.argv[2]) throw new Error("Remotion props JSON 경로가 필요합니다.");

const propsStat = await fs.stat(propsPath).catch(() => null);
if (!propsStat?.isFile()) throw new Error(`Remotion props JSON을 찾을 수 없습니다: ${propsPath}`);

const cli = path.join(projectDirectory, "node_modules", "@remotion", "cli", "remotion-cli.js");
const jobDirectory = path.dirname(outputPath);
const framesDirectory = path.join(jobDirectory, "remotion-frames");
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.rm(outputPath, { force: true });
await fs.rm(framesDirectory, { recursive: true, force: true });

const args = [
  cli,
  "render",
  "src/remotion/index.ts",
  "AgentVideo",
  framesDirectory,
  `--props=${propsPath}`,
  "--sequence",
  "--image-format=jpeg",
  "--jpeg-quality=90",
  "--concurrency=2",
  "--hardware-acceleration=disable",
  "--port=14002",
  "--overwrite",
];

const run = (command, commandArgs) => new Promise((resolve, reject) => {
  const child = spawn(command, commandArgs, { cwd: projectDirectory, stdio: "inherit" });
  child.on("error", reject);
  child.on("exit", (code) => resolve(code ?? 1));
});

const renderExitCode = await run(process.execPath, args);
const frameFiles = (await fs.readdir(framesDirectory).catch(() => []))
  .filter((file) => /\.(?:jpe?g)$/i.test(file))
  .sort();
if (!frameFiles.length) throw new Error(`Remotion 프레임 렌더 실패(exit=${renderExitCode})`);

const props = JSON.parse(await fs.readFile(propsPath, "utf8"));
const spec = props?.spec || {};
const fps = Number(spec?.fps) || 30;
const scenes = Array.isArray(spec?.scenes) ? spec.scenes : [];
const totalDurationSec = scenes.reduce((sum, scene) => sum + Math.max(0, Number(scene?.durationSec) || 0), 0);

const sfxSources = {
  whoosh: "https://remotion.media/whoosh.wav",
  ding: "https://remotion.media/ding.wav",
  switch: "https://remotion.media/switch.wav",
  click: "https://remotion.media/mouse-click.wav",
  whip: "https://remotion.media/whip.wav",
};
const sfxInputs = [];
let cursorSec = 0;
for (let index = 0; index < scenes.length; index++) {
  const scene = scenes[index] || {};
  const sfxName = String(scene.sfx || "none");
  const source = sfxSources[sfxName];
  if (source) {
    const sfxPath = path.join(jobDirectory, `sfx-${index}-${sfxName}.wav`);
    const response = await fetch(source);
    if (response.ok) {
      await fs.writeFile(sfxPath, Buffer.from(await response.arrayBuffer()));
      sfxInputs.push({ path: sfxPath, delayMs: Math.max(0, Math.round(cursorSec * 1000)) });
    }
  }
  cursorSec += Math.max(0, Number(scene.durationSec) || 0);
}

const ffmpegCandidates = [
  path.join(projectDirectory, "node_modules", "@remotion", "compositor-win32-x64-msvc", "ffmpeg.exe"),
  "ffmpeg",
];
let ffmpeg = ffmpegCandidates[0];
if (!(await fs.stat(ffmpeg).catch(() => null))) ffmpeg = ffmpegCandidates[1];

const firstFrame = frameFiles[0];
const frameMatch = firstFrame.match(/^(.*?)(\d+)(\.jpe?g)$/i);
if (!frameMatch) throw new Error(`프레임 파일 패턴을 확인할 수 없습니다: ${firstFrame}`);
const digitCount = frameMatch[2].length;
const startNumber = Number(frameMatch[2]);
const framePattern = path.join(framesDirectory, `${frameMatch[1]}%0${digitCount}d${frameMatch[3]}`);

const ffmpegArgs = [
  "-hide_banner",
  "-loglevel", "warning",
  "-framerate", String(fps),
  "-start_number", String(startNumber),
  "-i", framePattern,
];
for (const input of sfxInputs) ffmpegArgs.push("-i", input.path);

if (sfxInputs.length) {
  const filters = sfxInputs.map((input, index) => `[${index + 1}:a]adelay=${input.delayMs}|${input.delayMs},volume=0.34[s${index}]`);
  const labels = sfxInputs.map((_, index) => `[s${index}]`).join("");
  filters.push(`${labels}amix=inputs=${sfxInputs.length}:normalize=0:dropout_transition=0[aout]`);
  ffmpegArgs.push("-filter_complex", filters.join(";"), "-map", "0:v:0", "-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
}

ffmpegArgs.push(
  "-vf", "scale=in_range=full:out_range=tv,format=yuv420p",
  "-c:v", "libx264",
  "-preset", "medium",
  "-crf", "20",
  "-pix_fmt", "yuv420p",
  "-color_range", "tv",
  "-movflags", "+faststart",
  "-t", String(totalDurationSec || frameFiles.length / fps),
  "-y",
  outputPath,
);

const encodeExitCode = await run(ffmpeg, ffmpegArgs);
const outputStat = await fs.stat(outputPath).catch(() => null);
if (encodeExitCode !== 0 || !outputStat?.isFile() || outputStat.size === 0) {
  throw new Error(`Remotion MP4 인코딩 실패(exit=${encodeExitCode})`);
}

await fs.rm(framesDirectory, { recursive: true, force: true });
console.log(`AGENT_VIDEO_RENDER_COMPLETE ${outputStat.size} ${outputPath}`);
