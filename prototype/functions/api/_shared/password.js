// prototype/functions/api/_shared/password.js
// PBKDF2(SHA-256) 기반 비밀번호 해시/검증. Web Crypto(crypto.subtle)만 사용 → Workers 호환.
// 저장 포맷: "pbkdf2$<iterations>$<saltB64url>$<hashB64url>"

const DEFAULT_ITERATIONS = 100000;
const KEY_LEN_BITS = 256; // 32 bytes
const SALT_LEN = 16;

/** 평문 비밀번호 → 해시 문자열. */
export async function hashPassword(password, iterations = DEFAULT_ITERATIONS) {
  const pw = String(password || "");
  if (!pw) throw new Error("password_required");
  const iter = Math.max(10000, Number(iterations) || DEFAULT_ITERATIONS);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const bits = await deriveBits(pw, salt, iter);
  return `pbkdf2$${iter}$${b64url(salt.buffer)}$${b64url(bits)}`;
}

/** 평문 비밀번호가 저장된 해시와 일치하는지 검증(상수 시간 비교). */
export async function verifyPassword(password, stored) {
  try {
    const pw = String(password || "");
    const parts = String(stored || "").split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
    const iter = Math.max(10000, parseInt(parts[1], 10) || DEFAULT_ITERATIONS);
    const salt = b64urlToBytes(parts[2]);
    const expected = String(parts[3] || "");
    if (!salt || !expected) return false;
    const bits = await deriveBits(pw, salt, iter);
    return timingSafeEqual(b64url(bits), expected);
  } catch (_) {
    return false;
  }
}

/** 저장 값이 PBKDF2 해시 포맷인지 여부. */
export function isHashed(stored) {
  return /^pbkdf2\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(String(stored || ""));
}

async function deriveBits(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(password)),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    KEY_LEN_BITS
  );
}

function b64url(buf) {
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(input) {
  const raw = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function timingSafeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
