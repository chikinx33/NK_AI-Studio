/**
 * POST /api/sound/sfx-generate
 * 효과음 생성 (ElevenLabs Sound Effects) → GCS 업로드 → sound_assets 레코드.
 *
 * Request:
 *   { mode, brandId?, episodeId?, sessionId?, prompt, duration?, looping?, influence? }
 * Response:
 *   { assetId, status, outputUrl, creditsUsed }
 */
import { authorizeRequest } from "../_shared/auth.js";
import { sanitizeUserId, buildUserRoot } from "../_shared/storage";
import { withCreditCharge } from "../_shared/credits";
import {
  corsHeaders, send, getSql, ensureSoundSchema,
  resolveGcsEnv, buildSoundObjectName, uploadToGcs, signGcsUrl,
  elevenLabsSfx, bytesToDataUrl,
} from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const handlePost: PagesFunction = async ({ request, env }) => {
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
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return send({ error: "prompt required" }, 400, origin);
    const duration = Math.min(22, Math.max(0.5, Number(body.duration) || 5));
    const looping = !!body.looping;
    const influence = Number.isFinite(Number(body.influence)) ? Number(body.influence) : 0.3;

    const elevenLabsKey = String(env.ELEVENLABS_API_KEY || "").trim();
    if (!elevenLabsKey) return send({ error: "ELEVENLABS_API_KEY not configured" }, 500, origin);

    // ElevenLabs SFX 생성
    const audioBytes = await elevenLabsSfx({ apiKey: elevenLabsKey, prompt, durationSec: duration, promptInfluence: influence, looping });
    const creditsUsed = Math.round(duration * 40); // 대략값(초당 ~40 크레딧)

    // GCS 업로드
    const assetId = "sfx_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const gcs = resolveGcsEnv(env);
    const userId = sanitizeUserId(auth.userId);
    let outputUrl = "";
    let objectName = "";
    if (gcs) {
      const userRoot = buildUserRoot(gcs.basePrefix, userId);
      const scopeKey = mode === "project" ? (brandId || "project") : (sessionId || "instance");
      objectName = buildSoundObjectName(userRoot, "sfx", scopeKey, assetId);
      try {
        const ok = await uploadToGcs({
          bucket: gcs.bucket, object: objectName, bytes: audioBytes, contentType: "audio/mpeg",
          clientEmail: gcs.clientEmail, privateKeyPem: gcs.privateKey, userProject: gcs.userProject || undefined,
        });
        if (ok) outputUrl = await signGcsUrl({ bucket: gcs.bucket, object: objectName, clientEmail: gcs.clientEmail, privateKeyPem: gcs.privateKey, expiresInSec: 3600 });
      } catch (_) {}
    }
    if (!outputUrl) outputUrl = bytesToDataUrl(audioBytes);

    // sound_assets 레코드
    let recordId = assetId;
    const sql = getSql(env);
    if (sql) {
      try {
        await ensureSoundSchema(sql);
        const rows = await sql(
          `INSERT INTO sound_assets
             (owner_id, type, scope, brand_id, episode_id, session_id, title, prompt, provider, params, output_url, output_format, duration_seconds, credits_used, status)
           VALUES ($1, 'sfx', $2, $3, $4, $5, $6, $7, 'elevenlabs', $8::jsonb, $9, 'mp3_44100_128', $10, $11, 'ready')
           RETURNING id`,
          [
            userId, mode, brandId, episodeId, sessionId,
            prompt.slice(0, 60), prompt,
            JSON.stringify({ duration, looping, influence, objectName }),
            outputUrl, duration, creditsUsed,
          ]
        );
        if (rows && rows[0]) recordId = String(rows[0].id);
      } catch (_) {}
    }

    return send({ assetId: recordId, status: "ready", outputUrl, creditsUsed }, 200, origin);
  } catch (e: any) {
    return send({ error: String(e?.message || e || "sfx_generate_error") }, 500, origin);
  }
};

export const onRequestPost: PagesFunction = async (context) =>
  withCreditCharge(context, { feature: "sfx" }, handlePost);

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
