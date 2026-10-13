/**
 * POST /api/brand/voice
 * IP 라이브러리 캐릭터 보이스 등록. 오디오를 그 사용자의 브랜드 폴더에 저장하고 brandCharacters[].voice 에 넣을 값을 돌려준다.
 * 저장(브랜드 허브 '저장')은 화면이 한다 — 이 엔드포인트는 파일만 올린다(시트 업로드와 같은 초안 흐름).
 *
 * Request:
 *   { brandId, token: "@네모", kind: "preset", provider: "gemini", voice: "Achird" | "char:girl-5", name?, voiceId? }
 *   { brandId, token: "@네모", kind: "reference", dataUrl: "data:audio/wav;base64,...", fileName? }
 * Response: { voice: { kind, name, provider, providerVoiceId, voiceId, audioUrl(gs://), fileName, durationSec, updatedAt }, url }
 *
 * 프리셋도 그 보이스의 샘플 음성을 브랜드 폴더에 복사해 둔다. 영상 모델(Seedance 2.5 reference_audios)은
 * 보이스 이름이 아니라 음성 파일을 받기 때문이다 — 프리셋·레퍼런스 모두 "이 캐릭터의 목소리 파일" 하나로 귀결된다.
 */
import { authorizeRequest } from "../_shared/auth.js";
import { buildAiVideoBrandPrefix } from "../_shared/storage";
import { corsHeaders, send, signGcsUrl, uploadToGcs, parseGcsUri } from "../sound/_shared";
import { loadVoiceSample, VoiceSampleError } from "../sound/_voice-sample";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

// Seedance 2.5 reference_audios: wav/mp3, 클립당 2~30초·15MB, 요청 합계 30초.
// 캐릭터 3명이 한 컷에 같이 나와도 합계를 넘지 않도록 캐릭터당 10초까지만 받는다(화면에서 잘라 보낸다).
const VOICE_MIN_SEC = 2;
const VOICE_MAX_SEC = 10;
const MAX_BYTES = 15 * 1024 * 1024;

