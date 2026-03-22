// prototype/functions/api/imagen.ts
import { buildAiVideoProjectPrefix } from "./_shared/storage";
import { authorizeRequest } from "./_shared/auth.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }

    const body = await request.json().catch(() => ({} as any));
    const prompt = normalizePrompt((body?.prompt ?? "").toString().trim());
    const aspectIncoming = (body?.aspectRatio ?? "16:9").toString().trim();
    const allowed = new Set(["16:9", "9:16", "1:1"]);
    const aspectFinal = allowed.has(aspectIncoming) ? aspectIncoming : "16:9";
    const incomingReferenceImages = Array.isArray(body?.referenceImages) ? body.referenceImages : [];

    if (!prompt) {
      return json({ error: "prompt is required" }, 400);
    }

    const apiKey = String(env.GOOGLE_API_KEY || "").trim();
    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    const geminiModel = String(env.GEMINI_IMAGE_MODEL || "").trim() || "gemini-3.1-flash-image-preview";
    const geminiImageSize = String(env.GEMINI_IMAGE_SIZE || "").trim() || "2K";

    if (!apiKey) {
      return json({ error: "Missing GOOGLE_API_KEY" }, 500);
    }
    if (!clientEmail || !privateKeyRaw) {
      return json({ error: "Missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY" }, 500);
    }

    const accessToken = await getGoogleAccessToken({
      clientEmail,
      privateKeyPem: privateKeyRaw,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });

    const referenceImages = await normalizeReferenceImages({
      items: incomingReferenceImages,
      accessToken,
    });
    const finalPrompt = buildGeminiImagePrompt(prompt, referenceImages);

    const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`;
    const geminiRes = await fetch(generateUrl, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: buildGeminiParts(referenceImages, finalPrompt),
          }
        ],
        generationConfig: buildGeminiGenerationConfig(geminiModel, aspectFinal, geminiImageSize),
      }),
    });

    const geminiText = await geminiRes.text();
    if (!geminiRes.ok) {
      return json(
        { error: "Gemini API error", status: geminiRes.status, detail: safeJson(geminiText) },
        500
      );
    }

    const geminiJson = safeJson(geminiText) || {};
    const imageOutput = extractGeminiImage(geminiJson);
    const bytesBase64Encoded = imageOutput?.data || "";

    if (!bytesBase64Encoded) {
      return json({ error: "No image bytes returned", raw: geminiJson }, 500);
    }

    const projTagRaw = (body?.projectId ?? body?.projTag ?? "").toString().trim();
    const projTag = projTagRaw || "default";
    const userId = auth.userId;
    const baseOutput = env.VIDEO_OUTPUT_GCS_URI as string | undefined;
    const outParsed = baseOutput ? parseGcsUri(baseOutput) : null;
    let signedUrl = "";
    let objectName = "";
    if (outParsed) {
      const basePrefix = outParsed.object.replace(/\/$/, "");
      const projectPrefix = buildAiVideoProjectPrefix(basePrefix, userId, projTag);
      const stamp = Date.now();
      objectName = `${projectPrefix}/image/${stamp}-${crypto.randomUUID()}.png`;
      const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
      const bytes = base64ToUint8(bytesBase64Encoded);
      const upRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": imageOutput?.mimeType || "image/png" },
        body: bytes
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

    return json({
      bytesBase64Encoded,
      dataUrl: `data:${imageOutput?.mimeType || "image/png"};base64,${bytesBase64Encoded}`,
      signedUrl,
      objectName,
      model: geminiModel,
      provider: "gemini-api",
      promptEcho: finalPrompt,
      aspectApplied: aspectFinal,
      referenceImageCount: referenceImages.length,
    });
  } catch (e: any) {
    return json({ error: e?.message ?? "Unknown error" }, 500);
  }
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildGeminiParts(referenceImages: NormalizedReferenceImage[], prompt: string) {
  const parts: Array<Record<string, unknown>> = [];
  referenceImages.forEach((item) => {
    parts.push({
      inlineData: {
        mimeType: item.mimeType || "image/png",
        data: item.base64,
      }
    });
  });
  parts.push({ text: prompt });
  return parts;
}

function buildGeminiGenerationConfig(model: string, aspectRatio: string, imageSize: string) {
  const config: Record<string, unknown> = {
    responseModalities: ["IMAGE"],
    imageConfig: {
      aspectRatio,
    }
  };
  if (/gemini-3\./i.test(model) || /image-preview/i.test(model)) {
    (config.imageConfig as Record<string, unknown>).imageSize = imageSize;
  }
  return config;
}

function normalizePrompt(prompt: string) {
  return String(prompt || "")
    .replace(/@([0-9A-Za-z가-힣_]{1,24})/g, "$1")
    .replace(/\[(\d+)\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildGeminiImagePrompt(prompt: string, referenceImages: NormalizedReferenceImage[]) {
  const base = normalizePrompt(prompt);
  if (!referenceImages.length) return base;
  const grouped = new Map<number, NormalizedReferenceImage>();
  referenceImages.forEach((item) => {
    const key = Number(item.referenceId || 1) || 1;
    if (!grouped.has(key)) grouped.set(key, item);
  });
  const consistencyLines = Array.from(grouped.values()).map((item) => {
    const subject = String(item.subjectDescription || "registered character").trim() || "registered character";
    return `Use the provided registered reference image set for ${subject} and keep the exact same character design, face, silhouette, colors, costume, and proportions.`;
  });
  return [
    base,
    "The uploaded reference images define the official registered character design.",
  ].concat(consistencyLines).filter(Boolean).join("\n");
}

type NormalizedReferenceImage = {
  referenceId: number;
  base64: string;
  mimeType: string;
  subjectDescription: string;
  subjectType: string;
};

function extractGeminiImage(json: any): { data: string; mimeType: string } | null {
  try {
    const candidates = Array.isArray(json?.candidates) ? json.candidates : [];
    for (const candidate of candidates) {
      const parts = candidate?.content?.parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        const inline = part?.inlineData || part?.inline_data;
        if (inline?.data) {
          return {
            data: String(inline.data),
            mimeType: String(inline.mimeType || inline.mime_type || "image/png"),
          };
        }
      }
    }
  } catch (_) {}
  return null;
}

async function normalizeReferenceImages(args: {
  items: any[];
  accessToken: string;
}): Promise<NormalizedReferenceImage[]> {
  const items = Array.isArray(args.items) ? args.items.slice(0, 4) : [];
  const out: NormalizedReferenceImage[] = [];
  for (let i = 0; i < items.length; i++) {
    const raw = items[i] && typeof items[i] === "object" ? items[i] : {};
    const imageDataUrl = String(raw.imageDataUrl || raw.imageUrl || raw.url || "").trim();
    if (!imageDataUrl) continue;
    const parsed = await resolveImageBytes(imageDataUrl, args.accessToken);
    if (!parsed) continue;
    const referenceId = Number(raw.referenceId || (i + 1)) || (i + 1);
    const subjectDescription = String(raw.subjectDescription || `registered character ${referenceId}`).trim() || `registered character ${referenceId}`;
    const subjectType = normalizeSubjectType(raw.subjectType);
    out.push({
      referenceId,
      base64: parsed.base64,
      mimeType: parsed.mimeType || "image/png",
      subjectDescription,
      subjectType,
    });
  }
  return out;
}

async function resolveImageBytes(imageDataUrl: string, accessToken: string): Promise<{ base64: string; mimeType: string } | null> {
  const parsed = parseDataUrl(imageDataUrl);
  if (parsed) return parsed;
  try {
    const resolvedUrl = imageDataUrl.startsWith("gs://")
      ? gcsToHttps(imageDataUrl)
      : imageDataUrl;
    if (!resolvedUrl) return null;
    const headers: Record<string, string> = {};
    if (imageDataUrl.startsWith("gs://") || resolvedUrl.includes("storage.googleapis.com")) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    const res = await fetch(resolvedUrl, { headers });
    if (!res.ok) {
      throw new Error(`reference_image_fetch_failed (${res.status})`);
    }
    const buf = await res.arrayBuffer();
    return {
      base64: arrayBufferToBase64(buf),
      mimeType: res.headers.get("content-type") || "image/png",
    };
  } catch {
    return null;
  }
}

function normalizeSubjectType(value: unknown) {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "SUBJECT_TYPE_PERSON" || raw === "SUBJECT_TYPE_ANIMAL" || raw === "SUBJECT_TYPE_PRODUCT") {
    return raw;
  }
  return "SUBJECT_TYPE_DEFAULT";
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
  const claimSet = {
    iss: opts.clientEmail,
    scope: opts.scope,
    aud,
    iat: now,
    exp,
  };

  const jwtUnsigned = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(claimSet)
  )}`;

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
  if (!res.ok) {
    throw new Error(`OAuth token error (${res.status}): ${text}`);
  }
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error("No access_token in OAuth response");
  return json.access_token as string;
}

function base64url(input: string) {
  const bytes = new TextEncoder().encode(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  const b64 = btoa(str);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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

  const sigBytes = new Uint8Array(sigBuf);
  let bin = "";
  for (const b of sigBytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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
  const bucket = rest.slice(0, slash);
  const object = rest.slice(slash + 1);
  return { bucket, object };
}

function gcsToHttps(uri: string) {
  if (!uri.startsWith("gs://")) return uri;
  const parsed = parseGcsUri(uri);
  if (!parsed) return uri;
  return `https://storage.googleapis.com/${parsed.bucket}/${parsed.object}`;
}

function base64ToUint8(b64: string) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function parseDataUrl(dataUrl: string): { base64: string; mimeType: string } | null {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = String(match[1] || "image/png").trim() || "image/png";
  const base64 = String(match[2] || "").trim();
  if (!base64) return null;
  return { base64, mimeType };
}

function arrayBufferToBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
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
  let out = "";
  for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, "0");
  return out;
}
