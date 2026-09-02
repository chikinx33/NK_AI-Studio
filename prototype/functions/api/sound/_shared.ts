// prototype/functions/api/sound/_shared.ts
// AI 사운드 스튜디오 공유 헬퍼.
// - Neon Postgres 접근 (raw fetch, npm 의존성 없음 — Cloudflare Pages 번들 호환)
// - 스키마 lazy 생성 (voices / voice_favorites / sound_assets)
// - GCS 업로드 + V4 서명 URL (tts.ts / sfx.ts 헬퍼 재사용)
// - ElevenLabs TTS / SFX 호출

// ─── CORS ─────────────────────────────────────────────────────────────────
export const corsHeaders = (origin?: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Vary": "Origin",
});
export const send = (data: any, status = 200, origin?: string | null) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });

// ─── Neon ───────────────────────────────────────────────────────────────────
export type SqlFn = (sql: string, params?: any[]) => Promise<any[]>;

function parseDbHost(rawUrl: string): string {
  const url = rawUrl.startsWith("postgres://")
    ? rawUrl.replace("postgres://", "postgresql://")
    : rawUrl;
  return new URL(url).hostname;
}

async function neonQuery(dbUrl: string, sql: string, params: any[] = []): Promise<any[]> {
  const host = parseDbHost(dbUrl);
  const res = await fetch(`https://${host}/sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Neon-Connection-String": dbUrl,
    },
    body: JSON.stringify({ query: sql, params }),
  });
  const body = await res.text();
  if (!res.ok) {
    let msg = `Neon SQL 오류 ${res.status}`;
    try {
      const d = JSON.parse(body);
      if (d?.message) msg = d.message;
      else if (d?.error) msg = d.error;
    } catch (_) {}
    throw new Error(`${msg}: ${body.slice(0, 300)}`);
  }
  const data = JSON.parse(body);
  return (data as any).rows || [];
}

// Neon HTTP가 text[] 컬럼을 JS 배열 또는 Postgres 배열 리터럴 문자열로 반환할 수 있어 모두 처리.
export function parsePgTextArray(val: any): string[] {
  if (Array.isArray(val)) return val.map((x) => String(x));
  if (typeof val === "string") {
    const s = val.trim();
    if (!s || s === "{}") return [];
    if (s.startsWith("{") && s.endsWith("}")) {
      return s.slice(1, -1).split(",").map((x) => x.replace(/^"|"$/g, "").trim()).filter(Boolean);
    }
  }
  return [];
}

export function getSql(env: any): SqlFn | null {
  const url = String((env && env.DATABASE_URL) || "").trim();
  if (!url) return null;
  return (sql: string, params?: any[]) => neonQuery(url, sql, params || []);
}

// ─── Schema (lazy) ────────────────────────────────────────────────────────
// brands/episodes 테이블 존재 여부를 보장할 수 없으므로 brand_id/episode_id는
// 외래키 제약 없이 TEXT로 저장한다(스펙의 "FK만 조정" 허용 범위).
let schemaReady = false;

export async function ensureSoundSchema(sql: SqlFn): Promise<void> {
  if (schemaReady) return;
  await sql(`
    CREATE TABLE IF NOT EXISTS voices (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scope             TEXT NOT NULL CHECK (scope IN ('global','brand','user')),
      brand_id          TEXT,
      owner_id          TEXT,
      name              TEXT NOT NULL,
      gender            TEXT CHECK (gender IN ('male','female','neutral')),
      language          TEXT NOT NULL DEFAULT 'ko',
      description       TEXT,
      style_tags        TEXT[] DEFAULT '{}',
      provider          TEXT NOT NULL DEFAULT 'elevenlabs',
      provider_voice_id TEXT,
      preview_url       TEXT,
      r2v_reference_url    TEXT,
      r2v_reference_status TEXT NOT NULL DEFAULT 'none'
                        CHECK (r2v_reference_status IN ('none','generating','ready')),
      version           INT NOT NULL DEFAULT 1,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await sql(`CREATE INDEX IF NOT EXISTS idx_voices_scope_brand ON voices(scope, brand_id)`);
  await sql(`
    CREATE TABLE IF NOT EXISTS voice_favorites (
      voice_id   UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
      owner_id   TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (voice_id, owner_id)
    )
  `);
  await sql(`
    CREATE TABLE IF NOT EXISTS sound_assets (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id      TEXT NOT NULL,
      type          TEXT NOT NULL CHECK (type IN ('voice','sfx','music')),
      scope         TEXT NOT NULL CHECK (scope IN ('instance','project')),
      brand_id      TEXT,
      episode_id    TEXT,
      session_id    TEXT,
      title         TEXT,
      prompt        TEXT,
      text_content  TEXT,
      segments      JSONB,
      voice_id      UUID,
      provider      TEXT,
      model         TEXT,
      params        JSONB,
      output_url    TEXT,
      output_format TEXT DEFAULT 'mp3_44100_128',
      duration_seconds NUMERIC,
      credits_used  INT,
      status        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','ready','failed')),
      error_message TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await sql(`ALTER TABLE sound_assets ADD COLUMN IF NOT EXISTS owner_id TEXT`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_sound_assets_owner ON sound_assets(owner_id)`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_sound_assets_scope ON sound_assets(scope, brand_id, episode_id, session_id)`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_sound_assets_type ON sound_assets(type, status)`);
  schemaReady = true;
}

// 전역 공용 보이스 시드 — voices 테이블이 비었을 때 1회 삽입.
// ElevenLabs 공개 기본 보이스 ID 매핑(다국어 v3/multilingual_v2 호환).
export const SEED_VOICES: Array<{
  name: string; gender: string; description: string; tags: string[]; providerVoiceId: string;
}> = [
  { name: "마루", gender: "female", description: "조용하고 차분한 내레이션", tags: ["#차분한", "#고요한"], providerVoiceId: "EXAVITQu4vr4xnSDxMaL" },
  { name: "사율", gender: "male", description: "무심한 듯 부드러운 저음", tags: ["#부드러운", "#저음"], providerVoiceId: "pNInz6obpgDQGcFmaJgB" },
  { name: "뚜뮤", gender: "female", description: "호기심 많고 엉뚱한 톤", tags: ["#호기심", "#엉뚱"], providerVoiceId: "21m00Tcm4TlvDq8ikWAM" },
  { name: "네모", gender: "male", description: "또렷하고 신뢰감 있는 음색", tags: ["#또렷한", "#신뢰감"], providerVoiceId: "TxGEqnHWrfWFTfGW9XjX" },
  { name: "별", gender: "female", description: "밝고 경쾌한 캐릭터 보이스", tags: ["#밝은", "#경쾌"], providerVoiceId: "MF3mGyEYCl7XYWbV9V6O" },
  { name: "단", gender: "male", description: "따뜻하고 친근한 진행자", tags: ["#따뜻한", "#친근"], providerVoiceId: "ErXwobaYiN019PkySvjV" },
  { name: "윤", gender: "female", description: "감성적이고 섬세한 표현", tags: ["#감성", "#섬세"], providerVoiceId: "AZnzlk1XvdvUeBnXmlld" },
  { name: "한", gender: "male", description: "에너지 넘치는 활기찬 톤", tags: ["#활기", "#에너지"], providerVoiceId: "yoZ06aMxZJJ28mfd3POQ" },
];

export async function seedGlobalVoicesIfEmpty(sql: SqlFn): Promise<void> {
  const rows = await sql(`SELECT COUNT(*)::int AS n FROM voices WHERE scope = 'global'`);
  const n = Number(rows && rows[0] && rows[0].n) || 0;
  if (n > 0) return;
  for (const v of SEED_VOICES) {
    await sql(
      `INSERT INTO voices (scope, name, gender, language, description, style_tags, provider, provider_voice_id)
       VALUES ('global', $1, $2, 'ko', $3, string_to_array($4, ','), 'elevenlabs', $5)`,
      [v.name, v.gender, v.description, v.tags.join(","), v.providerVoiceId]
    );
  }
}

// ─── GCS 헬퍼 (tts.ts / sfx.ts 검증된 헬퍼 복제) ──────────────────────────────
export function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  if (!uri || !uri.startsWith("gs://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  return { bucket: rest.slice(0, slash), object: rest.slice(slash + 1) };
}

function b64url(input: string) {
  const bytes = new TextEncoder().encode(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
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
  new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
async function signRS256(message: string, pem: string): Promise<string> {
  const cleaned = pem.replace(/\\n/g, "\n").trim();
  const pkcs8Der = pemToArrayBuffer(cleaned);
  const key = await crypto.subtle.importKey("pkcs8", pkcs8Der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(message));
  return bufToB64url(sig);
}

export async function getGoogleAccessToken(opts: { clientEmail: string; privateKeyPem: string; scope: string }) {
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

async function sha256Hex(input: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function b64urlToHex(s: string) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Array.from(atob(b64)).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}

export async function signGcsUrl(opts: { bucket: string; object: string; clientEmail: string; privateKeyPem: string; expiresInSec: number }) {
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

export async function uploadToGcs(opts: {
  bucket: string; object: string; bytes: Uint8Array; contentType: string;
  clientEmail: string; privateKeyPem: string; userProject?: string;
}): Promise<boolean> {
  const token = await getGoogleAccessToken({ clientEmail: opts.clientEmail, privateKeyPem: opts.privateKeyPem, scope: "https://www.googleapis.com/auth/cloud-platform" });
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(opts.bucket)}/o?uploadType=media&name=${encodeURIComponent(opts.object)}`;
  const upRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": opts.contentType,
      ...(opts.userProject ? { "X-Goog-User-Project": opts.userProject } : {}),
    },
    body: opts.bytes,
  });
  return upRes.ok;
}

// GCS 환경설정 묶음 해석
export function resolveGcsEnv(env: any): {
  clientEmail: string; privateKey: string; bucket: string; basePrefix: string; userProject: string;
} | null {
  const clientEmail = String(env.TTS_GOOGLE_CLIENT_EMAIL || env.GOOGLE_CLIENT_EMAIL || "").trim();
  const privateKey = String(env.TTS_GOOGLE_PRIVATE_KEY || env.GOOGLE_PRIVATE_KEY || "").trim();
  const baseOutput = String(env.AUDIO_OUTPUT_GCS_URI || env.VIDEO_OUTPUT_GCS_URI || "").trim();
  if (!clientEmail || !privateKey || !baseOutput) return null;
  const parsed = parseGcsUri(baseOutput);
  if (!parsed) return null;
  return {
    clientEmail,
    privateKey,
    bucket: parsed.bucket,
    basePrefix: parsed.object.replace(/\/$/, ""),
    userProject: String(env.GCS_BILLING_PROJECT_ID || env.GOOGLE_PROJECT_ID || "").trim(),
  };
}

// 사운드 자산 GCS 경로: {basePrefix}/sound/{kind}/{scopeKey}/{assetId}.mp3
export function buildSoundObjectName(basePrefix: string, kind: "voices" | "sfx" | "voice-previews" | "music", scopeKey: string, assetId: string): string {
  const safeScope = String(scopeKey || "instance").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "instance";
  const safeId = String(assetId).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
  const root = basePrefix ? `${basePrefix}/sound` : "sound";
  if (kind === "voice-previews") return `${root}/voice-previews/${safeId}.mp3`;
  return `${root}/${kind}/${safeScope}/${safeId}.mp3`;
}

// ─── ElevenLabs ───────────────────────────────────────────────────────────
export async function elevenLabsTts(opts: {
  apiKey: string; voiceId: string; text: string; modelId: string; stability: number; outputFormat: string;
}): Promise<Uint8Array> {
  const fmt = opts.outputFormat || "mp3_44100_128";
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}?output_format=${encodeURIComponent(fmt)}`;
  const body: any = {
    text: opts.text,
    model_id: opts.modelId || "eleven_v3",
    voice_settings: {
      stability: Math.min(1, Math.max(0, Number(opts.stability))),
      similarity_boost: 0.75,
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": opts.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`elevenlabs_tts_failed::${res.status}::${errText.slice(0, 200)}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export async function elevenLabsSfx(opts: {
  apiKey: string; prompt: string; durationSec: number; promptInfluence: number; looping: boolean;
}): Promise<Uint8Array> {
  const body: any = { text: opts.prompt.slice(0, 450) };
  const clampedDur = Math.min(22, Math.max(0.5, opts.durationSec));
  body.duration_seconds = Math.round(clampedDur * 10) / 10;
  body.prompt_influence = Math.min(1, Math.max(0, Number(opts.promptInfluence)));
  if (opts.looping) body.loop = true;
  const res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: { "xi-api-key": opts.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`elevenlabs_sfx_failed::${res.status}::${errText.slice(0, 200)}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

// ─── Gemini TTS (Cloud Text-to-Speech, tts.ts와 동일 경로) ─────────────────
// AI 기업 에이전트 페이지(/api/tts)에서 검증된 Cloud Gemini-TTS 호출을 사운드 스튜디오에서도 재사용한다.
export const GEMINI_TTS_VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede",
  "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
  "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
];

export function pickGeminiVoiceName(raw: string): string {
  const v = String(raw || "").trim();
  if (!v) return "Kore";
  return GEMINI_TTS_VOICES.find((n) => n.toLowerCase() === v.toLowerCase()) || "Kore";
}

export function normalizeGeminiTtsModel(model: string): string {
  const raw = String(model || "").trim();
  if (!raw) return "gemini-2.5-flash-tts";
  if (raw === "gemini-2.5-flash-preview-tts") return "gemini-2.5-flash-tts";
  if (raw === "gemini-2.5-pro-preview-tts") return "gemini-2.5-pro-tts";
  if (raw === "gemini-2.5-flash-lite-tts") return "gemini-2.5-flash-lite-preview-tts";
  return raw;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(String(b64 || ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function geminiTtsRequest(opts: {
  token: string; text: string; prompt: string; voiceName: string; modelName: string; userProject?: string;
}, modelField: "model_name" | "modelName"): Promise<Uint8Array> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.token}`,
    "Content-Type": "application/json",
  };
  if (opts.userProject) headers["X-Goog-User-Project"] = opts.userProject;
  const voice: Record<string, any> = { languageCode: "ko-KR", name: opts.voiceName };
  voice[modelField] = opts.modelName;
  const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    headers,
    body: JSON.stringify({
      input: { text: opts.text, prompt: opts.prompt || "Say the following in a natural Korean voice." },
      voice,
      audioConfig: { audioEncoding: "MP3" },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`gemini_tts_failed::${res.status}::${text.slice(0, 300)}`);
  let json: any = {};
  try { json = JSON.parse(text); } catch { throw new Error("gemini_tts_bad_response"); }
  const audio = String(json.audioContent || "");
  if (!audio) throw new Error("gemini_tts_empty_audio");
  return base64ToBytes(audio);
}

// model_name 필드가 거부되면 modelName으로 1회 재시도 (tts.ts와 동일 폴백).
export async function geminiTts(opts: {
  clientEmail: string; privateKeyPem: string; userProject?: string;
  text: string; prompt: string; voiceName: string; modelName: string;
}): Promise<Uint8Array> {
  const token = await getGoogleAccessToken({
    clientEmail: opts.clientEmail,
    privateKeyPem: opts.privateKeyPem,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  });
  const req = { token, text: opts.text, prompt: opts.prompt, voiceName: opts.voiceName, modelName: opts.modelName, userProject: opts.userProject };
  try {
    return await geminiTtsRequest(req, "model_name");
  } catch (firstError: any) {
    const msg = String(firstError?.message || firstError || "");
    if (!/modelName|model_name|Unknown name|INVALID_ARGUMENT|400/i.test(msg)) throw firstError;
    return await geminiTtsRequest(req, "modelName");
  }
}

// [calm] [warmly] 형태의 감정 태그를 본문에서 떼어 Gemini 스타일 프롬프트로 변환.
export function splitEmotionTags(text: string): { clean: string; tags: string[] } {
  const tags: string[] = [];
  const clean = String(text || "").replace(/\[([a-zA-Z가-힣 _-]{1,24})\]/g, (_m, tag) => {
    tags.push(String(tag).trim());
    return "";
  }).replace(/\s{2,}/g, " ").trim();
  return { clean: clean || String(text || "").trim(), tags };
}

export function buildGeminiPrompt(tags: string[]): string {
  const base = "Say the following in a natural Korean voice.";
  if (!tags.length) return base;
  return `${base} Speak in a ${tags.join(", ")} tone.`;
}

// MP3 바이트 단순 이어붙이기 (방식 ① — 세그먼트별 합성 후 병합)
export function concatMp3(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.byteLength; }
  return out;
}

export function bytesToDataUrl(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return `data:audio/mpeg;base64,${btoa(bin)}`;
}
