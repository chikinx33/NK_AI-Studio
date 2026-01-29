// prototype/functions/api/video-status.ts
var onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const jobId = (url.searchParams.get("job_id") || "").trim();
    if (!jobId) return json({ error: "job_id is required" }, 400);
    const projectId = env.GOOGLE_PROJECT_ID;
    const clientEmail = env.GOOGLE_CLIENT_EMAIL;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY;
    if (!projectId || !clientEmail || !privateKeyRaw) {
      return json({ error: "Missing GOOGLE_PROJECT_ID / GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY" }, 500);
    }
    const location = "us-central1";
    const normalizedJobId = jobId.startsWith("projects/") ? jobId : jobId.replace(/^\/+/, "");
    const opPath = normalizedJobId;
    const opUrl = `https://${location}-aiplatform.googleapis.com/v1/${opPath}`;
    const accessToken = await getGoogleAccessToken({
      clientEmail,
      privateKeyPem: privateKeyRaw,
      scope: "https://www.googleapis.com/auth/cloud-platform"
    });
    const res = await fetch(opUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const text = await res.text();
    if (!res.ok) {
      return json({ status: "error", message: `operations.get failed (${res.status})`, detail: safeJson(text) }, 500);
    }
    const data = safeJson(text);
    if (!data.done) {
      return json({ status: "processing" });
    }
    if (data.error) {
      return json({ status: "error", message: data.error.message || "Veo error", detail: data.error });
    }
    const gcsUri = data.response?.outputUri || data.response?.outputGcsUri || data.response?.videos?.[0]?.uri || data.response?.videos?.[0]?.outputUri || data.response?.generatedContentUri || "";
    if (!gcsUri) {
      return json({ status: "error", message: "No output URI found", detail: data.response || data });
    }
    let videoUrl = gcsToHttps(gcsUri);
    try {
      const parsed = parseGcsUri(gcsUri);
      if (parsed) {
        videoUrl = await signGcsUrl({
          bucket: parsed.bucket,
          object: parsed.object,
          clientEmail,
          privateKeyPem: privateKeyRaw,
          expiresInSec: 3600
        });
      }
    } catch (_) {
    }
    return json({ status: "done", videoUrl, gcsUri });
  } catch (e) {
    return json({ status: "error", message: e?.message || "Unknown error" }, 500);
  }
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
function gcsToHttps(uri) {
  if (!uri.startsWith("gs://")) return uri;
  const { bucket, object } = parseGcsUri(uri) || { bucket: "", object: "" };
  return `https://storage.googleapis.com/${bucket}/${object}`;
}
function parseGcsUri(uri) {
  if (!uri.startsWith("gs://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const bucket = rest.slice(0, slash);
  const object = rest.slice(slash + 1);
  return { bucket, object };
}
async function getGoogleAccessToken(opts) {
  const now = Math.floor(Date.now() / 1e3);
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
    body: form.toString()
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OAuth token error (${res.status}): ${text}`);
  const json2 = JSON.parse(text);
  if (!json2.access_token) throw new Error("No access_token in OAuth response");
  return json2.access_token;
}
function base64url(input) {
  const bytes = new TextEncoder().encode(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  const b64 = btoa(str);
  return b64.replace(/\\+/g, "-").replace(/\\/ / g, "_").replace(/=+$/g, "");
}
async function signRS256(message, privateKeyPem) {
  const pem = privateKeyPem.replace(/\\n/g, "\n").trim();
  const pkcs8Der = pemToArrayBuffer(pem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8Der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(message));
  return bufferToBase64Url(sigBuf);
}
function pemToArrayBuffer(pem) {
  const lines = pem.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\\s+/g, "");
  const raw = atob(lines);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}
function bufferToBase64Url(buf) {
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\\+/g, "-").replace(/\\/ / g, "_").replace(/=+$/g, "");
}
async function signGcsUrl(opts) {
  const now = /* @__PURE__ */ new Date();
  const pad = (n) => `${n}`.padStart(2, "0");
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${date}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const credential = `${opts.clientEmail}/${date}/auto/storage/goog4_request`;
  const host = "storage.googleapis.com";
  const canonicalUri = `/${encodePathComponent(opts.bucket)}/${encodeFullPath(opts.object)}`;
  const signedHeaders = "host";
  const query = new URLSearchParams({
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": credential,
    "X-Goog-Date": time,
    "X-Goog-Expires": `${opts.expiresInSec}`,
    "X-Goog-SignedHeaders": signedHeaders
  });
  const canonicalQuery = query.toString();
  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQuery,
    `host:${host}`,
    "",
    signedHeaders,
    "UNSIGNED-PAYLOAD"
  ].join("\\n");
  const hashedRequest = await sha256Hex(canonicalRequest);
  const stringToSign = [
    "GOOG4-RSA-SHA256",
    time,
    `${date}/auto/storage/goog4_request`,
    hashedRequest
  ].join("\\n");
  const signatureB64url = await signRS256(stringToSign, opts.privateKeyPem);
  const signatureHex = b64urlToHex(signatureB64url);
  const finalQuery = `${canonicalQuery}&X-Goog-Signature=${signatureHex}`;
  return `https://${host}${canonicalUri}?${finalQuery}`;
}
function encodePathComponent(part) {
  return encodeURIComponent(part).replace(/%2F/g, "/");
}
function encodeFullPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}
async function sha256Hex(input) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return bufferToHex(buf);
}
function bufferToHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function b64urlToHex(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  return Array.from(bin).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}
export {
  onRequestGet
};
