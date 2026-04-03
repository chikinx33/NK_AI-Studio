// prototype/functions/api/imagen.ts
import { buildAiImageSessionPrefix, buildAiVideoProjectPrefix } from "./_shared/storage";
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
    const incomingConversationHistory = Array.isArray(body?.conversationHistory) ? body.conversationHistory : [];
    const storageService = normalizeStorageService(body?.storageService || body?.service);
    const generationMode = normalizeGenerationMode(body?.generationMode || body?.mode, incomingReferenceImages.length > 0);
    const generationStyle = normalizeGenerationStyle(body?.generationStyle || body?.conversationMode);
    const cameraTargetModeIncoming = String(body?.cameraTargetMode || body?.cameraTarget || body?.cameraScope || "").trim();
    const cameraTargetModeNorm = normalizeCameraTargetMode(cameraTargetModeIncoming);
    const cameraTargetMode = (generationMode === "image-to-image" && !cameraTargetModeIncoming)
      ? "subject"
      : cameraTargetModeNorm;
    const sessionId = String(body?.sessionId || body?.session || "default").trim();

    if (!prompt) {
      return json({ error: "prompt is required" }, 400);
    }

    const apiKey = String(env.GOOGLE_API_KEY || "").trim();
    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    const geminiModel = String(env.GEMINI_IMAGE_MODEL || "").trim() || "gemini-3.1-flash-image-preview";
    const incomingSize = String(body?.imageSize || body?.quality || body?.resolution || "").trim().toUpperCase();
    const sizeAllowed = new Set(["512", "1K", "2K"]);
    const sizeDefault = String(env.GEMINI_IMAGE_SIZE || "").trim().toUpperCase() || "1K";
    const geminiImageSize = sizeAllowed.has(incomingSize) ? incomingSize : sizeDefault;

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
      requestUrl: request.url,
      authHeader: String(request.headers.get("Authorization") || "").trim(),
    });
    const conversationHistory = await normalizeConversationHistory({
      items: incomingConversationHistory,
      accessToken,
      requestUrl: request.url,
      authHeader: String(request.headers.get("Authorization") || "").trim(),
    });
    if (generationMode === "image-to-image" && incomingReferenceImages.length > 0 && !referenceImages.length) {
      return json({
        error: "소스 이미지를 서버에서 읽지 못했습니다. 만료된 URL이거나 인증되지 않은 프록시 URL일 수 있습니다.",
        code: "source_image_reference_unavailable",
        requestedReferenceImageCount: incomingReferenceImages.length,
        referenceImageCount: 0,
      }, 400);
    }
    const finalPrompt = buildGeminiImagePrompt(
      prompt,
      referenceImages,
      generationMode,
      generationStyle,
      conversationHistory.length,
      cameraTargetMode
    );

    const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`;
    const requestPayload = {
      contents: buildGeminiContents(conversationHistory, referenceImages, finalPrompt),
      generationConfig: buildGeminiGenerationConfig(geminiModel, aspectFinal, geminiImageSize),
    };
    let geminiRes: Response | null = null;
    let geminiText = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        geminiRes = await fetch(generateUrl, {
          method: "POST",
          headers: {
            "x-goog-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestPayload),
        });
        geminiText = await geminiRes.text();
        if (geminiRes.ok || (geminiRes.status >= 400 && geminiRes.status < 500)) break;
      } catch (_) {
      }
      await sleep(400 * Math.pow(2, attempt));
    }

    if (!geminiRes) {
      return json({ error: "Gemini API error", status: 500, detail: "network_error", hint: "네트워크 오류로 Gemini 호출에 실패했습니다. 잠시 후 다시 시도하세요." }, 500);
    }
    if (!geminiRes.ok) {
      const detail = safeJson(geminiText);
      const mapped = explainGeminiError(geminiRes.status, detail, { model: geminiModel });
      return json(Object.assign({ error: "Gemini API error", status: geminiRes.status, detail }, mapped), 500);
    }

    const geminiJson = safeJson(geminiText) || {};
    const imageOutput = extractGeminiImage(geminiJson);
    const bytesBase64Encoded = imageOutput?.data || "";

    if (!bytesBase64Encoded) {
      return json({ error: "No image bytes returned", raw: geminiJson }, 500);
    }

    const projTagRaw = (body?.projectId ?? body?.projTag ?? "").toString().trim();
    const projTag = projTagRaw || "default";
    const userId = String((auth as any)?.userId || "owner").trim() || "owner";
    const baseOutput = env.VIDEO_OUTPUT_GCS_URI as string | undefined;
    const outParsed = baseOutput ? parseGcsUri(baseOutput) : null;
    let signedUrl = "";
    let objectName = "";
    if (outParsed) {
      const basePrefix = outParsed.object.replace(/\/$/, "");
      const stamp = Date.now();
      if (storageService === "ai-image") {
        const sessionPrefix = buildAiImageSessionPrefix(basePrefix, userId, sessionId || "default");
        objectName = `${sessionPrefix}/outputs/${stamp}-${crypto.randomUUID()}.png`;
      } else {
        const projectPrefix = buildAiVideoProjectPrefix(basePrefix, userId, projTag);
        objectName = `${projectPrefix}/image/${stamp}-${crypto.randomUUID()}.png`;
      }
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
          clientEmail: String(clientEmail || ""),
          privateKeyPem: String(privateKeyRaw || ""),
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
      imageSizeApplied: geminiImageSize,
      provider: "gemini-api",
      promptEcho: finalPrompt,
      aspectApplied: aspectFinal,
      referenceImageCount: referenceImages.length,
      conversationTurnCount: conversationHistory.length,
      storageService,
      generationMode,
      generationStyle,
      sessionId: sessionId || "default",
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildGeminiParts(referenceImages: NormalizedReferenceImage[], prompt: string) {
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  referenceImages.forEach((item) => {
    parts.push({
      inlineData: {
        mimeType: item.mimeType || "image/png",
        data: item.base64,
      }
    });
  });
  return parts;
}

function buildGeminiContents(
  conversationHistory: ConversationHistoryTurn[],
  referenceImages: NormalizedReferenceImage[],
  prompt: string
) {
  const contents: Array<Record<string, unknown>> = [];
  conversationHistory.forEach((turn) => {
    contents.push({
      role: "user",
      parts: [{
        text: buildConversationPrompt(turn),
      }],
    });
    contents.push({
      role: "model",
      parts: [{
        inlineData: {
          mimeType: turn.imageMimeType || "image/png",
          data: turn.imageBase64,
        }
      }],
    });
  });
  contents.push({
    role: "user",
    parts: buildGeminiParts(referenceImages, prompt),
  });
  return contents;
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

function buildGeminiImagePrompt(
  prompt: string,
  referenceImages: NormalizedReferenceImage[],
  generationMode: "text-to-image" | "image-to-image",
  generationStyle: "single" | "conversation",
  conversationTurnCount: number,
  cameraTargetMode: "scene" | "subject"
) {
  const base = normalizePrompt(prompt);
  const conversationLines = generationStyle === "conversation" && conversationTurnCount > 0
    ? [
      "Build on the established visual continuity from the previous conversation turns.",
      "Preserve the existing subject identity, styling, and composition language unless this prompt explicitly changes them."
    ]
    : [];
  if (!referenceImages.length) {
    return [base].concat(conversationLines).filter(Boolean).join("\n");
  }
  if (generationMode === "image-to-image") {
    const targetLines = cameraTargetMode === "subject"
      ? [
        "Keep the background, environment, horizon, and broad composition as stable as possible.",
        "Rotate or re-pose only the main foreground subject relative to the camera.",
        "Do not reinterpret the whole frame from a new scene-wide viewpoint."
      ]
      : [
        "Reconstruct the entire frame from a new camera viewpoint.",
        "Rotate the whole scene perspective together, including the background, environment, depth, horizon, and subject placement.",
        "Do not keep the background fixed while rotating only a foreground subject.",
        "Preserve the same scene concept and key subjects, but allow perspective and composition to shift to match the new camera angle."
      ];
    const referenceGuideLines = referenceImages.map((item, index) => {
      const label = String(item.subjectDescription || `reference image ${index + 1}`).trim() || `reference image ${index + 1}`;
      if (index === 0) {
        return `Reference image 1 (${label}) is the primary anchor for composition, structure, and subject identity.`;
      }
      return `Reference image ${index + 1} (${label}) is a supporting reference for style, details, materials, and consistency.`;
    });
    return [
      base,
      ...conversationLines,
      referenceImages.length > 1
        ? "Use the uploaded source image set as a coordinated multi-reference pack."
        : "Use the uploaded source image as the base reference.",
      ...targetLines,
      referenceImages.length > 1
        ? "Follow the prompt first, then reference image 1, then the remaining reference images."
        : "Preserve the important structure, composition, and recognizable subject identity unless the prompt explicitly requests changes.",
      referenceImages.length > 1
        ? "Treat reference image 1 as the primary composition and structure anchor. Use the remaining reference images to reinforce styling, design details, materials, lighting cues, and subject consistency only when they do not conflict with the prompt."
        : "",
      ...referenceGuideLines,
      referenceImages.length > 1
        ? "If the references show the same subject from different angles or crops, merge them into one consistent result."
        : "",
      "Apply only the requested edits or stylistic transformations."
    ].filter(Boolean).join("\n");
  }
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
    ...conversationLines,
    "The uploaded reference images define the official registered character design.",
  ].concat(consistencyLines).filter(Boolean).join("\n");
}

function explainGeminiError(status: number, detail: any, ctx?: { model?: string }) {
  try {
    const d = detail && typeof detail === "object" ? detail : {};
    const message = String(d?.error?.message || d?.message || "").trim();
    const code = String(d?.error?.status || d?.error?.code || "").trim();
    let hint = "";
    if (status === 404 || /model/i.test(message)) {
      hint = "모델 이름 또는 엔드포인트를 확인하세요. 환경변수 GEMINI_IMAGE_MODEL=" + (ctx?.model || "") + "이 유효한지 점검하세요.";
    } else if (status === 401) {
      hint = "API 키가 유효하지 않거나 권한이 없습니다. GOOGLE_API_KEY를 확인하세요.";
    } else if (status === 403) {
      hint = "권한 또는 쿼터 제한입니다. 프로젝트 접근 권한/결제/할당량을 확인하세요.";
    } else if (status === 429) {
      hint = "요청 한도를 초과했습니다. 잠시 후 다시 시도하거나 쿼터를 늘리세요.";
    } else if (status === 400) {
      hint = "요청 형식이 잘못되었을 수 있습니다. 프롬프트/참조 이미지/파라미터를 점검하세요.";
    } else if (status >= 500) {
      hint = "Gemini 서버 일시 오류입니다. 잠시 후 다시 시도하세요.";
    }
    return { code, hint, message };
  } catch {
    return {};
  }
}

function normalizeStorageService(value: unknown) {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "ai-image" ? "ai-image" : "ai-video";
}

function normalizeGenerationMode(value: unknown, hasReferences: boolean): "text-to-image" | "image-to-image" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "image-to-image" || raw === "img2img") return "image-to-image";
  if (raw === "text-to-image" || raw === "txt2img") return "text-to-image";
  return hasReferences ? "image-to-image" : "text-to-image";
}

function normalizeGenerationStyle(value: unknown): "single" | "conversation" {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "conversation" ? "conversation" : "single";
}

function normalizeCameraTargetMode(value: unknown): "scene" | "subject" {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "subject" ? "subject" : "scene";
}

type NormalizedReferenceImage = {
  referenceId: number;
  base64: string;
  mimeType: string;
  subjectDescription: string;
  subjectType: string;
};

type ConversationHistoryTurn = {
  prompt: string;
  imageBase64: string;
  imageMimeType: string;
  mode: string;
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
  requestUrl: string;
  authHeader: string;
}): Promise<NormalizedReferenceImage[]> {
  const items = Array.isArray(args.items) ? args.items.slice(0, 4) : [];
  const out: NormalizedReferenceImage[] = [];
  for (let i = 0; i < items.length; i++) {
    const raw = items[i] && typeof items[i] === "object" ? items[i] : {};
    const imageDataUrl = String(raw.imageDataUrl || raw.imageUrl || raw.url || "").trim();
    if (!imageDataUrl) continue;
    const parsed = await resolveImageBytes(imageDataUrl, args.accessToken, args.requestUrl, args.authHeader);
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

async function normalizeConversationHistory(args: {
  items: any[];
  accessToken: string;
  requestUrl: string;
  authHeader: string;
}): Promise<ConversationHistoryTurn[]> {
  const items = Array.isArray(args.items) ? args.items.slice(-3) : [];
  const out: ConversationHistoryTurn[] = [];
  for (let i = 0; i < items.length; i++) {
    const raw = items[i] && typeof items[i] === "object" ? items[i] : {};
    const prompt = normalizePrompt(String(raw.prompt || "").trim());
    const imageDataUrl = String(raw.imageDataUrl || raw.imageUrl || raw.url || "").trim();
    if (!prompt || !imageDataUrl) continue;
    const parsed = await resolveImageBytes(imageDataUrl, args.accessToken, args.requestUrl, args.authHeader);
    if (!parsed) continue;
    out.push({
      prompt,
      imageBase64: parsed.base64,
      imageMimeType: parsed.mimeType || "image/png",
      mode: String(raw.mode || "text-to-image").trim(),
    });
  }
  return out;
}

function buildConversationPrompt(turn: ConversationHistoryTurn) {
  const lines = [
    "Previous approved image generation turn.",
    turn.mode === "image-to-image"
      ? "This turn was an image-to-image edit."
      : "This turn was a text-to-image generation.",
    turn.prompt
  ];
  return lines.filter(Boolean).join("\n");
}

async function resolveImageBytes(
  imageDataUrl: string,
  accessToken: string,
  requestUrl: string,
  authHeader: string
): Promise<{ base64: string; mimeType: string } | null> {
  const parsed = parseDataUrl(imageDataUrl);
  if (parsed) return parsed;
  try {
    let resolvedUrl = imageDataUrl.startsWith("gs://")
      ? gcsToHttps(imageDataUrl)
      : imageDataUrl;
    if (!resolvedUrl) return null;
    if (/^\/(?!\/)/.test(resolvedUrl)) {
      resolvedUrl = new URL(resolvedUrl, requestUrl).toString();
    }
    const headers: Record<string, string> = {};
    if (imageDataUrl.startsWith("gs://") || resolvedUrl.includes("storage.googleapis.com")) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    try {
      const requestOrigin = new URL(requestUrl).origin;
      const targetUrl = new URL(resolvedUrl);
      if (
        authHeader &&
        targetUrl.origin === requestOrigin &&
        targetUrl.pathname === "/api/media/proxy"
      ) {
        headers.Authorization = authHeader;
      }
    } catch (_) {}
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
