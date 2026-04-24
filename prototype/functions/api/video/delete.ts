// prototype/functions/api/video/delete.ts
// Delete one or more GCS video objects belonging to the authenticated user.
// Body: { objectName?: string, objectNames?: string[], confirm: 'yes' }
import { buildUserRoot } from "../_shared/storage";
import { authorizeRequest } from "../_shared/auth.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const corsHeaders = (origin: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Origin": origin || "*",
  "Vary": "Origin",
});

const send = (data: any, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    const body = await request.json().catch(() => ({} as any));
    const confirm = String((body as any).confirm || "").trim() === "yes";
    if (!confirm) return send({ error: "confirm=yes required" }, 400, origin);

    const single = String((body as any).objectName || (body as any).object || "").trim();
    const list = Array.isArray((body as any).objectNames)
      ? (body as any).objectNames.map((v: any) => String(v || "").trim()).filter(Boolean)
      : [];
    const targets = list.length ? list : (single ? [single] : []);
    if (!targets.length) return send({ error: "objectName(s) required" }, 400, origin);

    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    const baseOutput = env.VIDEO_OUTPUT_GCS_URI as string | undefined;
    if (!clientEmail || !privateKeyRaw || !baseOutput) {
      return send({ error: "Missing GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY/VIDEO_OUTPUT_GCS_URI" }, 500, origin);
    }
    const outParsed = parseGcsUri(baseOutput);
    if (!outParsed) return send({ error: "Invalid VIDEO_OUTPUT_GCS_URI" }, 500, origin);

    const basePrefix = outParsed.object.replace(/\/$/, "");
    const userRoot = buildUserRoot(basePrefix, auth.userId);
    const allowedPrefix = `${userRoot}/`;
    const blocked = targets.filter((name) => !name.startsWith(allowedPrefix));
    if (blocked.length) {
      return send({ error: "objectName outside user scope", blocked }, 403, origin);
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
    const billingQuery = userProject ? `?userProject=${encodeURIComponent(userProject)}` : "";
    const billingHeader = userProject ? { "X-Goog-User-Project": userProject } : {};

    let deletedCount = 0;
    const failed: Array<{ name: string; status: number; detail: any }> = [];
    for (const name of targets) {
      const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o/${encodeURIComponent(name)}${billingQuery}`;
      const res = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, ...billingHeader },
      });
      if (res.status === 204 || res.status === 404) {
        deletedCount += 1;
        continue;
      }
      failed.push({ name, status: res.status, detail: safeJson(await res.text()) });
    }
    return send({ requestedCount: targets.length, deletedCount, failedCount: failed.length, failed }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, origin);
  }
};

function safeJson(text: string) { try { return JSON.parse(text); } catch { return text; } }
function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  if (!uri.startsWith("gs://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  return { bucket: rest.slice(0, slash), object: rest.slice(slash + 1) };
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
  return btoa(str).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
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
