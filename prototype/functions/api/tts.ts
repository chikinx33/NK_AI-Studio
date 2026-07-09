import { buildAiVideoProjectPrefix } from "./_shared/storage";
import { authorizeRequest } from "./_shared/auth.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const corsHeaders = (origin?: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Vary": "Origin",
});
const send = (data: any, status = 200, origin?: string | null) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });

const VOICE_MAP: Record<string, { languageCode: string; name: string }> = {
  kr_female_narration: { languageCode: "ko-KR", name: "ko-KR-Neural2-A" },
  kr_male_narration: { languageCode: "ko-KR", name: "ko-KR-Neural2-B" }
};
const GEMINI_TTS_VOICES = new Set([
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede",
  "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
  "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"
]);

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env, { allowQueryToken: true });
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const text = await request.text();
    let body: any = {};
    try { body = JSON.parse(text || "{}"); } catch { body = {}; }
    const projectId = String(body.projectId || "").trim();
    const sceneId = String(body.sceneId || "").trim();
    const scriptRaw = String(body.script || "").trim();
    const voiceId = String(body.voiceId || "kr_female_narration").trim();
    if (!projectId || !sceneId || !scriptRaw) {
      return send({ error: "projectId, sceneId and script are required" }, 400, origin);
    }
    const script = scriptRaw.slice(0, 5000);
    const rateNum = Number(body.speakingRate || 1.05);
    const pitchNum = Number(body.pitch || 2);
    const promptRaw = String(body.prompt || "").trim();
    const voiceNameRaw = String(body.voiceName || "").trim();
    const geminiVoiceName = pickGeminiVoiceName(String(body.geminiVoiceName || body.geminiVoice || "").trim());
    const finalPrompt = promptRaw || derivePromptFromVoice(voiceNameRaw || voiceId);
    const strictCloudGeminiTts = body.strictCloudGeminiTts === true;

    const clientEmail = (env.TTS_GOOGLE_CLIENT_EMAIL || env.GOOGLE_CLIENT_EMAIL) as string | undefined;
    const privateKeyRaw = (env.TTS_GOOGLE_PRIVATE_KEY || env.GOOGLE_PRIVATE_KEY) as string | undefined;
    const baseOutput = (env.AUDIO_OUTPUT_GCS_URI as string | undefined) || (env.VIDEO_OUTPUT_GCS_URI as string | undefined);
    if (!clientEmail || !privateKeyRaw || !baseOutput) {
      return send({ error: "Missing TTS_GOOGLE_CLIENT_EMAIL/TTS_GOOGLE_PRIVATE_KEY or GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY, and AUDIO_OUTPUT_GCS_URI|VIDEO_OUTPUT_GCS_URI" }, 500, origin);
    }
    const outParsed = parseGcsUri(baseOutput);
    if (!outParsed) return send({ error: "Invalid AUDIO_OUTPUT_GCS_URI|VIDEO_OUTPUT_GCS_URI" }, 500, origin);
    const basePrefix = outParsed.object.replace(/\/$/, "");
    const userId: string = String(auth.userId || "").trim() || "owner";
    const projectIdStr: string = String(projectId || "").trim();
    const projectPrefix = buildAiVideoProjectPrefix(basePrefix, userId, projectIdStr);
    const baseObjectName = `${projectPrefix}/sfx/voice-${sceneId}`;
    const userProjectRaw =
      (env.GCS_BILLING_PROJECT_ID as string | undefined) ||
      (env.GOOGLE_PROJECT_ID as string | undefined) ||
      "";
    const userProject = String(userProjectRaw || "").trim();
    const validProjectId = /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/; // GCP project ID 형식
    const validProjectNum = /^[0-9]{6,20}$/; // project number 형식
    if (userProject && !(validProjectId.test(userProject) || validProjectNum.test(userProject))) {
      return send({ error: "invalid_user_project", hint: "Set GCS_BILLING_PROJECT_ID to a valid project ID or number" }, 500, origin);
    }

    const token = await getGoogleAccessToken({
      clientEmail: clientEmail as string,
      privateKeyPem: privateKeyRaw as string,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });
    let audioInfo = null as null | { data: string; mime: string };
    let cloudTtsError: any = null;
    const wantDebug = !!body.debug;

    try {
      const cloudModel = normalizeCloudGeminiTtsModel(String(env.GEMINI_TTS_MODEL || "").trim());
      const cloud = await synthesizeViaCloudGeminiTts({
        token,
        text: script,
        prompt: finalPrompt || "Say the following in a natural Korean voice.",
        languageCode: "ko-KR",
        voiceName: geminiVoiceName,
        modelName: cloudModel,
        userProject,
      });
      audioInfo = { data: cloud.base64, mime: cloud.mime };
    } catch (e: any) {
      cloudTtsError = e;
      try {
        console.warn("cloud_gemini_tts_failed", String(e && e.message ? e.message : e));
      } catch (_) {}
    }
    if ((!audioInfo || !audioInfo.data) && strictCloudGeminiTts) {
      const cloudErrorText = String(cloudTtsError && cloudTtsError.message ? cloudTtsError.message : cloudTtsError);
      return send({
        error: "cloud_gemini_tts_failed",
        category: classifyCloudGeminiTtsError(cloudTtsError),
        hint: explainCloudGeminiTtsError(cloudTtsError),
        cloud_error: sanitizeCloudGeminiTtsError(cloudErrorText),
      }, 200, origin);
    }

    if (!audioInfo || !audioInfo.data) {
      const apiKey = String(env.GOOGLE_API_KEY || "").trim();
      const promptPlusScript = (finalPrompt || "Say the following in a natural Korean voice.") + "\n" + script;
      const reqBody = {
        contents: [
          {
            parts: [
              { text: promptPlusScript }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: geminiVoiceName
              }
            }
          }
        }
      };
      if (!apiKey) {
        return send({ error: "GOOGLE_API_KEY missing", cloud_error: String(cloudTtsError && cloudTtsError.message ? cloudTtsError.message : cloudTtsError) }, 500, origin);
      }
      const preferModel = String(env.GEMINI_TTS_MODEL || "").trim() || "gemini-2.5-flash-preview-tts";
      const chosenModel = await resolveTtsModel(apiKey, preferModel);
      const glBase = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(chosenModel)}:generateContent`;
      const glUrl = glBase + "?key=" + encodeURIComponent(apiKey);
      const glHeaders: any = { "Content-Type": "application/json" };
      console.log("TTS request model: " + chosenModel);
      console.log("TTS headers", glHeaders);
      if (glHeaders.Authorization) console.warn("Authorization header detected in TTS request");
      let synthRes = await fetch(glUrl, {
        method: "POST",
        headers: glHeaders,
        body: JSON.stringify(reqBody),
      });
      let synthText = await synthRes.text();
      if (wantDebug) {
        try {
          console.log("TTS raw response status", synthRes.status);
          console.log("TTS raw response length", synthText.length);
          console.log("TTS raw response preview", synthText.slice(0, 2048));
        } catch (_) {}
      }
      if (synthRes.ok) {
        const synthJson = safeJson(synthText) || {};
        audioInfo = extractGeminiAudio(synthJson);
      }
      if (!synthRes.ok || !audioInfo || !audioInfo.data) {
        const status = synthRes?.status || 502;
        const detail = synthText ? safeJson(synthText) : undefined;
        try {
          const vmap = VOICE_MAP[voiceId] || { languageCode: "ko-KR", name: "ko-KR-Neural2-A" };
          const v1 = await synthesizeViaGoogleTts({
            token,
            text: script,
            languageCode: vmap.languageCode,
            voiceName: vmap.name,
            speakingRate: rateNum,
            pitch: pitchNum
          });
          audioInfo = { data: v1.base64, mime: v1.mime };
        } catch (fallbackErr: any) {
          return send({
            error: "tts_failed",
            status,
            detail,
            cloud_error: String(cloudTtsError && cloudTtsError.message ? cloudTtsError.message : cloudTtsError),
            fallback_error: String(fallbackErr && fallbackErr.message ? fallbackErr.message : fallbackErr)
          }, status, origin);
        }
      }
    }
    if (!audioInfo || !audioInfo.data) {
      try {
        const vmap = VOICE_MAP[voiceId] || { languageCode: "ko-KR", name: "ko-KR-Neural2-A" };
        const v1 = await synthesizeViaGoogleTts({
          token,
          text: script,
          languageCode: vmap.languageCode,
          voiceName: vmap.name,
          speakingRate: rateNum,
          pitch: pitchNum
        });
        audioInfo = { data: v1.base64, mime: v1.mime };
      } catch (fallbackErr: any) {
        return send({ error: "tts_failed", fallback_error: String(fallbackErr && fallbackErr.message ? fallbackErr.message : fallbackErr) }, 502, origin);
      }
    }
    const audioContent = audioInfo.data;
    let audioBytes = base64ToBytes(audioContent);
    let sniff = sniffAudioFormat(audioBytes);
    const mimeFromModel = String(audioInfo.mime || "").toLowerCase();
    const isRawPcm = /pcm/.test(mimeFromModel) && sniff === "unknown";
    if (isRawPcm) {
      try {
        const sampleRate = Number(env.TTS_PCM_SAMPLE_RATE || 24000);
        const channels = Number(env.TTS_PCM_CHANNELS || 1);
        audioBytes = wrapPcmAsWav(audioBytes, sampleRate, channels);
        sniff = "wav";
      } catch (e) {
        console.warn("pcm_wrap_failed", e && (e as any).message ? (e as any).message : e);
      }
    }

    const looksMp3 = sniff === "mp3" || /mpeg|mp3/.test(mimeFromModel);
    const looksWav = sniff === "wav" || /wav|pcm/.test(mimeFromModel);
    const chosenExt = looksMp3 ? "mp3" : (looksWav ? "wav" : "wav");
    const objNameFinal = `${baseObjectName}.${chosenExt}`;
    const contentTypeFinal = chosenExt === "mp3" ? "audio/mpeg" : "audio/wav";
    const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(objNameFinal)}`;
    const upRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentTypeFinal,
        ...(userProject ? { "X-Goog-User-Project": userProject } : {}),
      },
      body: audioBytes,
    });
    const upText = await upRes.text();
    if (!upRes.ok) {
      const isRequesterPays = upRes.status === 403 && String(upText).toLowerCase().includes("requester pays");
      const dataUri = `data:${contentTypeFinal};base64,${audioContent}`;
      if (isRequesterPays) {
        return send({ voiceUrl: dataUri, format: chosenExt, objectName: objNameFinal, warning: "upload_failed_requester_pays" }, 200, origin);
      }
      return send({ voiceUrl: dataUri, format: chosenExt, objectName: objNameFinal, warning: "upload_failed" }, 200, origin);
    }

    let signedUrl: string | null = null;
    let signError: any = null;
    try {
      signedUrl = await signGcsUrl({
        bucket: outParsed.bucket,
        object: objNameFinal,
        clientEmail: clientEmail as string,
        privateKeyPem: privateKeyRaw as string,
        expiresInSec: 3600,
      });
    } catch (e: any) {
      signError = e;
      try {
        const hint = detectSignFailureHint(e);
        console.error("tts_sign_failed", { error: String(e && e.message ? e.message : e), hint });
      } catch (_) {}
    }
    if (signedUrl) {
      const debugMeta = wantDebug ? {
        sniff,
        mimeFromModel,
        chosenExt,
        sizeBytes: Number(audioBytes?.length || 0),
        headHex: Array.from(audioBytes?.slice(0, 16) || []).map(b => b.toString(16).padStart(2, "0")).join(""),
      } : undefined;
      return send({ voiceUrl: signedUrl, format: chosenExt, objectName: objNameFinal, debug: debugMeta }, 200, origin);
    }
    const dataUriFinal = `data:${contentTypeFinal};base64,${audioContent}`;
    const debugMeta2 = wantDebug ? {
      sniff,
      mimeFromModel,
      chosenExt,
      sizeBytes: Number(audioBytes?.length || 0),
      headHex: Array.from(audioBytes?.slice(0, 16) || []).map(b => b.toString(16).padStart(2, "0")).join(""),
    } : undefined;
    return send({ voiceUrl: dataUriFinal, format: chosenExt, objectName: objNameFinal, warning: "sign_failed", debug: debugMeta2 }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

function safeJson(text: string) { try { return JSON.parse(text); } catch { return text; } }
function pickGeminiVoiceName(v: string): string {
  const raw = String(v || "").trim();
  if (!raw) return "Kore";
  const hit = Array.from(GEMINI_TTS_VOICES).find((name) => name.toLowerCase() === raw.toLowerCase());
  return hit || "Kore";
}
function extractGeminiAudio(json: any): { data: string; mime: string } | null {
  try {
    const cands = json?.candidates || [];
    for (const c of cands) {
      const parts = c?.content?.parts || c?.content?.inlineData || c?.content?.inline_data || [];
      if (Array.isArray(parts)) {
        for (const p of parts) {
          const inline = p?.inlineData || p?.inline_data;
          if (inline?.data) return { data: String(inline.data), mime: String(inline?.mimeType || inline?.mime_type || "") };
          if (p?.audio?.data) return { data: String(p.audio.data), mime: String(p?.audio?.mimeType || p?.audio?.mime_type || "") };
          if (p?.data) return { data: String(p.data), mime: "" };
        }
      } else if (parts?.data || parts?.inlineData?.data || parts?.inline_data?.data) {
        const inline = parts?.inlineData || parts?.inline_data;
        if (inline?.data) return { data: String(inline.data), mime: String(inline?.mimeType || inline?.mime_type || "") };
        return { data: String(parts.data), mime: "" };
      }
    }
  } catch (_) {}
  return null;
}
function normalizeCloudGeminiTtsModel(model: string): string {
  const raw = String(model || "").trim();
  if (!raw) return "gemini-2.5-flash-tts";
  if (raw === "gemini-2.5-flash-preview-tts") return "gemini-2.5-flash-tts";
  if (raw === "gemini-2.5-pro-preview-tts") return "gemini-2.5-pro-tts";
  if (raw === "gemini-2.5-flash-lite-tts") return "gemini-2.5-flash-lite-preview-tts";
  return raw;
}
function explainCloudGeminiTtsError(err: any): string {
  const msg = String(err && err.message ? err.message : err || "");
  if (/aiplatform\.endpoints\.predict|permission|PERMISSION_DENIED|403/i.test(msg)) {
    return "Cloud Gemini-TTS 권한이 없습니다. 서비스 계정에 aiplatform.endpoints.predict 권한이 포함된 roles/aiplatform.user 권한을 부여해 주세요.";
  }
  if (/billing|quota|RESOURCE_EXHAUSTED|429/i.test(msg)) {
    return "Cloud Gemini-TTS 결제, 할당량 또는 호출 제한을 확인해 주세요.";
  }
  if (/modelName|model_name|model|not found|INVALID_ARGUMENT|400/i.test(msg)) {
    return "Cloud Gemini-TTS 모델명 또는 보이스명을 확인해 주세요. 모델은 gemini-2.5-flash-tts, 보이스는 Algenib 같은 Gemini-TTS 보이스 이름이어야 합니다.";
  }
  if (/UNAUTHENTICATED|401|access token|credential/i.test(msg)) {
    return "Google Cloud 인증 정보를 확인해 주세요.";
  }
  return "Cloud Gemini-TTS 호출에 실패했습니다. 서버 로그의 cloud_gemini_tts_failed 상세 오류를 확인해 주세요.";
}
function classifyCloudGeminiTtsError(err: any): string {
  const msg = String(err && err.message ? err.message : err || "");
  if (/aiplatform\.endpoints\.predict|permission|PERMISSION_DENIED|403/i.test(msg)) return "permission";
  if (/billing|quota|RESOURCE_EXHAUSTED|429/i.test(msg)) return "billing_or_quota";
  if (/modelName|model_name|Unknown name|model|not found|INVALID_ARGUMENT|400/i.test(msg)) return "request_or_model";
  if (/UNAUTHENTICATED|401|access token|credential/i.test(msg)) return "authentication";
  return "unknown";
}
function sanitizeCloudGeminiTtsError(msg: string): string {
  const raw = String(msg || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  return raw.slice(0, 900);
}
async function synthesizeViaCloudGeminiTts(opts: {
  token: string;
  text: string;
  prompt: string;
  languageCode: string;
  voiceName: string;
  modelName: string;
  userProject?: string;
}) {
  try {
    return await synthesizeViaCloudGeminiTtsRequest(opts, "model_name");
  } catch (firstError: any) {
    const msg = String(firstError && firstError.message ? firstError.message : firstError || "");
    if (!/modelName|model_name|Unknown name|INVALID_ARGUMENT|400/i.test(msg)) throw firstError;
    try {
      return await synthesizeViaCloudGeminiTtsRequest(opts, "modelName");
    } catch (secondError: any) {
      const secondMsg = String(secondError && secondError.message ? secondError.message : secondError || "");
      throw new Error(`${msg} | retry_modelName_failed: ${secondMsg}`);
    }
  }
}
async function synthesizeViaCloudGeminiTtsRequest(opts: {
  token: string;
  text: string;
  prompt: string;
  languageCode: string;
  voiceName: string;
  modelName: string;
  userProject?: string;
}, modelField: "model_name" | "modelName") {
  const url = "https://texttospeech.googleapis.com/v1/text:synthesize";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.token}`,
    "Content-Type": "application/json",
  };
  if (opts.userProject) headers["X-Goog-User-Project"] = opts.userProject;
  const voice: Record<string, any> = {
    languageCode: opts.languageCode,
    name: opts.voiceName,
  };
  voice[modelField] = opts.modelName;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      input: {
        text: opts.text,
        prompt: opts.prompt || "Say the following in a natural Korean voice.",
      },
      voice,
      audioConfig: {
        audioEncoding: "MP3",
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || "cloud_gemini_tts_failed");
  const json = safeJson(text) || {};
  const b64 = String(json?.audioContent || "");
  if (!b64) throw new Error("cloud_gemini_tts_no_audio");
  const bytes = base64ToBytes(b64);
  return { base64: b64, bytes, mime: "audio/mpeg" };
}
async function synthesizeViaGoogleTts(opts: { token: string; text: string; languageCode: string; voiceName: string; speakingRate: number; pitch: number; }) {
  const url = "https://texttospeech.googleapis.com/v1/text:synthesize";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: { text: opts.text },
      voice: { languageCode: opts.languageCode, name: opts.voiceName },
      audioConfig: { audioEncoding: "MP3", speakingRate: opts.speakingRate, pitch: opts.pitch }
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || "tts_v1_failed");
  const json = safeJson(text) || {};
  const b64 = String(json?.audioContent || "");
  if (!b64) throw new Error("tts_v1_no_audio");
  const bytes = base64ToBytes(b64);
  return { base64: b64, bytes, mime: "audio/mpeg" };
}
function derivePromptFromVoice(v: string): string {
  const raw = String(v || "").trim();
  if (!raw) return "Say the following in a natural Korean voice.";
  if (raw.indexOf("preset:child:female:") === 0) return "Speak like an excited young child.";
  if (raw.indexOf("preset:child:male:") === 0) return "Speak like an excited young child.";
  if (raw.indexOf("preset:char:cute:") === 0) return "Speak like a cheerful cartoon character.";
  if (raw.indexOf("preset:char:robot:") === 0) return "Speak like a robotic AI assistant.";
  if (raw.indexOf("preset:char:magician:") === 0) return "Speak like an old wizard.";
  if (raw.indexOf("preset:char:trick:") === 0) return "Speak like a playful trickster.";
  return "Say the following in a natural Korean voice.";
}
function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  if (!uri || !uri.startsWith("gs://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const bucket = rest.slice(0, slash);
  const object = rest.slice(slash + 1);
  return { bucket, object };
}

async function resolveTtsModel(apiKey: string, hint: string): Promise<string> {
  try {
    const listUrl = "https://generativelanguage.googleapis.com/v1beta/models?key=" + encodeURIComponent(apiKey);
    const res = await fetch(listUrl, { method: "GET" });
    const text = await res.text();
    if (!res.ok) return hint;
    const json = safeJson(text) || {};
    const models = Array.isArray(json.models) ? json.models : [];
    const has = (name: string) => models.find((m: any) =>
      String(m?.name || "") === `models/${name}` &&
      Array.isArray(m?.supportedGenerationMethods) &&
      m.supportedGenerationMethods.includes("generateContent")
    );
    if (has(hint)) return hint;
    const prefer = ["gemini-2.5-flash-preview-tts", "gemini-2.0-flash-tts", "gemini-2.5-flash-tts"];
    for (const p of prefer) if (has(p)) return p;
    const any = models.find((m: any) =>
      /tts|audio/i.test(String(m?.name || "")) &&
      Array.isArray(m?.supportedGenerationMethods) &&
      m.supportedGenerationMethods.includes("generateContent")
    );
    if (any) return String(any.name).replace(/^models\//, "");
    return hint;
  } catch {
    return hint;
  }
}
function gcsToHttps(uri: string) {
  if (!uri.startsWith("gs://")) return uri;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return uri;
  const bucket = rest.slice(0, slash);
  const object = rest.slice(slash + 1);
  return `https://storage.googleapis.com/${bucket}/${object}`;
}
function detectSignFailureHint(err: any): string {
  const msg = String(err && err.message ? err.message : err || "").toLowerCase();
  if (/pkcs8|asn1|pem|private key|importkey/.test(msg)) return "invalid_private_key_format";
  if (/subtle|crypto|not implemented|unsupported/.test(msg)) return "crypto_subtle_unavailable";
  if (/date|time|skew|x-goog-date|clock/.test(msg)) return "clock_skew";
  if (/goog4|signature|signedheaders|credential|request/.test(msg)) return "gcs_signing_error";
  return "signing_failed";
}
function base64ToBytes(b64: string) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function wrapPcmAsWav(pcmBytes: Uint8Array, sampleRate: number, channels: number) {
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmBytes.length;
  const riffSize = 36 + dataSize;
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  // "RIFF"
  v.setUint8(0, 0x52); v.setUint8(1, 0x49); v.setUint8(2, 0x46); v.setUint8(3, 0x46);
  v.setUint32(4, riffSize, true);
  // "WAVE"
  v.setUint8(8, 0x57); v.setUint8(9, 0x41); v.setUint8(10, 0x56); v.setUint8(11, 0x45);
  // "fmt "
  v.setUint8(12, 0x66); v.setUint8(13, 0x6D); v.setUint8(14, 0x74); v.setUint8(15, 0x20);
  v.setUint32(16, 16, true); // Subchunk1Size
  v.setUint16(20, 1, true); // AudioFormat PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, byteRate, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bitsPerSample, true);
  // "data"
  v.setUint8(36, 0x64); v.setUint8(37, 0x61); v.setUint8(38, 0x74); v.setUint8(39, 0x61);
  v.setUint32(40, dataSize, true);
  const out = new Uint8Array(44 + dataSize);
  out.set(new Uint8Array(header), 0);
  out.set(pcmBytes, 44);
  return out;
}
function sniffAudioFormat(bytes: Uint8Array): "mp3" | "wav" | "unknown" {
  if (bytes.length >= 3) {
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return "mp3"; // ID3
  }
  if (bytes.length >= 2) {
    const b0 = bytes[0], b1 = bytes[1];
    // MP3 frame sync 11111111 111xxxxx (0xFF, 0xE0..0xFB)
    if (b0 === 0xFF && (b1 & 0xE0) === 0xE0) return "mp3";
  }
  if (bytes.length >= 12) {
    const r = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    const w = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (r === "RIFF" && w === "WAVE") return "wav";
  }
  return "unknown";
}
async function getGoogleAccessToken(opts: { clientEmail: string; privateKeyPem: string; scope: string; }) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;
  const aud = "https://oauth2.googleapis.com/token";
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = { iss: opts.clientEmail, scope: opts.scope, aud, iat: now, exp };
  const jwtUnsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;
  const signature = await signRS256(jwtUnsigned, opts.privateKeyPem);
  const assertion = `${jwtUnsigned}.${signature}`;
  const form = new URLSearchParams();
  form.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  form.set("assertion", assertion);
  const res = await fetch(aud, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
  const text = await res.text();
  if (!res.ok) throw new Error(`OAuth token error (${res.status}): ${text}`);
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error("No access_token in OAuth response");
  return json.access_token as string;
}
function base64url(input: string) {
  const bytes = new TextEncoder().encode(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  const b64 = btoa(str);
  return b64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
async function signRS256(message: string, privateKeyPem: string) {
  const pem = privateKeyPem.replace(/\\n/g, "\n").trim();
  const pkcs8Der = pemToArrayBuffer(pem);
  const key = await crypto.subtle.importKey("pkcs8", pkcs8Der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(message));
  return bufferToBase64Url(sigBuf);
}
function pemToArrayBuffer(pem: string) {
  const lines = pem.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").split(/\s+/).join("");
  const raw = atob(lines);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}
function bufferToBase64Url(buf: ArrayBuffer) {
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
async function signGcsUrl(opts: { bucket: string; object: string; clientEmail: string; privateKeyPem: string; expiresInSec: number; }) {
  const now = new Date();
  const pad = (n: number) => `${n}`.padStart(2, "0");
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${date}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const credential = `${opts.clientEmail}/${date}/auto/storage/goog4_request`;
  const host = "storage.googleapis.com";
  const canonicalUri = `/${encodeURIComponent(opts.bucket)}/${opts.object.split("/").map(encodeURIComponent).join("/")}`;
  const signedHeaders = "host";
  const query = new URLSearchParams({
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": credential,
    "X-Goog-Date": time,
    "X-Goog-Expires": `${opts.expiresInSec}`,
    "X-Goog-SignedHeaders": signedHeaders,
  });
  const canonicalQuery = query.toString();
  const canonicalRequest = ["GET", canonicalUri, canonicalQuery, `host:${host}`, "", signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const hashedRequest = await sha256Hex(canonicalRequest);
  const stringToSign = ["GOOG4-RSA-SHA256", time, `${date}/auto/storage/goog4_request`, hashedRequest].join("\n");
  const signatureB64url = await signRS256(stringToSign, opts.privateKeyPem);
  const signatureHex = b64urlToHex(signatureB64url);
  const finalQuery = `${canonicalQuery}&X-Goog-Signature=${signatureHex}`;
  return `https://${host}${canonicalUri}?${finalQuery}`;
}
async function sha256Hex(input: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function b64urlToHex(b64url: string) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  return Array.from(bin).map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}
