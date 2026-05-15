import { buildUserDataObject, gcsObjectPath } from "./storage";
import { getGoogleServiceAccountToken, resolveGcsContextForUser } from "./youtube-token";

export interface FacebookTokenData {
  connected: boolean;
  enabled?: boolean;
  pageId?: string;
  pageName?: string;
  userToken?: string;       // 장기 사용자 토큰 (60일)
  pageToken?: string;       // 페이지 토큰 (장기 사용자 토큰 파생 시 만료 없음)
  tokenExpiresAt?: string;  // 사용자 토큰 만료시각 ISO string
}

interface GcsContext {
  bucket: string;
  objectName: string;
  googleToken: string;
}

export function resolveFacebookGcsContext(env: any, userId: string): { bucket: string; objectName: string } {
  return resolveGcsContextForUser(env, userId);
}

export async function readFacebookRecord(ctx: GcsContext): Promise<FacebookTokenData | null> {
  const readName = gcsObjectPath(ctx.objectName);
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${ctx.bucket}/o/${readName}?alt=media`,
    { headers: { Authorization: `Bearer ${ctx.googleToken}` } }
  );
  if (!res.ok) return null;
  let settings: any;
  try { settings = await res.json(); } catch { return null; }
  const fb = settings?.sns?.facebook;
  if (!fb || !fb.connected) return null;
  return fb as FacebookTokenData;
}

export async function writeFacebookPatch(ctx: GcsContext, patch: Partial<FacebookTokenData>): Promise<void> {
  const readName = gcsObjectPath(ctx.objectName);
  const readRes = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${ctx.bucket}/o/${readName}?alt=media`,
    { headers: { Authorization: `Bearer ${ctx.googleToken}` } }
  );

  let existing: any = {
    sns: { instagram: { connected: false }, youtube: { connected: false }, tiktok: { connected: false }, facebook: { connected: false } },
    deployDefaults: {},
  };
  if (readRes.ok) {
    try { existing = await readRes.json(); } catch { /* keep default */ }
  }

  existing.sns = existing.sns || {};
  existing.sns.facebook = Object.assign({}, existing.sns.facebook, patch);
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

/**
 * 페이지 토큰을 반환한다.
 * 장기 사용자 토큰에서 파생된 페이지 토큰은 만료 없음 — refresh 불필요.
 * 미연결 시 "facebook_not_connected" 오류를 throw.
 */
export async function getFacebookPageToken(env: any, userId: string): Promise<{ pageToken: string; pageId: string; pageName: string }> {
  const googleToken = await getGoogleServiceAccountToken({
    clientEmail: env.GOOGLE_CLIENT_EMAIL,
    privateKeyPem: env.GOOGLE_PRIVATE_KEY,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  });

  const gcs = resolveFacebookGcsContext(env, userId);
  const ctx: GcsContext = { ...gcs, googleToken };
  const record = await readFacebookRecord(ctx);

  if (!record) throw new Error("facebook_not_connected");
  if (!record.pageToken || !record.pageId) throw new Error("facebook_not_connected");

  return {
    pageToken: record.pageToken,
    pageId: record.pageId,
    pageName: record.pageName || record.pageId,
  };
}
