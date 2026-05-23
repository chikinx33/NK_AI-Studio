import { gcsObjectPath } from "./storage";
import { getGoogleServiceAccountToken, resolveGcsContextForUser } from "./youtube-token";

// Threads(메타) 액세스 토큰 저장 형식. accessToken 은 장기(60일) 토큰이며,
// 만료 임박 시 th_refresh_token 으로 갱신한다(Facebook 과 달리 갱신 엔드포인트가 있음).
export interface ThreadsTokenData {
  connected: boolean;
  enabled?: boolean;
  threadsUserId?: string;   // Threads 사용자 ID (게시 시 {id}/threads 경로에 사용)
  username?: string;
  accessToken?: string;     // 장기 사용자 토큰 (60일)
  tokenExpiresAt?: string;  // 토큰 만료시각 ISO string
}

interface GcsContext {
  bucket: string;
  objectName: string;
  googleToken: string;
}

export function resolveThreadsGcsContext(env: any, userId: string): { bucket: string; objectName: string } {
  return resolveGcsContextForUser(env, userId);
}

export async function readThreadsRecord(ctx: GcsContext): Promise<ThreadsTokenData | null> {
  const readName = gcsObjectPath(ctx.objectName);
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${ctx.bucket}/o/${readName}?alt=media`,
    { headers: { Authorization: `Bearer ${ctx.googleToken}` } }
  );
  if (!res.ok) return null;
  let settings: any;
  try { settings = await res.json(); } catch { return null; }
  const th = settings?.sns?.threads;
  if (!th || !th.connected) return null;
  return th as ThreadsTokenData;
}

export async function writeThreadsPatch(ctx: GcsContext, patch: Partial<ThreadsTokenData>): Promise<void> {
  const readName = gcsObjectPath(ctx.objectName);
  console.log("[writeThreadsPatch] bucket:", ctx.bucket, "objectName:", ctx.objectName);

  const readRes = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${ctx.bucket}/o/${readName}?alt=media`,
    { headers: { Authorization: `Bearer ${ctx.googleToken}` } }
  );
  console.log("[writeThreadsPatch] existing read status:", readRes.status);

  let existing: any = { sns: {}, deployDefaults: {} };
  if (readRes.ok) {
    try { existing = await readRes.json(); } catch (e) { console.log("[writeThreadsPatch] parse error:", e); }
  }

  existing.sns = existing.sns || {};
  existing.sns.threads = Object.assign({}, existing.sns.threads, patch);
  existing.updatedAt = new Date().toISOString();
  console.log("[writeThreadsPatch] sns.threads AFTER merge:", JSON.stringify(existing.sns.threads));

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
  console.log("[writeThreadsPatch] upload status:", upRes.status);
}

// 장기 토큰을 th_refresh_token 으로 갱신(최소 24시간 경과·미만료 토큰만 가능, 새 60일 토큰 반환).
export async function refreshThreadsToken(accessToken: string): Promise<{ accessToken: string; tokenExpiresAt: string }> {
  const res = await fetch(
    `https://graph.threads.net/refresh_access_token?` +
    new URLSearchParams({ grant_type: "th_refresh_token", access_token: accessToken }).toString()
  );
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: { message?: string } };
  if (!data.access_token) {
    throw new Error(`Threads 토큰 갱신 실패: ${data.error?.message || res.status}`);
  }
  return {
    accessToken: data.access_token,
    tokenExpiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString(),
  };
}

/**
 * 게시에 사용할 유효한 Threads 토큰을 반환한다. 만료 임박(7일 이내) 시 자동 갱신 후 GCS 에 저장.
 * 미연결 시 "threads_not_connected" 오류를 throw.
 */
export async function getThreadsToken(
  env: any,
  userId: string
): Promise<{ accessToken: string; threadsUserId: string; username: string }> {
  const googleToken = await getGoogleServiceAccountToken({
    clientEmail: env.GOOGLE_CLIENT_EMAIL,
    privateKeyPem: env.GOOGLE_PRIVATE_KEY,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  });

  const gcs = resolveThreadsGcsContext(env, userId);
  const ctx: GcsContext = { ...gcs, googleToken };
  const record = await readThreadsRecord(ctx);

  if (!record || !record.accessToken || !record.threadsUserId) {
    throw new Error("threads_not_connected");
  }

  let accessToken = record.accessToken;
  const expiresAt = record.tokenExpiresAt ? new Date(record.tokenExpiresAt).getTime() : 0;
  if (expiresAt && Date.now() > expiresAt - 7 * 24 * 3600 * 1000) {
    try {
      console.log("[getThreadsToken] 토큰 만료 임박, 갱신 시도");
      const refreshed = await refreshThreadsToken(accessToken);
      accessToken = refreshed.accessToken;
      await writeThreadsPatch(ctx, {
        accessToken: refreshed.accessToken,
        tokenExpiresAt: refreshed.tokenExpiresAt,
      });
    } catch (e) {
      // 갱신 실패해도 기존 토큰이 아직 유효할 수 있으니 그대로 진행
      console.log("[getThreadsToken] 토큰 갱신 실패(기존 토큰으로 진행):", e);
    }
  }

  return {
    accessToken,
    threadsUserId: record.threadsUserId,
    username: record.username || record.threadsUserId,
  };
}
