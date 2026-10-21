// 인포그래픽 영상(모션 키트) 자산 입력.
// 작업을 만들 때 고른 브랜드·업무 파일·배경음악은 작업 입력(options.assets)에 실리고,
// 렌더 직전에 브라우저가 사이트에서 파일을 받아 이 PC 렌더러(/local-motion)로 넘긴다(렌더러에는 로그인 정보가 없다).
import { localRendererUrl, withMediaToken, type LocalAgentVideoRenderStatus } from "./api";

export interface MotionAssetSelection {
  brandId: string | null;
  files: string[];
  bgm: { source: "sound" | "file"; value: string } | null;
  noMusic: boolean;
}

export const EMPTY_MOTION_ASSETS: MotionAssetSelection = { brandId: null, files: [], bgm: null, noMusic: false };

export const MOTION_IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;
export const MOTION_VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;
export const MOTION_AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac|flac)$/i;
export const isMotionMediaFile = (name: string) => MOTION_IMAGE_EXT.test(name) || MOTION_VIDEO_EXT.test(name) || MOTION_AUDIO_EXT.test(name);

export interface MotionBrandOption { id: string; title: string }
export interface MotionMusicOption { id: string; title: string; durationSeconds: number | null }

export async function listMotionBrands(): Promise<MotionBrandOption[]> {
  const res = await fetch("/api/brand/list?full=1");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "브랜드 목록을 읽지 못했어요.");
  const brands: any[] = Array.isArray(data?.brands) ? data.brands : [];
  return brands
    .filter((brand) => brand && !brand.empty && brand.id)
    .map((brand) => ({ id: String(brand.id), title: String(brand.brandTitle || brand.title || brand.id) }));
}

export async function listMotionMusic(): Promise<MotionMusicOption[]> {
  const res = await fetch("/api/sound/assets?type=music");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "사운드 라이브러리를 읽지 못했어요.");
  const assets: any[] = Array.isArray(data?.assets) ? data.assets : [];
  return assets
    .filter((asset) => asset?.status === "ready" && asset?.outputUrl)
    .map((asset) => ({ id: String(asset.id), title: String(asset.title || asset.prompt || "음악").slice(0, 60), durationSeconds: asset.durationSeconds ?? null }));
}

export interface MotionAssetManifest {
  schema: "motion-assets/v1";
  workId: string;
  brand: { id: string; title: string } | null;
  items: Array<{ id: string; role: string; name: string; fileName: string; url: string }>;
  noMusic: boolean;
  warnings: string[];
}

