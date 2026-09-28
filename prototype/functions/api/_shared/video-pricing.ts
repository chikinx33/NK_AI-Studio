// prototype/functions/api/_shared/video-pricing.ts
//
// 영상 생성의 공급자(Atlas Cloud) 원가를 정확히 계산하고 판매 크레딧으로 바꾼다.
//   판매 크레딧 = ceil(원가 USD × (1 + 마진 30%) ÷ 1C $0.01)
//
// 두 층으로 나눈다.
//  1) atlasPriceUsd(atlasModel, params): Atlas 요청 파라미터 그대로 원가를 낸다.
//     표는 Atlas 웹 플레이그라운드의 견적 API(POST https://api.atlascloud.ai/api/v1/model/calculate) 2026-09-29 실측값이며,
//     prototype/tests/fixtures/atlas-price-grid-2026-09-29.json(실측 응답 전체)과 한 건도 어긋나지 않는지 테스트로 검증한다.
//  2) videoCost(NK 요청): video.ts 가 모델마다 실제로 보내는 값(엔드포인트·해상도·길이 스냅·오디오 기본값)으로 바꿔 1)을 부른다.
//     ⚠️ video.ts 의 분기를 바꾸면 여기(atlasRequestFor)와 테스트(credit-pricing.test.mjs)를 함께 고친다.
// 공급자 할인(discount)이 바뀌면 다시 재고 PRICE_TABLE_DATE 를 올린다.

import { snapDurationFor, resolveMinimaxRoute, normalizeSeedanceResolution } from "./video-specs.ts";
import { snapKlingDuration } from "./kling.ts";

export const PRICE_TABLE_DATE = "2026-09-29";
/** 1 크레딧의 원가 기준(USD). */
export const USD_PER_CREDIT = 0.01;
/** 원가에 붙이는 마진. */
export const CREDIT_MARGIN = 0.3;

/** 원가(USD) → 판매 크레딧. 원가가 있으면 최소 1C. 부동소수 오차로 한 단계 올라가지 않게 1e-9 를 뺀다. */
export function creditsForUsd(usd: number): number {
  const raw = (Number(usd) || 0) * (1 + CREDIT_MARGIN) / USD_PER_CREDIT;
  if (!(raw > 0)) return 0;
  return Math.max(1, Math.ceil(raw - 1e-9));
}

export class VideoPricingError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

