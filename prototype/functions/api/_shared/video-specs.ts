// prototype/functions/api/_shared/video-specs.ts
//
// 영상 모델별 허용 파라미터의 단일 출처(SSOT).
//
// 프론트와 서버가 서로 다른 값을 들고 있으면 UI 에서는 고를 수 있는데 서버/공급자가
// 무시하거나 400 으로 거부하는 조합이 생긴다(예: Veo 에서 5초를 고르면 서버가 조용히
// 4초로 스냅). 값은 여기서만 정의하고, 프론트(js/ui/ai-video-gen.js)의 리터럴은
// tests/video-duration-spec.test.mjs 가 이 파일과 일치하는지 검사한다.
// 프론트는 classic script 라 이 모듈을 직접 import 할 수 없어 "미러 + 검사" 구조를 쓴다.
//
// ⚠️ 각 집합은 서버가 실제로 공급자에게 보내던 값에서 역산한 것이다. Atlas Cloud 가
// 문서로 공개한 허용 집합을 확인한 것은 아니므로 추측으로 좁히지 않았다. 생성 실패
// 응답(detail)에 허용값이 드러나면 이 파일만 고치면 프론트·서버가 함께 따라간다.

// ── 공급자가 실제로 받는 집합 (ALLOWED) ─────────────────────
// 서버가 값을 스냅·검증할 때 쓴다.

/** Veo / Grok 계열: 공급자가 4·6·8초만 받는다. */
export const DURATIONS_VEO = [4, 6, 8] as const;
/** Kling: 5초 또는 10초. */
export const DURATIONS_KLING = [5, 10] as const;
/** Seedance 2.0 / Wan: 4~15초 정수 전체 (atlascloud.ai 모델 페이지 확인). */
export const DURATIONS_SEEDANCE = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
/** Seedance 2.5 (bytedance/seedance-2.5/reference-to-video): 4~30초 정수 (atlascloud.ai 모델 페이지 확인 2026-09-14). */
export const DURATIONS_SEEDANCE_25 = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30] as const;
/** Vidu Q3. */
export const DURATIONS_VIDU = [4, 5, 6, 8, 10] as const;
/** MiniMax H3 · H3-Developer: 4~15초 정수 (atlascloud.ai 스키마 확인 2026-09-28). */
export const DURATIONS_MINIMAX = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
/** MiniMax H3 Max · Max Turbo · Fast: 5~15초 정수 (4초 없음, 같은 날 확인). */
export const DURATIONS_MINIMAXFIVE = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

/** 모델 id → 공급자 허용 duration 집합. 표에 없으면 DURATIONS_VEO. */
export const MODEL_DURATIONS: Record<string, readonly number[]> = {
  "veo": DURATIONS_VEO,
  "veo-full": DURATIONS_VEO,
  "grok": DURATIONS_VEO,
  "grok-r2v": DURATIONS_VEO,
  "grok-extend": DURATIONS_VEO,
  "kling": DURATIONS_KLING,
  "kling-draft": DURATIONS_KLING,
  "kling-final": DURATIONS_KLING,
  "seedance": DURATIONS_SEEDANCE,
  "seedance-r2v": DURATIONS_SEEDANCE,
  "seedance-2.5": DURATIONS_SEEDANCE_25,
  "wan": DURATIONS_SEEDANCE,
  "vidu-q3": DURATIONS_VIDU,
  "minimax-h3": DURATIONS_MINIMAX,
  "minimax-h3-dev": DURATIONS_MINIMAX,
  "minimax-h3-max": DURATIONS_MINIMAXFIVE,
  "minimax-h3-max-turbo": DURATIONS_MINIMAXFIVE,
  "minimax-h3-fast": DURATIONS_MINIMAXFIVE,
};

// ── UI 가 제시하는 선택지 (CHOICES) ─────────────────────────
// 허용 집합의 부분집합이어야 한다. 4~15초를 전부 드롭다운에 넣으면 고르기만 불편하므로
// 실제로 쓰는 값만 노출한다. 프론트는 이 표를 미러링하고 테스트가 부분집합임을 검사한다.

