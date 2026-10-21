// 인포그래픽 영상(모션 키트) 자산 입력.
// 작업을 만들 때 고른 브랜드·업무 파일·배경음악은 작업 입력(options.assets)에 실리고,
// 렌더 직전에 브라우저가 사이트에서 파일을 받아 이 PC 렌더러(/local-motion)로 넘긴다(렌더러에는 로그인 정보가 없다).
import { withMediaToken } from "./api";

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
  const created = await fetch("/local-motion/jobs", {
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
    const upload = await fetch(`/local-motion/jobs/${encodeURIComponent(workId)}/raw/${encodeURIComponent(item.fileName)}`, {
      method: "PUT",
      body: await source.blob(),
    });
    if (!upload.ok) {
      const data = await upload.json().catch(() => ({}));
      throw new Error(data?.error || `자산을 이 PC로 옮기지 못했어요: ${item.name}`);
    }
  }
  onProgress?.(manifest.items.length, manifest.items.length, "");
  const prepared = await fetch(`/local-motion/jobs/${encodeURIComponent(workId)}/prepare`, { method: "POST" });
  const preparedData = await prepared.json().catch(() => ({}));
  if (!prepared.ok) throw new Error(preparedData?.error || "자산을 정리하지 못했어요.");
  return { ...preparedData, warnings: manifest.warnings };
}
