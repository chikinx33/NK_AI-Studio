import { buildUserDataObject, gcsObjectPath } from "../../_shared/storage";
import { authorizeRequest, sanitizeUserId } from "../../_shared/auth.js";
import { loadShares, getGrantRole } from "../../_shared/shares";

// 비소유자(공유 협업자)에게 반환할 때 노출해도 안전한 필드만 남긴다.
// accessToken/refreshToken/tokenExpiresAt 등 자격증명은 절대 클라이언트로 보내지 않는다.
const SAFE_SNS_FIELDS = ["connected", "enabled", "username", "pageName", "channelTitle", "igUserId", "needsReconnect", "displayName", "avatarUrl", "handle"];
function maskSnsSettings(settings: any) {
  const sns = settings && typeof settings === "object" ? settings.sns : null;
  if (!sns || typeof sns !== "object") return settings;
  const maskedSns: Record<string, any> = {};
  for (const key of Object.keys(sns)) {
    const entry = sns[key];
    if (!entry || typeof entry !== "object") { maskedSns[key] = entry; continue; }
    const safe: Record<string, any> = {};
    for (const f of SAFE_SNS_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(entry, f)) safe[f] = entry[f];
    }
    maskedSns[key] = safe;
  }
  // deployDefaults 등 비자격증명 메타는 유지, sns만 마스킹
  return Object.assign({}, settings, { sns: maskedSns, shared: true });
}

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
    .split(/\s+/)
    .join("");
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
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
    },
  });
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);
  const requesterId = auth.userId;
  let userId = requesterId;

  // 공유 접근: ownerId+projectId가 본인과 다르면 해당 프로젝트의 공유 권한(viewer/editor)이
  // 있어야 소유자 SNS 설정을 읽을 수 있다. 비소유자에겐 토큰을 마스킹해서만 반환한다.
  const url = new URL(request.url);
  const ownerParam = sanitizeUserId(url.searchParams.get("ownerId") || "");
  const projectId = String(url.searchParams.get("projectId") || "").trim();
  let masked = false;
  if (ownerParam && ownerParam !== requesterId) {
    if (!projectId) return send({ error: "projectId required for shared access" }, 400);
    const sharesReg = await loadShares(env);
    const role = getGrantRole(sharesReg, ownerParam, projectId, requesterId);
    if (!role) return send({ error: "forbidden" }, 403);
    userId = ownerParam;
    masked = true;
  }

  const outParsed = parseGcsUri(env.VIDEO_OUTPUT_GCS_URI);
  const bucket = outParsed.bucket;
  const basePrefix = outParsed.object.replace(/\/$/, "");
  const objectName = buildUserDataObject(basePrefix, userId, "sns-settings.json");
  // 읽기는 GCS JSON API 규칙상 객체 이름 전체를 percent-encoding 해야 함(슬래시 포함)
  const encodedName = gcsObjectPath(objectName);
  console.log("[sns/get] bucket:", bucket, "objectName:", objectName, "userId:", userId);

  try {
    const token = await getGoogleAccessToken({
      clientEmail: env.GOOGLE_CLIENT_EMAIL,
      privateKeyPem: env.GOOGLE_PRIVATE_KEY,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });

    const gcsRes = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodedName}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log("[sns/get] GCS read status:", gcsRes.status);

    if (gcsRes.status === 404) {
      // 파일 없음(신규 사용자 또는 일시적 GCS 누락) — 가짜 'disconnected' 기본값을
      // 권위 있는 값처럼 돌려주면 클라이언트가 로컬 캐시를 disconnected 로 덮어쓰는
      // 부작용이 있음. 명시적으로 missing 플래그만 반환하여 클라이언트가 캐시를
      // 보존하도록 한다.
      return send({ ok: true, settings: null, missing: true });
    }

    if (!gcsRes.ok) throw new Error(`GCS read error: ${gcsRes.status}`);
    const settings = await gcsRes.json();
    // 비소유자에겐 자격증명을 제거한 마스킹 버전만 반환
    const outSettings = masked ? maskSnsSettings(settings) : settings;
    return send({ ok: true, settings: outSettings });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return send({ ok: false, error: msg }, 500);
  }
};
