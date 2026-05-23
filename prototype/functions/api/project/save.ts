// prototype/functions/api/project/save.ts
// Save project payload/scenes to GCS reference folder as data.json
import { buildAiVideoProjectPrefix } from "../_shared/storage";
import { authorizeRequest, sanitizeUserId } from "../_shared/auth.js";
import { loadShares, getGrantRole } from "../_shared/shares";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

// Open CORS so local/remote dashboards can both save projects to the same bucket.
const corsHeaders = (origin: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Origin": origin || "*",
  "Vary": "Origin",
});

const send = (data: any, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const origin = request.headers.get("Origin");
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const body = await request.json().catch(() => ({} as any));
    const projectId = String(body.projectId || "").trim();
    if (!projectId) return send({ error: "projectId is required" }, 400, origin);
    if (!/^[a-zA-Z0-9._-]+$/.test(projectId)) return send({ error: "Invalid projectId format" }, 400, origin);
    const requesterId = auth.userId;
    // 공유 프로젝트 저장: ownerId가 본인과 다르면 '에디터' 권한이 있어야 소유자 경로에 쓸 수 있다.
    const ownerParam = sanitizeUserId(body.ownerId || "");
    let userId = requesterId;
    if (ownerParam && ownerParam !== requesterId) {
      const sharesReg = await loadShares(env);
      const role = getGrantRole(sharesReg, ownerParam, projectId, requesterId);
      if (role !== "editor") return send({ error: "forbidden_not_editor" }, 403, origin);
      userId = ownerParam;
    }

    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    const baseOutput = env.VIDEO_OUTPUT_GCS_URI as string | undefined;
    if (!clientEmail || !privateKeyRaw || !baseOutput) {
      return send({ error: "Missing GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY/VIDEO_OUTPUT_GCS_URI" }, 500, origin);
    }
    const outParsed = parseGcsUri(baseOutput);
    if (!outParsed) return send({ error: "Invalid VIDEO_OUTPUT_GCS_URI" }, 500, origin);
    const basePrefix = outParsed.object.replace(/\/$/, "");
    const projectPrefix = buildAiVideoProjectPrefix(basePrefix, userId, projectId);
    const objectName = `${projectPrefix}/reference/data.json`;

    const token = await getGoogleAccessTokenCached({
      clientEmail,
      privateKeyPem: privateKeyRaw,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });

    const toGcsPath = (url?: string) => {
      const parseRef = (input?: string, depth = 0): { bucket?: string; object: string } | null => {
        const raw = String(input || "").trim();
        if (!raw || depth > 2) return null;
        if (raw.startsWith("gs://")) {
          const rest = raw.slice(5).replace(/^\/+/, "");
          const slash = rest.indexOf("/");
          if (slash <= 0) return null;
          return { bucket: rest.slice(0, slash), object: rest.slice(slash + 1) };
        }
        try {
          const u = new URL(raw, "http://localhost");
          const objectName = String(u.searchParams.get("objectName") || "").trim();
          if (objectName) {
            const nested = parseRef(objectName, depth + 1);
            if (nested) return nested;
            return { object: objectName.replace(/^\/+/, "") };
          }
          const nestedUrl = String(u.searchParams.get("url") || "").trim();
          if (nestedUrl) {
            const nested = parseRef(nestedUrl, depth + 1);
            if (nested) return nested;
          }
          if (u.host === "storage.googleapis.com") {
            const path = String(u.pathname || "").replace(/^\/+/, "");
            const slash = path.indexOf("/");
            if (slash <= 0) return null;
            return {
              bucket: path.slice(0, slash),
              object: decodeURIComponent(path.slice(slash + 1)),
            };
          }
        } catch (_) { }
        return null;
      };

      const parsed = parseRef(url);
      if (!parsed) return "";
      const bucket = String(parsed.bucket || outParsed.bucket || "").trim();
      let object = String(parsed.object || "").trim().replace(/^\/+/, "");
      if (!bucket || !object) return "";
      if (!parsed.bucket && object.startsWith(bucket + "/")) {
        object = object.slice(bucket.length + 1);
      }
      return object ? `gs://${bucket}/${object}` : "";
    };

    // 메인 프로덕션이 생성한 이미지를 scene.imageDataUrl 에 data:base64 그대로 저장하면
    // 씬 6개 × 1MB ≈ 6MB 페이로드가 되어 /api/project/save Worker 가 JSON 파싱·직렬화·업로드
    // 단계에서 CPU 한도를 넘기고 1102(resource limits) 로 503 이 난다.
    // 영속화 대상은 GCS path/signedUrl 이지 일회용 base64 가 아니므로,
    // GCS 경로가 없는 data: URL 은 저장 단계에서 비운다.
    // (생성 직후 화면 표시용 dataUrl 은 클라이언트 메모리에는 남아 있다.)
    const stripDataUrl = (value: string) =>
      (typeof value === "string" && value.startsWith("data:")) ? "" : value;

    const normalizeDialogue = (value: any) => {
      if (Array.isArray(value)) {
        return value
          .map((d: any) => ({
            speaker: typeof d?.speaker === "string" ? d.speaker.trim() : "",
            line: typeof d?.line === "string" ? d.line.trim() : "",
          }))
          .filter((d: any) => d.speaker || d.line);
      }
      if (typeof value === "string") {
        return value
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const idx = line.indexOf(":");
            if (idx > -1) {
              return {
                speaker: line.slice(0, idx).trim(),
                line: line.slice(idx + 1).trim(),
              };
            }
            return { speaker: "", line };
          })
          .filter((d) => d.speaker || d.line);
      }
      return [];
    };

    const normalizeShots = (value: any, sceneId: number) => {
      if (!Array.isArray(value)) return [];
      return value
        .map((sh: any, j: number) => {
          if (!sh || typeof sh !== "object") return null;
          const dur = Number(sh.duration);
          const shotImageUrl =
            typeof sh.imageDataUrl === "string" ? sh.imageDataUrl
              : (typeof sh.imagePath === "string" ? sh.imagePath
                : (typeof sh.generatedImageUrl === "string" ? sh.generatedImageUrl
                  : (typeof sh.imageUrl === "string" ? sh.imageUrl : "")));
          const shotImagePath = toGcsPath(shotImageUrl) || (typeof sh.imagePath === "string" ? sh.imagePath : "");
          const shotVideoUrlRaw =
            typeof sh.videoUrl === "string" ? sh.videoUrl
              : (typeof sh.videoPlaybackUrl === "string" ? sh.videoPlaybackUrl
                : (typeof sh.videoPath === "string" ? sh.videoPath
                  : (typeof sh.generatedVideoUrl === "string" ? sh.generatedVideoUrl : "")));
          const shotVideoPath = toGcsPath(shotVideoUrlRaw) || (typeof sh.videoPath === "string" ? sh.videoPath : "");
          const keepInlineShotVideo = String(shotVideoUrlRaw).startsWith("data:video/");
          const shotVideoUrl = shotVideoPath || (keepInlineShotVideo ? shotVideoUrlRaw : "");
          return {
            id: String(sh.id || `${sceneId}.${j + 1}`),
            duration: Number.isFinite(dur) && dur > 0 ? dur : 0,
            shotType: typeof sh.shotType === "string" ? sh.shotType : "MS",
            cameraMove: typeof sh.cameraMove === "string" ? sh.cameraMove : "static",
            composition: typeof sh.composition === "string" ? sh.composition : "",
            action: typeof sh.action === "string" ? sh.action : "",
            imageDataUrl: stripDataUrl(shotImagePath || shotImageUrl),
            imagePath: shotImagePath,
            videoUrl: stripDataUrl(shotVideoUrl),
            videoPath: shotVideoPath,
            videoStatus: typeof sh.videoStatus === "string" ? sh.videoStatus : "",
            videoError: typeof sh.videoError === "string" ? sh.videoError : "",
            videoJobId: typeof sh.videoJobId === "string" ? sh.videoJobId : "",
            videoMethod: typeof sh.videoMethod === "string" ? sh.videoMethod : "",
          };
        })
        .filter(Boolean);
    };

    const normalizeScene = (s: any, idx: number) => {
      const est = Number(s?.estSec ?? s?.duration ?? s?.len ?? 0);
      const dialogue = normalizeDialogue(s?.dialogue ?? s?.dialogues ?? []);
      const rawLines = typeof s?.lines === "string" ? s.lines : "";
      const subtitleText = typeof s?.subtitleText === "string"
        ? s.subtitleText
        : (typeof s?.caption === "string" ? s.caption : rawLines);
      const narration = typeof s?.narration === "string"
        ? s.narration
        : (!dialogue.length && subtitleText === rawLines ? rawLines : "");
      const videoSpeechPrompt = typeof s?.videoSpeechPrompt === "string"
        ? s.videoSpeechPrompt
        : (typeof s?.spokenPrompt === "string" ? s.spokenPrompt : "");
      const script = typeof s?.script === "string" ? s.script : (typeof s?.voiceScript === "string" ? s.voiceScript : "");
      const sceneLocation = typeof s?.sceneLocation === "string" ? s.sceneLocation : (typeof s?.location === "string" ? s.location : "");
      const backgroundStyle = typeof s?.backgroundStyle === "string" ? s.backgroundStyle : "";
      const visual = typeof s?.visual === "string" ? s.visual : (typeof s?.shot === "string" ? s.shot : "");
      const imageUrl =
        typeof s?.imageDataUrl === "string" ? s.imageDataUrl
          : (typeof s?.imagePath === "string" ? s.imagePath
            : (typeof s?.generatedImageUrl === "string" ? s.generatedImageUrl
              : (typeof s?.imageUrl === "string" ? s.imageUrl : "")));
      const imagePath = toGcsPath(imageUrl) || (typeof s?.imagePath === "string" ? s.imagePath : "");
      const videoUrlRaw =
        typeof s?.videoUrl === "string" ? s.videoUrl
          : (typeof s?.videoPlaybackUrl === "string" ? s.videoPlaybackUrl
            : (typeof s?.videoPath === "string" ? s.videoPath
              : (typeof s?.generatedVideoUrl === "string" ? s.generatedVideoUrl : "")));
      const videoPath = toGcsPath(videoUrlRaw) || (typeof s?.videoPath === "string" ? s.videoPath : "");
      const keepInlineVideo = String(videoUrlRaw).startsWith("data:video/");
      const videoUrl = videoPath || (keepInlineVideo ? videoUrlRaw : "");
      const videoStatus = typeof s?.videoStatus === "string" ? s.videoStatus : "";
      const videoError = typeof s?.videoError === "string" ? s.videoError : "";
      const videoJobId = typeof s?.videoJobId === "string" ? s.videoJobId : "";
      const videoMethod = typeof s?.videoMethod === "string" ? s.videoMethod : "";
      const voiceUrlRaw = typeof s?.voiceUrl === "string" ? s.voiceUrl : "";
      const voiceObjectName = typeof s?.voiceObjectName === "string" ? s.voiceObjectName : "";
      const voiceUrl = voiceObjectName ? "" : voiceUrlRaw;
      const voiceStatus = typeof s?.voiceStatus === "string" ? s.voiceStatus : "";
      const voiceVoiceId = typeof s?.voiceVoiceId === "string" ? s.voiceVoiceId : "";
      const voiceError = typeof s?.voiceError === "string" ? s.voiceError : "";
      const sceneId = Number(s?.id ?? idx + 1);
      // 새 평탄화 모델: scene 자체에 카메라 셋업 정보
      const shotType = typeof s?.shotType === "string" ? s.shotType : "MS";
      const cameraMove = typeof s?.cameraMove === "string" ? s.cameraMove : "static";
      const composition = typeof s?.composition === "string" ? s.composition : "";
      const action = typeof s?.action === "string" ? s.action : "";
      return {
        id: sceneId,
        title: typeof s?.title === "string" ? s.title : "",
        lines: subtitleText,
        narration,
        dialogue,
        sceneLocation,
        backgroundStyle,
        subtitleText,
        videoSpeechPrompt,
        script,
        shot: visual,
        visual,
        shotType,
        cameraMove,
        composition,
        action,
        shots: normalizeShots(s?.shots, sceneId),
        estSec: est > 0 ? Math.round(est) : undefined,
        imageDataUrl: stripDataUrl(imagePath || imageUrl),
        imagePath,
        videoUrl: stripDataUrl(videoUrl),
        videoPath,
        videoStatus,
        videoError,
        videoJobId,
        videoMethod,
        voiceUrl,
        voiceObjectName,
        voiceStatus,
        voiceVoiceId,
        voiceError,
      };
    };

    // 머지 모드: 클라이언트가 자기 책임 필드만 보내도 다른 페이지 데이터가 보존되도록
    // 기존 data.json 을 GET → shallow merge → PUT.
    // - body.payload 가 있으면 기존 payload 위에 shallow merge (받지 않은 키는 보존)
    // - body.scenes 가 있으면 통째로 대체, 없으면 기존 scenes 보존
    // - title/header/aspectRatio 도 받은 경우에만 덮어씀
    // GET 실패(신규 프로젝트, 권한 등)는 빈 객체로 fallback → 기존 통째 저장과 동일 동작
    let existing: any = null;
    try {
      const getUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o/${encodeURIComponent(objectName)}?alt=media`;
      const getRes = await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (getRes.ok) {
        try { existing = await getRes.json(); } catch (_) { existing = null; }
      }
    } catch (_) { existing = null; }

    // 빈 배열/객체는 "보내지 않은 것"으로 간주 → 기존 호출자가 `scenes || []` 패턴으로
    // 신규 프로젝트나 미초기화 상태를 보내도 기존 데이터를 덮어쓰지 않게 보호.
    // 명시적으로 전체 씬 삭제가 필요한 경우는 별도 액션으로 처리해야 함.
    const hasScenes = Array.isArray(body.scenes) && body.scenes.length > 0;
    const hasPayload = body.payload && typeof body.payload === "object" && Object.keys(body.payload).length > 0;
    const hasHeader = Object.prototype.hasOwnProperty.call(body, "header") && body.header;
    const hasAspect = Object.prototype.hasOwnProperty.call(body, "aspectRatio") && body.aspectRatio;
    const hasTitle = Object.prototype.hasOwnProperty.call(body, "title") && body.title;

    const mergedScenes = hasScenes
      ? (body.scenes as any[]).map(normalizeScene)
      : (Array.isArray(existing?.scenes) ? existing.scenes : []);
    const mergedPayload = hasPayload
      ? Object.assign({}, (existing?.payload || {}), normalizeClientPayload(body.payload))
      : (existing?.payload || {});
    const mergedHeader = hasHeader ? (body.header || "") : (existing?.header || "");
    const mergedAspect = hasAspect ? body.aspectRatio : (existing?.aspectRatio || "");
    const mergedTitle = hasTitle ? body.title : (existing?.title || "");

    const payload = {
      projectId,
      userId,
      title: mergedTitle,
      payload: mergedPayload,
      scenes: mergedScenes,
      header: mergedHeader,
      aspectRatio: mergedAspect,
      savedAt: new Date().toISOString(),
    };

    const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) return send({ error: text || "upload_error" }, res.status, origin);

    return send({ ok: true, objectName, merged: !!existing }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, request.headers.get("Origin"));
  }
};

// overlay clip url이 data:video/... base64인 경우 GCS에 그대로 저장하면
// payload가 수십 MB가 되어 Worker CPU·업로드 시간을 초과한다.
// 클라이언트에서 이미 제거하지만 구버전 클라이언트 방어 목적으로 서버에서도 정규화.
function normalizeClientPayload(raw: any): any {
  if (!raw || typeof raw !== "object") return raw ?? {};
  const out: any = { ...raw };
  const dropData = (c: any) => {
    if (!c || typeof c.url !== "string" || !c.url.startsWith("data:")) return c;
    return { ...c, url: "" };
  };
  if (Array.isArray(out.overlayClips)) out.overlayClips = out.overlayClips.map(dropData);
  if (Array.isArray(out.editVersions)) {
    out.editVersions = out.editVersions.map((v: any) => {
      if (!v || !Array.isArray(v.overlayClips)) return v;
      return { ...v, overlayClips: v.overlayClips.map(dropData) };
    });
  }
  return out;
}

// Google OAuth 2.0 서비스 계정 토큰은 유효 기간 3600초.
// 매 저장마다 새로 발급하면 RSA 서명 + Google OAuth HTTP 왕복 (~300-500ms) 이 발생한다.
// Cloudflare Cache API(edge 데이터센터 공유 캐시)로 3300초 캐싱 → 두 번째 저장부터 <1ms.
async function getGoogleAccessTokenCached(opts: Parameters<typeof getGoogleAccessToken>[0]): Promise<string> {
  const cacheUrl = `https://nk-cache.internal/gcs-token/${encodeURIComponent(opts.clientEmail)}`;
  let store: Cache | null = null;
  try {
    store = await caches.open("nk-gcs-token-v1");
    const cached = await store.match(new Request(cacheUrl));
    if (cached) {
      const { token, exp } = await cached.json() as { token: string; exp: number };
      if (token && Number(exp) > Date.now() + 120_000) return token;
    }
  } catch (_) { store = null; }

  const token = await getGoogleAccessToken(opts);

  if (store) {
    try {
      const exp = Date.now() + 55 * 60 * 1000;
      await store.put(
        new Request(cacheUrl),
        new Response(JSON.stringify({ token, exp }), {
          headers: { "Cache-Control": "max-age=3300", "Content-Type": "application/json" },
        })
      );
    } catch (_) {}
  }
  return token;
}

function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  if (!uri.startsWith("gs://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const bucket = rest.slice(0, slash);
  const object = rest.slice(slash + 1);
  return { bucket, object };
}

async function getGoogleAccessToken(opts: { clientEmail: string; privateKeyPem: string; scope: string; }) {
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
  const res = await fetch(aud, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
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
  const key = await crypto.subtle.importKey("pkcs8", pkcs8Der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(message));
  return bufferToBase64Url(sigBuf);
}

function pemToArrayBuffer(pem: string) {
  const lines = pem.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").split(/\s+/).join("");
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

export const onRequestOptions: PagesFunction = async ({ request }) => {
  const origin = request.headers.get("Origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
};
