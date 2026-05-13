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

// 영상 장르(시청 카테고리)를 음악 장르 힌트로 변환하는 사전 매핑표.
// 영상 장르명("브이로그", "광고" 등)은 음악 장르로 그대로 던지면 AI 가 어색한 결과를 내므로
// 음악적으로 의미 있는 표현으로 사전 번역해두고, Gemini 분석 결과가 비어있을 때 폴백으로 쓴다.
// key 는 소문자·공백제거 정규화된 한국어/영어 키. 매칭은 부분 포함 우선으로 시도한다.
const VIDEO_TO_MUSIC_GENRE_MAP: Record<string, string> = {
  // 시청 카테고리 (purposeCategory)
  "광고": "upbeat corporate pop with bright synths",
  "브이로그": "indie acoustic lo-fi, warm guitars",
  "vlog": "indie acoustic lo-fi, warm guitars",
  "드라마": "cinematic orchestral, emotional strings",
  "다큐": "ambient piano cinematic underscore",
  "예능": "playful upbeat pop",
  "교육": "warm instrumental folk, light piano",
  "키즈": "cheerful playful orchestral, glockenspiel",
  "뉴스": "tense corporate underscore",
  "스포츠": "energetic rock, driving drums",
  "음악": "instrumental cinematic",
  "라이프": "indie acoustic lo-fi, warm guitars",
  "일상": "indie acoustic lo-fi, warm guitars",
  // 세부 태그 (purposeTags)
  "리뷰": "modern minimal electronic underscore",
  "튜토리얼": "light corporate, bright marimba",
  "인터뷰": "warm ambient piano",
  "홍보": "upbeat corporate pop",
  "쇼츠": "energetic punchy electronic",
  "단편": "cinematic underscore",
  "감성": "warm ambient piano with soft strings",
  "여행": "uplifting acoustic with ukulele and percussion",
  "요리": "playful jazzy underscore",
  "ASMR": "ambient drones, soft textures",
  "호러": "tense ambient drones with dissonant strings",
  "코미디": "playful jazzy bouncy",
};

const ANALYSIS_INSTRUCTION =
  "You are a music supervisor analyzing a short-form video project to plan its background score. " +
  "Read the provided overview and reply with ONLY a JSON object — no markdown, no prose. Schema: " +
  '{"mood": "<one keyword: warm | calm | tense | melancholic | uplifting | mysterious | energetic | playful | epic | nostalgic>",' +
  '"pace": "<one keyword: slow | moderate | upbeat | fast>",' +
  '"intensity": "<one keyword: minimal | gentle | balanced | driving | intense>",' +
  '"musicGenre": "<concrete music genre suited as instrumental BGM, English, 2-6 words>",' +
  '"instruments": ["<2-4 key instruments in English>"]}.' +
  " The genre must be a MUSIC genre (e.g., \"cinematic orchestral\", \"indie acoustic lo-fi\"), NOT a video genre.";

function isEnglish(text: string): boolean {
  return !!text && /[a-zA-Z]{3,}/.test(text);
}

function normalizeKey(s: string): string {
  return String(s || "").toLowerCase().replace(/\s+/g, "").trim();
}

