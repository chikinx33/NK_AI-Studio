// prototype/functions/api/upscale.ts
// POST /api/upscale { imageUrl | objectName, sessionId, storageService }
// Vertex AI Imagen 업스케일 (imagen-4.0-upscale-preview) — GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY 재사용
// imagen-3.0-capability-001은 편집/커스터마이즈 전용이라 mode:"upscale" 미지원(+승인 필요) → 404가 났었음
import { buildAiImageSessionPrefix } from "./_shared/storage";
import { authorizeRequest } from "./_shared/auth.js";
import { hasPagePermission } from "./_shared/admin-users";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

// Cloudflare Function 이 죽기 전에 우리가 먼저 끊는다 (플랫폼 한도보다 짧게)
const VERTEX_TIMEOUT_MS = 25000;

// 주의: 이 함수는 502·504 를 반환하면 안 된다. Cloudflare 가 게이트웨이 오류로 보고
// 우리 JSON 본문을 자기 "502 Bad gateway" HTML 페이지로 갈아치워, 화면에는 원인 대신
// 그 페이지가 통째로 뜬다(실제로 겪은 증상). 우리 쪽 실패는 500 으로 알린다.

export const onRequestOptions: PagesFunction = async ({ request }) => {
  const origin = request.headers.get("Origin");
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      Vary: "Origin",
    },
  });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status, origin);
    if (!(await hasPagePermission(env, auth.userId, "image"))) {
      return json({ error: "permission_denied" }, 403, origin);
    }

    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    const projectId = String(env.GOOGLE_CLOUD_PROJECT || env.GCS_PROJECT_ID || "").trim();
    const baseOutput = env.VIDEO_OUTPUT_GCS_URI as string | undefined;
    const outParsed = baseOutput ? parseGcsUri(baseOutput) : null;

    if (!clientEmail || !privateKeyRaw) {
      return json({ error: "GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY 미설정" }, 500, origin);
    }
    if (!projectId) {
      return json({ error: "GOOGLE_CLOUD_PROJECT 미설정" }, 500, origin);
    }
    if (!outParsed) {
      return json({ error: "VIDEO_OUTPUT_GCS_URI 미설정" }, 500, origin);
    }

    const body = await request.json().catch(() => ({} as any));
    const imageUrl = String(body?.imageUrl || "").trim();
    const objectName = String(body?.objectName || "").trim();
    const sessionId = String(body?.sessionId || "default").trim() || "default";
    const storageService = String(body?.storageService || "ai-image").trim();
    const userId = String(auth.userId || "owner").trim() || "owner";

    if (!imageUrl && !objectName) return json({ error: "imageUrl 또는 objectName 필요" }, 400, origin);

    // cloud-platform scope로 GCS + Vertex AI 모두 커버
    const accessToken = await getGoogleAccessToken({
      clientEmail,
      privateKeyPem: privateKeyRaw,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    }).catch(() => null);
    if (!accessToken) return json({ error: "Google 액세스 토큰 획득 실패" }, 500, origin);

    // 1) 소스 지정 — GCS 객체면 gs:// 경로를 그대로 Vertex 에 넘긴다.
    // 이미지 바이트를 Worker 로 통과시키면(다운로드 → base64 → 업로드) 큰 이미지에서
    // 메모리·CPU 한도를 넘겨 Function 이 그냥 죽고, Cloudflare 가 대신 502 를 돌려준다.
    let sourceImage: Record<string, string>;

    if (objectName) {
      sourceImage = { gcsUri: `gs://${outParsed.bucket}/${objectName.replace(/^\/+/, "")}` };

    } else {
      let srcBytes: Uint8Array | null = null;

      if (imageUrl.startsWith("data:")) {
        const match = imageUrl.match(/^data:[^;]+;base64,(.+)$/);
        if (!match) return json({ error: "data URL 파싱 실패" }, 400, origin);
        srcBytes = base64ToUint8(match[1]);

      } else if (imageUrl.startsWith("http")) {
        const fetchRes = await fetch(imageUrl).catch(() => null);
        if (!fetchRes?.ok) return json({ error: "소스 이미지 fetch 실패" }, 500, origin);
        srcBytes = new Uint8Array(await fetchRes.arrayBuffer());

      } else {
        return json({ error: "지원하지 않는 이미지 소스 형식" }, 400, origin);
      }

      if (!srcBytes || srcBytes.length === 0) return json({ error: "소스 이미지 바이트 없음" }, 500, origin);

      // Imagen 업스케일 입력 제한: 원본 10MB 이하, 출력(=원본 해상도 x2) 17MP 이하
      if (srcBytes.length > 10 * 1024 * 1024) {
        return json({ error: `소스 이미지가 너무 큽니다 (${(srcBytes.length / 1048576).toFixed(1)}MB / 최대 10MB)` }, 400, origin);
      }
      const dims = readImageSize(srcBytes);
      if (dims && dims.width * dims.height * 4 > 17_000_000) {
        return json({
          error: `업스케일 결과가 17MP 제한을 초과합니다 (원본 ${dims.width}x${dims.height} → 2X ${dims.width * 2}x${dims.height * 2})`,
        }, 400, origin);
      }

      sourceImage = { bytesBase64Encoded: uint8ToBase64(srcBytes) };
    }

    // 2) Vertex AI Imagen 업스케일. 결과도 GCS 로 직접 받아 Worker 메모리를 태우지 않는다.
    const stamp = Date.now();
    const basePrefix = outParsed.object.replace(/\/$/, "");
    const sessionPrefix = buildAiImageSessionPrefix(basePrefix, userId, sessionId);
    const outputPrefix = `${sessionPrefix}/outputs/${stamp}-${crypto.randomUUID()}-2x`;
    const location = String(env.VERTEX_LOCATION || "us-central1").trim() || "us-central1";
    // 업스케일 지원 모델만 사용. env로 덮어쓸 수 있고, 접근 권한이 없으면(404/403) 다음 후보로 폴백
    const modelCandidates = String(env.IMAGEN_UPSCALE_MODEL || "").trim()
      ? [String(env.IMAGEN_UPSCALE_MODEL).trim()]
      : ["imagen-4.0-upscale-preview", "imagegeneration@002"];

    let resultObjectName = "";
    let b64Output = "";
    let usedModel = "";
    const attemptErrors: string[] = [];

    for (const model of modelCandidates) {
      const vertexEndpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;
      const parameters: Record<string, any> = {
        mode: "upscale",
        upscaleConfig: { upscaleFactor: "x2" },
        outputOptions: { mimeType: "image/png" },
        // 결과를 응답 본문(base64)이 아니라 GCS 로 바로 쓰게 한다
        storageUri: `gs://${outParsed.bucket}/${outputPrefix}/`,
      };
      // 구형 imagegeneration@* 계열은 sampleCount를 요구
      if (model.startsWith("imagegeneration@")) parameters.sampleCount = 1;

      // Vertex 가 오래 끌면 Function 이 플랫폼 한도에 걸려 통째로 죽고, 그러면 사용자에게는
      // 원인을 알 수 없는 Cloudflare 502 HTML 만 남는다. 그 전에 우리가 끊고 이유를 돌려준다.
      const started = Date.now();
      let vertexRes: Response;
      try {
        vertexRes = await fetch(vertexEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            instances: [{ prompt: "", image: sourceImage }],
            parameters,
          }),
          signal: AbortSignal.timeout(VERTEX_TIMEOUT_MS),
        });
      } catch (err: any) {
        const elapsed = Date.now() - started;
        const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
        return json({
          error: timedOut
            ? `Vertex AI 업스케일 시간 초과 (${model}, ${Math.round(elapsed / 1000)}초). 이미지가 크면 더 오래 걸릴 수 있습니다.`
            : `Vertex AI 업스케일 요청 실패 (${model}): ${err?.message || err}`,
          code: timedOut ? "vertex_timeout" : "vertex_request_failed",
          model,
          elapsedMs: elapsed,
        }, 500, origin);
      }

      const vertexText = await vertexRes.text();
      if (!vertexRes.ok) {
        attemptErrors.push(`${model} → ${vertexRes.status}: ${vertexText.slice(0, 200)}`);
        // 모델 미존재/권한 없음이면 다음 후보로, 그 외 오류는 즉시 중단
        if (vertexRes.status === 404 || vertexRes.status === 403) continue;
        return json({ error: `Vertex AI 업스케일 오류 (${vertexRes.status}): ${vertexText.slice(0, 400)}` }, 500, origin);
      }

      const vertexJson = safeJson(vertexText);
      const prediction = vertexJson?.predictions?.[0] || {};
      const outGcsUri = String(prediction?.gcsUri || "").trim();
      const outBytes = String(prediction?.bytesBase64Encoded || "").trim();

      if (outGcsUri) {
        const parsedOut = parseGcsUri(outGcsUri);
        if (!parsedOut) {
          attemptErrors.push(`${model} → 결과 gcsUri 파싱 실패 (${outGcsUri})`);
          continue;
        }
        resultObjectName = parsedOut.object;
      } else if (outBytes) {
        // storageUri 를 무시하는 모델을 위한 폴백 — 이때만 바이트가 Worker 를 지난다
        b64Output = outBytes;
      } else {
        attemptErrors.push(`${model} → 결과 이미지 없음`);
        continue;
      }
      usedModel = model;
      break;
    }

    if (!resultObjectName && !b64Output) {
      return json({
        error: `Vertex AI 업스케일 실패 — 사용 가능한 업스케일 모델이 없습니다. ${attemptErrors.join(" | ")}`,
        hint: `프로젝트 ${projectId}(${location})에서 Vertex AI API 활성화 및 Imagen 업스케일 모델 접근 권한을 확인하세요. 특정 모델을 강제하려면 IMAGEN_UPSCALE_MODEL 환경변수를 설정하세요.`,
      }, 500, origin);
    }

    // 3) 폴백 경로에서만 결과를 직접 GCS 에 올린다
    if (!resultObjectName) {
      resultObjectName = `${outputPrefix}.png`;
      const resultBytes = base64ToUint8(b64Output);
      const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(resultObjectName)}`;
      const upRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "image/png" },
        body: resultBytes,
      });
      if (!upRes.ok) return json({ error: "GCS 결과 업로드 실패" }, 500, origin);
    }

    const signedUrl = await signGcsUrl({
      bucket: outParsed.bucket,
      object: resultObjectName,
      clientEmail,
      privateKeyPem: privateKeyRaw,
      expiresInSec: 3600,
    }).catch(() => `https://storage.googleapis.com/${outParsed.bucket}/${resultObjectName}`);

    return json({
      signedUrl,
      objectName: resultObjectName,
      dataUrl: "",
      imageSizeApplied: "2X",
      model: usedModel,
      provider: "google",
      storageService,
      sessionId,
    }, 200, origin);

  } catch (e: any) {
    return json({ error: e?.message ?? "업스케일 처리 중 오류" }, 500, origin);
  }
};

