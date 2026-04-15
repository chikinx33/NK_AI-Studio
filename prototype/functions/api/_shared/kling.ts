// prototype/functions/api/_shared/kling.ts
// Kling AI 공용 helper (JWT HS256 서명/캐싱, 엔드포인트/모델 매핑, API 호출 래퍼).
// - 글로벌 엔드포인트 기본값: https://api-singapore.klingai.com (env KLING_API_BASE 로 override)
// - 인증: JWT(HS256) 30분 만료. 본 모듈은 Worker 모듈 스코프 메모리 캐시로 자동 재발급.

const DEFAULT_BASE = "https://api-singapore.klingai.com";

interface JwtCacheEntry {
  token: string;
  expiresAt: number; // unix sec
  accessKey: string;
}

// 모듈 스코프 캐시 (Worker 인스턴스 단위). 각 요청이 새로운 인스턴스에 히트할 수도 있지만
// 같은 인스턴스 내 재사용은 커넥션 절약이 된다.
let jwtCache: JwtCacheEntry | null = null;

export type KlingQuality = "draft" | "final";

export function klingModelFor(quality: KlingQuality): string {
  return quality === "final" ? "kling-v2-1-master" : "kling-v1-6";
}

// Kling duration은 "5" 또는 "10"만 허용. 입력(4/6/8)을 근접값으로 스냅.
export function snapKlingDuration(sec: number): "5" | "10" {
  const n = Math.max(1, Math.floor(Number(sec) || 0));
  return n >= 8 ? "10" : "5";
}

// Kling aspect_ratio: "16:9" | "9:16" | "1:1"
export function normalizeKlingAspect(raw: any): "16:9" | "9:16" | "1:1" {
  const text = String(raw ?? "").trim().replace(/\s+/g, "").replace("/", ":");
  if (text === "9:16" || text === "1:1") return text as any;
  return "16:9";
}

export function klingBase(env: any): string {
  const raw = String(env?.KLING_API_BASE || "").trim().replace(/\/+$/, "");
  return raw || DEFAULT_BASE;
}

export function klingEndpoints(env: any) {
  const base = klingBase(env);
  return {
    base,
    image2video: `${base}/v1/videos/image2video`,
    multiImage2video: `${base}/v1/videos/multi-image2video`,
    lipSync: `${base}/v1/videos/lip-sync`,
  };
}

export async function getKlingJwt(env: any): Promise<string> {
  const accessKey = String(env?.KLING_ACCESS_KEY || "").trim();
  const secretKey = String(env?.KLING_SECRET_KEY || "").trim();
  if (!accessKey || !secretKey) {
    throw new Error("KLING_ACCESS_KEY / KLING_SECRET_KEY not configured");
  }
  const now = Math.floor(Date.now() / 1000);
  if (jwtCache && jwtCache.accessKey === accessKey && jwtCache.expiresAt > now + 60) {
    return jwtCache.token;
  }
  const token = await signKlingJwt(accessKey, secretKey);
  // 30분 만료 - 60초 safety margin
  jwtCache = { token, expiresAt: now + 1800 - 60, accessKey };
  return token;
}

async function signKlingJwt(accessKey: string, secretKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: accessKey,
    exp: now + 1800, // 30분
    nbf: now - 5,
  };
  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const unsigned = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${bufferToBase64Url(sigBuf)}`;
}

// Kling API 호출 (JWT 만료시 한 번 자동 재발급 후 재시도)
export async function callKlingApi(env: any, url: string, init: RequestInit): Promise<Response> {
  let token = await getKlingJwt(env);
  const doCall = async (authToken: string) =>
    fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {}),
        Authorization: `Bearer ${authToken}`,
      },
    });
  let res = await doCall(token);
  if (res.status === 401 || res.status === 403) {
    jwtCache = null; // 강제 만료
    token = await getKlingJwt(env);
    res = await doCall(token);
  }
  return res;
}

// 결과 비디오 URL 추출 (Kling 응답 스펙)
export function pickKlingVideoUrl(json: any): string {
  const videos =
    json?.data?.task_result?.videos ||
    json?.task_result?.videos ||
    json?.data?.videos ||
    [];
  if (Array.isArray(videos) && videos.length > 0) {
    return String(videos[0]?.url || videos[0]?.video_url || "");
  }
  return "";
}

export function klingTaskStatus(json: any): string {
  const s =
    json?.data?.task_status ||
    json?.task_status ||
    json?.status ||
    "";
  return String(s).toLowerCase();
}

export function isKlingDone(status: string): boolean {
  return status === "succeed" || status === "success" || status === "completed" || status === "done";
}

export function isKlingFailed(status: string): boolean {
  return status === "failed" || status === "failure" || status === "error";
}

function base64urlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function bufferToBase64Url(buf: ArrayBuffer): string {
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

// data: URL 에서 base64 부분만 추출 (Kling은 data: 접두어 없이 base64 문자열을 받음)
export function stripDataUrlPrefix(dataUrl: string): string {
  if (!dataUrl) return "";
  if (dataUrl.startsWith("data:")) {
    const idx = dataUrl.indexOf(",");
    return idx === -1 ? "" : dataUrl.slice(idx + 1);
  }
  return dataUrl;
}
