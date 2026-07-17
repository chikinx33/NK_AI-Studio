import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(projectDirectory, "out");
const mode = process.argv[2] === "still" ? "still" : "video";
const stillFrame = Number.parseInt(process.argv[3] ?? "525", 10);
const output = path.join(
  outputDirectory,
  mode === "still"
    ? process.argv[3]
      ? `nk-studio-intro-preview-${stillFrame}.png`
      : "nk-studio-intro-preview.png"
    : "nk-studio-intro.mp4",
);
const cli = path.join(
  projectDirectory,
  "node_modules",
  "@remotion",
  "cli",
  "remotion-cli.js",
);

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectDirectory,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });

await fs.mkdir(outputDirectory, { recursive: true });
await fs.rm(output, { force: true });

const args =
  mode === "still"
    ? [
        cli,
        "still",
        "NKStudioIntro",
        output,
        `--frame=${stillFrame}`,
        "--port=14001",
        "--overwrite",
      ]
    : [
        cli,
        "render",
        "NKStudioIntro",
        output,
        "--codec=h264",
        "--pixel-format=yuv420p",
        "--crf=18",
        "--concurrency=2",
        "--disallow-parallel-encoding",
        "--hardware-acceleration=disable",
        "--port=14001",
        "--overwrite",
      ];

const exitCode = await run(process.execPath, args);

let stat = await fs.stat(output).catch(() => null);

if (
  mode === "video" &&
  (!stat || stat.size === 0) &&
  process.platform === "win32"
) {
  const temporaryDirectory = os.tmpdir();
  const candidates = await fs.readdir(temporaryDirectory, {
    withFileTypes: true,
  });
  const frameDirectories = await Promise.all(
    candidates
      .filter(
        (entry) =>
          entry.isDirectory() && entry.name.startsWith("react-motion-render"),
      )
      .map(async (entry) => {
        const directory = path.join(temporaryDirectory, entry.name);
        const [directoryStat, files] = await Promise.all([
          fs.stat(directory),
          fs.readdir(directory),
        ]);
        return {
          directory,
          frameCount: files.filter((file) => /^element-\d+\.jpeg$/.test(file))
            .length,
          modifiedAt: directoryStat.mtimeMs,
        };
      }),
  );
  const frames = frameDirectories
    .filter(({ frameCount }) => frameCount === 900)
    .sort((a, b) => b.modifiedAt - a.modifiedAt)[0];

  if (frames) {
    const ffmpeg = path.join(
      projectDirectory,
      "node_modules",
      "@remotion",
      "compositor-win32-x64-msvc",
      "ffmpeg.exe",
    );
    console.warn(
      `Remotion's Windows encoder exited with ${exitCode}; finalizing ${frames.frameCount} cached frames with bundled FFmpeg.`,
    );
    await run(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-framerate",
      "30",
      "-start_number",
      "0",
      "-i",
      path.join(frames.directory, "element-%03d.jpeg"),
      "-vf",
      "scale=in_range=full:out_range=tv,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-color_range",
      "tv",
      "-movflags",
      "+faststart",
      "-y",
      output,
    ]);
    stat = await fs.stat(output).catch(() => null);
  }
}

if (!stat || stat.size === 0) {
  throw new Error(`Remotion ${mode} render failed with exit code ${exitCode}`);
}

console.log(`Verified ${mode} output (${stat.size} bytes): ${output}`);
