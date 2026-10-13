// 자동 검수(기계 검수) — 디렉터 단계 화면(B)과 대화형 디렉터(A)가 같은 스크립트를 쓴다.
// 스킬의 scripts/qa_video.py(장면 전환·콘티 정렬·음악 의심·디코딩 오류·컷 중앙 프레임)를 그대로 돌린다.
// 영상은 사용자 토큰으로 받은 서명 URL 로만 내려받는다(본인 저장 영역 확인은 사이트 media-url 이 한다).
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { site, SiteError } from "./site.js";

export const QA_SCRIPT = process.env.QA_SCRIPT || "/app/qa/qa_video.py";
const MAX_VIDEO_BYTES = 400 * 1024 * 1024;
const MAX_FRAMES = 16;

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => { stdout += d; });
    p.stderr.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
    p.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(e) }); });
  });
}

/** 콘티 컷 시작 시각 목록 정리: 0 포함, 오름차순, 영상 길이 안. */
export function cutStarts(raw: unknown): number[] {
  const list = (Array.isArray(raw) ? raw : []).map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 120);
  return [...new Set([0, ...list].map((n) => Math.round(n * 100) / 100))].sort((a, b) => a - b).slice(0, 60);
}

/** report.json → 화면·take.qa 에 쓸 부분만(서버 경로는 빼고). */
export function compactReport(report: any): any {
  const audio = report?.audio || {};
  return {
    meta: report?.meta || null,
    decodeErrors: Array.isArray(report?.decodeErrors) ? report.decodeErrors.slice(0, 10) : [],
    sceneCuts: Array.isArray(report?.sceneCuts) ? report.sceneCuts : [],
    cutAlignment: Array.isArray(report?.cutAlignment) ? report.cutAlignment : [],
    musicSuspect: Array.isArray(audio.musicSuspect) ? audio.musicSuspect : [],
    musicPerSecond: Array.isArray(audio.perSecond) ? audio.perSecond.map((r: any) => [r.t, r.lines]) : [],
    audioSkipped: audio.skipped || null,
  };
}

/** f_004.20.png → 4.2 */
export function frameTime(name: string): number | null {
  const m = /^f_([0-9.]+)\.png$/.exec(name);
  return m ? Number(m[1]) : null;
}

/** 프레임 한 장을 프로젝트 director/ 폴더에 올리고 gs 경로를 준다. 실패하면 빈 값(화면 표시는 dataUrl 로 된다). */
async function storeFrame(token: string, projectId: string, filename: string, bytes: Buffer): Promise<string | undefined> {
  try {
    const up: any = await site("/api/director/media-url", { token, body: { upload: { projectId, filename, contentType: "image/jpeg" } }, timeoutMs: 20_000 });
    const put = await fetch(String(up?.uploadUrl || ""), { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(30_000) });
    return put.ok ? String(up.gsUri || "") || undefined : undefined;
  } catch { return undefined; }
}

export async function runQa(token: string, body: any): Promise<any> {
  const videoPath = String(body?.videoPath || "").trim();
  if (!videoPath) throw new SiteError(400, { error: "video_path_required" });
  const signed: any = await site("/api/director/media-url", { token, body: { read: [videoPath] }, timeoutMs: 20_000 });
  const url = String(signed?.items?.[0]?.url || "");
  if (!url) throw new SiteError(403, { error: signed?.items?.[0]?.error || "video_not_readable" });

  const dir = await mkdtemp(path.join(tmpdir(), "qa-"));
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new SiteError(502, { error: "video_download_failed", status: res.status });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_VIDEO_BYTES) throw new SiteError(413, { error: "video_too_large" });
    const video = path.join(dir, "take.mp4");
    await writeFile(video, buf);

    const cuts = cutStarts(body?.cuts);
    const out = path.join(dir, "out");
    const r = await run("python3", [QA_SCRIPT, video, "--out", out, "--cuts", cuts.join(",")], 240_000);
    if (r.code !== 0) throw new SiteError(500, { error: "qa_failed", detail: (r.stderr || r.stdout).slice(-800) });
    const report = JSON.parse(await readFile(path.join(out, "report.json"), "utf8"));

    // 컷 중앙 프레임 → 화면 표시·Claude 검수용 JPEG(가로 960). projectId 가 있으면 프로젝트 director/ 폴더에도 남긴다
    // (테이크에는 data: URL 이 아니라 gs 경로를 저장한다). 업로드는 서버에서 해 브라우저 CORS 와 무관하다.
    const projectId = /^[A-Za-z0-9._-]{1,64}$/.test(String(body?.projectId || "")) ? String(body.projectId) : "";
    const label = String(body?.label || "qa").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60);
    const frames: Array<{ t: number; dataUrl: string; path?: string }> = [];
    const frameDir = path.join(out, "frames");
    const names = (await readdir(frameDir).catch(() => [] as string[])).filter((n) => frameTime(n) !== null).sort().slice(0, MAX_FRAMES);
    for (const name of names) {
      const jpg = path.join(frameDir, name.replace(/\.png$/, ".jpg"));
      const c = await run("ffmpeg", ["-v", "error", "-y", "-i", path.join(frameDir, name), "-vf", "scale='min(960,iw)':-2", "-q:v", "4", jpg], 30_000);
      if (c.code !== 0) continue;
      const bytes = await readFile(jpg);
      const t = frameTime(name) as number;
      frames.push({ t, dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`, path: projectId ? await storeFrame(token, projectId, `${label}-f${t}`, bytes) : undefined });
    }
    return { qa: compactReport(report), frames, cuts };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
