// prototype/functions/api/video.ts
// Minimal Veo (image -> video) trigger endpoint for Cloudflare Pages Functions.
// Goal: return job/operation name to confirm Vertex AI request is accepted.

// Ensure bundled helpers that might reference a `g` global have a defined value in Workers runtime.
import { buildAiVideoProjectPrefix } from "./_shared/storage";
import { authorizeRequest } from "./_shared/auth.js";
import {
  callKlingApi,
  klingEndpoints,
  klingModelFor,
  normalizeKlingAspect,
  snapKlingDuration,
  stripDataUrlPrefix,
  type KlingQuality,
} from "./_shared/kling";

(globalThis as any).g = globalThis;
type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;
const log = (...args: any[]) => console.log('[video]', ...args);

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    const body = await request.json().catch(() => ({} as any));
    const {
      sceneId = "scene",
      projTag = "",
      userId: rawUserId = "",
      promptText = "",
      imageDataUrl = "",
      durationSeconds = 6,
      aspectRatio = "16:9",
      videoModel = "veo"
    } = body || {};
    const aspectFinal = normalizeAspectRatio(aspectRatio);
    const narrationEnabled = toBool((body as any)?.narrationEnabled, false);
    const dubbingEnabled = toBool((body as any)?.dubbingEnabled, false);
    const voiceEnabled = !!(narrationEnabled || dubbingEnabled);
    const noSpeechDirective = "No speech, no dialogue, no voice-over, no lip sync, keep mouths closed.";
    const safePromptText = voiceEnabled
      ? String(promptText || "")
      : `${String(promptText || "").trim()}\n${noSpeechDirective}`.trim();
    // durationSeconds는 4/6/8만 허용 → 근접값으로 스냅 (Veo/Grok 공용)
    const snapDuration = snapToAllowedDuration(durationSeconds);
    // Seedance는 4–15초 지원 → 스냅 없이 클램프만 적용
    const seedanceDuration = Math.min(15, Math.max(4, Math.round(Number(durationSeconds) || 5)));

    if (!safePromptText || !imageDataUrl) {
      return json({ error: "promptText and imageDataUrl are required" }, 400);
    }

    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    const baseOutput = env.VIDEO_OUTPUT_GCS_URI as string | undefined;

    if (!clientEmail || !privateKeyRaw) {
      return json({ error: "Missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY" }, 500);
    }
    if (!baseOutput) {
      return json({ error: "Missing VIDEO_OUTPUT_GCS_URI" }, 500);
    }

    const outParsed = parseGcsUri(baseOutput);
    if (!outParsed) {
      return json({ error: "Invalid VIDEO_OUTPUT_GCS_URI (expect gs://bucket/prefix)" }, 500);
    }
    const projectTag = (projTag || "default").toString();
    const userId = auth.userId || "";
    const basePrefix = outParsed.object.replace(/\/$/, "");
    const projectPrefix = buildAiVideoProjectPrefix(basePrefix, userId, projectTag);
    // 표준 경로: users/{userId}/ai-video/projects{projectId}/videos/{timestamp-sceneId}.mp4
    const stamp = Date.now();
    const videoObject = `${projectPrefix}/videos/${stamp}-${sceneId}.mp4`;
    const outputGcsUri = `gs://${outParsed.bucket}/${videoObject}`;

    // Shared Atlas Cloud helper: converts data:URL / gs:// → signed https URL
    const signIfGs = async (src: string): Promise<string> => {
      const s = String(src || "").trim();
      if (!s.startsWith("gs://")) return s;
      const parsed = parseGcsUri(s);
      if (!parsed) return s;
      try {
        return await signGcsUrl({ bucket: parsed.bucket, object: parsed.object, clientEmail: clientEmail!, privateKeyPem: privateKeyRaw!, expiresInSec: 3600 });
      } catch (_) { return gcsToHttps(s); }
    };
    const toAtlasImageUrl = async (src: string, suffix: string): Promise<string> => {
      if (!src) return "";
      if (src.startsWith("data:")) {
        const outParsedImg = parseGcsUri(baseOutput!);
        if (!outParsedImg) throw new Error("Invalid VIDEO_OUTPUT_GCS_URI");
        const accessTok = await getGoogleAccessToken({ clientEmail: clientEmail!, privateKeyPem: privateKeyRaw!, scope: "https://www.googleapis.com/auth/cloud-platform" });
        const objName = `${projectPrefix}/atlas/${stamp}-${suffix}.png`;
        const upUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsedImg.bucket)}/o?uploadType=media&name=${encodeURIComponent(objName)}`;
        const b64 = src.split(",")[1] || "";
        const upRes = await fetch(upUrl, { method: "POST", headers: { Authorization: `Bearer ${accessTok}`, "Content-Type": "image/png" }, body: base64ToUint8(b64) });
        if (!upRes.ok) throw new Error(`upload_failed: ${await upRes.text()}`);
        return await signGcsUrl({ bucket: outParsedImg.bucket, object: objName, clientEmail: clientEmail!, privateKeyPem: privateKeyRaw!, expiresInSec: 3600 }).catch(() => gcsToHttps(`gs://${outParsedImg.bucket}/${objName}`));
      }
      return await signIfGs(src);
    };

    const isKling = videoModel === "kling" || videoModel === "kling-draft" || videoModel === "kling-final";
    if (videoModel !== "veo" && videoModel !== "grok" && videoModel !== "seedance" && !isKling) {
      return json({ error: "unsupported_video_model", detail: videoModel }, 400);
    }

    // Kling branch (via Atlas Cloud AI)
    if (isKling) {
      const atlasKey = env.ATLASCLOUD_API_KEY as string | undefined;
      if (!atlasKey) return json({ error: "ATLASCLOUD_API_KEY missing" }, 500);

      const quality: KlingQuality =
        (body as any)?.quality === "final" || videoModel === "kling-final" ? "final" : "draft";
      const klingDuration = snapKlingDuration(durationSeconds);
      const klingAspect = normalizeKlingAspect(aspectRatio);

      const startImageResolved = await toAtlasImageUrl(imageDataUrl, `start-${sceneId}`).catch((e: any) => { throw new Error("image_upload_error: " + (e?.message || e)); });
      if (!startImageResolved) return json({ error: "imageDataUrl is empty or upload failed" }, 400);

      const endImageRaw = String((body as any)?.endImageDataUrl || (body as any)?.image_tail || "").trim();
      const endImageResolved = endImageRaw ? await toAtlasImageUrl(endImageRaw, `end-${sceneId}`).catch(() => "") : "";

      const refRaw = (body as any)?.referenceImages || (body as any)?.references || [];
      const refListRaw: string[] = Array.isArray(refRaw)
        ? refRaw.map((v: any) => String(v || "")).filter(Boolean) : [];
      const refList: string[] = [];
      for (const raw of refListRaw) refList.push(await toAtlasImageUrl(raw, `ref-${sceneId}-${refList.length}`).catch(() => ""));
      const refListFiltered = refList.filter(Boolean);

      // final 선택 시 캐릭터 참조 여부와 무관하게 FHD 모델 우선 (multi 모델은 720p만 지원)
      const useMulti = refListFiltered.length > 0 && quality !== "final";
      const atlasKlingModel = useMulti
        ? "kwaivgi/kling-v1.6-multi-i2v-standard"
        : (quality === "final" ? "kwaivgi/kling-v2.6-pro/image-to-video" : "kwaivgi/kling-v1.6-i2v-standard");

      const atlasBody: any = {
        model: atlasKlingModel,
        prompt: safePromptText,
        duration: klingDuration,
        aspect_ratio: klingAspect,
      };
      if ((body as any)?.negativePrompt) atlasBody.negative_prompt = String((body as any).negativePrompt);

      if (useMulti) {
        atlasBody.images = [startImageResolved, ...refListFiltered];
      } else {
        atlasBody.image = startImageResolved;
        if (endImageResolved) atlasBody.image_tail = endImageResolved;
      }

      log('kling_atlas_request', { sceneId, model: atlasKlingModel, useMulti, aspect: klingAspect, duration: klingDuration });

      const atlasRes = await fetch("https://api.atlascloud.ai/api/v1/model/generateVideo", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${atlasKey}` },
        body: JSON.stringify(atlasBody),
      });
      const atlasText = await atlasRes.text();
      if (!atlasRes.ok) {
        return json({ error: "kling_http_error", status: atlasRes.status, detail: safeJson(atlasText) }, atlasRes.status);
      }
      const atlasJson = safeJson(atlasText);
      const predictionId = atlasJson?.data?.id || atlasJson?.id || atlasJson?.prediction_id || "";
      if (!predictionId) {
        return json({ error: "kling_no_prediction_id", raw: atlasJson }, 500);
      }
      const jobPrefix = useMulti ? "kling-multi:" : "kling:";
      return json({ job_id: `${jobPrefix}${predictionId}`, model: atlasKlingModel, aspectApplied: klingAspect, outputGcsUri });
    }

    // Grok branch (xAI direct API — Atlas Cloud does not host Grok video)
    if (videoModel === "grok") {
      const xaiKey = env.XAI_API_KEY as string | undefined;
      if (!xaiKey) return json({ error: "XAI_API_KEY missing" }, 500);
      const startImageResolved = await toAtlasImageUrl(imageDataUrl, `start-${sceneId}`).catch((e: any) => { throw new Error("image_upload_error: " + (e?.message || e)); });
      const grokBody: any = {
        model: (env.GROK_MODEL_ID as string | undefined) || "grok-imagine-video",
        prompt: safePromptText,
        duration: snapDuration,
        aspect_ratio: aspectFinal,
        resolution: "720p",
      };
      if (startImageResolved) {
        const imgObj = { url: startImageResolved };
        grokBody.image_url = imgObj;
        grokBody.image = imgObj;
        grokBody.prompt = "Animate this image. " + safePromptText;
      }
      log('grok_request', { sceneId, aspect: aspectFinal, duration: snapDuration });
      const grokRes = await fetch("https://api.x.ai/v1/videos/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${xaiKey}` },
        body: JSON.stringify(grokBody),
      });
      const grokText = await grokRes.text();
      if (!grokRes.ok) {
        return json({ error: "grok_error", status: grokRes.status, detail: safeJson(grokText) }, grokRes.status);
      }
      const grokJson = safeJson(grokText);
      const reqId = grokJson?.request_id || grokJson?.id || grokJson?.data?.[0]?.id || "";
      return json({ job_id: reqId ? `grok:${reqId}` : "", status: "processing" }, 202);
    }

    // Seedance branch (Atlas Cloud AI)
    if (videoModel === "seedance") {
      const atlasKey = env.ATLASCLOUD_API_KEY as string | undefined;
      if (!atlasKey) return json({ error: "ATLASCLOUD_API_KEY missing" }, 500);

      let imageUrl = "";
      if (imageDataUrl) {
        if (/^https?:/i.test(imageDataUrl)) {
          imageUrl = imageDataUrl;
        } else if (imageDataUrl.startsWith("gs://")) {
          imageUrl = gcsToHttps(imageDataUrl);
        } else if (imageDataUrl.startsWith("data:")) {
          try {
            const outParsedImg = parseGcsUri(baseOutput!);
            if (!outParsedImg) return json({ error: "Invalid VIDEO_OUTPUT_GCS_URI" }, 500);
            const accessTokenUpload = await getGoogleAccessToken({
              clientEmail: clientEmail!,
              privateKeyPem: privateKeyRaw!,
              scope: "https://www.googleapis.com/auth/cloud-platform",
            });
            const imgObjectName = `${projectPrefix}/seedance/${stamp}-${sceneId}.png`;
            const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsedImg.bucket)}/o?uploadType=media&name=${encodeURIComponent(imgObjectName)}`;
            const b64 = imageDataUrl.split(",")[1] || "";
            const buf = base64ToUint8(b64);
            const upRes = await fetch(uploadUrl, {
              method: "POST",
              headers: { Authorization: `Bearer ${accessTokenUpload}`, "Content-Type": "image/png" },
              body: buf
            });
            const upTxt = await upRes.text();
            if (!upRes.ok) return json({ error: "upload_failed", detail: upTxt }, 500);
            imageUrl = await signGcsUrl({
              bucket: outParsedImg.bucket,
              object: imgObjectName,
              clientEmail: clientEmail!,
              privateKeyPem: privateKeyRaw!,
              expiresInSec: 3600,
            }).catch(() => gcsToHttps(`gs://${outParsedImg.bucket}/${imgObjectName}`));
          } catch (err: any) {
            return json({ error: "image_upload_error", detail: err?.message || err }, 500);
          }
        }
      }

      const seedanceBody: any = {
        model: "bytedance/seedance-2.0/image-to-video",
        prompt: safePromptText,
        duration: seedanceDuration,
        resolution: "720p",
        ratio: aspectFinal,
      };
      if (imageUrl) seedanceBody.image = imageUrl;

      const seedanceRes = await fetch("https://api.atlascloud.ai/api/v1/model/generateVideo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${atlasKey}`,
        },
        body: JSON.stringify(seedanceBody),
      });
      const seedanceText = await seedanceRes.text();
      if (!seedanceRes.ok) {
        return json({ error: "seedance_error", status: seedanceRes.status, detail: safeJson(seedanceText) }, seedanceRes.status);
      }
      const seedanceJson = safeJson(seedanceText);
      const predictionId =
        seedanceJson?.data?.id ||
        seedanceJson?.prediction_id ||
        seedanceJson?.id ||
        seedanceJson?.data?.prediction_id ||
        "";

      log('seedance_ok', { predictionId });
      return json({
        job_id: predictionId ? `seedance:${predictionId}` : "",
        status: "processing"
      }, 202);
    }

    // Veo branch (via Atlas Cloud AI)
    {
      const atlasKey = env.ATLASCLOUD_API_KEY as string | undefined;
      if (!atlasKey) return json({ error: "ATLASCLOUD_API_KEY missing" }, 500);
      const veoAtlasModel = (env.VEO_ATLAS_MODEL_ID as string | undefined) || "google/veo3.1-fast/image-to-video";
      const startImageResolved = await toAtlasImageUrl(imageDataUrl, `start-${sceneId}`).catch((e: any) => { throw new Error("image_upload_error: " + (e?.message || e)); });
      if (!startImageResolved) return json({ error: "imageDataUrl is empty or upload failed" }, 400);
      const atlasBody: any = {
        model: veoAtlasModel,
        prompt: safePromptText,
        duration: snapDuration,
        aspect_ratio: aspectFinal,
        resolution: "1080p",
        image: startImageResolved,
      };
      log('veo_atlas_request', { sceneId, model: veoAtlasModel, aspect: aspectFinal, duration: snapDuration });
      const atlasRes = await fetch("https://api.atlascloud.ai/api/v1/model/generateVideo", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${atlasKey}` },
        body: JSON.stringify(atlasBody),
      });
      const atlasText = await atlasRes.text();
      if (!atlasRes.ok) {
        return json({ error: "veo_http_error", status: atlasRes.status, detail: safeJson(atlasText) }, atlasRes.status);
      }
      const atlasJson = safeJson(atlasText);
      const predictionId = atlasJson?.data?.id || atlasJson?.id || atlasJson?.prediction_id || "";
      if (!predictionId) return json({ error: "veo_no_prediction_id", raw: atlasJson }, 500);
      log('veo_ok', { predictionId });
      return json({ job_id: `veo:${predictionId}`, model: veoAtlasModel, aspectApplied: aspectFinal, outputGcsUri });
    }
  } catch (e: any) {
    log('catch', e?.message, e?.stack);
    return json({ error: e?.message ?? "Unknown error", stack: e?.stack ?? '' }, 500);
  }
};

// Kling image 필드 변환: https/gs URL은 그대로 URL 형식 유지, data:URL은 base64 문자열만 추출
function toKlingImageField(src: string): string {
  const s = String(src || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("gs://")) {
    // Kling은 외부 접근 가능한 URL을 요구 → gs:// 는 공개 https로 변환해 전달
    const rest = s.slice(5);
    const slash = rest.indexOf("/");
    if (slash === -1) return "";
    return `https://storage.googleapis.com/${rest.slice(0, slash)}/${rest.slice(slash + 1)}`;
  }
  if (s.startsWith("data:")) return stripDataUrlPrefix(s);
  // 접두어 없는 base64 문자열로 간주
  return s;
}

