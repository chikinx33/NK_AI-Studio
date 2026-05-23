import { buildUserDataObject, gcsObjectPath } from "./storage";

export interface YouTubeTokenData {
  connected: boolean;
  enabled?: boolean;
  channelId?: string;
  channelTitle?: string;
  channelHandle?: string;  // snippet.customUrl (e.g. "@shapesU")
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string;
  scope?: string;
  needsReconnect?: boolean;  // refresh token 폐기/만료 시 true → SNS 설정에서 재연결 유도
}

// 하위 호환 alias
export type YoutubeTokenRecord = YouTubeTokenData;

export interface YouTubeUploadInitRequest {
  title: string;
  description?: string;
  tags?: string[] | string;
  categoryId?: string;
  privacyStatus?: "public" | "private" | "unlisted";
  contentLength: number;
  contentType?: string;
}

export interface YouTubeUploadInitResponse {
  ok: true;
  uploadUrl: string;
  contentType: string;
  contentLength: number;
}

interface GcsContext {
  bucket: string;
  objectName: string;
  googleToken: string;
}

function parseGcsUri(uri: string): { bucket: string; object: string } {
  const without = String(uri || "").replace(/^gs:\/\//, "");
  const slash = without.indexOf("/");
  if (slash === -1) return { bucket: without, object: "" };
  return { bucket: without.slice(0, slash), object: without.slice(slash + 1) };
}

export async function getGoogleServiceAccountToken(opts: {
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

export function resolveGcsContextForUser(env: any, userId: string): { bucket: string; objectName: string } {
  const outParsed = parseGcsUri(env.VIDEO_OUTPUT_GCS_URI);
  const bucket = outParsed.bucket;
  const basePrefix = outParsed.object.replace(/\/$/, "");
  const objectName = buildUserDataObject(basePrefix, userId, "sns-settings.json");
  return { bucket, objectName };
}

export async function readSnsSettings(ctx: GcsContext): Promise<any> {
  const readName = gcsObjectPath(ctx.objectName);
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${ctx.bucket}/o/${readName}?alt=media`,
    { headers: { Authorization: `Bearer ${ctx.googleToken}` } }
  );
  if (!res.ok) {
    return {
      sns: { instagram: { connected: false }, youtube: { connected: false }, tiktok: { connected: false } },
      deployDefaults: {},
    };
  }
  try { return await res.json(); } catch { /* fall through */ }
  return {
    sns: { instagram: { connected: false }, youtube: { connected: false }, tiktok: { connected: false } },
    deployDefaults: {},
  };
}

async function commitSnsSettings(ctx: GcsContext, existing: any): Promise<void> {
  const writeName = ctx.objectName.split("/").map(encodeURIComponent).join("/");
  existing.updatedAt = new Date().toISOString();
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${ctx.bucket}/o?uploadType=media&name=${writeName}`;
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.googleToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(existing),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GCS save error: ${res.status} ${errText}`);
  }
}

export async function writeYoutubePatch(ctx: GcsContext, patch: Partial<YouTubeTokenData>): Promise<void> {
  const existing = await readSnsSettings(ctx);
  existing.sns = existing.sns || {};
  existing.sns.youtube = Object.assign({}, existing.sns.youtube, patch);
  await commitSnsSettings(ctx, existing);
}

/**
 * youtube 와 youtube-shorts 를 한 번의 GCS write 로 동시 미러링.
 * shorts 는 토큰을 저장하지 않고 channelTitle/channelId/connected 만 mirror 한다.
 * 업로드 시에는 youtube 의 토큰을 그대로 사용한다.
 */
export async function writeYoutubeWithShortsMirror(
  ctx: GcsContext,
  ytPatch: Partial<YouTubeTokenData>,
  opts: { disconnect?: boolean } = {}
): Promise<void> {
  const existing = await readSnsSettings(ctx);
  existing.sns = existing.sns || {};

  if (opts.disconnect) {
    existing.sns.youtube = { connected: false, enabled: false };
    const prevShortsEnabled = !!(existing.sns["youtube-shorts"] && existing.sns["youtube-shorts"].enabled);
    existing.sns["youtube-shorts"] = { connected: false, enabled: false, mirrorOf: "youtube", prevEnabled: prevShortsEnabled };
  } else {
    existing.sns.youtube = Object.assign({}, existing.sns.youtube, ytPatch);
    const prevShorts = existing.sns["youtube-shorts"] || {};
    existing.sns["youtube-shorts"] = Object.assign({}, prevShorts, {
      connected: true,
      // 최초 연결 시 enabled=true, 이후 사용자가 토글해둔 값 보존
      enabled: typeof prevShorts.enabled === "boolean" ? prevShorts.enabled : true,
      mirrorOf: "youtube",
      channelId: ytPatch.channelId || prevShorts.channelId || "",
      channelTitle: ytPatch.channelTitle || prevShorts.channelTitle || "",
      channelHandle: ytPatch.channelHandle || prevShorts.channelHandle || "",
    });
  }

  await commitSnsSettings(ctx, existing);
}

export async function readYoutubeRecord(ctx: GcsContext): Promise<YouTubeTokenData | null> {
  const settings = await readSnsSettings(ctx);
  const yt = settings?.sns?.youtube;
  if (!yt || !yt.connected) return null;
  if (!yt.accessToken || !yt.refreshToken) return null;
  return yt as YouTubeTokenData;
}

/**
 * 액세스 토큰이 만료 60초 이내면 refresh_token으로 갱신 후 GCS에 저장.
 * 항상 유효한 accessToken을 반환한다.
 */
export async function ensureFreshAccessToken(env: any, userId: string): Promise<string> {
  const clientId = env.YOUTUBE_CLIENT_ID;
  const clientSecret = env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("YOUTUBE_CLIENT_ID/SECRET not configured");
  }

  const googleToken = await getGoogleServiceAccountToken({
    clientEmail: env.GOOGLE_CLIENT_EMAIL,
    privateKeyPem: env.GOOGLE_PRIVATE_KEY,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  });

  const gcs = resolveGcsContextForUser(env, userId);
  const ctx: GcsContext = { ...gcs, googleToken };
  const record = await readYoutubeRecord(ctx);
  if (!record) throw new Error("youtube_not_connected");

  const expiresAtMs = Date.parse(record.tokenExpiresAt || "");
  const fresh = Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() > 60_000;
  if (fresh) return record.accessToken;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: record.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const data = (await tokenRes.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    // refresh token 폐기/만료(사용자가 Google 권한 해제, 비밀번호 변경, 미사용 만료 등)
    // → 재연결 외엔 복구 불가. needsReconnect 플래그를 세우고 sentinel 오류를 던진다.
    const errStr = `${data.error || ""} ${data.error_description || ""}`.toLowerCase();
    if (data.error === "invalid_grant" || /expired or revoked|invalid_grant/.test(errStr)) {
      try { await writeYoutubePatch(ctx, { needsReconnect: true }); } catch (_) { /* best-effort */ }
      throw new Error("youtube_reconnect_required");
    }
    throw new Error(data.error_description || data.error || "refresh_failed");
  }

  const newAccessToken = data.access_token;
  const newExpiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
  await writeYoutubePatch(ctx, {
    accessToken: newAccessToken,
    tokenExpiresAt: newExpiresAt,
    needsReconnect: false,
  });
  return newAccessToken;
}
