/**
 * POST /api/sfx
 * 영상 클립 설명을 받아 ElevenLabs SFX API로 효과음을 생성하고 GCS에 업로드한 뒤
 * 서명된 URL을 반환합니다.
 *
 * Body: { projectId, clipId, clipLabel, clipDuration, prompt? }
 * Response: { sfxUrl, objectName }
 *
 * 필요 환경변수:
 *   ELEVENLABS_API_KEY   — ElevenLabs API 키
 *   GOOGLE_API_KEY       — Gemini 텍스트 생성 (SFX 프롬프트 자동 생성용)
 *   AUDIO_OUTPUT_GCS_URI 또는 VIDEO_OUTPUT_GCS_URI   — gs://bucket/prefix
 *   TTS_GOOGLE_CLIENT_EMAIL / GOOGLE_CLIENT_EMAIL
 *   TTS_GOOGLE_PRIVATE_KEY / GOOGLE_PRIVATE_KEY
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

// ── 공통 상수 ─────────────────────────────────────────────────────────────
// IMPORTANT: ElevenLabs sound-generation은 반드시 영어 텍스트만 받아야 함.
// 한국어 등 비라틴 텍스트를 보내면 TTS처럼 음성이 생성됨 → 항상 영어 폴백 사용.
const SFX_FALLBACK = "cinematic ambient sound effect, atmospheric background noise";

const SFX_SYSTEM_INSTRUCTION =
  "You are a professional sound designer. Analyze the visual content and write a concise English sound effects description for an audio generation AI. " +
  "Rules: (1) English only, (2) describe physical SOUNDS and ambience only — never speech, dialogue, or narration, " +
  "(3) under 22 words, (4) use vivid sound words: whoosh, rumble, crackle, hum, distant, reverb, footsteps, rain, wind, etc. " +
  "Output ONLY the English sound description. No quotes, no explanation.";

function isEnglish(text: string): boolean {
  return !!text && /[a-zA-Z]{3,}/.test(text);
}

async function callGemini(apiKey: string, body: object): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return "";
  const json: any = await res.json();
  return String(json?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
}

// ── Gemini Vision — 영상 프레임(이미지) 기반 SFX 프롬프트 생성 ─────────────
// frames: base64 JPEG 배열 (클라이언트에서 Canvas로 추출)
async function buildSfxPromptFromFrames(
  apiKey: string,
  frames: string[],
  clipLabel: string
): Promise<string> {
  try {
    // Gemini multimodal: 이미지 파트들 + 텍스트 파트
    const imageParts = frames.map((f) => ({
      inline_data: { mime_type: "image/jpeg", data: f },
    }));
    const textPart = {
      text:
        `These ${frames.length} frames are sampled from a video clip.\n` +
        `Clip label (for reference only): "${clipLabel}"\n\n` +
        `Look at WHAT IS HAPPENING visually — people, objects, environment, motion — ` +
        `and describe the SOUND EFFECTS that would realistically accompany this scene. ` +
        `English only, no speech/narration, under 22 words.`,
    };
    const body = {
      systemInstruction: { parts: [{ text: SFX_SYSTEM_INSTRUCTION }] },
      contents: [{ role: "user", parts: [...imageParts, textPart] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 80 },
    };
    const text = await callGemini(apiKey, body);
    if (isEnglish(text)) return text;
    return SFX_FALLBACK;
  } catch {
    return SFX_FALLBACK;
  }
}

// ── Gemini 텍스트 — 클립 라벨만으로 SFX 프롬프트 생성 (프레임 없을 때 폴백) ──
async function buildSfxPrompt(apiKey: string, clipLabel: string): Promise<string> {
  const userMsg =
    `Video clip label: "${clipLabel}"\n\n` +
    `Based on this label, describe the SOUND EFFECTS for the scene in English only. ` +
    `Do NOT narrate or speak the label text. Describe environmental sounds only.`;
  try {
    const body = {
      systemInstruction: { parts: [{ text: SFX_SYSTEM_INSTRUCTION }] },
      contents: [{ role: "user", parts: [{ text: userMsg }] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 60 },
    };
    const text = await callGemini(apiKey, body);
    if (isEnglish(text)) return text;
    return SFX_FALLBACK;
  } catch {
    return SFX_FALLBACK;
  }
}

// ── Gemini Files API — 서버에서 영상 파일을 직접 다운로드·분석 ───────────────
// 클라이언트 Canvas CORS 문제를 완전히 우회. 서버→GCS URL fetch는 CORS 무관.
// 흐름: 영상 다운로드 → Gemini Files API 업로드 → 처리 대기 → 영상 분석 → 파일 삭제

const MAX_VIDEO_BYTES = 30 * 1024 * 1024; // 30 MB (일반적인 웹 클립은 충분)

function detectVideoMimeType(url: string): string {
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".webm")) return "video/webm";
  if (path.endsWith(".mov") || path.endsWith(".qt")) return "video/quicktime";
  if (path.endsWith(".avi")) return "video/x-msvideo";
  if (path.endsWith(".wmv")) return "video/x-ms-wmv";
  if (path.endsWith(".mkv")) return "video/x-matroska";
  return "video/mp4";
}

async function uploadToGeminiFiles(
  apiKey: string,
  bytes: ArrayBuffer,
  mimeType: string
): Promise<string | null> {
  const boundary = "gem_sfx_" + Date.now();
  const meta = JSON.stringify({ file: { display_name: "sfx_video_" + Date.now() } });
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const combined = new Uint8Array(head.byteLength + bytes.byteLength + tail.byteLength);
  combined.set(head, 0);
  combined.set(new Uint8Array(bytes), head.byteLength);
  combined.set(tail, head.byteLength + bytes.byteLength);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart&key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: combined,
    }
  );
  if (!res.ok) return null;
  const json: any = await res.json();
  return String(json?.file?.uri || "") || null;
}

async function waitForGeminiFile(apiKey: string, fileUri: string, maxWaitMs = 20000): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${fileUri}?key=${encodeURIComponent(apiKey)}`);
    if (!res.ok) return false;
    const json: any = await res.json();
    const state = String(json?.state || "");
    if (state === "ACTIVE") return true;
    if (state === "FAILED") return false;
    // PROCESSING — 2초 대기 후 재시도
    await new Promise<void>((r) => setTimeout(r, 2000));
  }
  return false;
}

async function deleteGeminiFile(apiKey: string, fileUri: string): Promise<void> {
  try { await fetch(`${fileUri}?key=${encodeURIComponent(apiKey)}`, { method: "DELETE" }); } catch {}
}

async function fetchVideoBytes(
  videoUrl: string,
  gcsCredentials?: { clientEmail: string; privateKeyPem: string }
): Promise<ArrayBuffer | null> {
  // gs://bucket/object — GCS OAuth로 직접 다운로드 (서명 URL 없이도 접근 가능)
  if (videoUrl.startsWith("gs://")) {
    if (!gcsCredentials) return null;
    const parsed = parseGcsUri(videoUrl);
    if (!parsed) return null;
    try {
      const token = await getGoogleAccessToken({
        clientEmail: gcsCredentials.clientEmail,
        privateKeyPem: gcsCredentials.privateKeyPem,
        scope: "https://www.googleapis.com/auth/cloud-platform",
      });
      const apiUrl =
        `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(parsed.bucket)}` +
        `/o/${encodeURIComponent(parsed.object)}?alt=media`;
      const res = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const bytes = await res.arrayBuffer();
      return bytes.byteLength <= MAX_VIDEO_BYTES ? bytes : null;
    } catch { return null; }
  }
  // 일반 HTTPS URL (서명 URL, 공개 URL 등)
  try {
    const head = await fetch(videoUrl, { method: "HEAD" }).catch(() => null);
    const size = Number(head?.headers.get("content-length") || 0);
    if (size > MAX_VIDEO_BYTES) return null;
    const res = await fetch(videoUrl);
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    return bytes.byteLength <= MAX_VIDEO_BYTES ? bytes : null;
  } catch { return null; }
}

async function buildSfxPromptFromVideoUrl(
  apiKey: string,
  videoUrl: string,
  clipLabel: string,
  gcsCredentials?: { clientEmail: string; privateKeyPem: string }
): Promise<string> {
  try {
    // 1. 영상 다운로드 (gs:// → GCS 인증, https:// → 직접 fetch)
    const videoBytes = await fetchVideoBytes(videoUrl, gcsCredentials);
    if (!videoBytes) return "";

    // 3. Gemini Files API 업로드
    const mimeType = detectVideoMimeType(videoUrl);
    const fileUri = await uploadToGeminiFiles(apiKey, videoBytes, mimeType);
    if (!fileUri) return "";

    // 4. 파일 처리 대기 (PROCESSING → ACTIVE)
    const ready = await waitForGeminiFile(apiKey, fileUri);
    if (!ready) {
      deleteGeminiFile(apiKey, fileUri).catch(() => {});
      return "";
    }

    // 5. Gemini로 영상 전체 분석
    const analysisBody = {
      systemInstruction: { parts: [{ text: SFX_SYSTEM_INSTRUCTION }] },
      contents: [{
        role: "user",
        parts: [
          { file_data: { mime_type: mimeType, file_uri: fileUri } },
          {
            text:
              `Clip label (for reference only): "${clipLabel}"\n\n` +
              `Watch this video. Describe the SOUND EFFECTS that match what you see — ` +
              `environment, actions, objects, movement. English only, under 22 words.`,
          },
        ],
      }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 80 },
    };
    const text = await callGemini(apiKey, analysisBody);

    // 6. 업로드한 파일 삭제 (비동기, 오류 무시)
    deleteGeminiFile(apiKey, fileUri).catch(() => {});

    if (isEnglish(text)) return text;
    return "";
  } catch {
    return "";  // 오류 시 상위에서 폴백 처리
  }
}

// ── ElevenLabs SFX 생성 ────────────────────────────────────────────────────
async function generateElevenLabsSfx(
  apiKey: string,
  prompt: string,
  durationSec: number
): Promise<Uint8Array> {
  const body: any = { text: prompt.slice(0, 450) };
  const clampedDur = Math.min(22, Math.max(0.5, durationSec));
  body.duration_seconds = Math.round(clampedDur * 10) / 10;
  body.prompt_influence = 0.3;

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
    throw new Error(`elevenlabs_sfx_failed::${res.status}::${errText.slice(0, 200)}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

// ── GCS 업로드 + 서명 URL (tts.ts에서 공유한 헬퍼) ────────────────────────
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
    const clipId = String(body.clipId || "").trim();
    const clipLabel = String(body.clipLabel || "").trim() || "video clip";
    const clipDuration = Math.min(22, Math.max(0.5, Number(body.clipDuration) || 5));
    const customPrompt = String(body.prompt || "").trim();
    // 영상 파일 URL — 서버가 직접 다운로드해서 Gemini Files API로 분석 (CORS 우회)
    const clipUrl = String(body.clipUrl || "").trim();
    // 클라이언트 Canvas 프레임 (CORS 허용 환경 폴백용)
    const rawFrames: any[] = Array.isArray(body.frames) ? body.frames : [];
    const frames: string[] = rawFrames.filter(
      (f) => typeof f === "string" && f.length > 200
    ).slice(0, 10);

    if (!projectId) return send({ error: "projectId required" }, 400, origin);

    // 환경 변수 확인
    const elevenLabsKey = String(env.ELEVENLABS_API_KEY || "").trim();
    if (!elevenLabsKey) return send({ error: "ELEVENLABS_API_KEY not configured" }, 500, origin);

    const googleApiKey = String(env.GOOGLE_API_KEY || "").trim();
    const clientEmail = String(env.TTS_GOOGLE_CLIENT_EMAIL || env.GOOGLE_CLIENT_EMAIL || "").trim();
    const privateKey = String(env.TTS_GOOGLE_PRIVATE_KEY || env.GOOGLE_PRIVATE_KEY || "").trim();
    const baseOutput = String(env.AUDIO_OUTPUT_GCS_URI || env.VIDEO_OUTPUT_GCS_URI || "").trim();

    if (!clientEmail || !privateKey || !baseOutput) {
      return send({ error: "Missing GCS credentials (GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, AUDIO_OUTPUT_GCS_URI)" }, 500, origin);
    }
    const outParsed = parseGcsUri(baseOutput);
    if (!outParsed) return send({ error: "Invalid AUDIO_OUTPUT_GCS_URI" }, 500, origin);

    // Step 1: SFX 프롬프트 생성
    // 우선순위: 사용자 직접 입력
    //           > ① 서버 영상 다운로드 + Gemini Files API 분석 (가장 정확, CORS 무관)
    //           > ② 클라이언트 프레임 + Gemini Vision (CORS 허용 환경 폴백)
    //           > ③ 텍스트 라벨 분석
    //           > ④ 영어 기본값
    let sfxPrompt = customPrompt;
    let analysisMode = "text";

    if (!sfxPrompt && googleApiKey) {
      if (clipUrl) {
        // ① 서버에서 영상 파일을 직접 다운로드 → Gemini Files API로 전체 영상 분석
        sfxPrompt = await buildSfxPromptFromVideoUrl(googleApiKey, clipUrl, clipLabel,
          (clientEmail && privateKey) ? { clientEmail, privateKeyPem: privateKey } : undefined);
        if (sfxPrompt) {
          analysisMode = "video_server";
        }
      }
      if (!sfxPrompt && frames.length > 0) {
        // ② 클라이언트 Canvas 프레임이 있으면 Vision 분석 (폴백)
        sfxPrompt = await buildSfxPromptFromFrames(googleApiKey, frames, clipLabel);
        if (sfxPrompt !== SFX_FALLBACK) analysisMode = "vision";
      }
      if (!sfxPrompt || sfxPrompt === SFX_FALLBACK) {
        // ③ 텍스트 라벨만으로 분석
        sfxPrompt = await buildSfxPrompt(googleApiKey, clipLabel);
        analysisMode = "text";
      }
    }
    if (!sfxPrompt) {
      sfxPrompt = SFX_FALLBACK;
      analysisMode = "fallback";
    }

    // Step 2: ElevenLabs SFX 생성
    const audioBytes = await generateElevenLabsSfx(elevenLabsKey, sfxPrompt, clipDuration);

    // Step 3: GCS 업로드
    const userId = String(auth.userId || "").trim() || "owner";
    const basePrefix = outParsed.object.replace(/\/$/, "");
    const projectPrefix = buildAiVideoProjectPrefix(basePrefix, userId, projectId);
    const safeLabelId = (clipId || clipLabel).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const objName = `${projectPrefix}/sfx/${safeLabelId}-${Date.now()}.mp3`;

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
      const upText = await upRes.text();
      // 업로드 실패 시 data URI로 fallback
      const b64 = btoa(String.fromCharCode(...audioBytes));
      return send({ sfxUrl: `data:audio/mpeg;base64,${b64}`, objectName: objName, sfxPrompt, warning: "upload_failed" }, 200, origin);
    }

    // Step 4: 서명 URL 생성
    let signedUrl: string | null = null;
    try {
      signedUrl = await signGcsUrl({ bucket: outParsed.bucket, object: objName, clientEmail, privateKeyPem: privateKey, expiresInSec: 3600 });
    } catch (_) {}

    // _debug: 문제 진단용 — 이후 제거 예정
    const _debug = {
      clipUrlScheme: clipUrl ? clipUrl.slice(0, 60) : "(empty)",
      framesReceived: frames.length,
      analysisMode,
    };
    if (signedUrl) {
      return send({ sfxUrl: signedUrl, objectName: objName, sfxPrompt, analysisMode, framesUsed: frames.length, _debug }, 200, origin);
    }
    const b64 = btoa(String.fromCharCode(...audioBytes));
    return send({ sfxUrl: `data:audio/mpeg;base64,${b64}`, objectName: objName, sfxPrompt, warning: "sign_failed" }, 200, origin);

  } catch (e: any) {
    return send({ error: String(e?.message || e || "sfx_error") }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
