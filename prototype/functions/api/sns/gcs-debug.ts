import { buildUserDataObject } from "../_shared/storage";
import { authorizeRequest } from "../_shared/auth.js";

function parseGcsUri(uri: string): { bucket: string; object: string } {
  const without = String(uri || "").replace(/^gs:\/\//, "");
  const slash = without.indexOf("/");
  if (slash === -1) return { bucket: without, object: "" };
  return { bucket: without.slice(0, slash), object: without.slice(slash + 1) };
}

async function getGoogleAccessToken(opts: {
  clientEmail: string;
  privateKeyPem: string;
  scope: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: opts.clientEmail,
    scope: opts.scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const b64 = (obj: object) =>
    btoa(JSON.stringify(obj)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const message = `${b64(header)}.${b64(payload)}`;
  const pem = opts.privateKeyPem.replace(/\\n/g, "\n").trim();
  const lines = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .split(/\s+/).join("");
  const raw = atob(lines);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  const key = await crypto.subtle.importKey(
    "pkcs8", buf.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
  const sigBuf = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(message)
  );
  let bin = "";
  new Uint8Array(sigBuf).forEach((b) => (bin += String.fromCharCode(b)));
  const sig = btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const jwt = `${message}.${sig}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Failed to get Google access token");
  return data.access_token;
}

function send(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function maskToken(val: unknown): unknown {
  if (typeof val !== "string" || val.length < 8) return val;
  return val.slice(0, 6) + "…" + val.slice(-4);
}

/** 민감 필드(토큰)를 마스킹한 안전한 복사본 */
function maskSettings(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  const SENSITIVE = new Set(["accessToken", "refreshToken", "igAccessToken"]);
  const out: any = Array.isArray(obj) ? [] : {};
  for (const k of Object.keys(obj)) {
    out[k] = SENSITIVE.has(k) ? maskToken(obj[k]) : maskSettings(obj[k]);
  }
  return out;
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);

  const outParsed = parseGcsUri(env.VIDEO_OUTPUT_GCS_URI);
  const bucket = outParsed.bucket;
  const basePrefix = outParsed.object.replace(/\/$/, "");
  const objectName = buildUserDataObject(basePrefix, auth.userId, "sns-settings.json");
  const encodedName = objectName.split("/").map(encodeURIComponent).join("/");

  const pathInfo = {
    VIDEO_OUTPUT_GCS_URI: env.VIDEO_OUTPUT_GCS_URI || "(unset)",
    bucket,
    basePrefix,
    userId: auth.userId || "(empty→owner)",
    objectName,
    encodedName,
    readUrl: `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodedName}?alt=media`,
  };

  try {
    const googleToken = await getGoogleAccessToken({
      clientEmail: env.GOOGLE_CLIENT_EMAIL,
      privateKeyPem: env.GOOGLE_PRIVATE_KEY,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });

    const gcsRes = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodedName}?alt=media`,
      { headers: { Authorization: `Bearer ${googleToken}` } }
    );

    if (gcsRes.status === 404) {
      return send({ ok: true, exists: false, pathInfo });
    }
    if (!gcsRes.ok) {
      return send({ ok: false, gcsStatus: gcsRes.status, pathInfo });
    }

    const raw = await gcsRes.json();
    return send({
      ok: true,
      exists: true,
      pathInfo,
      settings: maskSettings(raw),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return send({ ok: false, error: msg, pathInfo });
  }
};
