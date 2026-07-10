/**
 * POST /api/sound/voice-generate
 * 다중 세그먼트 TTS 생성 → 세그먼트별 ElevenLabs 호출 후 병합(방식 ①) → GCS 업로드 → sound_assets 레코드.
 *
 * Request:
 *   { mode, brandId?, episodeId?, sessionId?, model, format, stability,
 *     segments: [{ voiceId?, providerVoiceId?, text, speaker? }] }
 * Response:
 *   { assetId, status, outputUrl, creditsUsed }
 *
 * 다중 세그먼트 합성 방식은 추후 ElevenLabs Dialogue/Studio로 교체 가능하도록 synthesizeSegments()로 분리.
 */
import { authorizeRequest } from "../_shared/auth.js";
import { sanitizeUserId, buildUserRoot } from "../_shared/storage";
import {
  corsHeaders, send, getSql, ensureSoundSchema,
  resolveGcsEnv, buildSoundObjectName, uploadToGcs, signGcsUrl,
  elevenLabsTts, concatMp3, bytesToDataUrl,
  geminiTts, pickGeminiVoiceName, normalizeGeminiTtsModel, splitEmotionTags, buildGeminiPrompt,
} from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

interface SegIn { voiceId?: string; providerVoiceId?: string; text?: string; speaker?: string; }

// 세그먼트별 합성 + 병합. (추후 ElevenLabs Dialogue 엔드포인트로 교체 가능)
async function synthesizeSegments(opts: {
  apiKey: string; segments: Array<{ providerVoiceId: string; text: string }>;
  model: string; stability: number; format: string;
}): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for (const seg of opts.segments) {
    const bytes = await elevenLabsTts({
      apiKey: opts.apiKey,
      voiceId: seg.providerVoiceId,
      text: seg.text,
      modelId: opts.model,
      stability: opts.stability,
      outputFormat: opts.format,
    });
    parts.push(bytes);
  }
  return concatMp3(parts);
}

