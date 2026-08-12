// prototype/functions/api/video/upload.ts
// Upload local video file to:
// {basePrefix}/users/{userId}/ai-video/projects{projectId}/videos/
import { buildAiVideoProjectPrefix } from "../_shared/storage";
import { authorizeRequest } from "../_shared/auth.js";

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

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const origin = request.headers.get("Origin");
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const fd = await request.formData();
    const projectId = String(fd.get("projectId") || "").trim();
    const userId = auth.userId;
    const sceneId = String(fd.get("sceneId") || "").trim();
    const file = fd.get("file") as File | null;
    if (!projectId || !sceneId || !file) {
      return send({ error: "projectId, sceneId, and file are required" }, 400, origin);
    }
    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    const baseOutput = env.VIDEO_OUTPUT_GCS_URI as string | undefined;
    if (!clientEmail || !privateKeyRaw || !baseOutput) {
      return send({ error: "Missing GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY/VIDEO_OUTPUT_GCS_URI" }, 500, origin);
    }
    const outParsed = parseGcsUri(baseOutput);
    if (!outParsed) return send({ error: "Invalid VIDEO_OUTPUT_GCS_URI" }, 500, origin);
    const basePrefix = outParsed.object.replace(/\/$/, "");
    const projectPrefix = buildAiVideoProjectPrefix(basePrefix, userId, projectId);
    const safeName = (file.name || "video.mp4").replace(/[^a-zA-Z0-9._-]+/g, "_");
    const stamp = Date.now();
    const objectName = `${projectPrefix}/videos/${stamp}-scene-${sceneId}-${safeName}`;

    const token = await getGoogleAccessToken({
      clientEmail,
      privateKeyPem: privateKeyRaw,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });
    const buf = await file.arrayBuffer();
    const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
    const upRes = await fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": file.type || "video/mp4" },
      body: buf,
    });
    const upText = await upRes.text();
    if (!upRes.ok) {
      return send({ error: "Upload failed", status: upRes.status, detail: safeJson(upText) }, upRes.status, origin);
    }
    // 생성 정보를 object metadata로 기록 → library 응답에 실려 기기 간 목록이 같아진다.
    const metadata: Record<string, string> = {};
    for (const key of ["prompt", "model", "modelLabel", "aspectRatio", "duration", "resultId"]) {
      const v = String(fd.get(key) || "").trim();
      if (v) metadata[key] = v.slice(0, 400);
    }
    if (Object.keys(metadata).length) {
      try {
        const patchUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o/${encodeURIComponent(objectName)}`;
        await fetch(patchUrl, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ metadata }),
        });
      } catch { /* 메타 기록 실패는 업로드 자체를 실패시키지 않는다 */ }
    }
    const signedUrl = await signGcsUrl({
      bucket: outParsed.bucket,
      object: objectName,
      clientEmail,
      privateKeyPem: privateKeyRaw,
      expiresInSec: 3600,
    }).catch(() => gcsToHttps(`gs://${outParsed.bucket}/${objectName}`));
    return send({ signedUrl, objectName }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, request.headers.get("Origin"));
  }
};
export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

function safeJson(text: string) { try { return JSON.parse(text); } catch { return text; } }
function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  if (!uri.startsWith("gs://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const bucket = rest.slice(0, slash);
  const object = rest.slice(slash + 1);
  return { bucket, object };
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
