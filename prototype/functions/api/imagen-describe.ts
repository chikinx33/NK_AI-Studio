import { geminiTextModel } from "./_shared/gemini-models.js";
import { authorizeRequest } from "./_shared/auth.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }

    const body = await request.json().catch(() => ({} as any));
    const imageUrl = String(body?.imageUrl || body?.imageDataUrl || body?.url || "").trim();
    const lang = normalizeLang(body?.lang);
    if (!imageUrl) {
      return json({ error: "imageUrl is required" }, 400);
    }

    const apiKey = String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "").trim();
    const clientEmail = String(env.GOOGLE_CLIENT_EMAIL || "").trim();
    const privateKeyRaw = String(env.GOOGLE_PRIVATE_KEY || "").trim();
    const geminiModel = String(
      geminiTextModel(env)
    ).trim();

    if (!apiKey) {
      return json({ error: "Missing GEMINI_API_KEY / GOOGLE_API_KEY" }, 500);
    }
    if (!clientEmail || !privateKeyRaw) {
      return json({ error: "Missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY" }, 500);
    }

    const accessToken = await getGoogleAccessToken({
      clientEmail,
      privateKeyPem: privateKeyRaw,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });

    const parsed = await resolveImageBytes(
      imageUrl,
      accessToken,
      request.url,
      String(request.headers.get("Authorization") || "").trim()
    );
    if (!parsed) {
      return json({ error: "image_reference_unavailable" }, 400);
    }

    const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`;
    const payload = {
      contents: [{
        role: "user",
        parts: [
          { text: buildAnalysisInstruction(lang) },
          {
            inlineData: {
              mimeType: parsed.mimeType || "image/png",
              data: parsed.base64,
            }
          }
        ]
      }],
      generationConfig: {
        responseMimeType: "text/plain",
        temperature: 0.35,
      }
    };

    const geminiRes = await fetch(generateUrl, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const geminiText = await geminiRes.text();
    if (!geminiRes.ok) {
      return json({ error: "Gemini API error", status: geminiRes.status, detail: safeJson(geminiText) }, 500);
    }

    const geminiJson = safeJson(geminiText) || {};
    const prompt = extractGeminiText(geminiJson);
    if (!prompt) {
      return json({ error: "No prompt text returned", raw: geminiJson }, 500);
    }

    return json({
      prompt: prompt.trim(),
      model: geminiModel,
      lang,
    });
  } catch (e: any) {
    return json({ error: e?.message ?? "Unknown error" }, 500);
  }
};

function normalizeLang(value: unknown) {
  return String(value || "").trim().toLowerCase() === "en" ? "en" : "ko";
}

function buildAnalysisInstruction(lang: "ko" | "en") {
  if (lang === "en") {
    return [
      "Analyze this image and convert it into one polished image-generation prompt.",
      "The prompt will be reused to preserve visual consistency in later generations.",
      "Describe the subject identity, facial features, silhouette, costume, materials, colors, pose, camera angle, composition, lighting, background, mood, and rendering style as concretely as possible.",
      "If an attribute is not visually clear, omit it instead of guessing.",
      "Return plain prompt text only.",
      "Do not use bullets, labels, quotes, markdown, or explanations.",
      "Write in English."
    ].join("\n");
  }
  return [
    "이 이미지를 분석해서 이후 이미지 생성에 재사용할 수 있는 완성형 프롬프트 한 문장으로 변환하세요.",
    "목표는 같은 피사체와 분위기의 일관성을 유지하는 것입니다.",
    "주체 정체성, 얼굴 특징, 실루엣, 의상, 재질, 색상, 포즈, 카메라 앵글, 구도, 조명, 배경, 분위기, 렌더링 스타일을 가능한 한 구체적으로 서술하세요.",
    "이미지에서 확실하지 않은 정보는 추측하지 말고 제외하세요.",
    "결과는 프롬프트 본문만 반환하세요.",
    "불릿, 라벨, 따옴표, 마크다운, 설명문은 금지합니다.",
    "한국어로 작성하세요."
  ].join("\n");
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