// Gemini TTS(Cloud Text-to-Speech) 세그먼트별 합성 + 병합. 감정 태그는 스타일 프롬프트로 전달.
async function synthesizeSegmentsGemini(opts: {
  clientEmail: string; privateKeyPem: string; userProject: string; modelName: string;
  segments: Array<{ providerVoiceId: string; text: string }>;
}): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for (const seg of opts.segments) {
    const { clean, tags } = splitEmotionTags(seg.text);
    const bytes = await geminiTts({
      clientEmail: opts.clientEmail,
      privateKeyPem: opts.privateKeyPem,
      userProject: opts.userProject || undefined,
      text: clean,
      prompt: buildGeminiPrompt(tags),
      voiceName: pickGeminiVoiceName(seg.providerVoiceId),
      modelName: opts.modelName,
    });
    parts.push(bytes);
  }
  return concatMp3(parts);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env, { allowQueryToken: true });
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    let body: any = {};
    try { body = JSON.parse(await request.text()); } catch { body = {}; }

    const mode = String(body.mode || "instance").trim() === "project" ? "project" : "instance";
    const brandId = String(body.brandId || "").trim() || null;
    const episodeId = String(body.episodeId || "").trim() || null;
    const sessionId = String(body.sessionId || "").trim() || null;
    const model = String(body.model || "eleven_v3").trim();
    const format = String(body.format || "mp3_44100_128").trim();
    const stability = Number(body.stability);
    const stabilityVal = Number.isFinite(stability) ? stability : 0.5;

    const rawSegments: SegIn[] = Array.isArray(body.segments) ? body.segments : [];
    const segIn = rawSegments
      .map((s) => ({ voiceId: String(s.voiceId || "").trim(), providerVoiceId: String(s.providerVoiceId || "").trim(), text: String(s.text || "").trim(), speaker: String(s.speaker || "").trim() }))
      .filter((s) => s.text);
    if (!segIn.length) return send({ error: "at least one non-empty segment required" }, 400, origin);

    // 모델 접두사로 프로바이더 결정 — gemini_tts는 Cloud Gemini-TTS, 그 외는 ElevenLabs.
    const isGemini = model.toLowerCase().startsWith("gemini");
    const provider = isGemini ? "gemini" : "elevenlabs";

    const elevenLabsKey = String(env.ELEVENLABS_API_KEY || "").trim();
    if (!isGemini && !elevenLabsKey) return send({ error: "ELEVENLABS_API_KEY not configured" }, 500, origin);

    const googleClientEmail = String(env.TTS_GOOGLE_CLIENT_EMAIL || env.GOOGLE_CLIENT_EMAIL || "").trim();
    const googlePrivateKey = String(env.TTS_GOOGLE_PRIVATE_KEY || env.GOOGLE_PRIVATE_KEY || "").trim();
    if (isGemini && (!googleClientEmail || !googlePrivateKey)) {
      return send({ error: "TTS_GOOGLE_CLIENT_EMAIL/TTS_GOOGLE_PRIVATE_KEY not configured" }, 500, origin);
    }

    const sql = getSql(env);
    if (sql) { try { await ensureSoundSchema(sql); } catch (_) {} }

    // voiceId(UUID) → provider_voice_id 해석 (DB 사용 가능 시). 없으면 클라이언트 providerVoiceId 사용.
    // Gemini 보이스는 DB에 없는 프리셋(providerVoiceId = 보이스 이름)이라 조회하지 않는다.
    const idToProvider: Record<string, string> = {};
    if (sql && !isGemini) {
      const uuids = Array.from(new Set(segIn.map((s) => s.voiceId).filter((v) => UUID_RE.test(v))));
      if (uuids.length) {
        try {
          const placeholders = uuids.map((_, i) => `$${i + 1}::uuid`).join(",");
          const rows = await sql(`SELECT id, provider_voice_id FROM voices WHERE id IN (${placeholders})`, uuids);
          for (const r of rows) idToProvider[String(r.id)] = String(r.provider_voice_id || "");
        } catch (_) {}
      }
    }

    const segments = segIn.map((s) => ({
      providerVoiceId: isGemini
        ? (s.providerVoiceId || "Kore")
        : ((s.voiceId && idToProvider[s.voiceId]) || s.providerVoiceId || "21m00Tcm4TlvDq8ikWAM"),
      text: s.text,
    }));

    const totalChars = segments.reduce((n, s) => n + s.text.length, 0);
    const creditsUsed = totalChars; // ElevenLabs는 문자 기준 과금 — 대략값으로 문자 수 사용

    // 합성
    const merged = isGemini
      ? await synthesizeSegmentsGemini({
          clientEmail: googleClientEmail,
          privateKeyPem: googlePrivateKey,
          userProject: String(env.GCS_BILLING_PROJECT_ID || env.GOOGLE_PROJECT_ID || "").trim(),
          modelName: normalizeGeminiTtsModel(String(env.GEMINI_TTS_MODEL || "").trim()),
          segments,
        })
      : await synthesizeSegments({ apiKey: elevenLabsKey, segments, model, stability: stabilityVal, format });

    // GCS 업로드
    const assetId = "snd_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const gcs = resolveGcsEnv(env);
    const userId = sanitizeUserId(auth.userId);
    let outputUrl = "";
    let uploaded = false;
    let objectName = "";
    if (gcs) {
      const userRoot = buildUserRoot(gcs.basePrefix, userId);
      const scopeKey = mode === "project" ? (brandId || "project") : (sessionId || "instance");
      objectName = buildSoundObjectName(userRoot, "voices", scopeKey, assetId);
      try {
        uploaded = await uploadToGcs({
          bucket: gcs.bucket, object: objectName, bytes: merged, contentType: "audio/mpeg",
          clientEmail: gcs.clientEmail, privateKeyPem: gcs.privateKey, userProject: gcs.userProject || undefined,
        });
        if (uploaded) {
          outputUrl = await signGcsUrl({ bucket: gcs.bucket, object: objectName, clientEmail: gcs.clientEmail, privateKeyPem: gcs.privateKey, expiresInSec: 3600 });
        }
      } catch (_) {}
    }
    if (!outputUrl) outputUrl = bytesToDataUrl(merged); // 업로드 실패/미구성 폴백

    // sound_assets 레코드 (preview 샘플은 히스토리에 남기지 않음)
    const isPreview = !!body.preview;
    let recordId = assetId;
    if (sql && !isPreview) {
      try {
        const textContent = segIn.map((s) => s.text).join("\n").slice(0, 4000);
        const rows = await sql(
          `INSERT INTO sound_assets
             (type, scope, brand_id, episode_id, session_id, title, text_content, segments, voice_id, provider, model, params, output_url, output_format, credits_used, status)
           VALUES ('voice', $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11::jsonb, $12, $13, $14, 'ready')
           RETURNING id`,
          [
            mode, brandId, episodeId, sessionId,
            (segIn[0] && segIn[0].text ? segIn[0].text.slice(0, 60) : "음성"),
            textContent,
            JSON.stringify(segIn),
            (segIn[0] && UUID_RE.test(segIn[0].voiceId)) ? segIn[0].voiceId : null,
            provider,
            model,
            JSON.stringify({ stability: stabilityVal, format, objectName }),
            outputUrl, format, creditsUsed,
          ]
        );
        if (rows && rows[0]) recordId = String(rows[0].id);
      } catch (_) {}
    }

    return send({ assetId: recordId, status: "ready", outputUrl, creditsUsed }, 200, origin);
  } catch (e: any) {
    return send({ error: String(e?.message || e || "voice_generate_error") }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
