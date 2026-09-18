import { readUserStorage, writeUserStorage } from "./safeStorage";

/**
 * 제작 캔버스 작성기 설정 — 에이전트 설정(생성 전 확인) + 이미지/영상 생성 기본값.
 *
 * 모델·길이·해상도 표는 서버 SSOT(functions/api/_shared/video-specs.ts, imagen.ts)의 미러다.
 * 프론트가 다른 값을 들고 있으면 UI 에선 고를 수 있는데 서버가 조용히 스냅하거나 400 을 낸다 —
 * tests/agent-mode-canvas-contract.test.mjs 가 서버 표와 일치하는지 검사한다.
 */

export type ImageAspect = "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
export type ImageSize = "512" | "1K" | "2K";
export type ImageProvider = "studio" | "gemini" | "openai";
export type VideoAspect = "16:9" | "9:16";
export type GenerationKind = "image" | "video";

export interface CanvasSettings {
  confirmBeforeGenerate: boolean;
  kind: GenerationKind;
  image: { aspect: ImageAspect; size: ImageSize; count: 1 | 2 | 3 | 4; provider: ImageProvider; providerExplicit?: boolean };
  video: { aspect: VideoAspect; model: string; durationSec: number; resolution: string; count: 1 | 2 | 3 | 4 };
}

export const IMAGE_ASPECTS: ImageAspect[] = ["16:9", "4:3", "1:1", "3:4", "9:16"];
export const IMAGE_SIZES: ImageSize[] = ["512", "1K", "2K"];
export const IMAGE_PROVIDERS: Array<{ id: ImageProvider; label: string }> = [
  // 스튜디오 기본 = 서버 기본 공급자(AI_IMAGE_PROVIDER/AGENT_IMAGE_PROVIDER). 예전 배경·스틸이 만들어진 경로와 같아 룩이 이어진다.
  // 라벨이 길면 좁은 패널에서 잘린다. 자세한 설명은 선택 상자 밑줄로 따로 보여 준다.
  { id: "studio", label: "스튜디오 설정 따름" },
  { id: "gemini", label: "Gemini 3.1 Flash Image" },
  { id: "openai", label: "GPT Image 2" },
];
export const VIDEO_ASPECTS: VideoAspect[] = ["16:9", "9:16"];
export const COUNTS = [1, 2, 3, 4] as const;

/** 스튜디오 영상 모델 가이드(js/ui/ai-video-gen.js)와 같은 표시명. i2v 전용 모델은 스틸이 먼저 있어야 한다. */
export const VIDEO_MODELS: Array<{ id: string; label: string; i2vOnly: boolean; resolutions?: string[] }> = [
  { id: "veo", label: "Veo 3.1 Fast", i2vOnly: false },
  { id: "veo-full", label: "Veo 3.1 Full", i2vOnly: false },
  { id: "grok", label: "Grok Imagine", i2vOnly: false },
  { id: "kling-final", label: "Kling Final (v2.6 Pro)", i2vOnly: true },
  { id: "seedance", label: "Seedance 2.0", i2vOnly: true, resolutions: ["480p", "720p", "1080p"] },
  // 참조→영상: 스틸 + 세트 플레이트 + 캐릭터 시트 + 부감 마스터 + 직전 컷을 매 컷 참조로 붙인다(서버 scene_video).
  { id: "seedance-r2v", label: "Seedance 2.0 Reference (참조)", i2vOnly: true, resolutions: ["480p", "720p", "1080p"] },
  { id: "seedance-2.5", label: "Seedance 2.5 Reference (참조·30초·오디오)", i2vOnly: true, resolutions: ["480p", "720p", "1080p"] },
  { id: "wan", label: "Wan 2.7", i2vOnly: false },
  { id: "vidu-q3", label: "Vidu Q3-Mix", i2vOnly: true },
];

/** 서버 video-specs.ts MODEL_DURATION_CHOICES 미러. */
export const VIDEO_DURATION_CHOICES: Record<string, readonly number[]> = {
  "veo": [4, 6, 8],
  "veo-full": [4, 6, 8],
  "grok": [4, 6, 8],
  "kling-final": [5, 10],
  "seedance": [4, 5, 6, 8, 10, 15],
  "seedance-r2v": [4, 5, 6, 8, 10, 15],
  "seedance-2.5": [4, 5, 6, 8, 10, 15, 20, 30],
  "wan": [4, 5, 6, 8, 10, 15],
  "vidu-q3": [4, 5, 6, 8, 10],
};

export function durationChoicesFor(model: string): readonly number[] {
  return VIDEO_DURATION_CHOICES[model] || VIDEO_DURATION_CHOICES.veo;
}

export function snapDuration(model: string, sec: number): number {
  const choices = durationChoicesFor(model);
  let best = choices[0];
  for (const v of choices) if (Math.abs(v - sec) < Math.abs(best - sec)) best = v;
  return best;
}

export const DEFAULT_CANVAS_SETTINGS: CanvasSettings = {
  confirmBeforeGenerate: true,
  kind: "video",
  image: { aspect: "16:9", size: "1K", count: 1, provider: "studio" },
  video: { aspect: "16:9", model: "veo", durationSec: 8, resolution: "720p", count: 1 },
};

const KEY = "canvasComposerSettings";

