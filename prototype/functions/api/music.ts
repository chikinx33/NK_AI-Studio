/**
 * POST /api/music
 * 프로젝트 개요(주제·스토리·장르·스타일·톤)를 바탕으로 배경음악을 생성하고 GCS에 업로드.
 *
 * Body: { projectId, topic?, story?, genre?, subgenre?, styles?, tones?, durationSec? }
 * Response: { musicUrl, objectName, musicPrompt, durationGenerated }
 *
 * 필요 환경변수:
 *   ELEVENLABS_API_KEY
 *   GEMINI_API_KEY 또는 GOOGLE_API_KEY
 *   AUDIO_OUTPUT_GCS_URI 또는 VIDEO_OUTPUT_GCS_URI
 *   GOOGLE_CLIENT_EMAIL / TTS_GOOGLE_CLIENT_EMAIL
 *   GOOGLE_PRIVATE_KEY / TTS_GOOGLE_PRIVATE_KEY
 */

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

const MUSIC_FALLBACK = "cinematic orchestral background music, moderate tempo, emotional strings, subtle percussion";

const MUSIC_SYSTEM_INSTRUCTION =
  "You are a professional music supervisor for video production. " +
  "Write a concise English background music description for an AI audio generator. " +
  "Include: genre/style, tempo (slow/moderate/upbeat/fast), mood/emotion, and key instruments. " +
  "Under 50 words. English only. Output ONLY the description. No quotes, no explanation.";

function isEnglish(text: string): boolean {
  return !!text && /[a-zA-Z]{3,}/.test(text);
}

async function callGemini(apiKey: string, body: object): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return "";
  const json: any = await res.json();
  return String(json?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
}

