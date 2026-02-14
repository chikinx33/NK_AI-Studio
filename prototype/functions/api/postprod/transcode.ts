type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const corsHeaders = (origin?: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Vary": "Origin",
});

const send = (data: any, status = 200, origin?: string | null) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });

type GcsPath = { bucket: string; object: string };

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const body = await request.json().catch(() => ({} as any));
    const projectId = String(body?.projectId || "").trim();
    const sourceObjectName = String(body?.sourceObjectName || "").trim();
    const aspectRatio = String(body?.aspectRatio || "16:9").trim();
    const location = String(env.TRANSCODER_LOCATION || "us-central1").trim();

    if (!projectId || !sourceObjectName) {
      return send({ error: "projectId and sourceObjectName are required" }, 400, origin);
    }

    const googleProjectId = env.GOOGLE_PROJECT_ID as string | undefined;
    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    const baseOutput = env.VIDEO_OUTPUT_GCS_URI as string | undefined;
    if (!googleProjectId || !clientEmail || !privateKeyRaw || !baseOutput) {
      return send({ error: "Missing GOOGLE_PROJECT_ID/GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY/VIDEO_OUTPUT_GCS_URI" }, 500, origin);
    }

    const outParsed = parseGcsUri(baseOutput);
    if (!outParsed) return send({ error: "Invalid VIDEO_OUTPUT_GCS_URI" }, 500, origin);

    const source = normalizeSource(sourceObjectName, outParsed.bucket);
    if (!source) return send({ error: "Invalid sourceObjectName" }, 400, origin);

    const basePrefix = outParsed.object.replace(/\/$/, "");
    const stamp = Date.now();
    const outputPrefix = `${basePrefix}/projects/${projectId}/postprod/final/${stamp}`;
    const outputObjectName = `${outputPrefix}/final-render.mp4`;
    const inputUri = `gs://${source.bucket}/${source.object}`;
    const outputUri = `gs://${outParsed.bucket}/${outputPrefix}/`;
    const size = getSizeByAspectRatio(aspectRatio);

    const token = await getGoogleAccessToken({
      clientEmail,
      privateKeyPem: privateKeyRaw,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });

    const url = `https://transcoder.googleapis.com/v1/projects/${encodeURIComponent(googleProjectId)}/locations/${encodeURIComponent(location)}/jobs`;
    const payload = {
      inputUri,
      outputUri,
      config: {
        elementaryStreams: [
          {
            key: "video-stream0",
            videoStream: {
              h264: {
                widthPixels: size.width,
                heightPixels: size.height,
                frameRate: 30,
                bitrateBps: 5500000,
              },
            },
          },
        ],
        muxStreams: [
          {
            key: "sd",
            container: "mp4",
            elementaryStreams: ["video-stream0"],
            fileName: "final-render",
          },
        ],
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    const json = safeJson(text);
    if (!res.ok) {
      const hint = getTranscoderHint(res.status, json);
      return send(
        {
          error: "Transcoder job create failed",
          status: res.status,
          detail: json,
          hint: hint.message,
          requiredRoles: hint.requiredRoles,
        },
        res.status,
        origin
      );
    }

    const jobName = String((json as any)?.name || "").trim();
    if (!jobName) {
      return send({ error: "Transcoder response missing job name", detail: json }, 500, origin);
    }

    return send(
      {
        ok: true,
        jobName,
        outputObjectName,
        outputGcsUri: `gs://${outParsed.bucket}/${outputObjectName}`,
      },
      200,
      origin
    );
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

function normalizeSource(raw: string, defaultBucket: string): GcsPath | null {
  const t = String(raw || "").trim();
  if (!t) return null;
  if (t.startsWith("gs://")) return parseGcsUri(t);
  const clean = t.replace(/^\/+/, "");
  if (!clean) return null;
  return { bucket: defaultBucket, object: clean };
}

function parseGcsUri(uri: string): GcsPath | null {
  if (!uri.startsWith("gs://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const bucket = rest.slice(0, slash);
  const object = rest.slice(slash + 1);
  if (!bucket || !object) return null;
  return { bucket, object };
}

function getSizeByAspectRatio(ratio: string): { width: number; height: number } {
  if (ratio === "9:16") return { width: 720, height: 1280 };
  if (ratio === "1:1") return { width: 720, height: 720 };
  return { width: 1280, height: 720 };
}

function safeJson(text: string) {
  try { return JSON.parse(text); } catch { return text; }
}

function getTranscoderHint(status: number, _detail: any): { message: string; requiredRoles: string[] } {
  const requiredRoles = [
    "roles/transcoder.admin",
    "roles/storage.objectViewer",
    "roles/storage.objectCreator",
    "roles/storage.objectAdmin",
  ];
  if (status === 403) {
    return {
      message:
        "Permission denied. Enable Transcoder API and grant the service account Transcoder + GCS read/write roles.",
      requiredRoles,
    };
  }
  return {
    message: `Transcoder request failed (${status}). Check location, bucket path, and service account permissions.`,
    requiredRoles,
  };
}

async function getGoogleAccessToken(opts: { clientEmail: string; privateKeyPem: string; scope: string }) {
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
  const res = await fetch(aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
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
  return bufferToBase64Url(sigBuf);
}

function pemToArrayBuffer(pem: string) {
  const lines = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .split(/\s+/)
    .join("");
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
