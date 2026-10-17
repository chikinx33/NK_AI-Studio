import { buildUserDataObject, gcsObjectPath } from "../../_shared/storage";
import { authorizeRequest } from "../../_shared/auth.js";

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
    headers: { "Content-Type": "application/json" },
  });
}

// 클라이언트 저장으로는 쓸 수 없는 필드(자격증명). OAuth 콜백·연결 엔드포인트만 쓴다.
const CLIENT_FORBIDDEN_FIELDS = ["accessToken", "refreshToken", "tokenExpiresAt", "refreshExpiresAt", "openId", "pageToken", "userToken", "webhookUrl", "webhookId", "guildId"];
// get.ts SAFE_SNS_FIELDS 와 같은 목록(테스트가 둘을 맞춰 본다).
const SAVE_RESPONSE_SNS_FIELDS = ["connected", "enabled", "needsReconnect", "username", "displayName", "avatarUrl", "handle", "pageName", "pageId", "channelTitle", "channelId", "channelHandle", "igUserId", "webhookHint", "guildId"];
function maskSavedSettings(settings: any) {
  const sns = settings?.sns && typeof settings.sns === "object" ? settings.sns : {};
  const out: Record<string, any> = {};
  for (const key of Object.keys(sns)) {
    const entry = sns[key];
    if (!entry || typeof entry !== "object") { out[key] = entry; continue; }
    const safe: Record<string, any> = {};
    for (const f of SAVE_RESPONSE_SNS_FIELDS) if (Object.prototype.hasOwnProperty.call(entry, f)) safe[f] = entry[f];
    out[key] = safe;
  }
  return Object.assign({}, settings, { sns: out });
}

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);
  const userId = auth.userId;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return send({ error: "Invalid JSON" }, 400);
  }

  const outParsed = parseGcsUri(env.VIDEO_OUTPUT_GCS_URI);
  const bucket = outParsed.bucket;
  const basePrefix = outParsed.object.replace(/\/$/, "");
  const objectName = buildUserDataObject(basePrefix, userId, "sns-settings.json");
  // 읽기(o/{name})는 전체 percent-encoding, 쓰기(upload name=)는 슬래시 그대로
  const readName = gcsObjectPath(objectName);
  const writeName = objectName.split("/").map(encodeURIComponent).join("/");
  console.log("[sns/save] bucket:", bucket, "objectName:", objectName, "userId:", userId);

  try {
    const token = await getGoogleAccessToken({
      clientEmail: env.GOOGLE_CLIENT_EMAIL,
      privateKeyPem: env.GOOGLE_PRIVATE_KEY,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });

    // Read-modify-write: 클라이언트가 보낸 필드만 머지로 적용.
    // OAuth 콜백이 저장한 accessToken/tokenExpiresAt 및 클라가 안 보낸
    // 다른 플랫폼 상태가 통째 덮어쓰기로 사라지는 cross-device 동기화 버그 방지.
    let existing: any = { sns: {}, deployDefaults: {} };
    const readRes = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${readName}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (readRes.ok) {
      try { existing = await readRes.json(); } catch { /* keep default */ }
    }
    existing = existing || {};
    existing.sns = existing.sns || {};

    const incomingSns: any = body?.sns || {};
    console.log("[sns/save] userId:", userId, "incoming sns keys:", Object.keys(incomingSns).join(","));
    if (incomingSns.facebook) {
      console.log("[sns/save] incoming facebook:", JSON.stringify(incomingSns.facebook));
      console.log("[sns/save] existing facebook BEFORE merge:", JSON.stringify(existing?.sns?.facebook || null));
    }
    Object.keys(incomingSns).forEach((platform) => {
      const incoming = Object.assign({}, incomingSns[platform] || {});
      // 자격증명은 연결 엔드포인트만 쓴다. 클라이언트 저장으로 들어오면 버린다.
      for (const f of CLIENT_FORBIDDEN_FIELDS) delete incoming[f];
      const prev = existing.sns[platform] || {};
      // 디스코드 해제는 웹훅 주소(=비밀)까지 지운다. 남겨 두면 해제 후에도 서버에 비밀이 남는다.
      if (platform === "discord" && incoming.connected === false) {
        existing.sns[platform] = { connected: false, enabled: false };
        return;
      }
      existing.sns[platform] = Object.assign({}, prev, incoming);
    });
    if (incomingSns.facebook) {
      console.log("[sns/save] existing facebook AFTER merge:", JSON.stringify(existing.sns.facebook));
    }
    existing.deployDefaults = body?.deployDefaults
      ? Object.assign({}, existing.deployDefaults || {}, body.deployDefaults)
      : (existing.deployDefaults || {});
    existing.updatedAt = new Date().toISOString();

    const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${writeName}`;
    const upRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(existing),
    });

    if (!upRes.ok) {
      const errText = await upRes.text();
      throw new Error(`GCS upload error: ${upRes.status} ${errText}`);
    }

    // 응답에는 화면 표기용 필드만 싣는다. 예전엔 병합 결과 전체(모든 채널의 토큰)를 돌려줘
    // 에이전트 도구(sns_prefs_save)를 통해 LLM 컨텍스트까지 들어갔다.
    return send({ ok: true, settings: maskSavedSettings(existing) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return send({ ok: false, error: msg }, 500);
  }
};