async function buildMusicPrompt(
  apiKey: string,
  topic: string,
  story: string,
  genre: string,
  subgenre: string,
  styles: string[],
  tones: string[]
): Promise<string> {
  const parts: string[] = [];
  if (topic) parts.push(`Topic: ${topic}`);
  if (genre || subgenre) parts.push(`Genre: ${[genre, subgenre].filter(Boolean).join(" / ")}`);
  if (styles.length) parts.push(`Style: ${styles.join(", ")}`);
  if (tones.length) parts.push(`Mood/Tone: ${tones.join(", ")}`);
  if (story) parts.push(`Story: ${story.slice(0, 300)}`);

  if (!parts.length) return MUSIC_FALLBACK;

  const userMsg =
    `Video project overview:\n${parts.join("\n")}\n\n` +
    `Write a background music description that fits this video.`;

  try {
    const body = {
      systemInstruction: { parts: [{ text: MUSIC_SYSTEM_INSTRUCTION }] },
      contents: [{ role: "user", parts: [{ text: userMsg }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 100 },
    };
    const text = await callGemini(apiKey, body);
    if (isEnglish(text)) return text;
    return MUSIC_FALLBACK;
  } catch {
    return MUSIC_FALLBACK;
  }
}

async function generateElevenLabsMusic(
  apiKey: string,
  prompt: string,
  durationSec: number
): Promise<Uint8Array> {
  const clampedDur = Math.min(22, Math.max(3, durationSec));
  const body = {
    text: prompt.slice(0, 450),
    duration_seconds: Math.round(clampedDur * 10) / 10,
    prompt_influence: 0.3,
  };
  const res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`elevenlabs_music_failed::${res.status}::${errText.slice(0, 200)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

// ── GCS 헬퍼 (sfx.ts와 동일 패턴) ─────────────────────────────────────────
function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  if (!uri || !uri.startsWith("gs://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  return { bucket: rest.slice(0, slash), object: rest.slice(slash + 1) };
}
async function getGoogleAccessToken(opts: { clientEmail: string; privateKeyPem: string; scope: string }) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;
  const aud = "https://oauth2.googleapis.com/token";
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = { iss: opts.clientEmail, scope: opts.scope, aud, iat: now, exp };
  const jwtUnsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claimSet))}`;
  const signature = await signRS256(jwtUnsigned, opts.privateKeyPem);
  const assertion = `${jwtUnsigned}.${signature}`;
  const form = new URLSearchParams();
  form.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  form.set("assertion", assertion);
  const res = await fetch(aud, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
  const text = await res.text();
  if (!res.ok) throw new Error(`OAuth error (${res.status}): ${text}`);
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error("No access_token");
  return json.access_token as string;
}
function b64url(input: string) {
  const bytes = new TextEncoder().encode(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
async function signRS256(message: string, pem: string): Promise<string> {
  const cleaned = pem.replace(/\\n/g, "\n").trim();
  const pkcs8Der = pemToArrayBuffer(cleaned);
  const key = await crypto.subtle.importKey("pkcs8", pkcs8Der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(message));
  return bufToB64url(sig);
}
function pemToArrayBuffer(pem: string) {
  const lines = pem.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").split(/\s+/).join("");
  const raw = atob(lines);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}
function bufToB64url(buf: ArrayBuffer) {
  let bin = "";
  new Uint8Array(buf).forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
async function signGcsUrl(opts: { bucket: string; object: string; clientEmail: string; privateKeyPem: string; expiresInSec: number }) {
  const now = new Date();
  const pad = (n: number) => `${n}`.padStart(2, "0");
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${date}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const credential = `${opts.clientEmail}/${date}/auto/storage/goog4_request`;
  const canonicalUri = `/${encodeURIComponent(opts.bucket)}/${opts.object.split("/").map(encodeURIComponent).join("/")}`;
  const query = new URLSearchParams({
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": credential,
    "X-Goog-Date": time,
    "X-Goog-Expires": `${opts.expiresInSec}`,
    "X-Goog-SignedHeaders": "host",
  });
  const canonicalQuery = query.toString();
  const canonicalRequest = ["GET", canonicalUri, canonicalQuery, `host:storage.googleapis.com`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const hashedRequest = await sha256Hex(canonicalRequest);
  const stringToSign = ["GOOG4-RSA-SHA256", time, `${date}/auto/storage/goog4_request`, hashedRequest].join("\n");
  const sig = await signRS256(stringToSign, opts.privateKeyPem);
  const sigHex = b64urlToHex(sig);
  return `https://storage.googleapis.com${canonicalUri}?${canonicalQuery}&X-Goog-Signature=${sigHex}`;
}
async function sha256Hex(input: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function b64urlToHex(b64url: string) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  return Array.from(atob(b64)).map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}

// ── Main handler ───────────────────────────────────────────────────────────
export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env, { allowQueryToken: true });
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    let body: any = {};
    try { body = JSON.parse(await request.text()); } catch { body = {}; }

    const projectId = String(body.projectId || "").trim();
    const topic     = String(body.topic    || "").trim();
    const story     = String(body.story    || "").trim();
    const genre     = String(body.genre    || "").trim();
    const subgenre  = String(body.subgenre || "").trim();
    const styles: string[]  = Array.isArray(body.styles)  ? body.styles.map(String).filter(Boolean)  : [];
    const tones: string[]   = Array.isArray(body.tones)   ? body.tones.map(String).filter(Boolean)   : [];
    const durationSec = Math.min(22, Math.max(3, Number(body.durationSec) || 15));

    if (!projectId) return send({ error: "projectId required" }, 400, origin);

    const elevenLabsKey = String(env.ELEVENLABS_API_KEY || "").trim();
    if (!elevenLabsKey) return send({ error: "ELEVENLABS_API_KEY not configured" }, 500, origin);

    const googleApiKey  = String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "").trim();
    const clientEmail   = String(env.TTS_GOOGLE_CLIENT_EMAIL || env.GOOGLE_CLIENT_EMAIL || "").trim();
    const privateKey    = String(env.TTS_GOOGLE_PRIVATE_KEY  || env.GOOGLE_PRIVATE_KEY  || "").trim();
    const baseOutput    = String(env.AUDIO_OUTPUT_GCS_URI    || env.VIDEO_OUTPUT_GCS_URI || "").trim();

    if (!clientEmail || !privateKey || !baseOutput) {
      return send({ error: "Missing GCS credentials" }, 500, origin);
    }
    const outParsed = parseGcsUri(baseOutput);
    if (!outParsed) return send({ error: "Invalid AUDIO_OUTPUT_GCS_URI" }, 500, origin);

    // Step 1: Gemini로 음악 프롬프트 생성
    let musicPrompt = MUSIC_FALLBACK;
    if (googleApiKey) {
      musicPrompt = await buildMusicPrompt(googleApiKey, topic, story, genre, subgenre, styles, tones);
    }

    // Step 2: ElevenLabs로 음악 생성
    const audioBytes = await generateElevenLabsMusic(elevenLabsKey, musicPrompt, durationSec);

    // Step 3: GCS 업로드
    const userId = String(auth.userId || "").trim() || "owner";
    const basePrefix = outParsed.object.replace(/\/$/, "");
    const projectPrefix = buildAiVideoProjectPrefix(basePrefix, userId, projectId);
    const objName = `${projectPrefix}/music/bgm-${Date.now()}.mp3`;

    const userProject = String(env.GCS_BILLING_PROJECT_ID || env.GOOGLE_PROJECT_ID || "").trim();
    const token = await getGoogleAccessToken({ clientEmail, privateKeyPem: privateKey, scope: "https://www.googleapis.com/auth/cloud-platform" });
    const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(objName)}`;
    const upRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "audio/mpeg",
        ...(userProject ? { "X-Goog-User-Project": userProject } : {}),
      },
      body: audioBytes,
    });
    if (!upRes.ok) {
      const b64 = btoa(String.fromCharCode(...audioBytes));
      return send({ musicUrl: `data:audio/mpeg;base64,${b64}`, objectName: objName, musicPrompt, durationGenerated: durationSec, warning: "upload_failed" }, 200, origin);
    }

    // Step 4: 서명 URL 생성
    let signedUrl: string | null = null;
    try {
      signedUrl = await signGcsUrl({ bucket: outParsed.bucket, object: objName, clientEmail, privateKeyPem: privateKey, expiresInSec: 3600 });
    } catch (_) {}

    if (signedUrl) {
      return send({ musicUrl: signedUrl, objectName: objName, musicPrompt, durationGenerated: durationSec }, 200, origin);
    }
    const b64 = btoa(String.fromCharCode(...audioBytes));
    return send({ musicUrl: `data:audio/mpeg;base64,${b64}`, objectName: objName, musicPrompt, durationGenerated: durationSec, warning: "sign_failed" }, 200, origin);

  } catch (e: any) {
    return send({ error: String(e?.message || e || "music_error") }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