export const CHOICES_SEEDANCE = [4, 5, 6, 8, 10, 15] as const;
export const CHOICES_SEEDANCE_25 = [4, 5, 6, 8, 10, 15, 20, 30] as const;
export const CHOICES_MINIMAX = [4, 5, 6, 8, 10, 12, 15] as const;
export const CHOICES_MINIMAXFIVE = [5, 6, 8, 10, 12, 15] as const;

export const MODEL_DURATION_CHOICES: Record<string, readonly number[]> = {
  "veo": DURATIONS_VEO,
  "veo-full": DURATIONS_VEO,
  "grok": DURATIONS_VEO,
  "grok-r2v": DURATIONS_VEO,
  "grok-extend": DURATIONS_VEO,
  "kling": DURATIONS_KLING,
  "kling-draft": DURATIONS_KLING,
  "kling-final": DURATIONS_KLING,
  "seedance": CHOICES_SEEDANCE,
  "seedance-r2v": CHOICES_SEEDANCE,
  "seedance-2.5": CHOICES_SEEDANCE_25,
  "wan": CHOICES_SEEDANCE,
  "vidu-q3": DURATIONS_VIDU,
  "minimax-h3": CHOICES_MINIMAX,
  "minimax-h3-dev": CHOICES_MINIMAX,
  "minimax-h3-max": CHOICES_MINIMAXFIVE,
  "minimax-h3-max-turbo": CHOICES_MINIMAXFIVE,
  "minimax-h3-fast": CHOICES_MINIMAXFIVE,
};

export function allowedDurationsFor(videoModel: string): readonly number[] {
  return MODEL_DURATIONS[String(videoModel || "")] || DURATIONS_VEO;
}

export function durationChoicesFor(videoModel: string): readonly number[] {
  return MODEL_DURATION_CHOICES[String(videoModel || "")] || DURATIONS_VEO;
}

/** 허용 집합에서 가장 가까운 값으로 스냅한다(동률이면 앞선 값). */
export function snapDurationFor(videoModel: string, seconds: unknown): number {
  const allowed = allowedDurationsFor(videoModel);
  const n = Number(seconds);
  const target = Number.isFinite(n) && n > 0 ? n : allowed[0];
  let best = allowed[0];
  let diff = Math.abs(target - best);
  for (const v of allowed) {
    const d = Math.abs(target - v);
    if (d < diff) { diff = d; best = v; }
  }
  return best;
}

/** Seedance 2.0 정식 모델의 공급자 해상도 집합 (Fast/Mini가 아님). */
export const SEEDANCE_RESOLUTIONS = [
  "480p",
  "720p",
  "720p-SR",
  "1080p",
  "1080p-SR",
  "1440p-SR",
  "4k",
] as const;

export type SeedanceResolution = (typeof SEEDANCE_RESOLUTIONS)[number];
export const DEFAULT_SEEDANCE_RESOLUTION: SeedanceResolution = "720p";

/** 대소문자는 관대하게 받되 공급자에는 문서의 canonical 값을 보낸다. */
export function normalizeSeedanceResolution(value: unknown): SeedanceResolution | null {
  const raw = String(value ?? "").trim();
  if (!raw) return DEFAULT_SEEDANCE_RESOLUTION;
  const matched = SEEDANCE_RESOLUTIONS.find((item) => item.toLowerCase() === raw.toLowerCase());
  return matched || null;
}

/**
 * 입력 이미지 제약 (atlascloud.ai bytedance/seedance-2.0/image-to-video 기준).
 * 공급자는 bmp/tiff/gif 도 받지만 우리 화이트리스트는 안전한 부분집합만 유지한다.
 * 치수·종횡비 검사는 워커에서 불가능하므로 클라이언트 게이트가 1차 방어, 바이트 상한이 2차.
 */
export const IMAGE_SPEC = {
  minEdge: 300,
  maxEdge: 6000,
  minRatio: 0.4,
  maxRatio: 2.5,
  maxBytes: 30 * 1024 * 1024,
  mimes: ["image/jpeg", "image/png", "image/webp"] as const,
} as const;

/** toAtlasImageUrl 이 허용하는 입력 이미지 mime. */
export const SUPPORTED_IMAGE_MIMES = IMAGE_SPEC.mimes;

