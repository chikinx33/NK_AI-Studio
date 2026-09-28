// prototype/functions/api/_shared/motion-control.js
//
// 모션 컨트롤(Kling 3.0 Motion Control via Atlas Cloud, 스키마 확인 2026-09-28).
// 캐릭터 이미지 1장 + 동작 영상 1개 → 영상 속 동작을 캐릭터에 입힌 영상.
// 결과 길이는 동작 영상 길이를 따른다(길이 파라미터가 없다). 그래서 과금도 업로드된 영상에서 직접 읽은 길이로 한다.
// 의존성이 없어 credit-rates.js·video.ts·테스트가 함께 import 한다.

export const KLING_MOTION_MODELS = Object.freeze({
  "kling-motion-pro": Object.freeze({ atlasModel: "kwaivgi/kling-v3.0-pro/motion-control", label: "Kling 3.0 Pro Motion Control", usdPerSecond: 0.143 }),
  "kling-motion-std": Object.freeze({ atlasModel: "kwaivgi/kling-v3.0-std/motion-control", label: "Kling 3.0 Std Motion Control", usdPerSecond: 0.107 }),
});

/**
 * 공급자 입력 규격. 이미지·영상 모두 한 변 300px 이상, 비율 1:2.5~2.5:1, 10MB 이하.
 * 동작 영상 길이 상한은 방향 기준에 따라 다르다: 영상 방향을 따르면 30초, 이미지 방향을 유지하면 10초(Kling 공식 문서).
 */
export const MOTION_SPEC = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  minSeconds: 3,
  maxSeconds: Object.freeze({ video: 30, image: 10 }),
  videoMimes: Object.freeze(["video/mp4", "video/quicktime"]),
  imageMimes: Object.freeze(["image/jpeg", "image/png"]),
});

export const MOTION_ORIENTATIONS = Object.freeze(["video", "image"]);

export function isKlingMotionModel(videoModel) {
  return Object.prototype.hasOwnProperty.call(KLING_MOTION_MODELS, String(videoModel || ""));
}

export function normalizeMotionOrientation(value) {
  return String(value || "").trim().toLowerCase() === "image" ? "image" : "video";
}

export function dataUrlMime(dataUrl) {
  const m = /^data:([^;,]+)[;,]/.exec(String(dataUrl || ""));
  return m ? m[1].toLowerCase() : "";
}

