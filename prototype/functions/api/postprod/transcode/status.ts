import { buildUserRoot } from "../../_shared/storage";
import { authorizeRequest } from "../../_shared/auth.js";
import { resolveProjectStorageOwner } from "../../_shared/shares";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const corsHeaders = (origin?: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Vary": "Origin",
});

const send = (data: any, status = 200, origin?: string | null) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const url = new URL(request.url);
    const jobName = String(url.searchParams.get("jobName") || "").trim();
    const outputObjectName = String(url.searchParams.get("outputObjectName") || "").trim();
    const projectId = String(url.searchParams.get("projectId") || "").trim();
    const ownerId = String(url.searchParams.get("ownerId") || "").trim();
    if (!jobName || !outputObjectName) {
      return send({ error: "jobName and outputObjectName are required" }, 400, origin);
    }

    const googleProjectId = env.GOOGLE_PROJECT_ID as string | undefined;
    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    const baseOutput = env.VIDEO_OUTPUT_GCS_URI as string | undefined;
    if (!googleProjectId || !clientEmail || !privateKeyRaw || !baseOutput) {
      return send({ error: "Missing GOOGLE_PROJECT_ID/GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY/VIDEO_OUTPUT_GCS_URI" }, 500, origin);
    }
    const outParsed = parseGcsUri(baseOutput);
    if (!outParsed) return send({ error: "Invalid VIDEO_OUTPUT_GCS_URI" }, 500, origin);
    const basePrefix = outParsed.object.replace(/\/$/, "");
    const storageUserId = projectId
      ? await resolveProjectStorageOwner(env, auth.userId, ownerId, projectId)
      : auth.userId;
    const userRoot = buildUserRoot(basePrefix, storageUserId);
    if (!outputObjectName.startsWith(`${userRoot}/`)) {
      return send({ error: "outputObjectName is outside user scope" }, 403, origin);
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

    const jobUrl = `https://transcoder.googleapis.com/v1/${jobName}`;
    const res = await fetch(jobUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    const json = safeJson(text) as any;
    if (!res.ok) {
      const hint = getTranscoderHint(res.status, json);
      return send(
        {
          error: "Transcoder status failed",
          status: res.status,
          detail: json,
          hint: hint.message,
          requiredRoles: hint.requiredRoles,
        },
        res.status,
        origin
      );
    }

    const state = String(json?.state || "").toUpperCase();
    if (state === "SUCCEEDED") {
      const resolved = await resolveOutputUrls({
        outputObjectName,
        bucket: outParsed.bucket,
        requestUrl: request.url,
        clientEmail,
        privateKeyPem: privateKeyRaw,
        token,
        userProject,
      });
      if (!resolved) {
        return send({ done: false, status: "OUTPUT_PENDING", raw: json }, 200, origin);
      }
      return send({ done: true, status: state, outputObjectName: resolved.outputObjectName, ...resolved }, 200, origin);
    }

    if (state === "FAILED" || state === "CANCELLED") {
      const recovered = await tryRecoverOutputAfterFailedJob({
        bucket: outParsed.bucket,
        object: outputObjectName,
        requestUrl: request.url,
        token,
        userProject:
          (env.GCS_BILLING_PROJECT_ID as string | undefined) ||
          (env.GOOGLE_PROJECT_ID as string | undefined) ||
          "",
        clientEmail,
        privateKeyPem: privateKeyRaw,
        expectedOutputObjectName: outputObjectName,
      });
      if (recovered && recovered.outputObjectName) {
        return send(
          {
            done: true,
            status: "SUCCEEDED",
            outputObjectName: recovered.outputObjectName,
            recoveredFromJobState: state,
            ...recovered,
          },
          200,
          origin
        );
      }
      return send(
        {
          done: true,
          status: state,
          error: json?.error || json?.failureReason || "transcode_failed",
          raw: json,
        },
        200,
        origin
      );
    }

    return send({ done: false, status: state || "PENDING", raw: json }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, origin);
  }
};

async function tryRecoverOutputAfterFailedJob(opts: {
  bucket: string;
  object: string;
  requestUrl: string;
  token: string;
  userProject: string;
  clientEmail: string;
  privateKeyPem: string;
  expectedOutputObjectName: string;
}) {
  const resolved = await resolveOutputUrls({
    outputObjectName: opts.expectedOutputObjectName || opts.object,
    bucket: opts.bucket,
    requestUrl: opts.requestUrl,
    clientEmail: opts.clientEmail,
    privateKeyPem: opts.privateKeyPem,
    token: opts.token,
    userProject: opts.userProject,
  });
  return (resolved && resolved.outputObjectName) ? resolved : null;
}