export async function getMotionAssetManifest(workId: string): Promise<MotionAssetManifest> {
  const res = await fetch(`/api/agent/motion-assets?workId=${encodeURIComponent(workId)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "자산 목록을 읽지 못했어요.");
  return data as MotionAssetManifest;
}

// 사이트 → 이 PC 렌더러로 자산을 옮기고 정리(클립 변환·박자표·크기)까지 마친 결과(assets.json)를 돌려준다.
export async function stageMotionAssets(
  workId: string,
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<any> {
  const manifest = await getMotionAssetManifest(workId);
  const created = await fetch(localRendererUrl("/local-motion/jobs"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workId, manifest }),
  });
  const createdData = await created.json().catch(() => ({}));
  if (!created.ok) throw new Error(createdData?.error || "이 PC 렌더러에 작업을 만들지 못했어요.");
  for (const [index, item] of manifest.items.entries()) {
    onProgress?.(index, manifest.items.length, item.name);
    const source = await fetch(withMediaToken(item.url));
    if (!source.ok) throw new Error(`자산을 받지 못했어요: ${item.name} (HTTP ${source.status})`);
    const upload = await fetch(localRendererUrl(`/local-motion/jobs/${encodeURIComponent(workId)}/raw/${encodeURIComponent(item.fileName)}`), {
      method: "PUT",
      body: await source.blob(),
    });
    if (!upload.ok) {
      const data = await upload.json().catch(() => ({}));
      throw new Error(data?.error || `자산을 이 PC로 옮기지 못했어요: ${item.name}`);
    }
  }
  onProgress?.(manifest.items.length, manifest.items.length, "");
  const prepared = await fetch(localRendererUrl(`/local-motion/jobs/${encodeURIComponent(workId)}/prepare`), { method: "POST" });
  const preparedData = await prepared.json().catch(() => ({}));
  if (!prepared.ok) throw new Error(preparedData?.error || "자산을 정리하지 못했어요.");
  return { ...preparedData, warnings: manifest.warnings };
}

// 감독이 자산을 직접 보도록 이 PC 렌더러가 만든 미리보기(긴 변 512px)를 data URL로 모은다
export async function fetchMotionThumbs(workId: string, prepared: any): Promise<Array<{ id: string; label: string; dataUrl: string }>> {
  const items: any[] = (Array.isArray(prepared?.items) ? prepared.items : []).filter((item: any) => item?.thumb).slice(0, 12);
  const thumbs: Array<{ id: string; label: string; dataUrl: string }> = [];
  for (const item of items) {
    const name = String(item.thumb).split("/").pop() || "";
    const res = await fetch(localRendererUrl(`/local-motion/jobs/${encodeURIComponent(workId)}/thumb/${encodeURIComponent(name)}`)).catch(() => null);
    if (!res?.ok) continue;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
    const size = item.width ? ` ${item.width}x${item.height}` : "";
    const length = item.durationSec ? ` ${item.durationSec}초` : "";
    if (dataUrl) thumbs.push({ id: item.id, label: `[${item.role}] ${item.name} → ${item.file}${size}${length}`, dataUrl });
  }
  return thumbs;
}

export interface MotionDirectorResult {
  html: string;
  episode: Record<string, unknown> | null;
  problems: string[];
}

// 감독(Claude 구독)이 이 영상만의 장면 코드를 쓴다. 응답이 흘러오는 동안 글자 수로 진행을 알린다.
export async function runMotionDirector(
  workId: string,
  prepared: any,
  thumbs: Array<{ id: string; label: string; dataUrl: string }>,
  onProgress?: (chars: number) => void,
  // 부분 수정: 지금 장면 코드·소리 큐 + 수정 요청 + 가리킨 장면 정지 화면
  revision?: { html: string; episode: unknown; request: string; frames: Array<{ t: number; dataUrl: string }> },
): Promise<MotionDirectorResult> {
  const res = await fetch("/api/agent/motion-director", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(revision ? { workId, prepared, mode: "revise", ...revision } : { workId, prepared, thumbs }),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `감독 호출 실패 (HTTP ${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 2);
      if (!line.startsWith("data:")) continue;
      const event = JSON.parse(line.slice(5).trim());
      if (event.t === "progress") onProgress?.(Number(event.chars) || 0);
      else if (event.t === "error") throw new Error(String(event.error || "motion_director_error"));
      else if (event.t === "done") return event.result as MotionDirectorResult;
    }
  }
  throw new Error("감독 응답이 끝나기 전에 연결이 끊겼어요.");
}

export async function saveMotionPage(workId: string, html: string, episode: unknown): Promise<void> {
  const res = await fetch(localRendererUrl(`/local-motion/jobs/${encodeURIComponent(workId)}/page`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html, episode }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || "장면 코드를 이 PC 렌더러에 저장하지 못했어요.");
  }
}

export async function startMotionRender(workId: string, lang: "ko" | "en" = "ko"): Promise<LocalAgentVideoRenderStatus> {
  const res = await fetch(localRendererUrl(`/local-motion/jobs/${encodeURIComponent(workId)}/render?lang=${lang}`), { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "렌더를 시작하지 못했어요.");
  return { ...(data as LocalAgentVideoRenderStatus), phase: "render" };
}

// ---------- 부분 수정 ----------

export async function getMotionPage(workId: string): Promise<{ html: string; episode: unknown }> {
  const res = await fetch(localRendererUrl(`/local-motion/jobs/${encodeURIComponent(workId)}/page`));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "이 PC 렌더러에서 장면 코드를 읽지 못했어요.");
  return data;
}

export async function getPreparedMotionAssets(workId: string): Promise<any> {
  const res = await fetch(localRendererUrl(`/local-motion/jobs/${encodeURIComponent(workId)}`));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "이 PC 렌더러에서 자산 목록을 읽지 못했어요.");
  return data;
}

export interface MotionStill { t: number; url: string }

export async function makeMotionStills(workId: string): Promise<MotionStill[]> {
  const res = await fetch(localRendererUrl(`/local-motion/jobs/${encodeURIComponent(workId)}/stills`), { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "장면 정지 화면을 만들지 못했어요.");
  return (data.stills || []).map((still: MotionStill) => ({ t: still.t, url: localRendererUrl(still.url) }));
}

export async function imageUrlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`그림을 읽지 못했어요 (HTTP ${res.status})`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("그림을 읽지 못했어요."));
    reader.readAsDataURL(blob);
  });
}