export function dataUrlBytes(dataUrl) {
  const s = String(dataUrl || "");
  const comma = s.indexOf(",");
  if (!s.startsWith("data:") || comma < 0) return new Uint8Array(0);
  const bin = atob(s.slice(comma + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── mp4/mov 길이 읽기 ─────────────────────────────────────────
// ISO BMFF(mp4)·QuickTime(mov) 모두 moov/mvhd 에 timescale·duration 이 있다(moov 가 파일 끝에 있어도 된다).
// 조각난 mp4(fMP4)는 mvhd duration 이 0 일 수 있어 moov/mvex/mehd 를 다음으로 본다.

function u32(b, o) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
function u64(b, o) { return u32(b, o) * 4294967296 + u32(b, o + 4); }
function boxType(b, o) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); }

function* boxes(b, start, end) {
  let o = start;
  while (o + 8 <= end) {
    let size = u32(b, o);
    const type = boxType(b, o + 4);
    let header = 8;
    if (size === 1) {
      if (o + 16 > end) return;
      size = u64(b, o + 8);
      header = 16;
    } else if (size === 0) {
      size = end - o;
    }
    if (size < header || o + size > end) return;
    yield { type, start: o + header, end: o + size };
    o += size;
  }
}

function findBox(b, start, end, type) {
  for (const box of boxes(b, start, end)) if (box.type === type) return box;
  return null;
}

/** mp4/mov 바이트에서 재생 길이(초)를 읽는다. 읽을 수 없으면 0. */
export function mp4DurationSeconds(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
  const moov = findBox(b, 0, b.length, "moov");
  if (!moov) return 0;
  const mvhd = findBox(b, moov.start, moov.end, "mvhd");
  let timescale = 0;
  if (mvhd && mvhd.end - mvhd.start >= 20) {
    const v = b[mvhd.start];
    const p = mvhd.start + 4;
    timescale = v === 1 ? u32(b, p + 16) : u32(b, p + 8);
    const duration = v === 1 ? u64(b, p + 20) : u32(b, p + 12);
    if (timescale > 0 && duration > 0 && duration !== 0xffffffff) return duration / timescale;
  }
  const mvex = findBox(b, moov.start, moov.end, "mvex");
  const mehd = mvex ? findBox(b, mvex.start, mvex.end, "mehd") : null;
  if (mehd && timescale > 0) {
    const v = b[mehd.start];
    const d = v === 1 ? u64(b, mehd.start + 4) : u32(b, mehd.start + 4);
    if (d > 0) return d / timescale;
  }
  return 0;
}

export function dataUrlVideoSeconds(dataUrl) {
  try { return mp4DurationSeconds(dataUrlBytes(dataUrl)); } catch (_) { return 0; }
}

/**
 * 과금용 본문. 모션 컨트롤은 길이를 고르지 않으므로(결과 = 동작 영상 길이) 클라이언트가 적은 durationSeconds 대신
 * 올라온 영상에서 읽은 길이를 쓴다. 영상이 없거나(견적 요청) 읽지 못하면 본문을 그대로 둔다
 * — 읽지 못한 영상은 video.ts 가 공급자 호출 전에 거부하고 예약이 풀린다.
 */
export function withMeasuredMotionSeconds(feature, body) {
  if (String(feature || "") !== "video" || !body || typeof body !== "object") return body;
  if (!isKlingMotionModel(body.videoModel || body.model)) return body;
  const seconds = dataUrlVideoSeconds(body.videoDataUrl);
  return seconds > 0 ? { ...body, durationSeconds: Math.ceil(seconds) } : body;
}

/**
 * 업로드 전에 공급자 규격을 확인한다. 공급자가 거부할 입력을 과금·업로드 전에 읽을 수 있는 이유로 돌려준다.
 * 입력: { imageMime, videoMime, videoBytes, videoSeconds, orientation }
 */
export function checkMotionInputs(input) {
  const orientation = normalizeMotionOrientation(input && input.orientation);
  const imageMime = String((input && input.imageMime) || "").toLowerCase();
  const videoMime = String((input && input.videoMime) || "").toLowerCase();
  const videoBytes = Number((input && input.videoBytes) || 0);
  const seconds = Number((input && input.videoSeconds) || 0);
  if (!imageMime) return { ok: false, error: "motion_image_required", message: "캐릭터 이미지를 넣어 주세요." };
  if (!MOTION_SPEC.imageMimes.includes(imageMime)) {
    return { ok: false, error: "motion_image_type", message: `캐릭터 이미지는 JPG·PNG 만 받아요(요청: ${imageMime}).` };
  }
  if (!videoMime) return { ok: false, error: "motion_video_required", message: "동작 영상을 넣어 주세요." };
  if (!MOTION_SPEC.videoMimes.includes(videoMime)) {
    return { ok: false, error: "motion_video_type", message: `동작 영상은 MP4·MOV 만 받아요(요청: ${videoMime}).` };
  }
  if (videoBytes > MOTION_SPEC.maxBytes) {
    return { ok: false, error: "motion_video_too_large", message: `동작 영상은 10MB 이하여야 해요(현재 ${(videoBytes / 1048576).toFixed(1)}MB).` };
  }
  if (!(seconds > 0)) {
    return { ok: false, error: "motion_video_unreadable", message: "동작 영상의 길이를 읽을 수 없어요. MP4 로 다시 저장해서 올려 주세요." };
  }
  const max = MOTION_SPEC.maxSeconds[orientation];
  if (seconds < MOTION_SPEC.minSeconds || seconds > max + 0.05) {
    return {
      ok: false,
      error: "motion_video_duration",
      message: orientation === "image"
        ? `캐릭터 이미지 방향을 유지하면 동작 영상은 ${MOTION_SPEC.minSeconds}~${max}초여야 해요(현재 ${seconds.toFixed(1)}초). 영상 방향 따라가기는 최대 ${MOTION_SPEC.maxSeconds.video}초까지 돼요.`
        : `동작 영상은 ${MOTION_SPEC.minSeconds}~${max}초여야 해요(현재 ${seconds.toFixed(1)}초).`,
    };
  }
  return { ok: true, orientation, seconds };
}
