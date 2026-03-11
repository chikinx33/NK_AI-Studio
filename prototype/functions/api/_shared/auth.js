const AUTH_ALGO = { name: "HMAC", hash: "SHA-256" };
const DEFAULT_TTL_SEC = 60 * 60 * 12;

export async function issueSessionToken(userId, env, ttlSec = DEFAULT_TTL_SEC) {
  const safeUserId = sanitizeUserId(userId);
  const secret = readSecret(env);
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    sub: safeUserId,
    iat: now,
    exp: now + Math.max(300, Number(ttlSec) || DEFAULT_TTL_SEC),
  };
  const encoded = base64url(JSON.stringify(payload));
  const sig = await sign(encoded, secret);
  return {
    token: `${encoded}.${sig}`,
    userId: safeUserId,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

export async function authorizeRequest(request, env, options = {}) {
  try {
    const token = readToken(request, !!options.allowQueryToken);
    if (!token) {
      return { ok: false, status: 401, error: "auth_required" };
    }
    const payload = await verifySessionToken(token, env);
    if (!payload || !payload.sub) {
      return { ok: false, status: 401, error: "invalid_session" };
    }
    return {
      ok: true,
      status: 200,
      userId: sanitizeUserId(payload.sub),
      payload,
      token,
    };
  } catch (err) {
    return {
      ok: false,
      status: 401,
      error: err && err.message ? err.message : "invalid_session",
    };
  }
}

export async function verifySessionToken(token, env) {
  const secret = readSecret(env);
  const raw = String(token || "").trim();
  const parts = raw.split(".");
  if (parts.length !== 2) throw new Error("invalid_session");
  const encoded = parts[0];
  const sig = parts[1];
  const expected = await sign(encoded, secret);
  if (!timingSafeEqual(sig, expected)) throw new Error("invalid_session");
  const payload = safeJson(base64urlDecode(encoded));
  if (!payload || typeof payload !== "object") throw new Error("invalid_session");
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || Number(payload.exp) <= now) throw new Error("session_expired");
  if (!payload.sub) throw new Error("invalid_session");
  return payload;
}

export function sanitizeUserId(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return "";
  const normalized = value
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return normalized;
}

function readSecret(env) {
  const direct = String(env && (env.AUTH_SESSION_SECRET || env.NK_AUTH_SESSION_SECRET) || "").trim();
  if (direct) return direct;
  const derived = String(
    env && (
      env.AUTH_PW ||
      env.GOOGLE_PRIVATE_KEY ||
      env.GOOGLE_PROJECT_ID ||
      "nk_studio_legacy_session_secret_v1"
    ) || ""
  ).trim();
  if (!derived) throw new Error("AUTH_SESSION_SECRET missing");
  return derived;
}

function readToken(request, allowQueryToken) {
  const auth = String(request.headers.get("Authorization") || "").trim();
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match && match[1]) return match[1].trim();
  if (!allowQueryToken) return "";
  try {
    const url = new URL(request.url);
    return String(url.searchParams.get("nk_token") || "").trim();
  } catch (_) {
    return "";
  }
}

async function sign(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret)),
    AUTH_ALGO,
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign(AUTH_ALGO.name, key, new TextEncoder().encode(String(message)));
  return bufferToBase64Url(sigBuf);
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function base64url(input) {
  const bytes = new TextEncoder().encode(String(input || ""));
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecode(input) {
  const raw = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function bufferToBase64Url(buf) {
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function timingSafeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}
