// prototype/functions/api/imagen.ts
export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const body = await request.json().catch(() => ({} as any));
    const prompt = (body?.prompt ?? "").toString().trim();

    if (!prompt) {
      return json({ error: "prompt is required" }, 400);
    }

    // 공통 가드 규칙: 다중 패널/텍스트/자막 금지 등
    const guardRules = [
      "Single frame only; do not split into multiple panels or pages.",
      "No subtitles, captions, on-screen text, speech bubbles, UI, or watermarks in the image.",
      "Render one final image, not a storyboard."
    ];
    const finalPrompt = `${prompt}\n\nGlobal guard: ${guardRules.join(" ")}`;

    // Cloudflare Pages > Variables and Secrets 에 등록한 값들
    const projectId = env.GOOGLE_PROJECT_ID as string | undefined;
    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;

    if (!projectId || !clientEmail || !privateKeyRaw) {
      return json(
        { error: "Missing GOOGLE_PROJECT_ID / GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY" },
        500
      );
    }

    const location = "us-central1";

    // Google OAuth 토큰 발급 (Service Account JWT Bearer)
    const accessToken = await getGoogleAccessToken({
      clientEmail,
      privateKeyPem: privateKeyRaw,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });

    // Vertex AI Imagen REST 호출
    // Google 공식 문서 REST 형식: https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_VERSION}:predict
    // 모델 버전은 Imagen 문서의 지원 모델 중 하나를 사용 (예: imagen-3.0-generate-002)
    const modelVersion = "imagen-3.0-generate-002";

    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelVersion}:predict`;

    const vertexRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [{ prompt: finalPrompt }],
        parameters: {
  	  sampleCount: 1,
  	  aspectRatio: "1:1",
  	  personGeneration: "allow_all",
        },
      }),
    });

    const vertexText = await vertexRes.text();
    if (!vertexRes.ok) {
      return json(
        { error: "Vertex AI error", status: vertexRes.status, detail: safeJson(vertexText) },
        500
      );
    }

    const vertexJson = JSON.parse(vertexText);
    const pred = vertexJson?.predictions?.[0];
    const bytesBase64Encoded =
      pred?.bytesBase64Encoded ??
      pred?.structValue?.fields?.bytesBase64Encoded?.stringValue; // 일부 응답 포맷 대비

    if (!bytesBase64Encoded) {
      return json({ error: "No image bytes returned", raw: vertexJson }, 500);
    }

    // 프론트에서 바로 <img src="data:image/png;base64,..." /> 로 쓸 수 있게 dataUrl도 제공
    return json({
      bytesBase64Encoded,
      dataUrl: `data:image/png;base64,${bytesBase64Encoded}`,
      model: modelVersion,
      location,
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

async function getGoogleAccessToken(opts: {
  clientEmail: string;
  privateKeyPem: string; // \n 포함 문자열 (Cloudflare Secret)
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
  // Cloudflare Secret에 들어간 값은 \n 형태이므로 실제 줄바꿈으로 변환
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