function sanitizeSegment(value: string) {
  return String(value || "")
    .trim()
    .normalize("NFKC")
    .replace(/^@+/, "")
    .replace(/[^0-9A-Za-z._\-가-힣]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    || "character";
}

function base64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** 파일 머리로 형식을 판별한다(확장자·선언된 MIME 은 믿지 않는다). */
function sniffAudio(bytes: Uint8Array): "wav" | "mp3" | "" {
  const ascii = (o: number, n: number) => String.fromCharCode(...bytes.slice(o, o + n));
  if (bytes.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "wav";
  if (bytes.length > 3 && ascii(0, 3) === "ID3") return "mp3";
  if (bytes.length > 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "mp3";
  return "";
}

/** WAV 길이(초). fmt 의 byteRate 와 data 청크 크기로 계산한다. 못 읽으면 0. */
function wavDurationSec(bytes: Uint8Array): number {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 12;
  let byteRate = 0;
  while (off + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.slice(off, off + 4));
    const size = dv.getUint32(off + 4, true);
    if (id === "fmt " && off + 16 <= bytes.length) byteRate = dv.getUint32(off + 16, true);
    if (id === "data") {
      const dataSize = Math.min(size, bytes.length - off - 8);
      return byteRate > 0 ? Math.round((dataSize / byteRate) * 100) / 100 : 0;
    }
    off += 8 + size + (size % 2);
  }
  return 0;
}

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const body: any = await request.json().catch(() => ({}));
    const brandId = String(body.brandId || "").trim();
    const token = String(body.token || "").trim();
    const kind = String(body.kind || "").trim();
    if (!brandId || !/^[a-zA-Z0-9._-]+$/.test(brandId)) return send({ error: "invalid_brandId" }, 400, origin);
    if (!token) return send({ error: "token_required" }, 400, origin);
    if (kind !== "preset" && kind !== "reference") return send({ error: "invalid_kind" }, 400, origin);

    const clientEmail = String(env.GOOGLE_CLIENT_EMAIL || "").trim();
    const privateKey = String(env.GOOGLE_PRIVATE_KEY || "").trim();
    const out = parseGcsUri(String(env.VIDEO_OUTPUT_GCS_URI || "").trim());
    if (!clientEmail || !privateKey || !out) return send({ error: "storage_not_configured" }, 500, origin);
    const userProject = String(env.GCS_BILLING_PROJECT_ID || env.GOOGLE_PROJECT_ID || "").trim();
    const brandPrefix = buildAiVideoBrandPrefix(out.object.replace(/\/$/, ""), auth.userId, brandId);

    let bytes: Uint8Array;
    let name = "";
    let provider = "";
    let providerVoiceId = "";
    let voiceId = "";
    let fileName = "";
    if (kind === "preset") {
      provider = String(body.provider || "gemini").trim() === "elevenlabs" ? "elevenlabs" : "gemini";
      providerVoiceId = String(body.voice || "").trim();
      const sample = await loadVoiceSample(env, provider, providerVoiceId);
      if (sample.gcs) {
        const signed = await signGcsUrl({ ...sample.gcs, expiresInSec: 600 });
        const res = await fetch(signed);
        if (!res.ok) return send({ error: "voice_sample_read_failed", status: res.status }, 500, origin);
        bytes = new Uint8Array(await res.arrayBuffer());
      } else if (sample.bytes) {
        bytes = sample.bytes;
      } else {
        return send({ error: "voice_sample_unavailable" }, 500, origin);
      }
      name = String(body.name || providerVoiceId).trim().slice(0, 80);
      voiceId = String(body.voiceId || "").trim().slice(0, 120);
    } else {
      const m = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/i.exec(String(body.dataUrl || ""));
      if (!m) return send({ error: "invalid_audio_data" }, 400, origin);
      bytes = base64ToBytes(m[2]);
      fileName = String(body.fileName || "").trim().replace(/[\\/]/g, "_").slice(0, 120);
      name = fileName || "reference";
    }

    if (!bytes.length || bytes.length > MAX_BYTES) return send({ error: "audio_too_large", maxBytes: MAX_BYTES }, 400, origin);
    const ext = sniffAudio(bytes);
    if (!ext) return send({ error: "unsupported_audio_format", detail: "wav 또는 mp3 만 받습니다." }, 400, origin);
    const durationSec = ext === "wav" ? wavDurationSec(bytes) : 0;
    if (ext === "wav" && durationSec > 0 && (durationSec < VOICE_MIN_SEC || durationSec > VOICE_MAX_SEC + 0.5)) {
      return send({ error: "audio_duration_out_of_range", durationSec, minSec: VOICE_MIN_SEC, maxSec: VOICE_MAX_SEC }, 400, origin);
    }

    const object = `${brandPrefix}/voice/${sanitizeSegment(token)}/${Date.now()}-${kind}.${ext}`;
    const ok = await uploadToGcs({
      bucket: out.bucket, object, bytes, contentType: ext === "wav" ? "audio/wav" : "audio/mpeg",
      clientEmail, privateKeyPem: privateKey, userProject: userProject || undefined,
    });
    if (!ok) return send({ error: "voice_upload_failed" }, 500, origin);
    const audioUrl = `gs://${out.bucket}/${object}`;
    const url = await signGcsUrl({ bucket: out.bucket, object, clientEmail, privateKeyPem: privateKey, expiresInSec: 3600 }).catch(() => "");
    return send({
      voice: { kind, name, provider, providerVoiceId, voiceId, audioUrl, fileName, durationSec, updatedAt: new Date().toISOString() },
      url,
    }, 200, origin);
  } catch (e: any) {
    if (e instanceof VoiceSampleError) return send({ error: e.message }, e.status, origin);
    return send({ error: String(e?.message || e || "brand_voice_error") }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