/** Worker 메모리 보호: data URL 문자열 길이 상한 (base64 는 원본의 약 4/3). */
export const MAX_IMAGE_DATA_URL_CHARS = 6_000_000;

/** 미러링(원본→GCS 복제)을 포기하는 크기. 초과 시 원본 URL 을 그대로 재생에 쓴다. */
export const MAX_MIRROR_BYTES = 80 * 1024 * 1024;

/** Seedance 2.5 참조→영상이 받는 출력 해상도(플레인 값만; SR/ESR 변형은 UI 에 내지 않는다). */
export const SEEDANCE_25_RESOLUTIONS = ["480p", "720p", "1080p"] as const;
/** 참조→영상 모델의 참조 이미지 상한(공급자 스키마). 프롬프트 매니페스트와 캔버스 게이트가 같은 수를 쓴다. */
export const REFERENCE_IMAGE_CAPS: Record<string, number> = { "seedance-2.5": 30, "seedance-r2v": 9, "grok-r2v": 7, "vidu-q3": 4, "wan": 4, "minimax-h3": 12, "minimax-h3-dev": 12, "minimax-h3-fast": 12 };

// ── MiniMax H3 계열 (Atlas Cloud, 스키마 확인 2026-09-28) ─────────────
// 등급마다 텍스트→영상 / 이미지→영상(첫·끝 프레임) / 참조→영상(이미지·영상·오디오 refers) 엔드포인트가 따로 있다.
// 앱은 모델 하나로 받고 입력을 보고 엔드포인트를 고른다(resolveMinimaxRoute).
// 오디오는 모든 등급·모드에서 영상과 함께 생성된다(끄는 파라미터 없음).
// 참조 상한 12 는 Atlas 블로그 기준이다(스키마에는 상한 표기가 없다).
export type MinimaxMode = "t2v" | "i2v" | "r2v";
export interface MinimaxTier {
  /** Atlas 모델 경로 `minimax/{slug}/{mode}` */
  slug: string;
  label: string;
  /** 모드별 공급자 해상도 집합. 없는 모드는 그 등급에 엔드포인트가 없다. */
  resolutions: Partial<Record<MinimaxMode, readonly string[]>>;
  defaultResolution: string;
  /** prompt_expansion 필드를 받는가(Max Turbo 는 스키마에 없다). */
  promptExpansion: boolean;
}
const MINIMAX_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
/** 텍스트→영상·참조→영상이 받는 화면비. 이미지→영상은 입력 이미지를 따른다(adaptive 만 받음). */
export const MINIMAX_ASPECT_RATIOS: readonly string[] = MINIMAX_RATIOS;
const H3_NATIVE = ["480P", "768P", "2K"] as const;
const H3_WITH_ESR = ["480P", "768P", "2K", "1080p-esr", "1440p-esr", "4k-esr"] as const;
const H3_SR = ["480P", "768P", "1440p-sr", "4k-sr"] as const;
export const MINIMAX_MODELS: Record<string, MinimaxTier> = {
  "minimax-h3": { slug: "h3", label: "MiniMax H3", resolutions: { t2v: H3_NATIVE, i2v: H3_WITH_ESR, r2v: H3_WITH_ESR }, defaultResolution: "768P", promptExpansion: true },
  "minimax-h3-max": { slug: "h3-max", label: "MiniMax H3 Max", resolutions: { t2v: H3_SR, i2v: H3_SR }, defaultResolution: "768P", promptExpansion: true },
  "minimax-h3-max-turbo": { slug: "h3-max-turbo", label: "MiniMax H3 Max Turbo", resolutions: { t2v: ["480P", "768P"], i2v: ["480P", "768P"] }, defaultResolution: "768P", promptExpansion: false },
  "minimax-h3-fast": { slug: "h3-fast", label: "MiniMax H3 Fast", resolutions: { t2v: ["480P"], i2v: ["480P"], r2v: ["480P"] }, defaultResolution: "480P", promptExpansion: true },
  "minimax-h3-dev": { slug: "h3-developer", label: "MiniMax H3 Developer", resolutions: { t2v: H3_SR, i2v: H3_SR, r2v: H3_SR }, defaultResolution: "768P", promptExpansion: true },
};

