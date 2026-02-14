type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const corsHeaders = (origin?: string | null, extra?: Record<string, string>) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Range",
  "Access-Control-Expose-Headers": "Content-Type, Content-Length, Content-Range, Accept-Ranges",
  "Vary": "Origin",
  ...(extra || {}),
});

const send = (data: any, status = 200, origin?: string | null) =>
  new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(origin, { "Content-Type": "application/json; charset=utf-8" }),
  });

type GcsPath = { bucket: string; object: string };

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const reqUrl = new URL(request.url);
    const rawUrl = String(reqUrl.searchParams.get("url") || "").trim();
    const objectName = String(reqUrl.searchParams.get("objectName") || "").trim();

    let target: GcsPath | null = null;
    if (objectName) target = parseObjectNameTarget(objectName, env);
    else target = parseRawMediaUrl(rawUrl);

    if (!target) {
      return send({ error: "url or objectName must point to a valid GCS object" }, 400, origin);
    }

    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    if (!clientEmail || !privateKeyRaw) {
      return send({ error: "Missing GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY" }, 500, origin);
    }

    const token = await getGoogleAccessToken({
      clientEmail,
      privateKeyPem: privateKeyRaw,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });

    const userProject =
      (env.GCS_BILLING_PROJECT_ID as string | undefined) ||
      (env.GOOGLE_PROJECT_ID as string | undefined) ||
      "";
    const mediaUrl =
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(target.bucket)}` +
      `/o/${encodeURIComponent(target.object)}?alt=media`;

    const range = request.headers.get("Range");
    const upstream = await fetch(mediaUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(range ? { Range: range } : {}),
        ...(userProject ? { "X-Goog-User-Project": userProject } : {}),
      },
    });

    if (!upstream.ok) {
      const detailText = await upstream.text();
      return send(
        {
          error: "media_proxy_fetch_failed",
          status: upstream.status,
          detail: safeJson(detailText),
        },
        upstream.status,
        origin
      );
    }

    const headers = corsHeaders(origin, {
      "Content-Type": upstream.headers.get("Content-Type") || "application/octet-stream",
      "Cache-Control": upstream.headers.get("Cache-Control") || "private, max-age=300",
      ...(upstream.headers.get("Content-Length")
        ? { "Content-Length": String(upstream.headers.get("Content-Length")) }
        : {}),
      ...(upstream.headers.get("Content-Range")
        ? { "Content-Range": String(upstream.headers.get("Content-Range")) }
        : {}),
      ...(upstream.headers.get("Accept-Ranges")
        ? { "Accept-Ranges": String(upstream.headers.get("Accept-Ranges")) }
        : { "Accept-Ranges": "bytes" }),
      ...(upstream.headers.get("ETag") ? { ETag: String(upstream.headers.get("ETag")) } : {}),
      ...(upstream.headers.get("Last-Modified")
        ? { "Last-Modified": String(upstream.headers.get("Last-Modified")) }
        : {}),
    });

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

function parseObjectNameTarget(objectName: string, env: any): GcsPath | null {
  const out = parseGcsUri(String(env.VIDEO_OUTPUT_GCS_URI || ""));
  if (!out) return null;
  const cleanObject = String(objectName || "").replace(/^\/+/, "");
  if (!cleanObject) return null;
  return { bucket: out.bucket, object: cleanObject };
}

function parseRawMediaUrl(raw: string): GcsPath | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (value.startsWith("gs://")) return parseGcsUri(value);
  try {
    const u = new URL(value);
    if (u.hostname !== "storage.googleapis.com") return null;
    const path = String(u.pathname || "").replace(/^\/+/, "");
    const slash = path.indexOf("/");
    if (slash < 1) return null;
    const bucket = path.slice(0, slash);
    const object = decodeURIComponent(path.slice(slash + 1));
    if (!bucket || !object) return null;
    return { bucket, object };
  } catch (_) {
    return null;
  }
}

function parseGcsUri(uri: string): GcsPath | null {
  if (!uri.startsWith("gs://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const bucket = rest.slice(0, slash);
  const object = rest.slice(slash + 1);
  if (!bucket || !object) return null;
  return { bucket, object };
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function getGoogleAccessToken(opts: { clientEmail: string; privateKeyPem: string; scope: string }) {
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
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8Der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(message)
  );
  return bufferToBase64Url(sigBuf);
}

function pemToArrayBuffer(pem: string) {
  const lines = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .split(/\s+/)
    .join("");
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
