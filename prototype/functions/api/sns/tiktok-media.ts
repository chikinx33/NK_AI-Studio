/**
 * TikTok Photo Post 전용 공개 미디어 프록시.
 *
 * TikTok Content Posting API 의 PULL_FROM_URL 방식은 photo_images URL 의
 * 도메인이 TikTok Developer Portal 에서 "URL ownership verified" 되어 있어야 한다.
 * GCS(storage.googleapis.com) 는 우리 소유 도메인이 아니라 인증할 수 없으므로,
 * 우리 자신의 도메인(요청 origin) 경로로 이미지를 중계한다.
 * 프록시 URL 은 publish.ts 에서 new URL(request.url).origin 기준으로 생성되므로
 * 서비스 도메인(nkstudio.org / nk-ai-studio.pages.dev)에 자동으로 맞춰진다.
 *
 * 인증되지 않은 임의 GCS 객체 접근을 막기 위해 publish.ts 가 HMAC-SHA256 으로
 * 서명한 단기 토큰(o, e, s 쿼리)을 검증한 뒤에만 바이트를 스트리밍한다.
 *
 * 포털 설정: TikTok Developer Portal > URL properties 에 실제 서비스 도메인의
 *   https://nkstudio.org/api/sns/tiktok-media
 * 를 URL prefix 로 등록하고 ownership 인증을 1회 완료해야 한다.
 * (전환 기간엔 기존 nk-ai-studio.pages.dev prefix 도 함께 등록해 둘 수 있다.)
 */

function parseGcsUri(uri: string): { bucket: string; object: string } {
  const without = String(uri || "").replace(/^gs:\/\//, "");
  const slash = without.indexOf("/");
  if (slash === -1) return { bucket: without, object: "" };
  return { bucket: without.slice(0, slash), object: without.slice(slash + 1) };
}

/** GCS JSON API o/{object} 경로용: 객체 이름 전체를 percent-encoding */
function gcsObjectPath(objectName: string): string {
  return encodeURIComponent(String(objectName || ""));
}

function readMediaSecret(env: any): string {
  return String(
    (env && (env.AUTH_SESSION_SECRET || env.NK_AUTH_SESSION_SECRET)) ||
    (env && (env.AUTH_PW || env.GOOGLE_PRIVATE_KEY || env.GOOGLE_PROJECT_ID)) ||
    "nk_studio_legacy_session_secret_v1"
  ).trim();
}

async function hmacSha256B64url(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  let bin = "";
  new Uint8Array(sig).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = String(a || "");
  const right = String(b || "");
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

async function getGoogleAccessToken(opts: {
  clientEmail: string;
  privateKeyPem: string;
  scope: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: opts.clientEmail,
    scope: opts.scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const b64 = (obj: object) =>
    btoa(JSON.stringify(obj)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const message = `${b64(header)}.${b64(payload)}`;
  const pem = opts.privateKeyPem.replace(/\\n/g, "\n").trim();
  const lines = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .split(/\s+/).join("");
  const raw = atob(lines);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  const key = await crypto.subtle.importKey(
    "pkcs8", buf.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
  const sigBuf = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(message)
  );
  let bin = "";
  new Uint8Array(sigBuf).forEach((b) => (bin += String.fromCharCode(b)));
  const sig = btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const jwt = `${message}.${sig}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Failed to get Google access token");
  return data.access_token;
}

async function serveMedia(request: Request, env: any, method: "GET" | "HEAD"): Promise<Response> {
  const url = new URL(request.url);
  const objectName = String(url.searchParams.get("o") || "");
  const exp = parseInt(url.searchParams.get("e") || "0", 10);
  const sig = String(url.searchParams.get("s") || "");

  if (!objectName || !exp || !sig) {
    return new Response("bad request", { status: 400 });
  }
  if (exp < Math.floor(Date.now() / 1000)) {
    return new Response("link expired", { status: 403 });
  }

  const secret = readMediaSecret(env);
  const expected = await hmacSha256B64url(secret, `${objectName}|${exp}`);
  if (!timingSafeEqual(sig, expected)) {
    return new Response("forbidden", { status: 403 });
  }

  try {
    const { bucket } = parseGcsUri(env.VIDEO_OUTPUT_GCS_URI);
    const googleToken = await getGoogleAccessToken({
      clientEmail: env.GOOGLE_CLIENT_EMAIL,
      privateKeyPem: env.GOOGLE_PRIVATE_KEY,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });

    // TikTok 의 PULL_FROM_URL 수집기는 Range 요청으로 나눠 받아간다. 그대로 전달한다.
    const gcsHeaders: Record<string, string> = { Authorization: `Bearer ${googleToken}` };
    const range = request.headers.get("Range");
    if (range) gcsHeaders["Range"] = range;

    const gcsRes = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${gcsObjectPath(objectName)}?alt=media`,
      { headers: gcsHeaders }
    );
    if (!gcsRes.ok && gcsRes.status !== 206) {
      return new Response("not found", { status: gcsRes.status === 404 ? 404 : 502 });
    }

    const type =
      gcsRes.headers.get("Content-Type") ||
      (/\.(mp4|mov|m4v)$/i.test(objectName) ? "video/mp4" : "image/jpeg");
    const headers: Record<string, string> = {
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
    };
    const len = gcsRes.headers.get("Content-Length");
    if (len) headers["Content-Length"] = len;
    const contentRange = gcsRes.headers.get("Content-Range");
    if (contentRange) headers["Content-Range"] = contentRange;

    // 영상은 수백 MB 가 될 수 있다. arrayBuffer 로 들고 있으면 워커 메모리가 터지므로
    // 버퍼링 없이 그대로 흘려보낸다. HEAD 는 본문 없이 헤더만 돌려준다.
    if (method === "HEAD") {
      try { await gcsRes.body?.cancel(); } catch { /* 무시 */ }
      return new Response(null, { status: gcsRes.status, headers });
    }
    return new Response(gcsRes.body, { status: gcsRes.status, headers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(`proxy error: ${msg}`, { status: 500 });
  }
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) =>
  serveMedia(request, env, "GET");

export const onRequestHead = async ({ request, env }: { request: Request; env: any }) =>
  serveMedia(request, env, "HEAD");
