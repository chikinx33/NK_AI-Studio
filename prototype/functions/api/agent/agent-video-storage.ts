// Agent Video 저장소
// users/{userId}/ai-video/projectsai-company/infographic/YYYY-MM-DD/
import { authorizeRequest } from "../_shared/auth.js";
import { getGoogleAccessToken, resolveGcsEnv } from "../_shared/gcs.js";
import { buildAiVideoProjectPrefix } from "../_shared/storage";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const GCS_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const corsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Origin": origin || "*",
  Vary: "Origin",
});

const send = (data: any, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

function storagePrefix(basePrefix: string, userId: string) {
  return `${buildAiVideoProjectPrefix(basePrefix, userId, "ai-company")}/infographic/`;
}

function koreaDate(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function koreaTimestamp(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
}

function safeFileName(raw: string) {
  const normalized = String(raw || "source.bin")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return normalized || "source.bin";
}

function fileNameFromObject(objectName: string) {
  return decodeURIComponent(String(objectName || "").split("/").pop() || "source");
}

function sourceType(contentType: string, name: string) {
  if (contentType.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(name)) return "video";
  if (contentType.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg)$/i.test(name)) return "image";
  if (contentType.includes("json") || /\.json$/i.test(name)) return "manifest";
  if (contentType.startsWith("audio/") || /\.(mp3|wav|m4a|aac)$/i.test(name)) return "audio";
  return "file";
}

async function accessContext(env: any) {
  const ctx = resolveGcsEnv(env);
  const token = await getGoogleAccessToken({
    clientEmail: ctx.clientEmail,
    privateKeyPem: ctx.privateKeyRaw,
    scope: GCS_SCOPE,
  });
  return { ...ctx, token };
}

async function gcsFetchWithBilling(ctx: any, makeRequest: (useBilling: boolean) => Promise<Response>) {
  let response = await makeRequest(true);
  if (!response.ok && ctx.userProject && (response.status === 400 || response.status === 403)) {
    response = await makeRequest(false);
  }
  return response;
}

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    const ctx = await accessContext(env);
    const allowedPrefix = storagePrefix(ctx.basePrefix, auth.userId);
    const url = new URL(request.url);
    const requestedObject = String(url.searchParams.get("objectName") || "").trim();

    if (requestedObject) {
      if (!requestedObject.startsWith(allowedPrefix)) return send({ error: "허용되지 않은 저장소 경로입니다." }, 400, origin);
      const response = await gcsFetchWithBilling(ctx, (useBilling) => {
        const billing = useBilling && ctx.userProject ? `&userProject=${encodeURIComponent(ctx.userProject)}` : "";
        return fetch(
          `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o/${encodeURIComponent(requestedObject)}?alt=media${billing}`,
          { headers: { Authorization: `Bearer ${ctx.token}`, ...(useBilling && ctx.userProject ? { "X-Goog-User-Project": ctx.userProject } : {}) } },
        );
      });
      if (!response.ok) return send({ error: `파일 다운로드 실패 (HTTP ${response.status})` }, response.status, origin);
      const headers = new Headers(corsHeaders(origin));
      headers.set("Content-Type", response.headers.get("Content-Type") || "application/octet-stream");
      headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileNameFromObject(requestedObject))}`);
      const size = response.headers.get("Content-Length");
      if (size) headers.set("Content-Length", size);
      return new Response(response.body, { status: 200, headers });
    }

    const items: any[] = [];
    let pageToken = "";
    do {
      const response = await gcsFetchWithBilling(ctx, (useBilling) => {
        const params = new URLSearchParams({ prefix: allowedPrefix, maxResults: "500" });
        if (pageToken) params.set("pageToken", pageToken);
        if (useBilling && ctx.userProject) params.set("userProject", ctx.userProject);
        return fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o?${params.toString()}`, {
          headers: { Authorization: `Bearer ${ctx.token}`, ...(useBilling && ctx.userProject ? { "X-Goog-User-Project": ctx.userProject } : {}) },
        });
      });
      const payload: any = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || `GCS 목록 조회 실패 (HTTP ${response.status})`);
      for (const item of Array.isArray(payload.items) ? payload.items : []) {
        const name = String(item?.name || "");
        if (!name.startsWith(allowedPrefix)) continue;
        const relative = name.slice(allowedPrefix.length);
        const dateFolder = relative.split("/")[0] || "";
        const contentType = String(item?.contentType || "application/octet-stream");
        items.push({
          objectName: name,
          fileName: fileNameFromObject(name),
          dateFolder,
          contentType,
          type: sourceType(contentType, name),
          size: Number(item?.size || 0),
          createdAt: String(item?.timeCreated || item?.updated || ""),
          updatedAt: String(item?.updated || ""),
          signedUrl: await signGcsUrl({
            bucket: ctx.bucket,
            object: name,
            clientEmail: ctx.clientEmail,
            privateKeyPem: ctx.privateKeyRaw,
            expiresInSec: 3600,
          }),
        });
      }
      pageToken = String(payload?.nextPageToken || "");
    } while (pageToken);

    items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return send({ prefix: allowedPrefix, storageUri: `gs://${ctx.bucket}/${allowedPrefix}`, items }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "저장소 조회에 실패했습니다.") }, 500, origin);
  }
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    const declaredSize = Number(request.headers.get("Content-Length") || 0);
    if (declaredSize > MAX_UPLOAD_BYTES) return send({ error: "파일은 100MB 이하만 저장할 수 있습니다." }, 413, origin);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) return send({ error: "저장할 파일이 비어 있습니다." }, 400, origin);
    if (bytes.byteLength > MAX_UPLOAD_BYTES) return send({ error: "파일은 100MB 이하만 저장할 수 있습니다." }, 413, origin);

    const ctx = await accessContext(env);
    const url = new URL(request.url);
    const originalName = safeFileName(String(url.searchParams.get("filename") || "source.bin"));
    const dateFolder = koreaDate();
    const unique = crypto.randomUUID().slice(0, 8);
    const fileName = `${koreaTimestamp()}-${unique}-${originalName}`;
    const objectName = `${storagePrefix(ctx.basePrefix, auth.userId)}${dateFolder}/${fileName}`;
    const contentType = request.headers.get("Content-Type") || "application/octet-stream";

    const response = await gcsFetchWithBilling(ctx, (useBilling) => {
      const billing = useBilling && ctx.userProject ? `&userProject=${encodeURIComponent(ctx.userProject)}` : "";
      return fetch(
        `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}${billing}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ctx.token}`,
            "Content-Type": contentType,
            ...(useBilling && ctx.userProject ? { "X-Goog-User-Project": ctx.userProject } : {}),
          },
          body: bytes,
        },
      );
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `GCS 업로드 실패 (HTTP ${response.status})`);

    return send({
      ok: true,
      item: {
        objectName,
        fileName,
        dateFolder,
        contentType,
        type: sourceType(contentType, objectName),
        size: bytes.byteLength,
        createdAt: payload?.timeCreated || new Date().toISOString(),
        updatedAt: payload?.updated || new Date().toISOString(),
      },
    }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "저장소 업로드에 실패했습니다.") }, 500, origin);
  }
};

