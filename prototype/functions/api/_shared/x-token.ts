import { gcsObjectPath } from "./storage";
import { getGoogleServiceAccountToken, resolveGcsContextForUser } from "./youtube-token";

// X(트위터) OAuth 2.0 토큰 저장 형식. access_token 은 단기(2시간) 토큰이며,
// offline.access 스코프로 받은 refresh_token 으로 갱신한다(YouTube 와 유사).
export interface XTokenData {
  connected: boolean;
  enabled?: boolean;
  xUserId?: string;        // X 사용자 ID (게시 시 사용)
  username?: string;       // 핸들 (@ 제외)
  name?: string;           // 표시 이름
  accessToken?: string;    // 단기 액세스 토큰 (2시간)
  refreshToken?: string;   // 갱신 토큰
  tokenExpiresAt?: string; // 액세스 토큰 만료시각 ISO string
  scope?: string;
  needsReconnect?: boolean; // refresh token 폐기/만료 시 true → SNS 설정에서 재연결 유도
}

interface GcsContext {
  bucket: string;
  objectName: string;
  googleToken: string;
}

export function resolveXGcsContext(env: any, userId: string): { bucket: string; objectName: string } {
  return resolveGcsContextForUser(env, userId);
}

export async function readXRecord(ctx: GcsContext): Promise<XTokenData | null> {
  const readName = gcsObjectPath(ctx.objectName);
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${ctx.bucket}/o/${readName}?alt=media`,
    { headers: { Authorization: `Bearer ${ctx.googleToken}` } }
  );
  if (!res.ok) return null;
  let settings: any;
  try { settings = await res.json(); } catch { return null; }
  const x = settings?.sns?.x;
  if (!x || !x.connected) return null;
  return x as XTokenData;
}

export async function writeXPatch(ctx: GcsContext, patch: Partial<XTokenData>): Promise<void> {
  const readName = gcsObjectPath(ctx.objectName);
  const readRes = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${ctx.bucket}/o/${readName}?alt=media`,
    { headers: { Authorization: `Bearer ${ctx.googleToken}` } }
  );

  let existing: any = { sns: {}, deployDefaults: {} };
  if (readRes.ok) {
    try { existing = await readRes.json(); } catch { /* keep default */ }
  }

  existing.sns = existing.sns || {};
  existing.sns.x = Object.assign({}, existing.sns.x, patch);
  existing.updatedAt = new Date().toISOString();

  const writeName = ctx.objectName.split("/").map(encodeURIComponent).join("/");
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${ctx.bucket}/o?uploadType=media&name=${writeName}`;
  const upRes = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${ctx.googleToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(existing),
  });
  if (!upRes.ok) {
    const errText = await upRes.text();
    throw new Error(`GCS save error: ${upRes.status} ${errText}`);
  }
}

// refresh_token 으로 새 액세스 토큰 + (회전된) refresh_token 발급. 토큰 엔드포인트는
// confidential client 라 Basic 인증(client_id:client_secret) 필요.
export async function refreshXToken(opts: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ accessToken: string; refreshToken: string; tokenExpiresAt: string; scope?: string }> {
  const basic = btoa(`${opts.clientId}:${opts.clientSecret}`);
  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: opts.refreshToken,
      client_id: opts.clientId,
    }).toString(),
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    throw new Error(`X 토큰 갱신 실패: ${data.error_description || data.error || res.status}`);
  }
  return {
    accessToken: data.access_token,
    // refresh_token 회전: 새 값이 오면 교체, 없으면 기존 유지
    refreshToken: data.refresh_token || opts.refreshToken,
    tokenExpiresAt: new Date(Date.now() + (data.expires_in || 7200) * 1000).toISOString(),
    scope: data.scope,
  };
}

/**
 * 게시에 사용할 유효한 X 토큰을 반환한다. 만료 임박(5분 이내) 시 자동 갱신 후 GCS 에 저장.
 * 미연결 시 "x_not_connected" 오류를 throw.
 */
export async function getXToken(
  env: any,
  userId: string
): Promise<{ accessToken: string; xUserId: string; username: string }> {
  const googleToken = await getGoogleServiceAccountToken({
    clientEmail: env.GOOGLE_CLIENT_EMAIL,
    privateKeyPem: env.GOOGLE_PRIVATE_KEY,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  });

  const gcs = resolveXGcsContext(env, userId);
  const ctx: GcsContext = { ...gcs, googleToken };
  const record = await readXRecord(ctx);

  if (!record || !record.accessToken || !record.refreshToken) {
    throw new Error("x_not_connected");
  }

  let accessToken = record.accessToken;
  const expiresAt = record.tokenExpiresAt ? new Date(record.tokenExpiresAt).getTime() : 0;
  // 액세스 토큰은 2시간으로 짧다 → 만료 5분 전이면 갱신
  if (!expiresAt || Date.now() > expiresAt - 5 * 60 * 1000) {
    try {
      const refreshed = await refreshXToken({
        refreshToken: record.refreshToken,
        clientId: env.X_CLIENT_ID,
        clientSecret: env.X_CLIENT_SECRET,
      });
      accessToken = refreshed.accessToken;
      await writeXPatch(ctx, {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        tokenExpiresAt: refreshed.tokenExpiresAt,
        scope: refreshed.scope || record.scope,
        needsReconnect: false,
      });
    } catch (e) {
      // 갱신 실패(refresh token 폐기 등) → 재연결 유도 플래그 저장 후 오류 전파
      await writeXPatch(ctx, { needsReconnect: true });
      throw new Error("x_not_connected");
    }
  }

  return {
    accessToken,
    xUserId: record.xUserId || "",
    username: record.username || record.xUserId || "",
  };
}
