// prototype/functions/api/video/lipsync.ts
// 립싱크 작업 생성 — Atlas Cloud (2026-09-29 Kling 직접 호출에서 이전: Kling 키 없이 영상 생성과 같은 Atlas 키·정산을 쓴다).
// 입력:
//   - videoUrl : 입이 움직일 인물 영상(https·gs://·data:)
//   - model    : "veed"(기본, VEED Lipsync $0.0132/초) | "sync"(고급, Sync.so Lipsync v3 $0.22/초)
//   - mode = "audio2video": audioUrl 또는 audioDataUrl (MP3·WAV·M4A)
//   - mode = "text2video" : text(최대 120자) + voiceId(Gemini 보이스 이름, 없으면 Kore) → 우리 TTS 로 음성을 먼저 만든다
//   - syncMode(Sync.so 만): cut_off(기본)·loop·bounce·silence·remap — 영상·음성 길이가 다를 때 처리
// 반환: { job_id: "lipsync-atlas:<prediction id>" } — 폴링은 /api/video/status(Atlas 공용 경로).
// 과금: 음성 길이 기준. 접수 직전에 보낼 요청 그대로 Atlas 공식 견적(calculate)을 받아 예약액을 그 가격으로 줄이고,
//       완료되면 확정·실패하면 전액 환불(상태 조회·서버 정산). 텍스트 방식은 TTS 사용량도 더한다.

import { authorizeRequest } from "../_shared/auth.js";
import { withCreditCharge } from "../_shared/credits";
import { atlasKeyFor } from "../_shared/generation-auth";
import { sanitizeUserId, buildUserRoot } from "../_shared/storage";
import { atlasCalculateUsd, LIPSYNC_MODELS, lipsyncModelOf, recordCost, recordUnpriced } from "../_shared/usage-cost.ts";
import {
  resolveGcsEnv, uploadToGcs, signGcsUrl, synthesizeGeminiDirected, normalizeGeminiTtsModel, parseGcsUri,
} from "../sound/_shared";

(globalThis as any).g = globalThis;
type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;
const log = (...args: any[]) => console.log("[video-lipsync]", ...args);

const SYNC_MODES = ["cut_off", "loop", "bounce", "silence", "remap"];
const MEDIA_MIMES: Record<string, string> = {
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
  "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a",
};

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]+)[^,]*,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime: m[1].toLowerCase() };
}

