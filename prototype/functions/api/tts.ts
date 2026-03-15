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
    const finalPrompt = promptRaw || derivePromptFromVoice(voiceNameRaw || voiceId);

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

    const token = await getGoogleAccessToken({
      clientEmail: clientEmail as string,
      privateKeyPem: privateKeyRaw as string,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });
    const apiKey = String(env.GOOGLE_API_KEY || "").trim();
    const promptPlusScript = (finalPrompt || "Speak like an epic fantasy narrator.") + "\n" + script;
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
        response_mime_type: "audio/mpeg",
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Kore"
            }
          }
        }
      }
    };
    if (!apiKey) return send({ error: "GOOGLE_API_KEY missing" }, 500, origin);
    const preferModel = String(env.GEMINI_TTS_MODEL || "").trim() || "gemini-2.5-flash-preview-tts";
    const chosenModel = await resolveTtsModel(apiKey, preferModel);
    let audioInfo = null as null | { data: string; mime: string };
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
    if (synthRes.ok) {
      const synthJson = safeJson(synthText) || {};
      audioInfo = extractGeminiAudio(synthJson);
    }
    if (!synthRes.ok || !audioInfo || !audioInfo.data) {
      const status = synthRes?.status || 502;
      const detail = synthText ? safeJson(synthText) : undefined;
      return send({ error: "tts_failed", status, detail }, status, origin);
    }
    const audioContent = audioInfo.data;
    const audioBytes = base64ToBytes(audioContent);

    const mimeFromModel = String(audioInfo.mime || "").toLowerCase();
    const isMp3 = /mpeg|mp3/.test(mimeFromModel) || !mimeFromModel; // 기본 MP3
    const objNameFinal = isMp3 ? `${baseObjectName}.mp3` : `${baseObjectName}.wav`;
    const contentTypeFinal = isMp3 ? "audio/mpeg" : "audio/wav";
    const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(objNameFinal)}`;
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
        return send({ voiceUrl: dataUri, format: "mp3", objectName: objNameFinal, warning: "upload_failed_requester_pays" }, 200, origin);
      }
      return send({ voiceUrl: dataUri, format: "mp3", objectName: objNameFinal, warning: "upload_failed" }, 200, origin);
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
      return send({ voiceUrl: signedUrl, format: isMp3 ? "mp3" : "wav", objectName: objNameFinal }, 200, origin);
    }
    const dataUriFinal = `data:${contentTypeFinal};base64,${audioContent}`;
    return send({ voiceUrl: dataUriFinal, format: isMp3 ? "mp3" : "wav", objectName: objNameFinal, warning: "sign_failed" }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

function safeJson(text: string) { try { return JSON.parse(text); } catch { return text; } }
function extractGeminiAudio(json: any): { data: string; mime: string } | null {
  try {
    const cands = json?.candidates || [];
    for (const c of cands) {
      const parts = c?.content?.parts || c?.content?.inlineData || [];
      if (Array.isArray(parts)) {
        for (const p of parts) {
          if (p?.inlineData?.data) return { data: String(p.inlineData.data), mime: String(p?.inlineData?.mimeType || "") };
          if (p?.audio?.data) return { data: String(p.audio.data), mime: String(p?.audio?.mimeType || "") };
          if (p?.data) return { data: String(p.data), mime: "" };
        }
      } else if (parts?.data) {
        return { data: String(parts.data), mime: "" };
      }
    }
  } catch (_) {}
  return null;
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
  if (!raw) return "Speak like an epic fantasy narrator.";
  if (raw.indexOf("preset:child:female:") === 0) return "Speak like an excited young child.";
  if (raw.indexOf("preset:child:male:") === 0) return "Speak like an excited young child.";
  if (raw.indexOf("preset:char:cute:") === 0) return "Speak like a cheerful cartoon character.";
  if (raw.indexOf("preset:char:robot:") === 0) return "Speak like a robotic AI assistant.";
  if (raw.indexOf("preset:char:magician:") === 0) return "Speak like an old wizard.";
  if (raw.indexOf("preset:char:trick:") === 0) return "Speak like a playful trickster.";
  return "Speak like an epic fantasy narrator.";
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
