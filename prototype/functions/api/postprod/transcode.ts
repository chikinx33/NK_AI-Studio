import { buildAiVideoProjectPrefix, buildUserRoot } from "../_shared/storage";
import { authorizeRequest } from "../_shared/auth.js";
import { resolveProjectStorageOwner } from "../_shared/shares";
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
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const body = await request.json().catch(() => ({} as any));
    const projectId = String(body?.projectId || "").trim();
    const userId = await resolveProjectStorageOwner(env, auth.userId, body?.ownerId, projectId);
    // 다중 씬 concat: sourceObjectNames(복수)를 우선 사용. 없으면 단일 sourceObjectName(하위호환).
    const rawSources: string[] = Array.isArray(body?.sourceObjectNames)
      ? body.sourceObjectNames.map((v: any) => String(v || "").trim()).filter(Boolean)
      : [];
    const sourceObjectName = String(body?.sourceObjectName || "").trim();
    const sourceList = rawSources.length ? rawSources : (sourceObjectName ? [sourceObjectName] : []);
    const aspectRatio = String(body?.aspectRatio || "16:9").trim();
    const sourceDurationSec = Number(body?.sourceDurationSec || 0);
    const location = String(env.TRANSCODER_LOCATION || "us-central1").trim();

    if (!projectId || !sourceList.length) {
      return send({ error: "projectId and sourceObjectName(s) are required" }, 400, origin);
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
    const basePrefix = outParsed.object.replace(/\/$/, "");
    const userRoot = buildUserRoot(basePrefix, userId);

    // 모든 소스를 정규화 + 사용자 스코프 검증(경로 이탈 차단).
    const sources: GcsPath[] = [];
    for (const raw of sourceList) {
      const s = normalizeSource(raw, outParsed.bucket);
      if (!s) return send({ error: `Invalid sourceObjectName: ${raw}` }, 400, origin);
      if (!s.object.startsWith(`${userRoot}/`)) {
        return send({ error: "sourceObjectName is outside user scope", offending: raw }, 403, origin);
      }
      sources.push(s);
    }

    const stamp = Date.now();
    const projectPrefix = buildAiVideoProjectPrefix(basePrefix, userId, projectId);
    const outputPrefix = `${projectPrefix}/postprod/final/${stamp}`;
    const outputObjectName = `${outputPrefix}/final-render.mp4`;
    const outputUri = `gs://${outParsed.bucket}/${outputPrefix}/`;
    const size = getSizeByAspectRatio(aspectRatio);

    const token = await getGoogleAccessToken({
      clientEmail,
      privateKeyPem: privateKeyRaw,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });

    const url = `https://transcoder.googleapis.com/v1/projects/${encodeURIComponent(googleProjectId)}/locations/${encodeURIComponent(location)}/jobs`;
    const editEnd = normalizeDurationSec(sourceDurationSec);
    // 입력들: 소스별 inputN.
    const inputs = sources.map((s, i) => ({ key: `input${i}`, uri: `gs://${s.bucket}/${s.object}` }));
    // editList(atom): 순서대로 이어붙임(concat). 각 atom이 순차 input을 통째 참조.
    //  - 단일 소스 + sourceDurationSec 지정 시에는 기존처럼 그 길이로 트림(하위호환).
    //  - 다중 소스는 각 atom을 풀 클립으로 두고 순서 concat(트림 없음).
    let editList: any[] | undefined;
    if (sources.length > 1) {
      editList = sources.map((_s, i) => ({ key: `atom${i}`, inputs: [`input${i}`] }));
    } else if (editEnd > 0) {
      editList = [{ key: "atom0", inputs: ["input0"], startTimeOffset: "0s", endTimeOffset: `${editEnd}s` }];
    }
    const payload: any = {
      outputUri,
      config: {
        inputs,
        ...(editList ? { editList } : {}),
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

function normalizeDurationSec(raw: number): number {
  const n = Number(raw);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.max(0.2, Math.round(n * 1000) / 1000);
}

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
