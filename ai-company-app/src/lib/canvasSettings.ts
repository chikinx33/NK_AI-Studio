import { readStorage, writeStorage } from "./safeStorage";

/**
 * 제작 캔버스 작성기 설정 — 에이전트 설정(생성 전 확인) + 이미지/영상 생성 기본값.
 *
 * 모델·길이·해상도 표는 서버 SSOT(functions/api/_shared/video-specs.ts, imagen.ts)의 미러다.
 * 프론트가 다른 값을 들고 있으면 UI 에선 고를 수 있는데 서버가 조용히 스냅하거나 400 을 낸다 —
 * tests/agent-mode-canvas-contract.test.mjs 가 서버 표와 일치하는지 검사한다.
 */

export type ImageAspect = "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
export type ImageSize = "512" | "1K" | "2K";
export type ImageProvider = "gemini" | "openai";
export type VideoAspect = "16:9" | "9:16";
export type GenerationKind = "image" | "video";

export interface CanvasSettings {
  confirmBeforeGenerate: boolean;
  kind: GenerationKind;
  image: { aspect: ImageAspect; size: ImageSize; count: 1 | 2 | 3 | 4; provider: ImageProvider };
  video: { aspect: VideoAspect; model: string; durationSec: number; resolution: string; count: 1 | 2 | 3 | 4 };
}

export const IMAGE_ASPECTS: ImageAspect[] = ["16:9", "4:3", "1:1", "3:4", "9:16"];
export const IMAGE_SIZES: ImageSize[] = ["512", "1K", "2K"];
export const IMAGE_PROVIDERS: Array<{ id: ImageProvider; label: string }> = [
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
  image: { aspect: "16:9", size: "1K", count: 1, provider: "gemini" },
  video: { aspect: "16:9", model: "veo", durationSec: 8, resolution: "720p", count: 1 },
};

const KEY = "canvasComposerSettings";

export function loadCanvasSettings(): CanvasSettings {
  try {
    const raw = readStorage(KEY);
    if (!raw) return DEFAULT_CANVAS_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<CanvasSettings>;
    const merged: CanvasSettings = {
      ...DEFAULT_CANVAS_SETTINGS,
      ...parsed,
      image: { ...DEFAULT_CANVAS_SETTINGS.image, ...(parsed.image || {}) },
      video: { ...DEFAULT_CANVAS_SETTINGS.video, ...(parsed.video || {}) },
    };
    merged.video.durationSec = snapDuration(merged.video.model, merged.video.durationSec);
    return merged;
  } catch {
    return DEFAULT_CANVAS_SETTINGS;
  }
}

export function saveCanvasSettings(s: CanvasSettings): void {
  writeStorage(KEY, JSON.stringify(s));
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

export interface CreditQuote { credits: number; balance: number | null; feature: string }

/** 서버 요율표로 견적 — 프론트에 단가를 복사하지 않는다(요율이 바뀌면 서버만 고친다). */
export async function quoteCanvasCredits(s: CanvasSettings): Promise<CreditQuote> {
  const feature = s.kind === "image" ? "image_generation" : "video";
  const input = s.kind === "image"
    ? { provider: s.image.provider, imageSize: s.image.size }
    : { videoModel: s.video.model, durationSeconds: s.video.durationSec, resolution: s.video.resolution };
  const res = await fetch("/api/credits/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature, input }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "크레딧 견적을 가져오지 못했어요.");
  const count = s.kind === "image" ? s.image.count : s.video.count;
  const per = Number(data?.quote?.credits) || 0;
  const balanceRaw = data?.summary?.balance ?? data?.summary?.remaining ?? data?.summary?.credits ?? null;
  return { credits: per * count, balance: Number.isFinite(Number(balanceRaw)) && balanceRaw !== null ? Number(balanceRaw) : null, feature };
}