// ── 초당 요금(USD, 할인 반영 실제 청구가) ─────────────────────────────────
const VEO: Record<string, { rates: Record<string, { off: number; on: number }>; audioDefault: boolean }> = {
  // Fast 는 generate_audio 기본 꺼짐, Full(veo3.1)은 안 보내면 켜짐(실측: 1080p 6초 무지정 $2.40).
  "google/veo3.1-fast/image-to-video": { audioDefault: false, rates: { "720p": { off: 0.08, on: 0.096 }, "1080p": { off: 0.10, on: 0.12 }, "4k": { off: 0.25, on: 0.30 } } },
  "google/veo3.1-fast/text-to-video": { audioDefault: false, rates: { "720p": { off: 0.08, on: 0.096 }, "1080p": { off: 0.10, on: 0.12 }, "4k": { off: 0.25, on: 0.30 } } },
  "google/veo3.1/image-to-video": { audioDefault: true, rates: { "720p": { off: 0.20, on: 0.40 }, "1080p": { off: 0.20, on: 0.40 }, "4k": { off: 0.40, on: 0.60 } } },
  "google/veo3.1/text-to-video": { audioDefault: true, rates: { "720p": { off: 0.20, on: 0.40 }, "1080p": { off: 0.20, on: 0.40 }, "4k": { off: 0.40, on: 0.60 } } },
};
const GROK_PER_SECOND: Record<string, number> = { "480p": 0.05, "720p": 0.07 };
const GROK_PER_INPUT_IMAGE = 0.002;
const GROK_EXTEND_PER_SECOND = 0.07;
const GROK_EXTEND_INPUT_PER_SECOND = 0.01;
const KLING_PER_SECOND: Record<string, { sound?: number; mute: number }> = {
  "kwaivgi/kling-v1.6-i2v-standard": { mute: 0.0476 },
  "kwaivgi/kling-v1.6-multi-i2v-standard": { mute: 0.0476 },
  // v2.6 Pro 는 sound 기본 켜짐(실측).
  "kwaivgi/kling-v2.6-pro/image-to-video": { sound: 0.119, mute: 0.0595 },
};
const MOTION_PER_SECOND: Record<string, number> = {
  "kwaivgi/kling-v3.0-pro/motion-control": 0.1428,
  "kwaivgi/kling-v3.0-std/motion-control": 0.1071,
};
const WAN_PER_SECOND: Record<string, number> = { "720P": 0.10, "1080P": 0.15 };
const WAN_MIN_SECONDS = 5;
const VIDU_PER_SECOND: Record<string, number> = { "720p": 0.10625, "1080p": 0.1275, "1080p-sr": 0.1275, "1440p-sr": 0.906652 / 5 };
const MINIMAX_PER_SECOND: Record<string, Record<string, number>> = {
  "h3": { "480P": 0.038, "768P": 0.08, "2K": 0.13, "1080p-esr": 0.105, "1440p-esr": 0.115, "4k-esr": 0.195 },
  "h3-max": { "480P": 0.0475, "768P": 0.076, "1440p-sr": 0.1425, "4k-sr": 0.19475 },
  "h3-max-turbo": { "480P": 0.02375, "768P": 0.038 },
  "h3-fast": { "480P": 0.0437 },
  "h3-developer": { "480P": 0.015, "768P": 0.024, "1440p-sr": 0.045, "4k-sr": 0.0615 },
};

// ── Seedance(토큰 과금) ─────────────────────────────────────────────
// 토큰 = floor(가로 × 세로 × (24 × (출력초 + 입력영상초) + 1) ÷ 1024). 5·7·10·15·30초 실측 토큰에서 역산한 해상도가 모두 정수로 맞는다.
// 공식 문구: "(height × width × (input duration + output duration) × 24) / 1024" (모델 페이지).
// Atlas 견적은 입력 영상 길이를 빼고 계산한다("estimate_partial") — 실제 청구는 완료 시 입력 길이까지 포함한 토큰.
const SEEDANCE_PIXELS: Record<string, Record<string, number>> = {
  "480p": { "16:9": 864 * 496, "9:16": 864 * 496, "1:1": 640 * 640, "4:3": 752 * 560, "3:4": 752 * 560, "21:9": 864 * 496 },
  "720p": { "16:9": 1280 * 720, "9:16": 1280 * 720, "1:1": 960 * 960, "4:3": 1112 * 834, "3:4": 1112 * 834, "21:9": 1470 * 630 },
  "1080p": { "16:9": 1920 * 1080, "9:16": 1920 * 1080, "1:1": 1440 * 1440, "4:3": 1440 * 1080, "3:4": 1440 * 1080, "21:9": 2520 * 1080 },
  "4k": { "16:9": 3840 * 2160 },
};
/** Seedance 2.0: 해상도 → (토큰 기준 원본 해상도, 1000토큰당 USD). SR 은 낮은 원본을 만든 뒤 업스케일한다. */
const SEEDANCE_20: Record<string, { base: string; perK: number }> = {
  "480p": { base: "480p", perK: 0.00896 },
  "720p": { base: "720p", perK: 0.00896 },
  "1080p": { base: "1080p", perK: 0.00896 },
  "720p-SR": { base: "480p", perK: 0.016128 },
  "1080p-SR": { base: "720p", perK: 0.016128 },
  "1440p-SR": { base: "720p", perK: 0.028672 },
  "4k": { base: "4k", perK: 4.901416 / 980.1 },
};
/** 입력 영상이 있으면 2.0 단가 × ($0.00688 ÷ $0.0112) — 해상도 무관(실측 일치). */
const SEEDANCE_20_VIDEO_RATIO = 0.00688 / 0.0112;
const SEEDANCE_25: Record<string, { perK: number; perKVideo: number }> = {
  "480p": { perK: 0.01391, perKVideo: 0.00832 },
  "720p": { perK: 0.01391, perKVideo: 0.00832 },
  "1080p": { perK: 0.012168, perKVideo: 1.783305 / 245.025 },
};