function parseDataUrl(dataUrl: string): { base64: string; mimeType: string } | null {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const [, mime, b64] = match;
  if (!b64) return null;
  return { base64: b64.trim(), mimeType: mime || 'image/png' };
}

function base64ToUint8(base64: string) {
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Veo fast는 4/6/8초만 허용 → 근접값으로 스냅
function snapToAllowedDuration(sec: number) {
  const allowed = [4, 6, 8];
  const n = Math.max(1, Math.floor(Number(sec) || 0));
  let best = allowed[0];
  let diff = Math.abs(n - best);
  for (const v of allowed) {
    const d = Math.abs(n - v);
    if (d < diff) {
      diff = d;
      best = v;
    }
  }
  return best;
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

function arrayBufferToBase64(buf: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function toBool(value: any, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(v)) return true;
    if (["false", "0", "no", "off"].includes(v)) return false;
  }
  return !!fallback;
}

function pickAspectRatio(raw: any): string {
  const text = String(raw ?? "").trim().replace(/\s+/g, "").replace("/", ":");
  return (text === "16:9" || text === "9:16" || text === "1:1") ? text : "";
}

function normalizeAspectRatio(raw: any): string {
  return pickAspectRatio(raw) || "16:9";
}

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

function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  if (!uri.startsWith("gs://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const bucket = rest.slice(0, slash);
  const object = rest.slice(slash + 1);
  return { bucket, object };
}

async function getGoogleAccessToken(opts: {
  clientEmail: string;
  privateKeyPem: string; // \\n 포함 형식(Cloudflare Secret)
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
  if (!res.ok) {
    throw new Error(`OAuth token error (${res.status}): ${text}`);
  }
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error("No access_token in OAuth response");
  return json.access_token as string;
}

// GCS 서명 URL (V4)
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
    "X-Goog-SignedHeaders": signedHeaders
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

  const sigBytes = new Uint8Array(sigBuf);
  let bin = "";
  for (const b of sigBytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return b64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string) {
  const lines = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .split(/\s+/).join("");
  const raw = atob(lines);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}