export function loadCanvasSettings(): CanvasSettings {
  try {
    const raw = readUserStorage(KEY);
    if (!raw) return DEFAULT_CANVAS_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<CanvasSettings>;
    const merged: CanvasSettings = {
      ...DEFAULT_CANVAS_SETTINGS,
      ...parsed,
      image: { ...DEFAULT_CANVAS_SETTINGS.image, ...(parsed.image || {}) },
      video: { ...DEFAULT_CANVAS_SETTINGS.video, ...(parsed.video || {}) },
    };
    merged.video.durationSec = snapDuration(merged.video.model, merged.video.durationSec);
    // 마이그레이션: 예전 기본값(gemini)이 저장돼 있어도 사용자가 직접 고른 적이 없으면 "스튜디오 설정 따름"으로.
    // (제작 화면은 GPT Image 2 인데 캔버스만 gemini 로 그리던 원인 — 저장된 옛 기본값이 새 기본값을 덮었다.)
    if (!merged.image.providerExplicit && merged.image.provider !== "studio") merged.image.provider = "studio";
    return merged;
  } catch {
    return DEFAULT_CANVAS_SETTINGS;
  }
}

export function saveCanvasSettings(s: CanvasSettings): void {
  writeUserStorage(KEY, JSON.stringify(s));
}

export function videoModelLabel(id: string): string {
  return VIDEO_MODELS.find((m) => m.id === id)?.label || id || "기본 모델";
}

/** 작성기 오른쪽 요약 칩: "동영상 · 720p · 8초 · 16:9 · x2" */
export function summarizeSettings(s: CanvasSettings): string {
  if (s.kind === "image") {
    return ["이미지", s.image.size, s.image.aspect, s.image.count > 1 ? `x${s.image.count}` : ""].filter(Boolean).join(" · ");
  }
  const model = VIDEO_MODELS.find((m) => m.id === s.video.model);
  return ["동영상", model?.resolutions ? s.video.resolution : "", `${s.video.durationSec}초`, s.video.aspect, s.video.count > 1 ? `x${s.video.count}` : ""].filter(Boolean).join(" · ");
}

/** 코어에게 넘기는 맥락 문장 — 도구 호출 시 이 기본값을 쓰게 한다. */
export function describeSettingsForAgent(s: CanvasSettings): string {
  const img = `이미지 ${s.image.aspect} ${s.image.size} ${s.image.provider} x${s.image.count}`;
  const vid = `영상 ${s.video.model} ${s.video.aspect} ${s.video.durationSec}초${VIDEO_MODELS.find((m) => m.id === s.video.model)?.resolutions ? ` ${s.video.resolution}` : ""} x${s.video.count}`;
  return `기본값: ${img} / ${vid} / 생성 전 확인 ${s.confirmBeforeGenerate ? "항상" : "안 함"}`;
}

export interface CreditQuote { credits: number; balance: number | null; feature: string; billingSource?: string }

/** 서버 요율표로 견적 — 프론트에 단가를 복사하지 않는다(요율이 바뀌면 서버만 고친다). */
export async function quoteCanvasCredits(s: CanvasSettings): Promise<CreditQuote> {
  const feature = s.kind === "image" ? "image_generation" : "video";
  const input = s.kind === "image"
    ? { ...providerArg(s), imageSize: s.image.size }
    : { videoModel: s.video.model, durationSeconds: s.video.durationSec, resolution: s.video.resolution };
  const res = await fetch("/api/credits/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature, input }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "크레딧 견적을 가져오지 못했어요.");
  const count = s.kind === "image" ? s.image.count : s.video.count;
  const per = Number(data?.quote?.credits) || 0;
  const balanceRaw = data?.summary?.balance ?? data?.summary?.remaining ?? data?.summary?.credits ?? null;
  return { credits: per * count, balance: Number.isFinite(Number(balanceRaw)) && balanceRaw !== null ? Number(balanceRaw) : null, feature,
    billingSource: data?.quote?.billingSource };
}

/**
 * 제작 화면(스튜디오)의 "이미지생성 모델" 설정. 같은 도메인의 localStorage 키(nk_ai_image_provider)에 저장되며
 * 스튜디오의 api.imagen 이 이 값을 자동으로 붙인다. 캔버스도 같은 값을 읽어야 같은 모델로 그린다
 * (2026-09-14: 에피소드는 GPT Image 2 인데 캔버스가 gemini 로 강제해 룩이 갈렸다).
 */
export const STUDIO_IMAGE_PROVIDER_KEY = "nk_ai_image_provider";
export function readStudioImageProvider(): string {
  try {
    const raw = String(window.localStorage.getItem(STUDIO_IMAGE_PROVIDER_KEY) || "").trim().toLowerCase();
    return (raw === "openai" || raw === "gemini" || raw === "gpt25-flare" || raw === "gpt25-sunburst") ? raw : "";
  } catch { return ""; }
}
/** 잡 입력에 넣을 공급자: 캔버스에서 명시했으면 그것, "스튜디오 설정 따름"이면 제작 화면 설정(없으면 서버 기본). */
export function resolveImageProvider(s: CanvasSettings): string {
  return s.image.provider === "studio" ? readStudioImageProvider() : s.image.provider;
}
export function providerArg(s: CanvasSettings): { provider?: string } {
  const p = resolveImageProvider(s);
  return p ? { provider: p } : {};
}
export const STUDIO_PROVIDER_LABELS: Record<string, string> = { openai: "GPT Image 2", gemini: "Gemini", "gpt25-flare": "GPT Image 2.5 Flare", "gpt25-sunburst": "GPT Image 2.5 Sunburst" };