async function resolveExistingOutputObject(opts: {
  bucket: string;
  outputObjectName: string;
  token: string;
  userProject: string;
}) {
  const expected = String(opts.outputObjectName || "").trim().replace(/^\/+/, "");
  if (!expected) return "";

  const candidates: string[] = [];
  const pushCandidate = (name: string) => {
    const v = String(name || "").trim().replace(/^\/+/, "");
    if (!v) return;
    if (candidates.indexOf(v) >= 0) return;
    candidates.push(v);
  };

  pushCandidate(expected);
  if (/\.mp4$/i.test(expected)) {
    pushCandidate(expected.replace(/\.mp4$/i, ""));
  } else {
    pushCandidate(`${expected}.mp4`);
  }

  for (const candidate of candidates) {
    const ok = await objectExists({
      bucket: opts.bucket,
      object: candidate,
      token: opts.token,
      userProject: opts.userProject,
    });
    if (ok) return candidate;
  }

  const prefix = expected.includes("/") ? expected.slice(0, expected.lastIndexOf("/") + 1) : "";
  if (!prefix) return "";
  const listed = await listObjectsByPrefix({
    bucket: opts.bucket,
    prefix,
    token: opts.token,
    userProject: opts.userProject,
  });
  if (!listed.length) return "";
  listed.sort((a, b) => {
    const at = Date.parse(String(a.updated || a.timeCreated || 0)) || 0;
    const bt = Date.parse(String(b.updated || b.timeCreated || 0)) || 0;
    return bt - at;
  });
  const mp4 = listed.find((it) => /\.mp4$/i.test(String(it.name || "")));
  if (mp4 && mp4.name) return String(mp4.name);
  return String(listed[0].name || "");
}

async function resolveOutputUrls(opts: {
  outputObjectName: string;
  bucket: string;
  requestUrl: string;
  clientEmail: string;
  privateKeyPem: string;
  token: string;
  userProject: string;
}) {
  const resolvedObjectName = await resolveExistingOutputObject({
    bucket: opts.bucket,
    outputObjectName: opts.outputObjectName,
    token: opts.token,
    userProject: opts.userProject,
  });
  const targetObjectName = resolvedObjectName;
  if (!targetObjectName) return null;
  const reqBase = new URL(opts.requestUrl);
  const proxyUrl =
    `${reqBase.origin}/api/media/proxy?objectName=${encodeURIComponent(targetObjectName)}`;
  const signedUrl = await signGcsUrl({
    bucket: opts.bucket,
    object: targetObjectName,
    clientEmail: opts.clientEmail,
    privateKeyPem: opts.privateKeyPem,
    expiresInSec: 3600,
  }).catch(() => gcsToHttps(`gs://${opts.bucket}/${targetObjectName}`));
  return { signedUrl, proxyUrl, outputObjectName: targetObjectName };
}

async function objectExists(opts: { bucket: string; object: string; token: string; userProject: string }) {
  const metaUrl =
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(opts.bucket)}` +
    `/o/${encodeURIComponent(opts.object)}`;
  const res = await fetch(metaUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      ...(opts.userProject ? { "X-Goog-User-Project": opts.userProject } : {}),
    },
  });
  return res.ok;
}

async function listObjectsByPrefix(opts: { bucket: string; prefix: string; token: string; userProject: string }) {
  const listUrl =
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(opts.bucket)}/o` +
    `?prefix=${encodeURIComponent(opts.prefix)}`;
  const res = await fetch(listUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      ...(opts.userProject ? { "X-Goog-User-Project": opts.userProject } : {}),
    },
  });
  if (!res.ok) return [];
  const text = await res.text();
  const json = safeJson(text) as any;
  const items = Array.isArray(json?.items) ? json.items : [];
  return items.map((it: any) => ({
    name: String(it?.name || ""),
    updated: String(it?.updated || ""),
    timeCreated: String(it?.timeCreated || ""),
  })).filter((it: any) => !!it.name);
}

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  if (!uri.startsWith("gs://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const bucket = rest.slice(0, slash);
  const object = rest.slice(slash + 1);
  if (!bucket || !object) return null;
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

function safeJson(text: string) {
  try { return JSON.parse(text); } catch { return text; }
}

function getTranscoderHint(status: number, _detail: any): { message: string; requiredRoles: string[] } {
  const requiredRoles = [
    "roles/transcoder.admin",
    "roles/storage.objectViewer",
    "roles/storage.objectCreator",
    "roles/storage.objectAdmin",
  ];
  if (status === 403) {
    return {
      message:
        "Permission denied. Enable Transcoder API and grant the service account Transcoder + GCS read/write roles.",
      requiredRoles,
    };
  }
  return {
    message: `Transcoder status request failed (${status}). Check jobName, location, and permissions.`,
    requiredRoles,
  };
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

async function signGcsUrl(opts: { bucket: string; object: string; clientEmail: string; privateKeyPem: string; expiresInSec: number }) {
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
