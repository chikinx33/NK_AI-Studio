import { buildAiVideoBrandPrefix } from "../_shared/storage";
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

type SheetItem = {
  sheetId: string;
  imageDataUrl: string;
  isPrimary: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const origin = request.headers.get("Origin");
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const body = await request.json().catch(() => ({} as any));
    const brandId = String(body.brandId || "").trim();
    const brand = body.brand && typeof body.brand === "object" ? body.brand : {};
    if (!brandId) return send({ error: "brandId is required" }, 400, origin);
    if (!/^[a-zA-Z0-9._-]+$/.test(brandId)) return send({ error: "Invalid brandId format" }, 400, origin);

    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    const baseOutput = env.VIDEO_OUTPUT_GCS_URI as string | undefined;
    if (!clientEmail || !privateKeyRaw || !baseOutput) {
      return send({ error: "Missing GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY/VIDEO_OUTPUT_GCS_URI" }, 500, origin);
    }
    const parsed = parseGcsUri(baseOutput);
    if (!parsed) return send({ error: "Invalid VIDEO_OUTPUT_GCS_URI" }, 500, origin);
    const basePrefix = parsed.object.replace(/\/$/, "");
    const brandPrefix = buildAiVideoBrandPrefix(basePrefix, auth.userId, brandId);
    const objectName = `${brandPrefix}/reference/data.json`;
    const token = await getGoogleAccessToken({
      clientEmail,
      privateKeyPem: privateKeyRaw,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });
    const userProject =
      (env.GCS_BILLING_PROJECT_ID as string | undefined) ||
      (env.GOOGLE_PROJECT_ID as string | undefined) ||
      "";
    const existingBrand = await loadPersistedBrandRecord({
      bucket: parsed.bucket,
      objectName,
      accessToken: token,
      userProject,
    });

    const normalizedResult = await normalizeBrandPayload(brandId, brand, {
      bucket: parsed.bucket,
      brandPrefix,
      accessToken: token,
      userProject,
      existingBrand,
    });
    const normalizedBrand = normalizedResult.brand;
    const payload = {
      brandId,
      brand: normalizedBrand,
      savedAt: new Date().toISOString(),
    };

    const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(parsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) return send({ error: text || "brand_save_error" }, res.status, origin);
    const cleanup = await deleteGcsObjects({
      bucket: parsed.bucket,
      objectNames: normalizedResult.staleSheetObjects,
      accessToken: token,
      userProject,
    });
    return send({ ok: true, brand: normalizedBrand, objectName, cleanup }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, request.headers.get("Origin"));
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) => {
  const origin = request.headers.get("Origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
};

async function normalizeBrandPayload(
  brandId: string,
  brand: Record<string, any>,
  ctx: { bucket: string; brandPrefix: string; accessToken: string; userProject?: string; existingBrand?: Record<string, any> | null; }
) {
  const normalized = JSON.parse(JSON.stringify(brand || {}));
  normalized.brandId = brandId;
  const previousSheets = (ctx.existingBrand && (ctx.existingBrand.characterSheets || ctx.existingBrand.knowledgeCharacterSheets)) || [];
  const previousEnv = (ctx.existingBrand && (ctx.existingBrand.environmentAssets || ctx.existingBrand.knowledgeEnvironmentAssets)) || [];
  normalized.characterSheets = await normalizeCharacterSheets(normalized.characterSheets, ctx);
  normalized.knowledgeCharacterSheets = JSON.parse(JSON.stringify(normalized.characterSheets || []));
  normalized.environmentAssets = await normalizeEnvironmentAssets(normalized.environmentAssets || normalized.knowledgeEnvironmentAssets, ctx);
  normalized.knowledgeEnvironmentAssets = JSON.parse(JSON.stringify(normalized.environmentAssets || []));
  normalized.updatedAt = new Date().toISOString();
  if (!normalized.createdAt) normalized.createdAt = normalized.updatedAt;
  const staleCharacterObjects = diffManagedSheetObjectNames(
    collectManagedSheetObjectNames(previousSheets, ctx.bucket, ctx.brandPrefix, "ip"),
    collectManagedSheetObjectNames(normalized.characterSheets, ctx.bucket, ctx.brandPrefix, "ip")
  );
  const staleEnvObjects = diffManagedSheetObjectNames(
    collectManagedSheetObjectNames(previousEnv, ctx.bucket, ctx.brandPrefix, "env"),
    collectManagedSheetObjectNames(normalized.environmentAssets, ctx.bucket, ctx.brandPrefix, "env")
  );
  return {
    brand: normalized,
    staleSheetObjects: staleCharacterObjects.concat(staleEnvObjects),
  };
}

async function normalizeCharacterSheets(value: any, ctx: { bucket: string; brandPrefix: string; accessToken: string; userProject?: string; existingBrand?: Record<string, any> | null; }) {
  const src = Array.isArray(value) ? value : [];
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const raw = src[i] && typeof src[i] === "object" ? src[i] : {};
    const token = normalizeToken(raw.token || raw.trigger || raw.displayName || raw.name);
    if (!token) continue;
    const items = await normalizeSheetItems(token, raw.items, ctx);
    out.push({
      characterId: normalizeText(raw.characterId || raw.id) || `char_${String(i + 1).padStart(3, "0")}`,
      displayName: normalizeText(raw.displayName || raw.name || token.replace(/^@/, "")) || token.replace(/^@/, ""),
      token,
      items,
    });
  }
  return out;
}

