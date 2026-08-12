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
/** Vidu Q3. */
export const DURATIONS_VIDU = [4, 5, 6, 8, 10] as const;

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
  "wan": DURATIONS_SEEDANCE,
  "vidu-q3": DURATIONS_VIDU,
};

// ── UI 가 제시하는 선택지 (CHOICES) ─────────────────────────
// 허용 집합의 부분집합이어야 한다. 4~15초를 전부 드롭다운에 넣으면 고르기만 불편하므로
// 실제로 쓰는 값만 노출한다. 프론트는 이 표를 미러링하고 테스트가 부분집합임을 검사한다.

export const CHOICES_SEEDANCE = [4, 5, 6, 8, 10, 15] as const;

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
  "wan": CHOICES_SEEDANCE,
  "vidu-q3": DURATIONS_VIDU,
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

/**
 * Seedance 계열이 받는 해상도.
 * 공급자는 480p/720p/720p-SR/1080p/1080p-SR/1440p-SR/4k 를 받지만 지금은 720p 고정.
 * (해상도 옵션화는 별건)
 */
export const SEEDANCE_RESOLUTION = "720p";

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