export function isMinimaxModel(videoModel: unknown): boolean {
  return Object.prototype.hasOwnProperty.call(MINIMAX_MODELS, String(videoModel || ""));
}

/** 참조→영상 엔드포인트가 있는 등급(AI 시네마가 캐릭터 시트·세트 플레이트를 참조로 붙이는 대상). */
export const MINIMAX_REFS_MODELS = Object.keys(MINIMAX_MODELS).filter((id) => !!MINIMAX_MODELS[id].resolutions.r2v);

/**
 * 입력으로 엔드포인트를 고른다.
 *  - 참조(이미지·영상·오디오)가 있으면 참조→영상. 시작 이미지는 참조 1번으로 들어간다. 끝 프레임은 이 모드에 없다.
 *  - 시작(·끝) 이미지만 있으면 이미지→영상.
 *  - 아무것도 없으면 텍스트→영상.
 * 요청 해상도가 그 모드에 없으면 오류를 돌려준다(조용히 바꾸지 않는다). 비어 있으면 등급 기본값.
 */
export function resolveMinimaxRoute(videoModel: string, input: {
  hasStart: boolean; hasEnd: boolean; refImages: number; refVideos: number; hasAudio: boolean; resolution?: unknown;
}): { ok: true; mode: MinimaxMode; model: string; resolution: string; tier: MinimaxTier }
  | { ok: false; error: string; message: string; allowedResolutions?: readonly string[] } {
  const tier = MINIMAX_MODELS[videoModel];
  if (!tier) return { ok: false, error: "unsupported_video_model", message: `알 수 없는 MiniMax 모델: ${videoModel}` };
  const hasRefMedia = input.refImages > 0 || input.refVideos > 0 || input.hasAudio;
  let mode: MinimaxMode;
  if (hasRefMedia) {
    if (!tier.resolutions.r2v) return { ok: false, error: "minimax_refs_unsupported", message: `${tier.label} 에는 참조→영상이 없어요. 참조 이미지·영상·오디오를 빼거나 H3·H3 Fast·H3 Developer 를 고르세요.` };
    if (input.hasEnd) return { ok: false, error: "minimax_end_with_refs", message: "끝 프레임은 참조와 함께 쓸 수 없어요(참조→영상에는 끝 프레임이 없습니다). 끝 프레임을 빼거나 참조를 비우세요." };
    if (input.refImages + input.refVideos + (input.hasStart ? 1 : 0) === 0) return { ok: false, error: "minimax_audio_only", message: "오디오만으로는 만들 수 없어요. 이미지나 영상 참조를 하나 이상 넣으세요." };
    mode = "r2v";
  } else if (input.hasStart || input.hasEnd) {
    if (!input.hasStart) return { ok: false, error: "minimax_end_needs_start", message: "끝 프레임만으로는 만들 수 없어요. 시작 이미지도 넣으세요." };
    mode = "i2v";
  } else {
    mode = "t2v";
  }
  const allowed = tier.resolutions[mode]!;
  const raw = String(input.resolution ?? "").trim();
  const resolution = raw ? allowed.find((r) => r.toLowerCase() === raw.toLowerCase()) : tier.defaultResolution;
  if (!resolution) {
    return { ok: false, error: "invalid_minimax_resolution", message: `${tier.label} ${mode === "t2v" ? "텍스트→영상" : mode === "i2v" ? "이미지→영상" : "참조→영상"}은 ${allowed.join("·")} 해상도만 받아요(요청: ${raw}).`, allowedResolutions: allowed };
  }
  const endpoint = mode === "t2v" ? "text-to-video" : mode === "i2v" ? "image-to-video" : "reference-to-video";
  return { ok: true, mode, model: `minimax/${tier.slug}/${endpoint}`, resolution, tier };
}

/** 화면비: 이미지→영상은 adaptive 고정, 나머지는 공급자 집합 안에서만(없으면 16:9). */
export function minimaxRatioFor(mode: MinimaxMode, aspectRatio: unknown): string {
  if (mode === "i2v") return "adaptive";
  const raw = String(aspectRatio ?? "").trim().replace(/\s+/g, "").replace("/", ":");
  return MINIMAX_RATIOS.includes(raw as any) ? raw : "16:9";
}
