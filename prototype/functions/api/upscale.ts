// prototype/functions/api/upscale.ts
// POST /api/upscale { imageUrl | objectName, sessionId, storageService }
// Vertex AI Imagen 업스케일 (imagen-4.0-upscale-preview) — GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY 재사용
// imagen-3.0-capability-001은 편집/커스터마이즈 전용이라 mode:"upscale" 미지원(+승인 필요) → 404가 났었음
import { buildAiImageSessionPrefix } from "./_shared/storage";
import { geminiTextModel } from "./_shared/gemini-models.js";
import { authorizeRequest } from "./_shared/auth.js";
import { hasPagePermission } from "./_shared/admin-users";
import { withCreditCharge } from "./_shared/credits";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

// 2K 이미지 생성은 수십 초 걸릴 수 있다. Worker 의 fetch 대기는 CPU 를 쓰지 않아
// 플랫폼 한도와 무관하므로, 클라이언트 타임아웃(api.js upscale: 120초)보다만 짧게 잡는다.
// (예전 25초는 "30초 플랫폼 한도" 오판에서 나온 값 — 실제 2K 생성이 그보다 오래 걸려 끊겼다)
const VERTEX_TIMEOUT_MS = 110000;

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

const handlePost: PagesFunction = async ({ request, env }) => {
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

    // 1) 소스 파트 구성 — GCS 객체는 gs:// 참조로 그대로 넘긴다.
    // 원본 바이트를 Worker 로 통과시키지 않기 위해서다(다운로드 → base64 재인코딩은
    // 큰 이미지에서 메모리·CPU 를 태운다). data:/http 소스만 인라인으로 싣는다.
    let srcPart: any;                                        // Gemini generateContent 용
    let imagenSource: Record<string, string> | null = null;  // (env 로 강제한) Imagen predict 용

    if (objectName) {
      const cleanObject = objectName.replace(/^\/+/, "");
      const gcsUri = `gs://${outParsed.bucket}/${cleanObject}`;
      srcPart = { fileData: { mimeType: mimeFromName(cleanObject), fileUri: gcsUri } };
      imagenSource = { gcsUri };

    } else {
      let srcBytes: Uint8Array | null = null;
      let srcMime = "image/png";

      if (imageUrl.startsWith("data:")) {
        const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) return json({ error: "data URL 파싱 실패" }, 400, origin);
        srcMime = match[1] || "image/png";
        srcBytes = base64ToUint8(match[2]);

      } else if (imageUrl.startsWith("http")) {
        const fetchRes = await fetch(imageUrl).catch(() => null);
        if (!fetchRes?.ok) return json({ error: "소스 이미지 fetch 실패" }, 500, origin);
        srcMime = String(fetchRes.headers.get("content-type") || "").split(";")[0].trim() || "image/png";
        srcBytes = new Uint8Array(await fetchRes.arrayBuffer());

      } else {
        return json({ error: "지원하지 않는 이미지 소스 형식" }, 400, origin);
      }

      if (!srcBytes || srcBytes.length === 0) return json({ error: "소스 이미지 바이트 없음" }, 500, origin);
      if (srcBytes.length > 10 * 1024 * 1024) {
        return json({ error: `소스 이미지가 너무 큽니다 (${(srcBytes.length / 1048576).toFixed(1)}MB / 최대 10MB)` }, 400, origin);
      }

      const b64 = uint8ToBase64(srcBytes);
      srcPart = { inlineData: { mimeType: srcMime, data: b64 } };
      imagenSource = { bytesBase64Encoded: b64 };
    }

    // 2) 업스케일 실행.
    //
    // 이 프로젝트에서 Vertex Imagen 표면은 전 모델·전 리전 404 다 (서비스 계정·Owner 양쪽,
    // 판별자 검증까지 마친 실측 결과). 구글이 Imagen 3 를 폐기하며 공식 이전처로 지정한
    // Gemini 이미지 모델(gemini-3.1-flash-image 등)은 같은 자격증명으로 200 이 확인됐다.
    // → 기본 경로는 Gemini 이미지 모델에 "원본 충실 재현 + 고해상도 출력"을 시키는 방식.
    //   Imagen predict 는 나중에 열릴 때를 대비해 IMAGEN_UPSCALE_MODEL env 로만 켠다.
    const stamp = Date.now();
    const basePrefix = outParsed.object.replace(/\/$/, "");
    const sessionPrefix = buildAiImageSessionPrefix(basePrefix, userId, sessionId);
    const outputPrefix = `${sessionPrefix}/outputs/${stamp}-${crypto.randomUUID()}-2x`;

    let resultObjectName = "";
    let b64Output = "";
    let outMime = "image/png";
    let usedModel = "";
    let usedLocation = "";
    const attemptErrors: string[] = [];

    // 2-a) (선택) 강제된 Imagen 업스케일 — env 가 있을 때만 시도, 실패해도 Gemini 로 넘어간다
    const forcedImagen = String(env.IMAGEN_UPSCALE_MODEL || "").trim();
    if (forcedImagen && imagenSource) {
      const location = String(env.VERTEX_LOCATION || "us-central1").trim() || "us-central1";
      for (const loc of [location, "global"]) {
        const vertexEndpoint = `https://${vertexHost(loc)}/v1/projects/${projectId}/locations/${loc}/publishers/google/models/${forcedImagen}:predict`;
        const parameters: Record<string, any> = {
          mode: "upscale",
          upscaleConfig: { upscaleFactor: "x2" },
          outputOptions: { mimeType: "image/png" },
          // 결과를 응답 본문(base64)이 아니라 GCS 로 바로 쓰게 한다
          storageUri: `gs://${outParsed.bucket}/${outputPrefix}/`,
        };
        if (forcedImagen.startsWith("imagegeneration@")) parameters.sampleCount = 1;

        let vertexRes: Response;
        try {
          vertexRes = await fetch(vertexEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
              "x-goog-user-project": projectId,
            },
            body: JSON.stringify({ instances: [{ prompt: "", image: imagenSource }], parameters }),
            signal: AbortSignal.timeout(VERTEX_TIMEOUT_MS),
          });
        } catch (err: any) {
          attemptErrors.push(`${forcedImagen}@${loc} → ${err?.name === "TimeoutError" ? "시간 초과" : err?.message || err}`);
          continue;
        }

        const vertexText = await vertexRes.text();
        if (!vertexRes.ok) {
          attemptErrors.push(`${forcedImagen}@${loc} → ${vertexRes.status}: ${shortGoogleError(vertexText)}`);
          continue;
        }
        const prediction = safeJson(vertexText)?.predictions?.[0] || {};
        const outGcsUri = String(prediction?.gcsUri || "").trim();
        const outBytes = String(prediction?.bytesBase64Encoded || "").trim();
        if (outGcsUri) {
          const parsedOut = parseGcsUri(outGcsUri);
          if (!parsedOut) { attemptErrors.push(`${forcedImagen}@${loc} → 결과 gcsUri 파싱 실패`); continue; }
          resultObjectName = parsedOut.object;
        } else if (outBytes) {
          b64Output = outBytes;
        } else {
          attemptErrors.push(`${forcedImagen}@${loc} → 결과 이미지 없음`);
          continue;
        }
        usedModel = forcedImagen;
        usedLocation = loc;
        break;
      }
    }

    // 2-b) 기본 경로: Gemini 이미지 모델로 원본 충실 재현 업스케일 (global 에서 200 확인됨)
    // 해상도는 요청(body.imageSize: "2K"|"4K")이 우선, 없으면 env, 기본 2K
    const sizeIncoming = String(body?.imageSize || "").trim().toUpperCase();
    const upscaleSize = ["1K", "2K", "4K"].includes(sizeIncoming)
      ? sizeIncoming
      : (String(env.UPSCALE_IMAGE_SIZE || "2K").trim() || "2K");
    if (!resultObjectName && !b64Output) {
      const geminiModel = String(env.GEMINI_UPSCALE_MODEL || "gemini-3.1-flash-image").trim();
      const loc = "global";
      const endpoint = `https://${vertexHost(loc)}/v1/projects/${projectId}/locations/${loc}/publishers/google/models/${geminiModel}:generateContent`;

      const started = Date.now();
      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            "x-goog-user-project": projectId,
          },
          body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [
                // 스타일·내용은 절대 건드리지 않는다 — 해상도만 올리는 충실 재현 지시.
                { text: "Reproduce this exact image at a higher resolution. Do not change the composition, framing, colors, lighting, style, or any content. Do not add, remove, or reinterpret anything. Output only the faithfully upscaled image." },
                srcPart,
              ],
            }],
            generationConfig: {
              responseModalities: ["IMAGE"],
              imageConfig: { imageSize: upscaleSize },
            },
          }),
          signal: AbortSignal.timeout(VERTEX_TIMEOUT_MS),
        });
      } catch (err: any) {
        const elapsed = Date.now() - started;
        const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
        return json({
          error: timedOut
            ? `업스케일 시간 초과 (${geminiModel}, ${Math.round(elapsed / 1000)}초). 잠시 후 다시 시도해 주세요.`
            : `업스케일 요청 실패 (${geminiModel}): ${err?.message || err}`,
          code: timedOut ? "vertex_timeout" : "vertex_request_failed",
          model: geminiModel,
          elapsedMs: elapsed,
        }, 500, origin);
      }

      const text = await res.text();
      if (!res.ok) {
        // 모델·권한 문제라면 대조 호출로 원인을 갈라서 함께 알려준다
        const diagnostic = (res.status === 404 || res.status === 403)
          ? await diagnoseVertexAccess(loc, projectId, accessToken)
          : "";
        return json({
          error: `업스케일 실패 (${geminiModel}@${loc} → ${res.status}): ${shortGoogleError(text)}`
            + (attemptErrors.length ? ` | 이전 시도: ${attemptErrors.join(" | ")}` : "")
            + (diagnostic ? ` · 진단: ${diagnostic}` : ""),
          serviceAccount: clientEmail,
          project: projectId,
        }, 500, origin);
      }

      const parts: any[] = safeJson(text)?.candidates?.[0]?.content?.parts || [];
      const imgPart = parts.find((p) => p?.inlineData?.data);
      if (!imgPart) {
        return json({
          error: `업스케일 결과에 이미지가 없습니다 (${geminiModel}). ${String(text).slice(0, 200)}`,
        }, 500, origin);
      }
      b64Output = String(imgPart.inlineData.data);
      outMime = String(imgPart.inlineData.mimeType || "image/png");
      usedModel = geminiModel;
      usedLocation = loc;
    }

    // 3) 결과가 인라인으로 온 경우에만 직접 GCS 에 올린다 (Imagen storageUri 경로는 이미 GCS 에 있음)
    if (!resultObjectName) {
      const ext = outMime === "image/jpeg" ? "jpg" : (outMime === "image/webp" ? "webp" : "png");
      resultObjectName = `${outputPrefix}.${ext}`;
      const resultBytes = base64ToUint8(b64Output);
      const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(resultObjectName)}`;
      const upRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": outMime },
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
      imageSizeApplied: usedModel.startsWith("imagen") ? "2X" : upscaleSize,
      model: usedModel,
      location: usedLocation,
      provider: "google",
      storageService,
      sessionId,
    }, 200, origin);

  } catch (e: any) {
    return json({ error: e?.message ?? "업스케일 처리 중 오류" }, 500, origin);
  }
};

export const onRequestPost: PagesFunction = async (context) =>
  withCreditCharge(context, { feature: "image_upscale" }, handlePost);

function safeJson(text: string): any {
  try { return JSON.parse(text); } catch { return {}; }
}

/** global 은 리전 접두사가 없는 호스트를 쓴다 */
function vertexHost(location: string): string {
  return location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
}

/** 확장자 → MIME. Vertex fileData 는 mimeType 이 필수다. */
function mimeFromName(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  return "image/png";
}

/** Google 오류 JSON 에서 message 만 뽑는다. 원문을 통째로 흘리면 화면이 JSON 으로 뒤덮인다. */
function shortGoogleError(text: string): string {
  const msg = String(safeJson(text)?.error?.message || "").trim();
  return (msg || String(text || "")).slice(0, 180);
}

/**
 * 업스케일 모델을 하나도 못 쓸 때, 원인이 "자격증명·API 문제"인지 "그 모델만 미제공"인지 가른다.
 *
 * 예전에는 publishers/google/models 목록을 근거로 썼는데, 그 목록은 resnet50·bert-base 같은
 * 구형 배포용 카탈로그라 Gemini·Imagen 이 애초에 들어 있지 않다. 그걸 "이미지 모델 없음"으로
 * 읽고 엉뚱한 결론(프로젝트에 Imagen 권한 없음)을 냈던 적이 있어, 대조 호출로 바꿨다.
 */
async function diagnoseVertexAccess(location: string, projectId: string, token: string): Promise<string> {
  // 진단 프로브. env 를 안 받는 함수라 기본 모델로 대조한다.
  const probeModel = geminiTextModel(null);
  const url = `https://${vertexHost(location)}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${probeModel}:generateContent`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-goog-user-project": projectId,
      },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "ping" }] }] }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e: any) {
    return `대조 호출 실패: ${e?.message || e}`;
  }

  const text = await res.text();
  if (res.ok) {
    // 같은 자격증명·리전으로 다른 퍼블리셔 모델은 되는데 업스케일 모델만 404 → 모델 미제공
    return `대조 호출(${probeModel}) 정상 → 자격증명·리전·Vertex API 모두 문제 없음. 이 프로젝트에 Imagen 업스케일 모델이 제공되지 않는 것으로 보입니다.`;
  }
  const msg = shortGoogleError(text);
  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(text)) {
    return `Vertex AI API 가 프로젝트 ${projectId} 에서 비활성화 상태입니다 → aiplatform.googleapis.com 을 활성화하세요. (${msg})`;
  }
  return `대조 호출(${probeModel})도 ${res.status} 로 실패 → 모델 문제가 아니라 자격증명·권한 문제일 수 있습니다. (${msg})`;
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