export const onRequestDelete: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const body: any = await request.json().catch(() => ({}));
    const requestedNames = (Array.isArray(body?.objectNames) ? body.objectNames : [body?.objectName])
      .map((value: any) => String(value || "").trim())
      .filter(Boolean);
    if (requestedNames.length > 100) return send({ error: "한 번에 최대 100개 파일까지 삭제할 수 있습니다." }, 400, origin);
    const objectNames = requestedNames;
    if (!objectNames.length) return send({ error: "삭제할 파일을 선택해 주세요." }, 400, origin);

    const ctx = await accessContext(env);
    const allowedPrefix = storagePrefix(ctx.basePrefix, auth.userId);
    if (objectNames.some((name: string) => !name.startsWith(allowedPrefix))) {
      return send({ error: "허용되지 않은 저장소 경로입니다." }, 400, origin);
    }

    let deletedCount = 0;
    const failed: Array<{ objectName: string; status: number }> = [];
    for (const objectName of objectNames) {
      const response = await gcsFetchWithBilling(ctx, (useBilling) => {
        const billing = useBilling && ctx.userProject ? `?userProject=${encodeURIComponent(ctx.userProject)}` : "";
        return fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o/${encodeURIComponent(objectName)}${billing}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${ctx.token}`, ...(useBilling && ctx.userProject ? { "X-Goog-User-Project": ctx.userProject } : {}) },
        });
      });
      if (response.status === 204 || response.status === 404) deletedCount += 1;
      else failed.push({ objectName, status: response.status });
    }
    return send({ ok: failed.length === 0, deletedCount, failed }, failed.length ? 207 : 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "저장소 파일 삭제에 실패했습니다.") }, 500, origin);
  }
};

async function signGcsUrl(opts: { bucket: string; object: string; clientEmail: string; privateKeyPem: string; expiresInSec: number }) {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${date}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const credential = `${opts.clientEmail}/${date}/auto/storage/goog4_request`;
  const host = "storage.googleapis.com";
  const canonicalUri = `/${encodeURIComponent(opts.bucket)}/${opts.object.split("/").map(encodeURIComponent).join("/")}`;
  const query = new URLSearchParams({
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": credential,
    "X-Goog-Date": time,
    "X-Goog-Expires": String(opts.expiresInSec),
    "X-Goog-SignedHeaders": "host",
  });
  const canonicalQuery = query.toString();
  const canonicalRequest = ["GET", canonicalUri, canonicalQuery, `host:${host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const hashedRequest = await sha256Hex(canonicalRequest);
  const stringToSign = ["GOOG4-RSA-SHA256", time, `${date}/auto/storage/goog4_request`, hashedRequest].join("\n");
  const signatureHex = base64UrlToHex(await signRs256(stringToSign, opts.privateKeyPem));
  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Goog-Signature=${signatureHex}`;
}

async function sha256Hex(input: string) {
  const value = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(value)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signRs256(message: string, privateKeyPem: string) {
  const pem = privateKeyPem.replace(/\\n/g, "\n").trim();
  const encoded = pem.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").split(/\s+/).join("");
  const raw = atob(encoded);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  const key = await crypto.subtle.importKey("pkcs8", bytes.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(message));
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToHex(value: string) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Array.from(binary).map((char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}
