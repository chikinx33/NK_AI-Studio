// prototype/functions/api/ai-image/session-delete.ts
import { buildAiImageSessionPrefix, buildAiImageUserRoot } from "../_shared/storage";
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

export const onRequestOptions: PagesFunction = async ({ request }) => {
  const origin = request.headers.get("Origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const origin = request.headers.get("Origin");
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    const body = await request.json().catch(() => ({} as any));
    const sessionId = String(body.sessionId || body.session || "").trim();
    const confirm = String(body.confirm || "").trim() === "yes";
    const deleteAll = String(body.all || "").trim() === "true";
    const userId = auth.userId;
    if (!sessionId || !confirm) return send({ error: "sessionId and confirm=yes are required" }, 400, origin);

    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    const baseOutput = env.VIDEO_OUTPUT_GCS_URI as string | undefined;
    if (!clientEmail || !privateKeyRaw || !baseOutput) {
      return send({ error: "Missing GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY/VIDEO_OUTPUT_GCS_URI" }, 500, origin);
    }
    const outParsed = parseGcsUri(baseOutput);
    if (!outParsed) return send({ error: "Invalid VIDEO_OUTPUT_GCS_URI" }, 500, origin);

    const basePrefix = outParsed.object.replace(/\/$/, "");
    const userRoot = buildAiImageUserRoot(basePrefix, userId);
    const sessionPrefix = buildAiImageSessionPrefix(basePrefix, userId, sessionId);
    const outputsPrefix = `${sessionPrefix}/outputs/`;

    const token = await getGoogleAccessToken({
      clientEmail,
      privateKeyPem: privateKeyRaw,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });
    const userProject =
      (env.GCS_BILLING_PROJECT_ID as string | undefined) ||
      (env.GOOGLE_PROJECT_ID as string | undefined) ||
      "";

    const objectName = String((body.objectName || body.object || "")).trim();
    const objectNames = Array.isArray(body.objectNames)
      ? body.objectNames.map((value: any) => String(value || "").trim()).filter(Boolean)
      : [];
    if (objectName || objectNames.length) {
      const allowedPrefix = `${sessionPrefix}/outputs/`;
      const deleteTargets = objectNames.length ? objectNames : [objectName];
      if (deleteTargets.some((name) => !name.startsWith(allowedPrefix))) {
        return send({ error: "Invalid objectName for ai-image session outputs" }, 400, origin);
      }
      const result = await deleteGcsObjects({
        bucket: outParsed.bucket,
        objectNames: deleteTargets,
        accessToken: token,
        userProject,
      });
      return send(result, 200, origin);
    }

    const prefix = deleteAll ? outputsPrefix : outputsPrefix;
    let pageToken = "";
    const results: Array<{ name: string; status: number }> = [];
    let listedCount = 0;
    do {
      const listUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?prefix=${encodeURIComponent(prefix)}&maxResults=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}${userProject ? `&userProject=${encodeURIComponent(userProject)}` : ""}`;
      const res = await fetch(listUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(userProject ? { "X-Goog-User-Project": userProject } : {})
        }
      });
      const text = await res.text();
      if (!res.ok) {
        return send({ error: "List objects failed", status: res.status, detail: safeJson(text) }, res.status, origin);
      }
      const json = safeJson(text);
      const items = Array.isArray((json as any).items) ? (json as any).items : [];
      listedCount += items.length;
      for (const it of items) {
        const name = String(it.name || "");
        if (!name.startsWith(outputsPrefix)) continue;
        const delUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o/${encodeURIComponent(name)}${userProject ? `?userProject=${encodeURIComponent(userProject)}` : ""}`;
        const dres = await fetch(delUrl, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
            ...(userProject ? { "X-Goog-User-Project": userProject } : {})
          }
        });
        results.push({ name, status: dres.status });
      }
      pageToken = String((json as any)?.nextPageToken || "");
    } while (pageToken);

    return send({ deletedCount: results.filter(r => r.status === 204 || r.status === 404).length, listedCount, results, prefix }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, request.headers.get("Origin"));
  }
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
  const key = await crypto.subtle.importKey("pkcs8", { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as any, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" } as any, key, new TextEncoder().encode(message));
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

async function deleteGcsObjects(args: {
  bucket: string;
  objectNames: string[];
  accessToken: string;
  userProject?: string;
}) {
  const names = Array.isArray(args.objectNames) ? args.objectNames.filter(Boolean) : [];
  let deletedCount = 0;
  const failed: Array<{ name: string; status: number; detail: any }> = [];
  if (!names.length) {
    return { requestedCount: 0, deletedCount: 0, failedCount: 0, failed };
  }
  const billingQuery = args.userProject ? `?userProject=${encodeURIComponent(args.userProject)}` : "";
  const billingHeader = args.userProject ? { "X-Goog-User-Project": args.userProject } : {};
  for (let i = 0; i < names.length; i++) {
    const name = String(names[i] || "").trim();
    if (!name) continue;
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(args.bucket)}/o/${encodeURIComponent(name)}${billingQuery}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        ...billingHeader,
      },
    });
    if (res.status === 204 || res.status === 404) {
      deletedCount += 1;
      continue;
    }
    failed.push({
      name,
      status: res.status,
      detail: safeJson(await res.text()),
    });
  }
  return {
    requestedCount: names.length,
    deletedCount,
    failedCount: failed.length,
    failed,
  };
}
