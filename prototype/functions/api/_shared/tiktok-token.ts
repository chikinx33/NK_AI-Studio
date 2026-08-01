/**
 * TikTok 토큰 · creator_info 공용 헬퍼.
 *
 * 게시 전 확인 모달(GET /api/sns/tiktok/creator-info)과 실제 게시(api/sns/publish)가
 * **같은 규칙**을 봐야 한다. 모달이 보여준 선택지와 서버가 허용하는 값이 어긋나면
 * 사용자가 고른 대로 안 올라가고, TikTok 심사에서도 문서와 동작 불일치로 잡힌다.
 * 그래서 privacy_level 결정 로직을 여기 한 곳에만 둔다.
 */
import {
  getGoogleServiceAccountToken,
  resolveGcsContextForUser,
  readSnsSettings,
} from "./youtube-token";

export type TikTokGcsContext = { bucket: string; objectName: string; googleToken: string };

export type TikTokCreatorInfo = {
  creatorNickname: string;
  creatorAvatarUrl: string;
  creatorUsername: string;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
  appAudited: boolean;
};

/** TikTok 이 정의한 공개 범위 값. 이 목록 밖의 값은 받지 않는다. */
export const TIKTOK_PRIVACY_LEVELS = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
] as const;

/**
 * 앱 심사 통과 여부. 미심사 앱은 TikTok 이 SELF_ONLY 게시만 허용하며
 * (unaudited_client_can_only_post_to_private_accounts), 심사 통과 후
 * Cloudflare 환경변수 TIKTOK_APP_AUDITED="true" 를 설정하면 공개 게시가 열린다.
 */
export function isTikTokAppAudited(env: any): boolean {
  return String(env?.TIKTOK_APP_AUDITED || "").toLowerCase() === "true";
}

export function isValidPrivacyLevel(value: unknown): boolean {
  return TIKTOK_PRIVACY_LEVELS.includes(String(value || "") as any);
}

/**
 * 사용자가 고른 공개 범위를 서버가 최종 확정한다.
 * 미심사 상태에서 SELF_ONLY 외 값이 오면 거부하지 않고 SELF_ONLY 로 낮춘 뒤
 * 사유를 함께 돌려준다 — 사용자에게 "왜 비공개로 올라갔는지" 설명해야 하기 때문.
 */
export function resolveTikTokPrivacyLevel(
  requested: string,
  appAudited: boolean
): { level: string; downgraded: boolean; reason?: string } {
  const level = String(requested || "").trim().toUpperCase();
  if (!appAudited && level !== "SELF_ONLY") {
    return {
      level: "SELF_ONLY",
      downgraded: true,
      reason:
        "This TikTok app has not completed TikTok's review yet, so posts can only be visible to you (SELF_ONLY). Your selection was downgraded.",
    };
  }
  return { level, downgraded: false };
}

async function writeTikTokPatch(
  ctx: TikTokGcsContext,
  patch: Record<string, unknown>
): Promise<void> {
  const existing = await readSnsSettings(ctx);
  existing.sns = existing.sns || {};
  existing.sns.tiktok = Object.assign({}, existing.sns.tiktok, patch);
  existing.updatedAt = new Date().toISOString();
  const writeName = ctx.objectName.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${ctx.bucket}/o?uploadType=media&name=${writeName}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.googleToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(existing),
    }
  );
  if (!res.ok) throw new Error(`GCS save error: ${res.status}`);
}

async function refreshTikTokToken(opts: {
  refreshToken: string;
  clientKey: string;
  clientSecret: string;
}): Promise<{ accessToken: string; refreshToken: string; tokenExpiresAt: string; refreshExpiresAt: string }> {
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: opts.clientKey,
      client_secret: opts.clientSecret,
      grant_type: "refresh_token",
      refresh_token: opts.refreshToken,
    }).toString(),
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    throw new Error(`tiktok_refresh_failed: ${data.error_description || data.error || res.status}`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || opts.refreshToken,
    tokenExpiresAt: new Date(Date.now() + (data.expires_in || 86400) * 1000).toISOString(),
    refreshExpiresAt: new Date(Date.now() + (data.refresh_expires_in || 365 * 86400) * 1000).toISOString(),
  };
}

/**
 * 저장된 TikTok 연결을 읽고, 만료 5분 전이면 갱신해 저장한 뒤 액세스 토큰을 돌려준다.
 * 연결이 없으면 "tiktok_not_connected", 갱신 불가면 "tiktok_reconnect_required" 로 throw.
 */
export async function getTikTokAccessToken(
  env: any,
  userId: string
): Promise<{ accessToken: string; record: any; ctx: TikTokGcsContext }> {
  const googleToken = await getGoogleServiceAccountToken({
    clientEmail: env.GOOGLE_CLIENT_EMAIL,
    privateKeyPem: env.GOOGLE_PRIVATE_KEY,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  });
  const ctx: TikTokGcsContext = { ...resolveGcsContextForUser(env, userId), googleToken };
  const settings = await readSnsSettings(ctx);
  const record = settings?.sns?.tiktok;
  if (!record?.connected || !record?.accessToken) throw new Error("tiktok_not_connected");

  const expiresAt = record.tokenExpiresAt ? Date.parse(record.tokenExpiresAt) : 0;
  const needsRefresh = Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() > expiresAt - 5 * 60 * 1000;
  if (!needsRefresh) return { accessToken: record.accessToken, record, ctx };

  if (!record.refreshToken) throw new Error("tiktok_reconnect_required");
  const refreshed = await refreshTikTokToken({
    refreshToken: record.refreshToken,
    clientKey: env.TIKTOK_CLIENT_KEY,
    clientSecret: env.TIKTOK_CLIENT_SECRET,
  });
  await writeTikTokPatch(ctx, {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    tokenExpiresAt: refreshed.tokenExpiresAt,
    refreshExpiresAt: refreshed.refreshExpiresAt,
  });
  return {
    accessToken: refreshed.accessToken,
    record: { ...record, ...refreshed },
    ctx,
  };
}

