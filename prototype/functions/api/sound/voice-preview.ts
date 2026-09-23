/**
 * POST /api/sound/voice-preview
 * 보이스 미리듣기 샘플. 보이스마다 고정 멘트 하나를 한 번만 합성해 GCS 공용 경로에 저장하고,
 * 이후 요청은 저장된 파일의 서명 URL 만 돌려준다(재생성·크레딧 차감 없음).
 *
 * Request:  { provider: "gemini" | "elevenlabs", voice: <Gemini 보이스 이름 | ElevenLabs voice id> }
 * Response: { url, line, cached }
 *
 * 샘플은 사용자와 무관하게 보이스마다 같으므로 사용자 경로가 아닌 {basePrefix}/sound/voice-previews/ 에 둔다.
 * 합성은 보이스당 한 번뿐이라 플랫폼 부담으로 두고 크레딧을 받지 않는다.
 */
import { authorizeRequest } from "../_shared/auth.js";
import {
  corsHeaders, send, getSql, ensureSoundSchema,
  resolveGcsEnv, buildSoundObjectName, uploadToGcs, signGcsUrl, gcsObjectExists, bytesToDataUrl,
  elevenLabsTts, pickGeminiVoiceName, normalizeGeminiTtsModel, synthesizeGeminiDirected, GEMINI_TTS_API_MODEL,
} from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

// 미리듣기 고정 멘트. 바꾸면 PREVIEW_REV 를 올려 기존 캐시 파일과 겹치지 않게 한다.
const PREVIEW_LINE = "안녕하세요, 오늘은 이 목소리로 이야기를 들려드릴게요.";
const PREVIEW_REV = "v1";
const SIGN_TTL_SEC = 6 * 3600;

const handlePost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env, { allowQueryToken: true });
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    let body: any = {};
    try { body = JSON.parse(await request.text()); } catch { body = {}; }
    const provider = String(body.provider || "").trim() === "elevenlabs" ? "elevenlabs" : "gemini";
    const rawVoice = String(body.voice || "").trim();
    if (!rawVoice) return send({ error: "voice required" }, 400, origin);

    // 캐시 파일 이름에 모델을 넣어, 모델이 바뀌면 새 샘플을 만든다.
    let voice = rawVoice;
    let cacheId = "";
    let ext: "mp3" | "wav" = "wav";
    if (provider === "gemini") {
      voice = pickGeminiVoiceName(rawVoice);
      cacheId = `gemini_${voice}_${GEMINI_TTS_API_MODEL}_${PREVIEW_REV}`;
    } else {
      // 임의 ID 로 합성을 반복시키지 못하게 등록된 보이스만 허용한다.
      const sql = getSql(env);
      if (!sql) return send({ error: "voice lookup unavailable" }, 500, origin);
      try { await ensureSoundSchema(sql); } catch (_) {}
      const rows = await sql(`SELECT 1 FROM voices WHERE provider_voice_id = $1 LIMIT 1`, [rawVoice]);
      if (!rows.length) return send({ error: "unknown voice" }, 404, origin);
      cacheId = `eleven_${rawVoice}_eleven_multilingual_v2_${PREVIEW_REV}`;
      ext = "mp3";
    }

    const gcs = resolveGcsEnv(env);
    const objectName = gcs ? buildSoundObjectName(gcs.basePrefix, "voice-previews", "", cacheId, ext) : "";
    const gcsAuth = gcs ? { bucket: gcs.bucket, object: objectName, clientEmail: gcs.clientEmail, privateKeyPem: gcs.privateKey } : null;

    if (gcsAuth) {
      try {
        if (await gcsObjectExists({ ...gcsAuth, userProject: gcs!.userProject || undefined })) {
          const url = await signGcsUrl({ ...gcsAuth, expiresInSec: SIGN_TTL_SEC });
          return send({ url, line: PREVIEW_LINE, cached: true }, 200, origin);
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
      if (!key) return send({ error: "ELEVENLABS_API_KEY not configured" }, 500, origin);
      bytes = await elevenLabsTts({ apiKey: key, voiceId: voice, text: PREVIEW_LINE, modelId: "eleven_multilingual_v2", stability: 0.5, outputFormat: "mp3_44100_128" });
      contentType = "audio/mpeg";
    }

    if (gcsAuth && cacheable) {
      try {
        const ok = await uploadToGcs({ ...gcsAuth, bytes, contentType, userProject: gcs!.userProject || undefined });
        if (ok) {
          const url = await signGcsUrl({ ...gcsAuth, expiresInSec: SIGN_TTL_SEC });
          return send({ url, line: PREVIEW_LINE, cached: false }, 200, origin);
        }
      } catch (_) {}
    }
    return send({ url: bytesToDataUrl(bytes, contentType), line: PREVIEW_LINE, cached: false }, 200, origin);
  } catch (e: any) {
    return send({ error: String(e?.message || e || "voice_preview_error") }, 500, origin);
  }
};

export const onRequestPost: PagesFunction = handlePost;

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