function lookupGenreMap(...candidates: string[]): string {
  for (const cand of candidates) {
    const key = normalizeKey(cand);
    if (!key) continue;
    // 완전 일치 우선
    if (VIDEO_TO_MUSIC_GENRE_MAP[cand]) return VIDEO_TO_MUSIC_GENRE_MAP[cand];
    // 부분 일치 (예: "라이프·일상" → "라이프" 포함)
    for (const k of Object.keys(VIDEO_TO_MUSIC_GENRE_MAP)) {
      if (normalizeKey(k) === key) return VIDEO_TO_MUSIC_GENRE_MAP[k];
    }
    for (const k of Object.keys(VIDEO_TO_MUSIC_GENRE_MAP)) {
      if (cand.indexOf(k) !== -1) return VIDEO_TO_MUSIC_GENRE_MAP[k];
    }
  }
  return "";
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

interface MusicAnalysis {
  mood: string;
  pace: string;
  intensity: string;
  musicGenre: string;
  instruments: string[];
}

// 1단계: Gemini 가 영상 개요를 분석해 음악 키워드(JSON)를 추출.
async function analyzeVideoForMusic(
  apiKey: string,
  topic: string,
  story: string,
  genre: string,
  subgenre: string,
  styles: string[],
  tones: string[]
): Promise<MusicAnalysis | null> {
  const parts: string[] = [];
  if (topic) parts.push(`Topic: ${topic}`);
  if (genre || subgenre) parts.push(`Video genre: ${[genre, subgenre].filter(Boolean).join(" / ")}`);
  if (styles.length) parts.push(`Visual style: ${styles.join(", ")}`);
  if (tones.length) parts.push(`Overall tone: ${tones.join(", ")}`);
  if (story) parts.push(`Story: ${story.slice(0, 600)}`);
  if (!parts.length) return null;

  const userMsg = `Analyze this short-form video project for background music planning:\n${parts.join("\n")}`;
  const body = {
    systemInstruction: { parts: [{ text: ANALYSIS_INSTRUCTION }] },
    contents: [{ role: "user", parts: [{ text: userMsg }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 250,
      responseMimeType: "application/json",
    },
  };
  try {
    const text = await callGemini(apiKey, body);
    if (!text) return null;
    const parsed = JSON.parse(text);
    return {
      mood: String(parsed.mood || "").trim(),
      pace: String(parsed.pace || "").trim(),
      intensity: String(parsed.intensity || "").trim(),
      musicGenre: String(parsed.musicGenre || "").trim(),
      instruments: Array.isArray(parsed.instruments)
        ? parsed.instruments.map((v: any) => String(v || "").trim()).filter(Boolean).slice(0, 4)
        : [],
    };
  } catch {
    return null;
  }
}

// 2단계: 분석 결과 + 영상→음악 장르 매핑표 + 길이를 합쳐 최종 음악 생성 프롬프트 조립.
// Lyria 3 는 별도 duration 필드가 없어 프롬프트 텍스트에 길이를 명시한다.
function assembleMusicPrompt(
  analysis: MusicAnalysis | null,
  genre: string,
  subgenre: string,
  tones: string[],
  durationSec: number
): string {
  const mappedGenre = lookupGenreMap(subgenre, genre);
  const musicGenre = (analysis && analysis.musicGenre) || mappedGenre || "cinematic instrumental underscore";
  const lines: string[] = [];
  // 길이는 첫 줄에 강하게 명시 (Lyria 3 가 프롬프트의 시간 지시를 받아 길이를 제어)
  lines.push(`Create a ${Math.max(3, Math.round(durationSec))}-second instrumental background music track.`);
  lines.push(`Genre: ${musicGenre}.`);
  if (analysis) {
    if (analysis.mood) lines.push(`Mood: ${analysis.mood}.`);
    if (analysis.pace) lines.push(`Tempo: ${analysis.pace}.`);
    if (analysis.intensity) lines.push(`Intensity: ${analysis.intensity}.`);
    if (analysis.instruments && analysis.instruments.length) {
      lines.push(`Featured instruments: ${analysis.instruments.join(", ")}.`);
    }
  } else if (tones.length) {
    lines.push(`Mood: ${tones.join(", ")}.`);
  }
  lines.push("No vocals, no lyrics, no spoken word. Instrumental only. Loopable.");
  return lines.join(" ");
}

// Cloudflare Workers V8 isolate 에서 큰 base64 를 1바이트씩 디코딩하면 O(n²) 가 되어 CPU 한도를 넘긴다.
// 청크 단위로 디코딩 후 Uint8Array 로 합친다.
function base64ToBytes(b64: string): Uint8Array {
  const clean = String(b64 || "").replace(/\s+/g, "");
  if (!clean) return new Uint8Array(0);
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Lyria 3 Pro 로 BGM 생성. preview 단계라 막혀있거나 실패하면 null 반환 → 상위에서 ElevenLabs 로 폴백.
// 응답은 WAV 로 요청한다. MP3 는 Xing/Info VBR 헤더가 없으면 HTMLAudioElement 의 currentTime
// 시킹이 프레임 중간으로 점프해 "삐비비" 노이즈를 내는데, Lyria preview 가 만드는 MP3 가
// 그런 경향이 있다. WAV(PCM) 는 바이트↔시간이 정확히 매핑돼 시킹이 안정적이다.
async function generateLyriaMusic(
  apiKey: string,
  prompt: string
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/lyria-3-pro-preview:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["AUDIO", "TEXT"],
        responseFormat: { audio: { mimeType: "audio/wav" } },
      },
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const parts = json?.candidates?.[0]?.content?.parts || [];
    for (const p of parts) {
      const inline = (p && (p.inlineData || p.inline_data)) || null;
      if (inline && inline.data) {
        const mime = String(inline.mimeType || inline.mime_type || "audio/wav");
        return { bytes: base64ToBytes(String(inline.data)), mimeType: mime };
      }
    }
    return null;
  } catch {
    return null;
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
    // 재생 길이: Lyria 3 Pro 가 분 단위를 지원하므로 상한을 240초(4분)로 확장.
    // ElevenLabs 폴백 경로에서는 22초로 다시 클램프된다.
    const durationSec = Math.min(240, Math.max(3, Number(body.durationSec) || 15));

    if (!projectId) return send({ error: "projectId required" }, 400, origin);

    const elevenLabsKey = String(env.ELEVENLABS_API_KEY || "").trim();
    const googleApiKey  = String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "").trim();
    if (!elevenLabsKey && !googleApiKey) {
      return send({ error: "No music provider configured (need GEMINI_API_KEY or ELEVENLABS_API_KEY)" }, 500, origin);
    }

    const clientEmail   = String(env.TTS_GOOGLE_CLIENT_EMAIL || env.GOOGLE_CLIENT_EMAIL || "").trim();
    const privateKey    = String(env.TTS_GOOGLE_PRIVATE_KEY  || env.GOOGLE_PRIVATE_KEY  || "").trim();
    const baseOutput    = String(env.AUDIO_OUTPUT_GCS_URI    || env.VIDEO_OUTPUT_GCS_URI || "").trim();

    if (!clientEmail || !privateKey || !baseOutput) {
      return send({ error: "Missing GCS credentials" }, 500, origin);
    }
    const outParsed = parseGcsUri(baseOutput);
    if (!outParsed) return send({ error: "Invalid AUDIO_OUTPUT_GCS_URI" }, 500, origin);

    // Step 1: 영상 개요 분석 → 음악 키워드(JSON) 추출 (Gemini)
    let analysis: MusicAnalysis | null = null;
    if (googleApiKey) {
      analysis = await analyzeVideoForMusic(googleApiKey, topic, story, genre, subgenre, styles, tones);
    }
    // Step 2: 분석 결과 + 영상→음악 장르 매핑표 + 길이로 최종 프롬프트 조립
    const musicPrompt = (analysis || tones.length || genre || subgenre)
      ? assembleMusicPrompt(analysis, genre, subgenre, tones, durationSec)
      : MUSIC_FALLBACK;

    // Step 3: 음악 생성 — Lyria 3 Pro 우선, 실패 시 ElevenLabs 폴백
    let audioBytes: Uint8Array | null = null;
    let audioMimeType = "audio/mpeg";
    let providerUsed = "";
    let providerFallbackReason = "";

    if (googleApiKey) {
      const lyria = await generateLyriaMusic(googleApiKey, musicPrompt);
      if (lyria && lyria.bytes && lyria.bytes.length > 0) {
        audioBytes = lyria.bytes;
        audioMimeType = lyria.mimeType || "audio/mp3";
        providerUsed = "lyria-3-pro-preview";
      } else {
        providerFallbackReason = "lyria_unavailable_or_failed";
      }
    }

    if (!audioBytes) {
      if (!elevenLabsKey) {
        return send({
          error: "music_generation_failed",
          detail: providerFallbackReason || "lyria_unavailable_and_no_elevenlabs_key",
          musicPrompt,
        }, 502, origin);
      }
      // ElevenLabs 는 22초가 한계라 별도로 클램프.
      const fallbackDur = Math.min(22, Math.max(3, durationSec));
      audioBytes = await generateElevenLabsMusic(elevenLabsKey, musicPrompt, fallbackDur);
      audioMimeType = "audio/mpeg";
      providerUsed = "elevenlabs";
    }

    if (!audioBytes || audioBytes.length === 0) {
      return send({ error: "music_generation_returned_empty", musicPrompt, providerUsed }, 502, origin);
    }

    // Step 4: GCS 업로드 — mp3 / wav 응답을 따라 확장자·Content-Type 결정
    const isWav = /wav/i.test(audioMimeType);
    const extension = isWav ? "wav" : "mp3";
    const uploadContentType = isWav ? "audio/wav" : "audio/mpeg";

    const userId = String(auth.userId || "").trim() || "owner";
    const basePrefix = outParsed.object.replace(/\/$/, "");
    const projectPrefix = buildAiVideoProjectPrefix(basePrefix, userId, projectId);
    const objName = `${projectPrefix}/music/bgm-${Date.now()}.${extension}`;

    // base64 인코딩은 큰 버퍼에서 O(n²) 가 되므로 청크 단위로.
    const bytesToBase64 = (bytes: Uint8Array): string => {
      const CHUNK = 0x8000;
      let bin = "";
      for (let i = 0; i < bytes.length; i += CHUNK) {
        const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
        bin += String.fromCharCode.apply(null, slice as unknown as number[]);
      }
      return btoa(bin);
    };

    const userProject = String(env.GCS_BILLING_PROJECT_ID || env.GOOGLE_PROJECT_ID || "").trim();
    const token = await getGoogleAccessToken({ clientEmail, privateKeyPem: privateKey, scope: "https://www.googleapis.com/auth/cloud-platform" });
    const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(objName)}`;
    const upRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": uploadContentType,
        ...(userProject ? { "X-Goog-User-Project": userProject } : {}),
      },
      body: audioBytes,
    });
    if (!upRes.ok) {
      const b64 = bytesToBase64(audioBytes);
      return send({
        musicUrl: `data:${uploadContentType};base64,${b64}`,
        objectName: objName,
        musicPrompt,
        durationGenerated: durationSec,
        providerUsed,
        analysis: analysis || undefined,
        warning: "upload_failed",
      }, 200, origin);
    }

    // Step 5: 서명 URL 생성
    let signedUrl: string | null = null;
    try {
      signedUrl = await signGcsUrl({ bucket: outParsed.bucket, object: objName, clientEmail, privateKeyPem: privateKey, expiresInSec: 3600 });
    } catch (_) {}

    if (signedUrl) {
      return send({
        musicUrl: signedUrl,
        objectName: objName,
        musicPrompt,
        durationGenerated: durationSec,
        providerUsed,
        analysis: analysis || undefined,
      }, 200, origin);
    }
    const b64 = bytesToBase64(audioBytes);
    return send({
      musicUrl: `data:${uploadContentType};base64,${b64}`,
      objectName: objName,
      musicPrompt,
      durationGenerated: durationSec,
      providerUsed,
      analysis: analysis || undefined,
      warning: "sign_failed",
    }, 200, origin);

  } catch (e: any) {
    return send({ error: String(e?.message || e || "music_error") }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