export function seedanceTokens(resolutionBase: string, ratio: string, outputSeconds: number, inputVideoSeconds = 0): number {
  const table = SEEDANCE_PIXELS[resolutionBase];
  const pixels = table && table[ratio];
  if (!pixels) throw new VideoPricingError("pricing_unknown_resolution", `Seedance ${resolutionBase} ${ratio} 요금이 없어요.`);
  return Math.floor(pixels * (24 * (outputSeconds + inputVideoSeconds) + 1) / 1024 + 1e-9);
}

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function need(v: unknown, what: string): number {
  const n = num(v);
  if (!(n > 0)) throw new VideoPricingError("pricing_input_video_unmeasured", `${what}: 입력 영상 길이를 읽지 못해 요금을 계산할 수 없어요.`);
  return n;
}
function rateOf<T>(table: Record<string, T> | undefined, key: string, what: string): T {
  const v = table ? table[key] : undefined;
  if (v === undefined) throw new VideoPricingError("pricing_unknown_resolution", `${what} ${key} 요금이 없어요.`);
  return v;
}

/**
 * Atlas 요청 파라미터 → 원가(USD).
 * @param media.inputVideoSeconds 입력 영상 길이 합(모션·연장·Seedance·MiniMax 참조 영상). Seedance 는 0 이면 Atlas 견적(부분)과 같다.
 */
export function atlasPriceUsd(atlasModel: string, params: any, media: { inputVideoSeconds?: number } = {}): number {
  const p = params || {};
  const d = num(p.duration);
  const veo = VEO[atlasModel];
  if (veo) {
    const audio = p.generate_audio === undefined ? veo.audioDefault : !!p.generate_audio;
    const r = rateOf(veo.rates, String(p.resolution || "720p"), atlasModel);
    return (audio ? r.on : r.off) * d;
  }
  if (atlasModel === "xai/grok-imagine-video/text-to-video") return rateOf(GROK_PER_SECOND, String(p.resolution || "720p"), atlasModel) * d;
  if (atlasModel === "xai/grok-imagine-video/image-to-video") return rateOf(GROK_PER_SECOND, String(p.resolution || "720p"), atlasModel) * d + GROK_PER_INPUT_IMAGE;
  if (atlasModel === "xai/grok-imagine-video/reference-to-video") {
    return rateOf(GROK_PER_SECOND, String(p.resolution || "720p"), atlasModel) * d + GROK_PER_INPUT_IMAGE * (Array.isArray(p.image_urls) ? p.image_urls.length : 0);
  }
  if (atlasModel === "xai/grok-imagine-video/extend-video") return GROK_EXTEND_PER_SECOND * d + GROK_EXTEND_INPUT_PER_SECOND * need(media.inputVideoSeconds, "Grok 연장");
  const kling = KLING_PER_SECOND[atlasModel];
  if (kling) {
    const sound = kling.sound !== undefined && p.sound !== false;
    return (sound ? kling.sound! : kling.mute) * d;
  }
  if (MOTION_PER_SECOND[atlasModel]) return MOTION_PER_SECOND[atlasModel] * need(media.inputVideoSeconds, "모션 컨트롤");
  if (atlasModel === "alibaba/wan-2.7/image-to-video" || atlasModel === "alibaba/wan-2.7/text-to-video") {
    return rateOf(WAN_PER_SECOND, String(p.resolution || "1080P"), atlasModel) * Math.max(WAN_MIN_SECONDS, d);
  }
  if (atlasModel === "vidu/q3-mix/reference-to-video") return rateOf(VIDU_PER_SECOND, String(p.resolution || "720p"), atlasModel) * d;
  const mm = /^minimax\/([a-z0-9-]+)\/(text|image|reference)-to-video$/.exec(atlasModel);
  if (mm) {
    const perSecond = rateOf(MINIMAX_PER_SECOND[mm[1]], String(p.resolution || ""), atlasModel);
    const hasVideo = Array.isArray(p.refers) && p.refers.some((r: any) => r && r.type === "video");
    return perSecond * (d + (hasVideo ? need(media.inputVideoSeconds, "MiniMax 참조 영상") : 0));
  }
  if (atlasModel === "bytedance/seedance-2.0/image-to-video" || atlasModel === "bytedance/seedance-2.0/reference-to-video") {
    const spec = rateOf(SEEDANCE_20, String(p.resolution || "720p"), atlasModel);
    const hasVideo = !!p.video || (Array.isArray(p.reference_videos) && p.reference_videos.length > 0);
    const tokens = seedanceTokens(spec.base, String(p.ratio || "16:9"), d, hasVideo ? num(media.inputVideoSeconds) : 0);
    return tokens / 1000 * (hasVideo ? spec.perK * SEEDANCE_20_VIDEO_RATIO : spec.perK);
  }
  if (atlasModel === "bytedance/seedance-2.5/reference-to-video") {
    const spec = rateOf(SEEDANCE_25, String(p.resolution || "720p"), atlasModel);
    const hasVideo = Array.isArray(p.reference_videos) && p.reference_videos.length > 0;
    const tokens = seedanceTokens(String(p.resolution || "720p"), String(p.ratio || "16:9"), d, hasVideo ? num(media.inputVideoSeconds) : 0);
    return tokens / 1000 * (hasVideo ? spec.perKVideo : spec.perK);
  }
  throw new VideoPricingError("pricing_unknown_model", `요금표에 없는 Atlas 모델이에요: ${atlasModel}`);
}

