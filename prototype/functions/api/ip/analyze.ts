// prototype/functions/api/ip/analyze.ts
// POST /api/ip/analyze — 등록된 캐릭터 시트를 분석해 IP 라이브러리의 '텍스트 속성' 초안을 만든다.
// 캐릭터 설명·고정 특성·금지 특성·네거티브 프롬프트·스타일 가이드를 1차로 채우고,
// 사람이 그 위에서 고치는 흐름을 전제로 한다. 저장하지 않는다 — 응답만 돌려준다.
//
// 왜 필요한가: 이미지 모델은 '없어야 하는 것'을 레퍼런스 이미지에서 배울 수 없다. 시트에 손가락이
// 안 보이면 "이 각도에선 안 보인다"로 읽고 자기 사전지식으로 손가락을 그린다. 금지 정보는 텍스트로만
// 전달되므로, 그 텍스트를 사람이 전부 적는 부담을 줄이는 것이 이 엔드포인트의 목적이다.
import { authorizeRequest } from "../_shared/auth.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const MAX_IMAGES = 4;
// 인라인 이미지 총량 상한(약 6MB). 시트 4장을 그대로 넣으면 요청이 커져 400 이 난다.
const MAX_INLINE_BYTES = 6 * 1024 * 1024;

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const body = await request.json().catch(() => ({} as any));
    const characterName = String(body?.characterName || body?.name || "").trim();
    const lang = normalizeLang(body?.lang);
    const imageUrls: string[] = (Array.isArray(body?.imageUrls) ? body.imageUrls : [])
      .map((v: any) => String(v || "").trim())
      .filter(Boolean)
      .slice(0, MAX_IMAGES);
    const brandContext = (body?.brandContext && typeof body.brandContext === "object") ? body.brandContext : {};
    if (!imageUrls.length) return json({ error: "등록된 시트 이미지가 필요해요(imageUrls)." }, 400);

    const apiKey = String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "").trim();
    const clientEmail = String(env.GOOGLE_CLIENT_EMAIL || "").trim();
    const privateKeyRaw = String(env.GOOGLE_PRIVATE_KEY || "").trim();
    const geminiModel = String(env.GEMINI_PROMPT_ANALYSIS_MODEL || env.GEMINI_TEXT_MODEL || "gemini-2.5-flash").trim();
    if (!apiKey) return json({ error: "Missing GEMINI_API_KEY / GOOGLE_API_KEY" }, 500);
    if (!clientEmail || !privateKeyRaw) return json({ error: "Missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY" }, 500);

    const accessToken = await getGoogleAccessToken({
      clientEmail,
      privateKeyPem: privateKeyRaw,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });
    const authHeader = String(request.headers.get("Authorization") || "").trim();

    const parts: any[] = [{ text: buildInstruction(lang, characterName, brandContext) }];
    let usable = 0;
    let skippedForSize = 0;
    let inlineBytes = 0;
    for (const url of imageUrls) {
      const parsed = await resolveImageBytes(url, accessToken, request.url, authHeader);
      if (!parsed) continue;
      // 시트는 4분할 그리드라 장당 수 MB가 될 수 있다. 요청이 커지면 Gemini 가 400 으로 거절하므로
      // 총량에 상한을 두고, 넘치는 장은 건너뛴다(1장이라도 있으면 분석은 가능하다).
      const bytes = Math.floor(parsed.base64.length * 0.75);
      if (usable > 0 && inlineBytes + bytes > MAX_INLINE_BYTES) { skippedForSize++; continue; }
      inlineBytes += bytes;
      parts.push({ inlineData: { mimeType: parsed.mimeType || "image/png", data: parsed.base64 } });
      usable++;
    }
    if (!usable) return json({ error: "시트 이미지를 읽지 못했어요(경로 확인 필요)." }, 400);

    const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`;
    const callGemini = async (useSchema: boolean) => {
      const generationConfig: any = { temperature: 0.3 };
      if (useSchema) {
        // JSON 스키마를 강제하면 파싱 실패·형식 흔들림이 없다. 단, 모델·버전에 따라 거절될 수 있어
        // 실패하면 스키마 없이 한 번 더 시도한다(아래 폴백).
        generationConfig.responseMimeType = "application/json";
        generationConfig.responseSchema = {
          type: "OBJECT",
          properties: {
            description: { type: "STRING" },
            fixedTraits: { type: "ARRAY", items: { type: "STRING" } },
            bannedTraits: { type: "ARRAY", items: { type: "STRING" } },
            negativePrompt: { type: "STRING" },
            styleGuide: { type: "STRING" },
          },
          required: ["description", "fixedTraits", "bannedTraits", "negativePrompt", "styleGuide"],
        };
      }
      const res = await fetch(generateUrl, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: useSchema ? parts : [...parts, { text: JSON_ONLY_HINT }] }],
          generationConfig,
        }),
      });
      return { res, text: await res.text() };
    };

    let attempt = await callGemini(true);
    let schemaFallback = false;
    if (!attempt.res.ok) {
      // 스키마 거절(400 등)일 수 있으니 스키마 없이 재시도. 그래도 실패하면 사유를 그대로 올린다.
      const retry = await callGemini(false);
      if (retry.res.ok) {
        attempt = retry;
        schemaFallback = true;
      } else {
        // ★ 사유를 error 문자열에 넣는다. 클라이언트는 error 필드만 표시하므로
        //   detail 로만 내려보내면 "Gemini API error" 만 보이고 원인을 알 수 없다.
        return json({
          error: `Gemini API error (${attempt.res.status}): ${geminiErrorMessage(attempt.text)}`,
          status: attempt.res.status,
          model: geminiModel,
          analyzedImages: usable,
          inlineBytes,
          retryStatus: retry.res.status,
          retryMessage: geminiErrorMessage(retry.text),
          detail: safeJson(attempt.text),
        }, 502);
      }
    }
    const rawText = extractGeminiText(safeJson(attempt.text) || {}) || "";
    const parsedOut = safeJson(extractJsonBlock(rawText));
    const out = (parsedOut && typeof parsedOut === "object") ? parsedOut : {};
    if (!out.description && !Array.isArray(out.fixedTraits)) {
      return json({
        error: `분석 응답을 이해하지 못했어요. (모델: ${geminiModel}) ${rawText.slice(0, 200)}`,
        model: geminiModel,
      }, 502);
    }

    return json({
      ok: true,
      characterName,
      analyzedImages: usable,
      skippedForSize,
      schemaFallback,
      model: geminiModel,
      description: oneLine(out.description, 600),
      fixedTraits: toList(out.fixedTraits, 10),
      bannedTraits: toList(out.bannedTraits, 10),
      negativePrompt: oneLine(out.negativePrompt, 300),
      styleGuide: oneLine(out.styleGuide, 200),
    });
  } catch (e: any) {
    return json({ error: e?.message ?? "Unknown error" }, 500);
  }
};

// 스키마를 못 쓰는 경우를 위한 지시 — 순수 JSON만 받도록 못박는다.
const JSON_ONLY_HINT = [
  "Return ONLY a JSON object with exactly these keys:",
  '{"description": string, "fixedTraits": string[], "bannedTraits": string[], "negativePrompt": string, "styleGuide": string}',
  "No markdown fences, no commentary.",
].join("\n");

/** Gemini 오류 본문에서 사람이 읽을 사유만 뽑는다. */
function geminiErrorMessage(text: string) {
  const parsed = safeJson(text);
  const msg = (parsed && typeof parsed === "object")
    ? String((parsed as any)?.error?.message || (parsed as any)?.message || "")
    : "";
  return (msg || String(text || "")).replace(/\s+/g, " ").trim().slice(0, 300) || "unknown";
}

/** 코드펜스·앞뒤 설명이 섞여 와도 JSON 본문만 꺼낸다(스키마 폴백 경로용). */
function extractJsonBlock(text: string) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const body = fenced ? fenced[1].trim() : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

function oneLine(value: unknown, max: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function toList(value: unknown, max: number) {
  return (Array.isArray(value) ? value : [])
    .map((v) => String(v || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeLang(value: unknown) {
  return String(value || "").trim().toLowerCase() === "en" ? "en" : "ko";
}

/**
 * 분석 지시문. 두 가지를 특히 강조한다.
 *  ① 금지 특성은 '한 각도에서 안 보이는 것'이 아니라 '설계상 없는 것'만 적게 한다(추측 금지).
 *  ② 이미지 모델이 부정문을 약하게 처리하므로 고정 특성은 형태를 긍정문으로 서술하게 한다.
 *     "손가락 없음"보다 "둥근 벙어리장갑 형태의 손, 손가락 구분 없음"이 훨씬 잘 먹는다.
 */
function buildInstruction(lang: "ko" | "en", characterName: string, brandContext: any) {
  const ctxLines: string[] = [];
  const push = (label: string, value: any) => {
    if (Array.isArray(value)) {
      const v = value.map((x) => String(x || "").trim()).filter(Boolean);
      if (v.length) ctxLines.push(`${label}: ${v.join(", ")}`);
      return;
    }
    const v = String(value || "").trim();
    if (v) ctxLines.push(`${label}: ${v}`);
  };
  push("Brand", brandContext?.brandTitle);
  push("Brand story", brandContext?.brandStory);
  push("World setting", brandContext?.worldSetting);
  push("Brand rules", brandContext?.brandRules);
  push("Banned expressions", brandContext?.bannedExpressions);
  push("Other registered characters", brandContext?.otherCharacters);
  const ctx = ctxLines.length ? `\n\n[Brand IP context]\n${ctxLines.join("\n")}` : "";

  if (lang === "en") {
    return [
      "You are building a reusable character specification from the attached registered character sheet image(s).",
      characterName ? `The character is "${characterName}".` : "",
      "All images show the SAME character from different angles or expressions. Merge them into one consistent spec.",
      "Return JSON with these fields:",
      "- description: 2-3 sentences on identity, silhouette, face, body proportions, costume, materials, and colors.",
      "- fixedTraits: short phrases that must never change. Describe SHAPES POSITIVELY (e.g. 'rounded mitten-like hands with no separated fingers'), because image models handle negation poorly.",
      "- bannedTraits: things this character design does NOT have, only when the sheets make it clearly intentional (e.g. 'no separated fingers', 'no nose'). Never guess from one angle where something is merely hidden.",
      "- negativePrompt: comma-separated English keywords for negative prompting (e.g. 'fingers, human hands, extra limbs').",
      "- styleGuide: rendering style in a short phrase (e.g. '3D toy-like render, soft pastel palette, clean outlines').",
      "Base every claim on what the images actually show. Leave a field empty rather than guessing.",
      ctx,
    ].filter(Boolean).join("\n");
  }
  return [
    "첨부된 등록 캐릭터 시트 이미지를 분석해, 이후 이미지 생성에 재사용할 캐릭터 규격을 만드세요.",
    characterName ? `대상 캐릭터: "${characterName}".` : "",
    "여러 장이면 모두 같은 캐릭터의 다른 각도·표정입니다. 하나의 일관된 규격으로 통합하세요.",
    "다음 필드를 JSON으로 반환하세요.",
    "- description: 정체성·실루엣·얼굴·신체 비율·의상·재질·색상을 2~3문장으로.",
    "- fixedTraits: 절대 변하면 안 되는 특징을 짧은 구로. 형태는 반드시 긍정문으로 서술하세요(예: '둥근 벙어리장갑 형태의 손, 손가락 구분 없음'). 이미지 모델은 부정문을 약하게 처리합니다.",
    "- bannedTraits: 이 캐릭터 설계상 '없는' 요소만. 시트에서 의도적으로 없다는 게 분명할 때만 적으세요(예: '손가락 없음', '코 없음'). 한 각도에서 단순히 안 보이는 것은 넣지 마세요.",
    "- negativePrompt: 네거티브 프롬프트용 영어 키워드를 쉼표로(예: 'fingers, human hands, extra limbs').",
    "- styleGuide: 렌더링 스타일을 짧은 구로(예: '3D 토이 렌더, 파스텔 색감, 깔끔한 외곽선').",
    "모든 서술은 이미지에서 실제로 확인되는 것만 쓰세요. 확인 불가한 항목은 비워 두세요.",
    "description·fixedTraits·bannedTraits·styleGuide 는 한국어로, negativePrompt 는 영어로 작성하세요.",
    ctx,
  ].filter(Boolean).join("\n");
}
function extractGeminiText(json: any) {
  try {
    const candidates = Array.isArray(json?.candidates) ? json.candidates : [];
    for (const candidate of candidates) {
      const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
      for (const part of parts) {
        const text = String(part?.text || "").trim();
        if (text) return text;
      }
    }
  } catch (_) {}
  return "";
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
      if (authHeader && targetUrl.origin === requestOrigin && targetUrl.pathname === "/api/media/proxy") {
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

function parseDataUrl(dataUrl: string): { base64: string; mimeType: string } | null {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = String(match[1] || "image/png").trim() || "image/png";
  const base64 = String(match[2] || "").trim();
  if (!base64) return null;
  return { base64, mimeType };
}

function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  if (!uri || !uri.startsWith("gs://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  return { bucket: rest.slice(0, slash), object: rest.slice(slash + 1) };
}

function gcsToHttps(uri: string) {
  if (!uri.startsWith("gs://")) return uri;
  const parsed = parseGcsUri(uri);
  if (!parsed) return uri;
  return `https://storage.googleapis.com/${parsed.bucket}/${parsed.object}`;
}

function arrayBufferToBase64(buf: ArrayBuffer) {
  // 큰 버퍼를 1바이트씩 연결하면 O(n²) 가 되어 Workers CPU 한도를 넘긴다.
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    bin += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(bin);
}
