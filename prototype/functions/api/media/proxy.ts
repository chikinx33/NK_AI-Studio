import { authorizeRequest } from "../_shared/auth.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const corsHeaders = (origin?: string | null) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Vary": "Origin",
});

const send = (data: any, status = 200, origin?: string | null) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) } });

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env, { allowQueryToken: true });
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const url = new URL(request.url);
    const objectName = String(url.searchParams.get("objectName") || "").trim();
    if (!objectName) return send({ error: "missing_objectName" }, 400, origin);

    // 오디오와 비디오/이미지는 서로 다른 버킷·서비스계정(서명자)일 수 있다. 객체 1개를
    // "오디오 버킷+TTS 서명자"로만 조회하던 탓에, 비디오/이미지 자산(ai-video/.../image/...)이
    // 잘못된 버킷에서 404/403 → 502 가 났다. 자산 종류에 맞는 (버킷+서명자) 쌍을 우선 시도하고,
    // 실패하면 다른 쌍으로 폴백한다.
    const audioPair = env.AUDIO_OUTPUT_GCS_URI ? {
      uri: String(env.AUDIO_OUTPUT_GCS_URI),
      email: String(env.TTS_GOOGLE_CLIENT_EMAIL || env.GOOGLE_CLIENT_EMAIL || ""),
      key: String(env.TTS_GOOGLE_PRIVATE_KEY || env.GOOGLE_PRIVATE_KEY || ""),
    } : null;
    const videoPair = env.VIDEO_OUTPUT_GCS_URI ? {
      uri: String(env.VIDEO_OUTPUT_GCS_URI),
      email: String(env.GOOGLE_CLIENT_EMAIL || ""),
      key: String(env.GOOGLE_PRIVATE_KEY || ""),
    } : null;

    const looksAudio = /(^|\/)(audio|voice|tts|sfx|music|ai-sound)(\/|-|$)/i.test(objectName);
    const ordered = looksAudio ? [audioPair, videoPair] : [videoPair, audioPair];

    // (버킷, 서명자) 중복 제거 후 시도 목록 구성.
    const tries: Array<{ bucket: string; email: string; key: string }> = [];
    const seen = new Set<string>();
    for (const pair of ordered) {
      if (!pair || !pair.uri || !pair.email || !pair.key) continue;
      const parsed = parseGcsUri(pair.uri);
      if (!parsed) continue;
      const dedupKey = `${parsed.bucket}|${pair.email}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      tries.push({ bucket: parsed.bucket, email: pair.email, key: pair.key });
    }
    if (!tries.length) return send({ error: "missing_output_base_or_signer" }, 500, origin);

    const userProjectRaw =
      (env.GCS_BILLING_PROJECT_ID as string | undefined) ||
      (env.GOOGLE_PROJECT_ID as string | undefined) ||
      "";
    const userProject = String(userProjectRaw || "").trim();

    let lastStatus = 0;
    let lastDetail = "";
    for (const t of tries) {
      let signed = "";
      try {
        signed = await signGcsUrl({
          bucket: t.bucket,
          object: objectName,
          clientEmail: t.email,
          privateKeyPem: t.key,
          expiresInSec: 3600,
          userProject
        });
      } catch (e: any) {
        lastDetail = String(e?.message || e);
        continue;
      }
      const gcsResp = await fetch(signed, { method: "GET" });
      if (gcsResp.ok) {
        const buf = await gcsResp.arrayBuffer();
        const type = gcsResp.headers.get("Content-Type") || "application/octet-stream";
        return new Response(buf, {
          status: 200,
          headers: { ...corsHeaders(origin), "Content-Type": type, "Cache-Control": "private, max-age=3600" }
        });
      }
      lastStatus = gcsResp.status;
      lastDetail = await gcsResp.text().catch(() => "");
    }
    // 모든 버킷에서 실패: 없음/권한은 실제 코드(404/403)로, 그 외는 502 로 전달.
    const outStatus = (lastStatus === 404 || lastStatus === 403) ? lastStatus : 502;
    return send({ error: "gcs_fetch_failed", status: lastStatus, detail: lastDetail }, outStatus, origin);
  } catch (e: any) {
    return send({ error: e?.message || "proxy_error" }, 500, origin);
  }
};

function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  if (!uri || !uri.startsWith("gs://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const bucket = rest.slice(0, slash);
  const object = rest.slice(slash + 1);
  return { bucket, object };
}

async function signGcsUrl(opts: { bucket: string; object: string; clientEmail: string; privateKeyPem: string; expiresInSec: number; userProject?: string; }) {
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
  if (opts.userProject) query.set("x-goog-user-project", opts.userProject);
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
  return Array.from(bin).map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
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