// ── NK 요청 → video.ts 가 보내는 Atlas 요청 ─────────────────────────────
export interface VideoCostInput {
  videoModel: string;
  durationSeconds?: number;
  resolution?: string;
  aspectRatio?: string;
  quality?: string;
  hasStartImage?: boolean;
  hasEndImage?: boolean;
  referenceImageCount?: number;
  /** 참조·편집 영상 개수(video.ts 가 그 모델에 싣는 것만). */
  referenceVideoCount?: number;
  hasAudio?: boolean;
  /** 입력 영상 길이 합(초, 소수). 서버가 파일에서 잰 값. */
  inputVideoSeconds?: number;
  generateAudio?: boolean;
  /** env.VEO_ATLAS_MODEL_ID(없으면 veo3.1-fast i2v). */
  veoAtlasModel?: string;
}

export interface VideoCost { usd: number; credits: number; atlasModel: string; params: Record<string, unknown>; }

function aspectOf(raw: unknown): string {
  // video.ts normalizeAspectRatio 와 같다: 16:9·9:16·1:1 만, 나머지는 16:9.
  const text = String(raw ?? "").trim().replace(/\s+/g, "").replace("/", ":");
  return text === "9:16" || text === "1:1" ? text : "16:9";
}

export function atlasRequestFor(input: VideoCostInput): { atlasModel: string; params: Record<string, unknown> } {
  const model = String(input.videoModel || "").trim().toLowerCase();
  const d = input.durationSeconds;
  const refs = Math.max(0, Math.trunc(num(input.referenceImageCount)));
  const vids = Math.max(0, Math.trunc(num(input.referenceVideoCount)));
  const ratio = aspectOf(input.aspectRatio);
  if (model === "veo") return { atlasModel: String(input.veoAtlasModel || "").trim() || "google/veo3.1-fast/image-to-video", params: { duration: snapDurationFor("veo", d), resolution: "1080p" } };
  if (model === "veo-full") return { atlasModel: "google/veo3.1/image-to-video", params: { duration: snapDurationFor("veo-full", d), resolution: "1080p" } };
  if (model === "grok" || model === "grok-r2v") {
    const useRefs = model === "grok-r2v" && refs > 0;
    const useStart = !useRefs && !!input.hasStartImage;
    const atlasModel = useRefs ? "xai/grok-imagine-video/reference-to-video" : (useStart ? "xai/grok-imagine-video/image-to-video" : "xai/grok-imagine-video/text-to-video");
    const params: Record<string, unknown> = { duration: snapDurationFor(model, d), resolution: "720p" };
    if (useRefs) params.image_urls = Array(refs).fill("ref");
    return { atlasModel, params };
  }
  if (model === "grok-extend") return { atlasModel: "xai/grok-imagine-video/extend-video", params: { duration: snapDurationFor("grok-extend", d), video_url: "input" } };
  if (model === "kling" || model === "kling-draft" || model === "kling-final") {
    const final = model === "kling-final" || String(input.quality || "") === "final";
    const atlasModel = final ? "kwaivgi/kling-v2.6-pro/image-to-video" : (refs > 0 ? "kwaivgi/kling-v1.6-multi-i2v-standard" : "kwaivgi/kling-v1.6-i2v-standard");
    return { atlasModel, params: { duration: Number(snapKlingDuration(num(d))) } }; // sound 는 보내지 않는다 → 기본 켜짐
  }
  if (model === "kling-motion-pro") return { atlasModel: "kwaivgi/kling-v3.0-pro/motion-control", params: {} };
  if (model === "kling-motion-std") return { atlasModel: "kwaivgi/kling-v3.0-std/motion-control", params: {} };
  if (model === "seedance" || model === "seedance-r2v") {
    const resolution = normalizeSeedanceResolution(input.resolution);
    if (!resolution) throw new VideoPricingError("pricing_unknown_resolution", `Seedance 해상도 요금이 없어요: ${input.resolution}`);
    const params: Record<string, unknown> = { duration: snapDurationFor(model, d), resolution, ratio };
    if (model === "seedance-r2v" && vids > 0) params.video = "input"; // video.ts 는 videoDataUrl 하나만 싣는다
    return { atlasModel: model === "seedance-r2v" ? "bytedance/seedance-2.0/reference-to-video" : "bytedance/seedance-2.0/image-to-video", params };
  }
  if (model === "seedance-2.5") {
    const params: Record<string, unknown> = { duration: snapDurationFor("seedance-2.5", d), resolution: String(input.resolution || "720p"), ratio };
    if (vids > 0) params.reference_videos = Array(vids).fill("input");
    return { atlasModel: "bytedance/seedance-2.5/reference-to-video", params };
  }
  if (model === "wan") return { atlasModel: "alibaba/wan-2.7/image-to-video", params: { duration: snapDurationFor("wan", d) } }; // resolution 미전송 → 1080P
  if (model === "vidu-q3") return { atlasModel: "vidu/q3-mix/reference-to-video", params: { duration: snapDurationFor("vidu-q3", d) } }; // resolution 미전송 → 720p
  if (model.startsWith("minimax-")) {
    const route = resolveMinimaxRoute(model, {
      hasStart: !!input.hasStartImage, hasEnd: !!input.hasEndImage,
      refImages: refs, refVideos: vids, hasAudio: !!input.hasAudio, resolution: input.resolution,
    });
    if (!route.ok) throw new VideoPricingError(route.error, route.message);
    const params: Record<string, unknown> = { duration: snapDurationFor(model, d), resolution: route.resolution };
    if (route.mode === "r2v") params.refers = Array(vids).fill({ type: "video" });
    return { atlasModel: route.model, params };
  }
  throw new VideoPricingError("pricing_unknown_model", `요금표에 없는 영상 모델이에요: ${model}`);
}