// 키트 글꼴(FONTS.md) — AI 없이 바로 바꾸기에서 고른다
export const MOTION_FONTS = [
  "Pretendard", "SUIT", "NK Sans", "Black Han Sans", "Do Hyeon", "Nanum Gothic ExtraBold", "Jua", "Dongle",
  "Gowun Dodum", "Gowun Batang", "NK Serif", "Nanum Pen Script", "Gaegu", "Hi Melody", "Nalgae", "KOTRA Hope",
];

// AI 없이 바로 바꾸기: 글꼴은 무대 안 모든 글자에, 색은 강조색 변수에 덮어쓴다(다시 바꾸면 이전 덮어쓰기는 지운다)
export function applyQuickStyle(html: string, quick: { font?: string; color?: string }): string {
  const rules: string[] = [];
  if (quick.font && MOTION_FONTS.includes(quick.font)) {
    rules.push(`#stage, #stage *:not(svg):not(path):not(circle):not(rect) { font-family: "${quick.font}", sans-serif !important; }`);
  }
  if (quick.color && /^#[0-9a-f]{6}$/i.test(quick.color)) {
    rules.push(`:root { --k-hi: ${quick.color} !important; --accent: ${quick.color} !important; --s-color: ${quick.color} !important; }`);
  }
  const cleaned = html.replace(/<style id="nk-quick-style">[\s\S]*?<\/style>\s*/g, "");
  if (!rules.length) return cleaned;
  const block = `<style id="nk-quick-style">\n${rules.join("\n")}\n</style>\n`;
  return /<\/head>/i.test(cleaned) ? cleaned.replace(/<\/head>/i, `${block}</head>`) : block + cleaned;
}

// ---------- 실례로 저장 ----------

export async function saveMotionExample(workId: string, html: string, title = ""): Promise<void> {
  const res = await fetch("/api/agent/motion-examples", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workId, html, title }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "실례로 저장하지 못했어요.");
}

// ---------- 클라우드 렌더러(2026-10-22) ----------
// 기획 회의부터 저장까지 Cloud Run 작업이 혼자 한다. 화면은 상태만 몇 초마다 읽는다(창을 닫아도 된다).

export interface MotionCloudRun {
  id: string;
  workId: string | null;
  skillJobId: string | null;
  mode: "new" | "revise" | "render";
  status: "queued" | "running" | "awaiting-approval" | "done" | "error";
  phase: "start" | "plan" | "assets" | "director" | "render" | "save";
  progress: number;
  chars: number;
  error: string;
  output: {
    videoUrl?: string;
    video?: { objectName: string; fileName: string; size: number };
    source?: { objectName: string };
    stills?: MotionStill[];
    timings?: Record<string, number>;
  };
}

export type MotionCloudStart =
  | { mode: "new"; skillJobId?: string; workId?: string }
  | { mode: "render"; workId: string; html: string; episode: unknown }
  | { mode: "revise"; workId: string; html: string; episode: unknown; request: string; frameTimes: number[] };

export async function startMotionCloud(body: MotionCloudStart, lang: "ko" | "en" = "ko"): Promise<MotionCloudRun> {
  const res = await fetch("/api/agent/motion-cloud", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start", lang, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "클라우드 렌더를 시작하지 못했어요.");
  return data.run as MotionCloudRun;
}

export async function getMotionCloudRun(query: { runId: string } | { workId: string }): Promise<MotionCloudRun | null> {
  const params = "runId" in query ? `runId=${encodeURIComponent(query.runId)}` : `workId=${encodeURIComponent(query.workId)}`;
  const res = await fetch(`/api/agent/motion-cloud?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "클라우드 렌더 상태를 읽지 못했어요.");
  return (data.run as MotionCloudRun) || null;
}

// 저장해 둔 장면 코드·소리 큐(source.json) — 부분 수정·실례 저장에 쓴다
export async function getMotionCloudSource(run: MotionCloudRun): Promise<{ html: string; episode: unknown }> {
  const objectName = run.output?.source?.objectName;
  if (!objectName) throw new Error("저장된 장면 코드가 없어요.");
  const res = await fetch(`/api/agent/agent-video-storage?objectName=${encodeURIComponent(objectName)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.motion?.html) throw new Error(data?.error || "저장된 장면 코드를 읽지 못했어요.");
  return { html: String(data.motion.html), episode: data.motion.episode ?? null };
}