/**
 * TikTok 발행 상태를 폴링한다. (Direct Post·초안함 업로드 공용)
 *
 * 중요: init 이 publish_id 를 반환한 시점에 TikTok 은 이미 발행을 "수락"한 것이며,
 * 실제 처리는 비동기로 진행돼 수 분이 걸릴 수 있다. status 폴링은 타임아웃·FAILED 를
 * 반환해도 실제로는 게시가 정상 완료된 사례가 반복 확인됐다. 즉 신뢰할 수 있는
 * 성공/실패 oracle 이 아니다. 따라서:
 *  - 절대 throw 하지 않는다 (배포를 막지 않음).
 *  - 결과는 정보성으로만 반환하고, FAILED 면 fail_reason 을 캡처해 노출한다.
 * 진짜 init 단계 실패(파라미터/ownership 등)는 init 호출에서 이미 throw 되므로
 * 여기서 막을 필요가 없다.
 *
 * 초안함 업로드는 게시가 아니라 "사용자 inbox 로 전달"이 완료 상태이므로
 * SEND_TO_USER_INBOX 도 완료로 취급한다.
 */
export async function waitForTikTokStatus(
  accessToken: string,
  publishId: string,
  maxRetries = 12,
  intervalMs = 3000
): Promise<{ status: "complete" | "processing" | "failed"; failReason?: string; postId?: string }> {
  let lastStatus = "";
  for (let i = 0; i < maxRetries; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    let status: string | undefined;
    let failReason: string | undefined;
    let postId: string | undefined;
    try {
      const r = await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ publish_id: publishId }),
      });
      const d = (await r.json()) as {
        // TikTok 응답 필드명의 오타(publicaly)는 그쪽 스펙 그대로다.
        data?: { status?: string; fail_reason?: string; publicaly_available_post_id?: Array<string | number> };
        error?: { code?: string; message?: string };
      };
      status = d.data?.status;
      failReason = d.data?.fail_reason;
      const ids = d.data?.publicaly_available_post_id;
      if (Array.isArray(ids) && ids.length) postId = String(ids[0]);
      console.log(`[tiktok] status poll ${i + 1}/${maxRetries}: ${JSON.stringify(d.data || {})} (publish_id: ${publishId})`);
    } catch (err) {
      // 상태 조회 일시 실패는 무시하고 계속 폴링
      console.log(`[tiktok] status poll ${i + 1}/${maxRetries} fetch 실패:`, err);
      continue;
    }
    if (status) lastStatus = status;
    if (status === "PUBLISH_COMPLETE" || status === "SEND_TO_USER_INBOX") {
      return { status: "complete", postId };
    }
    if (status === "FAILED") {
      // throw 하지 않음 — 실제로는 게시 성공인 경우가 반복 확인됨. 이유만 노출.
      console.log(`[tiktok] status=FAILED (fail_reason=${failReason || "?"}, publish_id: ${publishId}) — soft 처리`);
      return { status: "failed", failReason: failReason || "unknown" };
    }
  }
  // 타임아웃: 실패가 아니라 아직 처리 중. publish_id 는 유효하므로 게시는 완료된다.
  console.log(`[tiktok] status 폴링 타임아웃 — 처리 중으로 간주 (last=${lastStatus}, publish_id: ${publishId})`);
  return { status: "processing" };
}

/** POST /v2/post/publish/creator_info/query/ 원본 응답. */
export async function queryTikTokCreatorInfo(
  accessToken: string
): Promise<{ data: any; raw: any }> {
  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
  });
  const body = (await res.json()) as {
    data?: Record<string, any>;
    error?: { code?: string; message?: string };
  };
  console.log(`[tiktok] creator_info 응답 (${res.status}):`, JSON.stringify(body));
  if (!res.ok || (body.error?.code && body.error.code !== "ok")) {
    throw new Error(
      `tiktok_creator_info_failed: httpStatus=${res.status} code=${body.error?.code || "?"} msg=${body.error?.message || "?"}`
    );
  }
  return { data: body.data || {}, raw: { httpStatus: res.status, ...body } };
}

/**
 * creator_info 원본을 확인 모달이 쓰는 형태로 정규화한다.
 *
 * privacy_level_options 는 "계정 설정" 기준이라 미심사 앱에서도 PUBLIC 이 들어있다.
 * 옵션 목록 자체는 그대로 노출하고(모달이 사유와 함께 비활성 처리한다), 실제 강제는
 * resolveTikTokPrivacyLevel 이 담당한다 — 화면과 서버가 같은 근거를 쓰게 하기 위함.
 */
export function normalizeCreatorInfo(data: any, appAudited: boolean): TikTokCreatorInfo {
  const options: string[] = Array.isArray(data?.privacy_level_options)
    ? data.privacy_level_options.filter(isValidPrivacyLevel)
    : [];
  return {
    creatorNickname: String(data?.creator_nickname || ""),
    creatorAvatarUrl: String(data?.creator_avatar_url || ""),
    creatorUsername: String(data?.creator_username || ""),
    // 옵션이 비어 오면 최소한 SELF_ONLY 는 고를 수 있어야 모달이 막히지 않는다.
    privacyLevelOptions: options.length ? options : ["SELF_ONLY"],
    commentDisabled: !!data?.comment_disabled,
    duetDisabled: !!data?.duet_disabled,
    stitchDisabled: !!data?.stitch_disabled,
    maxVideoPostDurationSec: Number(data?.max_video_post_duration_sec || 0) || 0,
    appAudited,
  };
}