/** NK 요청 → 원가·판매 크레딧. 알 수 없는 조합·재지 못한 입력 영상은 VideoPricingError(과금·생성을 막는다). */
export function videoCost(input: VideoCostInput): VideoCost {
  const { atlasModel, params } = atlasRequestFor(input);
  // Seedance 는 입력 영상 길이가 토큰에 더해진다. 재지 못했으면 싸게 잡지 않고 막는다.
  if (/^bytedance\/seedance-/.test(atlasModel) && (params.video || params.reference_videos)) need(input.inputVideoSeconds, "Seedance 참조 영상");
  const usd = atlasPriceUsd(atlasModel, params, { inputVideoSeconds: input.inputVideoSeconds });
  return { usd: Math.round(usd * 1e6) / 1e6, credits: creditsForUsd(usd), atlasModel, params };
}

/** 업스케일(atlascloud/image-upscaler): 배율과 무관하게 1회 $0.01(실측). */
export const IMAGE_UPSCALE_USD = 0.01;

// ── 요청 본문(/api/video 와 같은 모양) → 요금 입력 ─────────────────────────
// video.ts 가 모델마다 싣는 입력만 센다: seedance-r2v 는 videoDataUrl 하나, seedance-2.5 는 referenceVideos,
// MiniMax 는 둘 다, Grok 연장·모션 컨트롤은 videoDataUrl.

