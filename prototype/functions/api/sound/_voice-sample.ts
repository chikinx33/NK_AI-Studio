/**
 * 보이스 샘플(미리듣기 고정 멘트) 한 벌을 얻는다 — /api/sound/voice-preview 와 /api/brand/voice 가 같이 쓴다.
 * 보이스마다 한 번만 합성해 GCS 공용 경로({basePrefix}/sound/voice-previews/)에 두고, 이후엔 저장된 파일을 가리킨다.
 * 캐시에 올리지 못한 경우(폴백 엔진·업로드 실패)만 bytes 로 돌려준다.
 */
import {
  getSql, ensureSoundSchema,
  resolveGcsEnv, buildSoundObjectName, uploadToGcs, gcsObjectExists,
  elevenLabsTts, pickGeminiVoiceName, normalizeGeminiTtsModel, synthesizeGeminiDirected, GEMINI_TTS_API_MODEL,
} from "./_shared";
import { resolveCharacterVoice, CHARACTER_PREFIX } from "./_character-voices";

// 미리듣기 고정 멘트. 바꾸면 PREVIEW_REV 를 올려 기존 캐시 파일과 겹치지 않게 한다.
export const PREVIEW_LINE = "안녕하세요, 오늘은 이 목소리로 이야기를 들려드릴게요.";
const PREVIEW_REV = "v1";

export class VoiceSampleError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export type VoiceSampleGcs = { bucket: string; object: string; clientEmail: string; privateKeyPem: string; userProject: string };
export type VoiceSample = {
  line: string;
  cached: boolean;
  contentType: string;
  /** 캐시 파일 위치(있으면 이쪽을 쓴다) */
  gcs: VoiceSampleGcs | null;
  /** 캐시에 올리지 못했을 때만 채워진다 */
  bytes: Uint8Array | null;
};

// 캐릭터 지시문을 고치면 캐시 이름이 바뀌어 새 샘플이 만들어지도록 짧은 해시를 붙인다.
async function shortHash(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).slice(0, 4).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function loadVoiceSample(env: any, providerRaw: string, rawVoiceIn: string): Promise<VoiceSample> {
  const provider = String(providerRaw || "").trim() === "elevenlabs" ? "elevenlabs" : "gemini";
  const rawVoice = String(rawVoiceIn || "").trim();
  if (!rawVoice) throw new VoiceSampleError("voice required", 400);

  // 캐시 파일 이름에 모델을 넣어, 모델이 바뀌면 새 샘플을 만든다.
  let voice = rawVoice;
  let cacheId = "";
  let ext: "mp3" | "wav" = "wav";
  if (provider === "gemini") {
    const ch = resolveCharacterVoice(rawVoice);
    if (rawVoice.startsWith(CHARACTER_PREFIX) && !ch) throw new VoiceSampleError("unknown voice", 404);
    voice = ch ? rawVoice : pickGeminiVoiceName(rawVoice);
    const tag = ch ? `char-${ch.id}-${await shortHash(ch.base + "|" + ch.persona)}` : voice;
    cacheId = `gemini_${tag}_${GEMINI_TTS_API_MODEL}_${PREVIEW_REV}`;
  } else {
    // 임의 ID 로 합성을 반복시키지 못하게 등록된 보이스만 허용한다.
    const sql = getSql(env);
    if (!sql) throw new VoiceSampleError("voice lookup unavailable", 500);
    try { await ensureSoundSchema(sql); } catch (_) {}
    const rows = await sql(`SELECT 1 FROM voices WHERE provider_voice_id = $1 LIMIT 1`, [rawVoice]);
    if (!rows.length) throw new VoiceSampleError("unknown voice", 404);
    cacheId = `eleven_${rawVoice}_eleven_multilingual_v2_${PREVIEW_REV}`;
    ext = "mp3";
  }

  const gcs = resolveGcsEnv(env);
  const gcsAuth: VoiceSampleGcs | null = gcs
    ? {
      bucket: gcs.bucket, object: buildSoundObjectName(gcs.basePrefix, "voice-previews", "", cacheId, ext),
      clientEmail: gcs.clientEmail, privateKeyPem: gcs.privateKey, userProject: gcs.userProject || "",
    }
    : null;
  const cachedType = ext === "mp3" ? "audio/mpeg" : "audio/wav";

  if (gcsAuth) {
    try {
      if (await gcsObjectExists({ ...gcsAuth, userProject: gcsAuth.userProject || undefined })) {
        return { line: PREVIEW_LINE, cached: true, contentType: cachedType, gcs: gcsAuth, bytes: null };
      }
    } catch (_) {}
  }

  // 캐시에 없을 때만 한 번 합성한다.
  let bytes: Uint8Array;
  let contentType: string;
  let cacheable = true;
  if (provider === "gemini") {
    const googleClientEmail = String(env.TTS_GOOGLE_CLIENT_EMAIL || env.GOOGLE_CLIENT_EMAIL || "").trim();
    const googlePrivateKey = String(env.TTS_GOOGLE_PRIVATE_KEY || env.GOOGLE_PRIVATE_KEY || "").trim();
    const g = await synthesizeGeminiDirected({
      env,
      apiKey: String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "").trim(),
      direction: "",
      cloud: (googleClientEmail && googlePrivateKey) ? {
        clientEmail: googleClientEmail,
        privateKeyPem: googlePrivateKey,
        userProject: String(env.GCS_BILLING_PROJECT_ID || env.GOOGLE_PROJECT_ID || "").trim(),
        modelName: normalizeGeminiTtsModel(String(env.GEMINI_TTS_MODEL || "").trim()),
      } : null,
      segments: [{ providerVoiceId: voice, text: PREVIEW_LINE }],
    });
    bytes = g.wav;
    contentType = "audio/wav";
    // 폴백 엔진으로 만든 샘플은 캐시하지 않는다 — 주 모델이 살아나면 그 목소리로 다시 만들어야 한다.
    cacheable = g.engine === GEMINI_TTS_API_MODEL;
  } else {
    const key = String(env.ELEVENLABS_API_KEY || "").trim();
    if (!key) throw new VoiceSampleError("ELEVENLABS_API_KEY not configured", 500);
    bytes = await elevenLabsTts({ apiKey: key, voiceId: voice, text: PREVIEW_LINE, modelId: "eleven_multilingual_v2", stability: 0.5, outputFormat: "mp3_44100_128" });
    contentType = "audio/mpeg";
  }

  if (gcsAuth && cacheable) {
    try {
      const ok = await uploadToGcs({ ...gcsAuth, bytes, contentType, userProject: gcsAuth.userProject || undefined });
      if (ok) return { line: PREVIEW_LINE, cached: false, contentType, gcs: gcsAuth, bytes: null };
    } catch (_) {}
  }
  return { line: PREVIEW_LINE, cached: false, contentType, gcs: null, bytes };
}