const handlePost: PagesFunction = async ({ request, env }) => {
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const body = await request.json().catch(() => ({} as any));
    const mode = String(body?.mode || (body?.audioUrl || body?.audioDataUrl ? "audio2video" : "text2video"));
    const videoUrlRaw = String(body?.videoUrl || "").trim();
    const lip = LIPSYNC_MODELS[lipsyncModelOf(body?.model || body?.quality)];
    if (!videoUrlRaw) return json({ error: "videoUrl required", detail: "입을 맞출 인물 영상(videoUrl)이 필요해요." }, 400);
    if (mode !== "text2video" && mode !== "audio2video") return json({ error: "unsupported_mode", detail: mode }, 400);

    const atlasKey = (await atlasKeyFor(env, auth.userId)).key;
    if (!atlasKey) return json({ error: "ATLASCLOUD_API_KEY missing" }, 500);
    const gcs = resolveGcsEnv(env);
    if (!gcs) return json({ error: "gcs_not_configured" }, 500);
    const userRoot = buildUserRoot(gcs.basePrefix, sanitizeUserId(auth.userId));
    const stamp = Date.now();

    // 공급자는 공개 URL 을 받는다: gs:// 는 서명, data: 는 GCS 에 올린 뒤 서명.
    const toPublicUrl = async (src: string, name: string): Promise<string> => {
      const s = String(src || "").trim();
      if (/^https:\/\//i.test(s)) return s;
      if (s.startsWith("gs://")) {
        const parsed = parseGcsUri(s);
        if (!parsed) throw new Error("invalid_gcs_uri");
        return await signGcsUrl({ bucket: parsed.bucket, object: parsed.object, clientEmail: gcs.clientEmail, privateKeyPem: gcs.privateKey, expiresInSec: 3600 });
      }
      if (s.startsWith("data:")) {
        const d = dataUrlToBytes(s);
        const ext = d && MEDIA_MIMES[d.mime];
        if (!d || !ext) throw new Error(`unsupported_media_mime: ${d ? d.mime : "unknown"}`);
        const object = `${userRoot}/lipsync/${stamp}-${name}.${ext}`;
        const ok = await uploadToGcs({ bucket: gcs.bucket, object, bytes: d.bytes, contentType: d.mime, clientEmail: gcs.clientEmail, privateKeyPem: gcs.privateKey, userProject: gcs.userProject || undefined });
        if (!ok) throw new Error("media_upload_failed");
        return await signGcsUrl({ bucket: gcs.bucket, object, clientEmail: gcs.clientEmail, privateKeyPem: gcs.privateKey, expiresInSec: 3600 });
      }
      throw new Error("unsupported_media_source");
    };

    const videoUrl = await toPublicUrl(videoUrlRaw, "video");
    let audioUrl = "";
    if (mode === "audio2video") {
      const audioSrc = String(body?.audioDataUrl || body?.audioUrl || "").trim();
      if (!audioSrc) return json({ error: "audio required for audio2video" }, 400);
      audioUrl = await toPublicUrl(audioSrc, "audio");
    } else {
      // 텍스트 방식: 우리 TTS(Gemini)로 음성을 먼저 만든다. TTS 사용량은 계량기에 기록된다.
      const text = String(body?.text || "").trim().slice(0, 120);
      if (!text) return json({ error: "text required for text2video", detail: "대사(최대 120자)가 필요해요." }, 400);
      const geminiApiKey = String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "").trim();
      const tts = await synthesizeGeminiDirected({
        env,
        apiKey: geminiApiKey,
        direction: String(body?.direction || ""),
        cloud: {
          clientEmail: gcs.clientEmail,
          privateKeyPem: gcs.privateKey,
          userProject: String(env.GCS_BILLING_PROJECT_ID || env.GOOGLE_PROJECT_ID || "").trim(),
          modelName: normalizeGeminiTtsModel(String(env.GEMINI_TTS_MODEL || "").trim()),
        },
        segments: [{ providerVoiceId: String(body?.voiceId || "Kore"), text }],
      });
      const object = `${userRoot}/lipsync/${stamp}-tts.wav`;
      const ok = await uploadToGcs({ bucket: gcs.bucket, object, bytes: tts.wav, contentType: "audio/wav", clientEmail: gcs.clientEmail, privateKeyPem: gcs.privateKey, userProject: gcs.userProject || undefined });
      if (!ok) return json({ error: "tts_upload_failed" }, 500);
      audioUrl = await signGcsUrl({ bucket: gcs.bucket, object, clientEmail: gcs.clientEmail, privateKeyPem: gcs.privateKey, expiresInSec: 3600 });
    }

    const atlasBody: Record<string, unknown> = { model: lip.atlasModel, video_url: videoUrl, audio_url: audioUrl };
    if (lip.atlasModel === "sync/lipsync-v3") {
      const sm = String(body?.syncMode || "cut_off");
      atlasBody.sync_mode = SYNC_MODES.includes(sm) ? sm : "cut_off";
    }

    // 실제 사용량 정산: 보낼 요청 그대로 Atlas 공식 견적(음성 길이 반영)을 받는다. 접수되면 예약액을 이 가격으로 줄인다.
    const quotedUsd = await atlasCalculateUsd(atlasKey, atlasBody);
    log("request", { model: lip.atlasModel, mode, quotedUsd });
    const res = await fetch("https://api.atlascloud.ai/api/v1/model/generateVideo", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${atlasKey}` },
      body: JSON.stringify(atlasBody),
    });
    const text = await res.text();
    const jsonBody = safeJson(text);
    if (!res.ok) return json({ error: "lipsync_error", status: res.status, detail: jsonBody, model: lip.atlasModel }, res.status);
    const predictionId = jsonBody?.data?.id || jsonBody?.id || jsonBody?.prediction_id || "";
    if (!predictionId) return json({ error: "lipsync_no_prediction_id", raw: jsonBody }, 500);
    if (quotedUsd === null) recordUnpriced(env, "atlas_lipsync", { model: lip.atlasModel, reason: "calculate_unavailable" });
    else recordCost(env, "atlas_lipsync", quotedUsd, { model: lip.atlasModel });
    return json({ job_id: `lipsync-atlas:${predictionId}`, status: "processing", model: lip.atlasModel, label: lip.label }, 202);
  } catch (e: any) {
    const msg = String(e?.message || e || "Unknown error");
    log("catch", msg);
    if (/unsupported_media_mime|unsupported_media_source|invalid_gcs_uri/.test(msg)) {
      return json({ error: "unsupported_media", detail: `${msg} — 영상은 mp4·mov·webm, 음성은 mp3·wav·m4a(https·gs·data)만 받아요.` }, 400);
    }
    return json({ error: msg }, 500);
  }
};

export const onRequestPost: PagesFunction = async (context) =>
  withCreditCharge(context, { feature: "video_lipsync", deferAccepted: true, metered: true }, handlePost);

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}
