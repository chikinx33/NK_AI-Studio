// prototype/functions/api/video.ts
// Minimal Veo (image -> video) trigger endpoint for Cloudflare Pages Functions.
// Goal: return job/operation name to confirm Vertex AI request is accepted.

// Ensure bundled helpers that might reference a `g` global have a defined value in Workers runtime.
(globalThis as any).g = globalThis;
const log = (...args: any[]) => console.log('[video]', ...args);

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const body = await request.json().catch(() => ({} as any));
    const {
      sceneId = "scene",
      promptText = "",
      imageDataUrl = "",
      durationSeconds = 6,
      aspectRatio = "16:9",
    } = body || {};

    if (!promptText || !imageDataUrl) {
      return json({ error: "promptText and imageDataUrl are required" }, 400);
    }

    const projectId = env.GOOGLE_PROJECT_ID as string | undefined;
    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    const modelId = (env.VIDEO_MODEL_ID as string | undefined) || "veo-3.1-fast-generate-001";
    const baseOutput = env.VIDEO_OUTPUT_GCS_URI as string | undefined;

    if (!projectId || !clientEmail || !privateKeyRaw) {
      return json({ error: "Missing GOOGLE_PROJECT_ID / GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY" }, 500);
    }
    if (!baseOutput) {
      return json({ error: "Missing VIDEO_OUTPUT_GCS_URI" }, 500);
    }

    const location = "us-central1";
    const jobId = crypto.randomUUID();
    const outputGcsUri = `${baseOutput.replace(/\/$/, "")}/${sceneId}/${jobId}/`;

    const bytesBase64Encoded = extractBase64(imageDataUrl);
    if (!bytesBase64Encoded) {
      return json({ error: "imageDataUrl is invalid or missing base64 payload" }, 400);
    }

    const accessToken = await getGoogleAccessToken({
      clientEmail,
      privateKeyPem: privateKeyRaw,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });

    // Veo는 Long Running Predict API를 사용해야 함
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predictLongRunning`;
    log('request', { sceneId, jobId, modelId, durationSeconds, aspectRatio, outputGcsUri: outputGcsUri.slice(0, 80) + '...' });

    const vertexRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [
          {
            prompt: { text: promptText },
            image: { bytesBase64Encoded },
          },
        ],
        parameters: {
          durationSeconds: Number(durationSeconds) || 6,
          aspectRatio: aspectRatio || "16:9",
          outputGcsUri,
        },
      }),
    });

    const text = await vertexRes.text();
    if (!vertexRes.ok) {
      const detail = safeJson(text);
      log('vertex_error', { status: vertexRes.status, detail });
      return json(
        { error: "Vertex AI Veo error", status: vertexRes.status, detail },
        500
      );
    }

    const resJson = safeJson(text);
    const operationName =
      (resJson && resJson.name) ||
      resJson?.operation?.name ||
      resJson?.predictions?.[0]?.name ||
      resJson?.output?.name ||
      "";

    if (!operationName) {
      log('no_operation_name', resJson);
      return json({ error: "No operation name returned", raw: resJson }, 500);
    }

    log('ok', { job_id: operationName });
    return json({
      job_id: operationName,
      outputGcsUri,
      model: modelId,
    });
  } catch (e: any) {
    log('catch', e?.message, e?.stack);
    return json({ error: e?.message ?? "Unknown error", stack: e?.stack ?? '' }, 500);
  }
};

function extractBase64(dataUrl: string) {
  if (!dataUrl || typeof dataUrl !== "string") return "";
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return "";
  return dataUrl.slice(comma + 1).trim();
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

function base64url(input: string) {
  const bytes = new TextEncoder().encode(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  const b64 = btoa(str);
  return b64.replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "");
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
  return b64.replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem: string) {
  const lines = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\\s+/g, "");
  const raw = atob(lines);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}
