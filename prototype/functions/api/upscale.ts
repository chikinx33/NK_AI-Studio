// prototype/functions/api/upscale.ts
// POST /api/upscale { imageUrl, sessionId, storageService }
// Atlas Cloud image-upscaler (atlascloud/image-upscaler) 를 이용해 이미지를 업스케일한다.
// creativity:0 으로 내용 변화 없이 해상도만 향상. ATLASCLOUD_API_KEY 재사용.
import { buildAiImageSessionPrefix } from "./_shared/storage";
import { authorizeRequest } from "./_shared/auth.js";
import { hasPagePermission } from "./_shared/admin-users";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  const origin = request.headers.get("Origin");
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      Vary: "Origin",
    },
  });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status, origin);
    if (!(await hasPagePermission(env, auth.userId, "image"))) {
      return json({ error: "permission_denied" }, 403, origin);
    }

    const atlasKey = String(env.ATLASCLOUD_API_KEY || "").trim();
    if (!atlasKey) return json({ error: "ATLASCLOUD_API_KEY 미설정" }, 500, origin);

    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    const baseOutput = env.VIDEO_OUTPUT_GCS_URI as string | undefined;
    const outParsed = baseOutput ? parseGcsUri(baseOutput) : null;

    const body = await request.json().catch(() => ({} as any));
    const imageUrl = String(body?.imageUrl || "").trim();
    const objectName = String(body?.objectName || "").trim();
    const sessionId = String(body?.sessionId || "default").trim() || "default";
    const storageService = String(body?.storageService || "ai-image").trim();
    const userId = String(auth.userId || "owner").trim() || "owner";

    if (!imageUrl && !objectName) return json({ error: "imageUrl 또는 objectName 필요" }, 400, origin);

    // Atlas Cloud는 외부에서 접근 가능한 HTTP URL이 필요.
    // objectName → 서버에서 GCS 서명 URL 발급 (proxy URL·만료 URL 문제 해결)
    // data: URL → GCS 임시 업로드 후 서명 URL
    // 그 외 http URL → 그대로 전달
    let accessibleUrl = "";

    if (objectName && outParsed && clientEmail && privateKeyRaw) {
      accessibleUrl = await signGcsUrl({
        bucket: outParsed.bucket,
        object: objectName,
        clientEmail,
        privateKeyPem: privateKeyRaw,
        expiresInSec: 300,
      }).catch(() => "");
      if (!accessibleUrl) return json({ error: "GCS 서명 URL 발급 실패" }, 500, origin);
    } else if (imageUrl.startsWith("data:")) {
      const uploaded = await uploadDataUrlToGcs(imageUrl, outParsed, userId, sessionId, clientEmail, privateKeyRaw);
      if (!uploaded) return json({ error: "소스 이미지 GCS 업로드 실패 (data URL)" }, 500, origin);
      accessibleUrl = uploaded;
    } else if (imageUrl.startsWith("http")) {
      accessibleUrl = imageUrl;
    } else {
      return json({ error: "지원하지 않는 이미지 URL 형식" }, 400, origin);
    }

    // Atlas Cloud image-upscaler 호출 (sync 모드)
    const atlasRes = await fetch("https://api.atlascloud.ai/api/v1/model/generateImage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${atlasKey}`,
      },
      body: JSON.stringify({
        model: "atlascloud/image-upscaler",
        image: accessibleUrl,
        creativity: 0,
        output_format: "png",
        target_resolution: "2k",
        enable_sync_mode: true,
      }),
    });

    const atlasText = await atlasRes.text();
    if (!atlasRes.ok) {
      return json({ error: `Atlas 업스케일 오류 (${atlasRes.status})`, detail: atlasText }, 500, origin);
    }

    const atlasJson = safeJson(atlasText);
    const resultUrl = String(
      (Array.isArray(atlasJson?.outputs) && atlasJson.outputs[0]) || ""
    ).trim();

    if (!resultUrl) {
      return json({ error: "업스케일 결과 URL 없음", raw: atlasJson }, 500, origin);
    }

    // 결과 이미지를 GCS에 저장
    let signedUrl = "";
    let objectName = "";

    if (outParsed && clientEmail && privateKeyRaw) {
      const accessToken = await getGoogleAccessToken({
        clientEmail,
        privateKeyPem: privateKeyRaw,
        scope: "https://www.googleapis.com/auth/devstorage.read_write",
      }).catch(() => null);

      if (accessToken) {
        const resultRes = await fetch(resultUrl).catch(() => null);
        if (resultRes && resultRes.ok) {
          const pngBuf = await resultRes.arrayBuffer();
          const basePrefix = outParsed.object.replace(/\/$/, "");
          const stamp = Date.now();
          const sessionPrefix = buildAiImageSessionPrefix(basePrefix, userId, sessionId);
          objectName = `${sessionPrefix}/outputs/${stamp}-${crypto.randomUUID()}-2x.png`;

          const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
          const upRes = await fetch(uploadUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "image/png" },
            body: new Uint8Array(pngBuf),
          });

          if (upRes.ok) {
            signedUrl = await signGcsUrl({
              bucket: outParsed.bucket,
              object: objectName,
              clientEmail,
              privateKeyPem: privateKeyRaw,
              expiresInSec: 3600,
            }).catch(() => gcsToHttps(`gs://${outParsed.bucket}/${objectName}`));
          } else {
            objectName = "";
          }
        }
      }
    }

    // GCS 실패 시 Atlas 결과 URL 직접 반환 (임시 URL)
    return json({
      signedUrl: signedUrl || resultUrl,
      objectName,
      dataUrl: "",
      imageSizeApplied: "2X",
      model: "atlascloud/image-upscaler",
      provider: "atlascloud",
      storageService,
      sessionId,
    }, 200, origin);
  } catch (e: any) {
    return json({ error: e?.message ?? "업스케일 처리 중 오류" }, 500, origin);
  }
};