/** video.ts 가 이 모델 요청에 실제로 싣는 입력 영상(data:·gs://·https). 서버가 이 목록의 길이를 재서 과금한다. */
export function videoInputSourcesFor(body: any): string[] {
  const b = body || {};
  const model = String(b.videoModel || b.model || "veo").trim().toLowerCase();
  const videoData = String(b.videoDataUrl || "").trim();
  const refVideos: string[] = Array.isArray(b.referenceVideos) ? b.referenceVideos.map((v: any) => String(v || "")).filter(Boolean).slice(0, 10) : [];
  if (model === "seedance-r2v" || model === "grok-extend" || model === "kling-motion-pro" || model === "kling-motion-std") return videoData ? [videoData] : [];
  if (model === "seedance-2.5") return refVideos;
  if (model.startsWith("minimax-")) return [...refVideos, ...(videoData ? [videoData] : [])];
  return [];
}

/**
 * 요청 본문 → 요금 입력. 견적 화면은 실제 파일 대신 개수·길이(hasStartImage·referenceVideoCount·inputVideoSeconds)를 보낸다.
 * 실제 차감(credits.ts withCreditCharge)은 이 보조 값을 지우고 서버가 잰 값으로 다시 채운다.
 */
export function videoCostInputFromBody(body: any, env?: any): VideoCostInput {
  const b = body || {};
  const model = String(b.videoModel || b.model || "veo").trim().toLowerCase();
  const start = String(b.imageDataUrl || b.image || "");
  const refs: string[] = Array.isArray(b.referenceImages) ? b.referenceImages.map((v: any) => String(v || "")).filter(Boolean) : [];
  // MiniMax 는 시작 스틸과 같은 참조를 한 번만 보낸다(video.ts).
  const refCount = model.startsWith("minimax-") && start ? refs.filter((r) => r !== start).length : refs.length;
  const sources = videoInputSourcesFor(b);
  const duration = b.durationSeconds ?? b.duration;
  return {
    videoModel: model,
    // video.ts 는 길이가 없으면 6초로 받는다.
    durationSeconds: duration === undefined || duration === null || duration === "" ? 6 : Number(duration),
    resolution: b.resolution === undefined ? undefined : String(b.resolution),
    aspectRatio: b.aspectRatio,
    quality: b.quality,
    hasStartImage: !!start || b.hasStartImage === true,
    hasEndImage: !!String(b.endImageDataUrl || "") || b.hasEndImage === true,
    referenceImageCount: refCount,
    referenceVideoCount: sources.length || Math.max(0, Math.trunc(Number(b.referenceVideoCount) || 0)),
    hasAudio: !!String(b.audioDataUrl || "") || b.hasAudio === true,
    inputVideoSeconds: Number(b.inputVideoSeconds) || 0,
    generateAudio: b.generateAudio,
    veoAtlasModel: env && env.VEO_ATLAS_MODEL_ID ? String(env.VEO_ATLAS_MODEL_ID) : undefined,
  };
}