async function normalizeEnvironmentAssets(value: any, ctx: { bucket: string; brandPrefix: string; accessToken: string; userProject?: string; existingBrand?: Record<string, any> | null; }) {
  const src = Array.isArray(value) ? value : [];
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const raw = src[i] && typeof src[i] === "object" ? src[i] : {};
    const displayName = normalizeText(raw.displayName || raw.name || raw.token || raw.trigger).replace(/^@+/, "").replace(/\s+/g, " ").trim();
    if (!displayName) continue;
    const token = "@" + displayName.replace(/\s+/g, "");
    const items = await normalizeSheetItems(token, raw.items, ctx, "env");
    out.push({
      assetId: normalizeText(raw.assetId || raw.id) || `env_${String(i + 1).padStart(3, "0")}`,
      displayName,
      token,
      kind: String(raw.kind || "").trim().toLowerCase() === "prop" ? "prop" : "background",
      items,
    });
  }
  return out;
}

async function normalizeSheetItems(token: string, value: any, ctx: { bucket: string; brandPrefix: string; accessToken: string; userProject?: string; existingBrand?: Record<string, any> | null; }, kind: string = "ip"): Promise<SheetItem[]> {
  const src = Array.isArray(value) ? value : [];
  const out: SheetItem[] = [];
  let primarySeen = false;
  for (let i = 0; i < src.length; i++) {
    const raw = src[i] && typeof src[i] === "object" ? src[i] : {};
    const imageDataUrl = String(raw.imageDataUrl || raw.imageUrl || raw.url || raw.src || "").trim();
    if (!imageDataUrl) continue;
    const sheetId = normalizeText(raw.sheetId || raw.id) || `sheet_${String(i + 1).padStart(3, "0")}`;
    let storedPath = imageDataUrl;
    if (imageDataUrl.startsWith("data:")) {
      storedPath = await uploadDataUrlToGcs({
        bucket: ctx.bucket,
        brandPrefix: ctx.brandPrefix,
        token,
        sheetId,
        imageDataUrl,
        accessToken: ctx.accessToken,
        kind,
      });
    } else if (imageDataUrl.startsWith("gs://")) {
      storedPath = await repairLegacySheetPath({
        bucket: ctx.bucket,
        brandPrefix: ctx.brandPrefix,
        token,
        sheetId,
        imageDataUrl,
        accessToken: ctx.accessToken,
        userProject: ctx.userProject,
        kind,
      }).catch(() => imageDataUrl);
    }
    const isPrimary = raw.isPrimary === true || (!primarySeen && i === 0);
    if (isPrimary) primarySeen = true;
    out.push({
      sheetId,
      imageDataUrl: storedPath,
      isPrimary,
      createdAt: normalizeText(raw.createdAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  if (out.length && !out.some((item) => item.isPrimary)) out[0].isPrimary = true;
  return out;
}

async function uploadDataUrlToGcs(args: {
  bucket: string;
  brandPrefix: string;
  token: string;
  sheetId: string;
  imageDataUrl: string;
  accessToken: string;
  kind?: string;
}) {
  const parsed = parseDataUrl(args.imageDataUrl);
  if (!parsed) throw new Error("invalid_sheet_data_url");
  const ext = mimeToExtension(parsed.mimeType);
  const objectName = buildSheetObjectName({
    brandPrefix: args.brandPrefix,
    token: args.token,
    sheetId: args.sheetId,
    ext,
    kind: args.kind,
  });
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(args.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.accessToken}`, "Content-Type": parsed.mimeType || "image/png" },
    body: parsed.bytes,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || "sheet_upload_error");
  return `gs://${args.bucket}/${objectName}`;
}

function buildSheetObjectName(args: {
  brandPrefix: string;
  token: string;
  sheetId: string;
  ext: string;
  kind?: string;
}) {
  const safeToken = sanitizeSegment(args.token.replace(/^@+/, "")) || "character";
  const safeSheetId = sanitizeSegment(args.sheetId || "sheet") || "sheet";
  const kindSegment = args.kind === "env" ? "env" : "ip";
  return `${args.brandPrefix}/${kindSegment}/${safeToken}/${safeSheetId}.${args.ext}`;
}

async function repairLegacySheetPath(args: {
  bucket: string;
  brandPrefix: string;
  token: string;
  sheetId: string;
  imageDataUrl: string;
  accessToken: string;
  userProject?: string;
  kind?: string;
}) {
  const parsed = parseGcsUri(args.imageDataUrl);
  if (!parsed || parsed.bucket !== args.bucket) return args.imageDataUrl;
  const ext = extensionFromObjectName(parsed.object);
  const kindSegment = args.kind === "env" ? "env" : "ip";
  const desiredObject = buildSheetObjectName({
    brandPrefix: args.brandPrefix,
    token: args.token,
    sheetId: args.sheetId,
    ext,
    kind: args.kind,
  });
  if (parsed.object === desiredObject) return args.imageDataUrl;
  if (parsed.object.indexOf(`${args.brandPrefix}/${kindSegment}/`) < 0) return args.imageDataUrl;
  const billingQuery = args.userProject ? `&userProject=${encodeURIComponent(args.userProject)}` : "";
  const billingHeader = args.userProject ? { "X-Goog-User-Project": args.userProject } : {};
  const downloadUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(parsed.bucket)}/o/${encodeURIComponent(parsed.object)}?alt=media${billingQuery}`;
  const readRes = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${args.accessToken}`, ...billingHeader },
  });
  if (!readRes.ok) throw new Error("legacy_sheet_read_error");
  const bytes = await readRes.arrayBuffer();
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(args.bucket)}/o?uploadType=media&name=${encodeURIComponent(desiredObject)}${args.userProject ? `&userProject=${encodeURIComponent(args.userProject)}` : ""}`;
  const writeRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "Content-Type": readRes.headers.get("content-type") || "image/png",
      ...billingHeader,
    },
    body: bytes,
  });
  const text = await writeRes.text();
  if (!writeRes.ok) throw new Error(text || "legacy_sheet_repair_error");
  return `gs://${args.bucket}/${desiredObject}`;
}

