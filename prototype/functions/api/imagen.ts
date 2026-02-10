// prototype/functions/api/imagen.ts
type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;
export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const body = await request.json().catch(() => ({} as any));
    const prompt = (body?.prompt ?? "").toString().trim();
    const aspectIncoming = (body?.aspectRatio ?? "16:9").toString().trim();
    const allowed = new Set(["16:9", "9:16", "1:1"]);
    const aspectFinal = allowed.has(aspectIncoming) ? aspectIncoming : "16:9";

    if (!prompt) {
      return json({ error: "prompt is required" }, 400);
    }

    // 이미지 모델에 전달할 최종 프롬프트 (사용자 Visual 그대로)
    const finalPrompt = prompt;

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
          aspectRatio: aspectFinal,
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

    const projTagRaw = (body?.projectId ?? body?.projTag ?? "").toString().trim();
    const projTag = projTagRaw || "default";
    const baseOutput = env.VIDEO_OUTPUT_GCS_URI as string | undefined;
    const outParsed = baseOutput ? parseGcsUri(baseOutput) : null;
    let signedUrl = "";
    let objectName = "";
    if (outParsed) {
      const basePrefix = outParsed.object.replace(/\/$/, "");
      const stamp = Date.now();
      objectName = `${basePrefix}/projects/${projTag}/image/${stamp}-${crypto.randomUUID()}.png`;
      const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
      const bytes = base64ToUint8(bytesBase64Encoded);
      const upRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "image/png" },
        body: bytes
      });
      const upTxt = await upRes.text();
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
      dataUrl: `data:image/png;base64,${bytesBase64Encoded}`,
      signedUrl,
      objectName,
      model: modelVersion,
      location,
      promptEcho: finalPrompt,
      aspectApplied: aspectFinal,
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
