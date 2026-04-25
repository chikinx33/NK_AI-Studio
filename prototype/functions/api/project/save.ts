// prototype/functions/api/project/save.ts
// Save project payload/scenes to GCS reference folder as data.json
import { buildAiVideoProjectPrefix } from "../_shared/storage";
import { authorizeRequest } from "../_shared/auth.js";

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
    const userId = auth.userId;

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

    const token = await getGoogleAccessToken({
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
          return {
            id: String(sh.id || `${sceneId}.${j + 1}`),
            duration: Number.isFinite(dur) && dur > 0 ? dur : 0,
            shotType: typeof sh.shotType === "string" ? sh.shotType : "MS",
            cameraMove: typeof sh.cameraMove === "string" ? sh.cameraMove : "static",
            composition: typeof sh.composition === "string" ? sh.composition : "",
            action: typeof sh.action === "string" ? sh.action : "",
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
        shots: normalizeShots(s?.shots, sceneId),
        estSec: est > 0 ? Math.round(est) : undefined,
        imageDataUrl: imagePath || imageUrl,
        imagePath,
        videoUrl,
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

    const scenes = Array.isArray(body.scenes) ? body.scenes.map(normalizeScene) : [];

    const payload = {
      projectId,
      userId,
      title: body.title || "",
      payload: body.payload || {},
      scenes,
      header: body.header || "",
      aspectRatio: body.aspectRatio || "",
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

    return send({ ok: true, objectName }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, request.headers.get("Origin"));
  }
};

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