function normalizeText(value: any) {
  return String(value || "").replace(/[<>]/g, "").trim();
}

function normalizeToken(value: any) {
  let raw = normalizeText(value).replace(/\s+/g, "");
  if (!raw) return "";
  if (!raw.startsWith("@")) raw = "@" + raw.replace(/^@+/, "");
  return raw;
}

function sanitizeSegment(value: string) {
  return String(value || "")
    .trim()
    .normalize("NFKC")
    .replace(/^@+/, "")
    .replace(/[^0-9A-Za-z._\-\uAC00-\uD7A3]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    || "item";
}

function collectManagedSheetObjectNames(value: any, bucket: string, brandPrefix: string, kind: string = "ip") {
  const src = Array.isArray(value) ? value : [];
  const out = new Set<string>();
  const kindSegment = kind === "env" ? "env" : "ip";
  for (let i = 0; i < src.length; i++) {
    const entry = src[i] && typeof src[i] === "object" ? src[i] : {};
    const items = Array.isArray(entry.items) ? entry.items : [];
    for (let j = 0; j < items.length; j++) {
      const row = items[j] && typeof items[j] === "object" ? items[j] : {};
      const parsed = parseGcsUri(String(row.imageDataUrl || row.imageUrl || row.url || row.src || "").trim());
      if (!parsed || parsed.bucket !== bucket) continue;
      if (parsed.object.indexOf(`${brandPrefix}/${kindSegment}/`) !== 0) continue;
      out.add(parsed.object);
    }
  }
  return out;
}

function diffManagedSheetObjectNames(previous: Set<string>, next: Set<string>) {
  const stale: string[] = [];
  previous.forEach((name) => {
    if (!next.has(name)) stale.push(name);
  });
  return stale;
}

async function loadPersistedBrandRecord(args: {
  bucket: string;
  objectName: string;
  accessToken: string;
  userProject?: string;
}) {
  const billingQuery = args.userProject ? `&userProject=${encodeURIComponent(args.userProject)}` : "";
  const billingHeader = args.userProject ? { "X-Goog-User-Project": args.userProject } : {};
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(args.bucket)}/o/${encodeURIComponent(args.objectName)}?alt=media${billingQuery}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      ...billingHeader,
    },
  });
  if (res.status === 404) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(text || "brand_load_error");
  const record = safeJson(text);
  const brand = record && typeof record === "object" && record.brand && typeof record.brand === "object"
    ? record.brand
    : record;
  return brand && typeof brand === "object" ? brand : null;
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

function safeJson(text: string) {
  try { return JSON.parse(text); } catch { return text; }
}

function parseDataUrl(input: string): { mimeType: string; bytes: Uint8Array } | null {
  const match = String(input || "").match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i);
  if (!match) return null;
  const mimeType = String(match[1] || "image/png").trim() || "image/png";
  const raw = atob(match[2]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return { mimeType, bytes };
}

function mimeToExtension(mimeType: string) {
  const lower = String(mimeType || "").toLowerCase();
  if (lower === "image/jpeg" || lower === "image/jpg") return "jpg";
  if (lower === "image/webp") return "webp";
  if (lower === "image/gif") return "gif";
  return "png";
}

function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  if (!uri.startsWith("gs://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  return { bucket: rest.slice(0, slash), object: rest.slice(slash + 1) };
}

function extensionFromObjectName(objectName: string) {
  const raw = String(objectName || "").trim().toLowerCase();
  if (/\.jpe?g$/i.test(raw)) return "jpg";
  if (/\.webp$/i.test(raw)) return "webp";
  if (/\.gif$/i.test(raw)) return "gif";
  return "png";
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
