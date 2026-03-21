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
  label: string;
  imageDataUrl: string;
  note: string;
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

    const normalizedBrand = await normalizeBrandPayload(brandId, brand, {
      bucket: parsed.bucket,
      brandPrefix,
      accessToken: token,
    });
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
    return send({ ok: true, brand: normalizedBrand, objectName }, 200, origin);
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
  ctx: { bucket: string; brandPrefix: string; accessToken: string; }
) {
  const normalized = JSON.parse(JSON.stringify(brand || {}));
  normalized.brandId = brandId;
  normalized.characterSheets = await normalizeCharacterSheets(normalized.characterSheets, ctx);
  normalized.knowledgeCharacterSheets = JSON.parse(JSON.stringify(normalized.characterSheets || []));
  normalized.updatedAt = new Date().toISOString();
  if (!normalized.createdAt) normalized.createdAt = normalized.updatedAt;
  return normalized;
}

async function normalizeCharacterSheets(value: any, ctx: { bucket: string; brandPrefix: string; accessToken: string; }) {
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

async function normalizeSheetItems(token: string, value: any, ctx: { bucket: string; brandPrefix: string; accessToken: string; }): Promise<SheetItem[]> {
  const src = Array.isArray(value) ? value : [];
  const out: SheetItem[] = [];
  let primarySeen = false;
  for (let i = 0; i < src.length; i++) {
    const raw = src[i] && typeof src[i] === "object" ? src[i] : {};
    const imageDataUrl = String(raw.imageDataUrl || raw.imageUrl || raw.url || raw.src || "").trim();
    if (!imageDataUrl) continue;
    const sheetId = normalizeText(raw.sheetId || raw.id) || `sheet_${String(i + 1).padStart(3, "0")}`;
    const label = normalizeText(raw.label || raw.title || raw.name) || `시트 ${i + 1}`;
    const note = normalizeText(raw.note || raw.description || raw.memo);
    let storedPath = imageDataUrl;
    if (imageDataUrl.startsWith("data:")) {
      storedPath = await uploadDataUrlToGcs({
        bucket: ctx.bucket,
        brandPrefix: ctx.brandPrefix,
        token,
        sheetId,
        label,
        imageDataUrl,
        accessToken: ctx.accessToken,
      });
    }
    const isPrimary = raw.isPrimary === true || (!primarySeen && i === 0);
    if (isPrimary) primarySeen = true;
    out.push({
      sheetId,
      label,
      imageDataUrl: storedPath,
      note,
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
  label: string;
  imageDataUrl: string;
  accessToken: string;
}) {
  const parsed = parseDataUrl(args.imageDataUrl);
  if (!parsed) throw new Error("invalid_sheet_data_url");
  const ext = mimeToExtension(parsed.mimeType);
  const safeToken = sanitizeSegment(args.token.replace(/^@+/, ""));
  const safeLabel = sanitizeSegment(args.label || args.sheetId || "sheet");
  const safeSheetId = sanitizeSegment(args.sheetId || "sheet");
  const objectName = `${args.brandPrefix}/ip/${safeToken}/${safeSheetId}-${safeLabel}.${ext}`;
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
  return String(value || "").trim().replace(/^@+/, "").replace(/[^a-zA-Z0-9._-가-힣]+/g, "_") || "item";
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