// data: URL → GCS 업로드 → 공개 signed URL 반환
async function uploadDataUrlToGcs(
  dataUrl: string,
  outParsed: { bucket: string; object: string } | null,
  userId: string,
  sessionId: string,
  clientEmail: string | undefined,
  privateKeyRaw: string | undefined
): Promise<string | null> {
  if (!outParsed || !clientEmail || !privateKeyRaw) return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1] || "image/png";
  const bytes = base64ToUint8(match[2]);

  const accessToken = await getGoogleAccessToken({
    clientEmail,
    privateKeyPem: privateKeyRaw,
    scope: "https://www.googleapis.com/auth/devstorage.read_write",
  }).catch(() => null);
  if (!accessToken) return null;

  const basePrefix = outParsed.object.replace(/\/$/, "");
  const ext = (mime.split("/")[1] || "png").toLowerCase();
  const sessionPrefix = buildAiImageSessionPrefix(basePrefix, userId, sessionId);
  const objName = `${sessionPrefix}/inputs/${Date.now()}-${crypto.randomUUID()}-src.${ext}`;

  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(objName)}`;
  const upRes = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": mime },
    body: bytes,
  });
  if (!upRes.ok) return null;

  return await signGcsUrl({
    bucket: outParsed.bucket,
    object: objName,
    clientEmail,
    privateKeyPem: privateKeyRaw,
    expiresInSec: 300,
  }).catch(() => gcsToHttps(`gs://${outParsed.bucket}/${objName}`));
}

function safeJson(text: string): any {
  try { return JSON.parse(text); } catch { return {}; }
}

function json(data: any, status = 200, origin?: string | null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin || "*",
      Vary: "Origin",
    },
  });
}

// ── GCS helpers ───────────────────────────────────────────────────────────────

function base64ToUint8(b64: string) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function getGoogleAccessToken(opts: {
  clientEmail: string;
  privateKeyPem: string;
  scope: string;
}) {
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
  const res = await fetch(aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OAuth token error (${res.status}): ${text}`);
  const parsed = JSON.parse(text);
  if (!parsed.access_token) throw new Error("No access_token in OAuth response");
  return parsed.access_token as string;
}

function base64url(input: string) {
  const bytes = new TextEncoder().encode(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signRS256(message: string, privateKeyPem: string) {
  const pem = privateKeyPem.replace(/\\n/g, "\n").trim();
  const pkcs8Der = pemToArrayBuffer(pem);
  const key = await crypto.subtle.importKey(
    "pkcs8", pkcs8Der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const sigBuf = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(message));
  const sigBytes = new Uint8Array(sigBuf);
  let bin = "";
  for (const b of sigBytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem: string) {
  const lines = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const raw = atob(lines);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  if (!uri || !uri.startsWith("gs://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  return { bucket: rest.slice(0, slash), object: rest.slice(slash + 1) };
}

function gcsToHttps(uri: string) {
  if (!uri.startsWith("gs://")) return uri;
  const parsed = parseGcsUri(uri);
  if (!parsed) return uri;
  return `https://storage.googleapis.com/${parsed.bucket}/${parsed.object}`;
}

async function sha256Hex(message: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function b64urlToHex(b64url: string) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  let hex = "";
  for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
  return hex;
}

async function signGcsUrl(opts: {
  bucket: string;
  object: string;
  clientEmail: string;
  privateKeyPem: string;
  expiresInSec: number;
}) {
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