function safeJson(text: string): any {
  try { return JSON.parse(text); } catch { return {}; }
}

function json(data: any, status = 200, origin?: string | null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin || "*",
      Vary: "Origin",
    },
  });
}

// ── 바이트 변환 ────────────────────────────────────────────────────────────────

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/** PNG/JPEG 헤더에서 해상도 추출. 알 수 없으면 null(제한 검사 생략). */
function readImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  // PNG: 8바이트 시그니처 + IHDR(width/height big-endian)
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // JPEG: SOF0~SOF15 마커에서 height/width
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = view.getUint16(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
      if (len < 2) break;
      i += 2 + len;
    }
  }
  return null;
}

/** 청크 단위로 묶어 변환한다. 바이트마다 문자열을 이어붙이면 큰 이미지에서 Worker CPU 한도를 넘긴다. */
function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as any));
  }
  return btoa(parts.join(""));
}

// ── Google OAuth2 / JWT ────────────────────────────────────────────────────────

async function getGoogleAccessToken(opts: {
  clientEmail: string;
  privateKeyPem: string;
  scope: string;
}) {
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
  const parsed = JSON.parse(text);
  if (!parsed.access_token) throw new Error("No access_token in OAuth response");
  return parsed.access_token as string;
}

function base64url(input: string) {
  const bytes = new TextEncoder().encode(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signRS256(message: string, privateKeyPem: string) {
  const pem = privateKeyPem.replace(/\\n/g, "\n").trim();
  const pkcs8Der = pemToArrayBuffer(pem);
  const key = await crypto.subtle.importKey(
    "pkcs8", pkcs8Der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const sigBuf = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(message));
  const sigBytes = new Uint8Array(sigBuf);
  let bin = "";
  for (const b of sigBytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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

// ── GCS helpers ───────────────────────────────────────────────────────────────

function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  if (!uri || !uri.startsWith("gs://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  return { bucket: rest.slice(0, slash), object: rest.slice(slash + 1) };
}

async function sha256Hex(message: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function b64urlToHex(b64url: string) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  let hex = "";
  for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
  return hex;
}

async function signGcsUrl(opts: {
  bucket: string;
  object: string;
  clientEmail: string;
  privateKeyPem: string;
  expiresInSec: number;
}) {
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
