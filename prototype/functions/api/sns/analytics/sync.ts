import { authorizeRequest, sanitizeUserId } from "../../_shared/auth.js";
import { loadShares, getGrantRole } from "../../_shared/shares";
import {
  ensureFreshAccessToken,
  getGoogleServiceAccountToken,
  readSnsSettings,
  resolveGcsContextForUser,
} from "../../_shared/youtube-token";
import { getFacebookPageToken } from "../../_shared/facebook-token";
import { getThreadsToken } from "../../_shared/threads-token";
import { getXToken } from "../../_shared/x-token";

type Metrics = {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
};

type AnalyticsPost = {
  id: string;
  channelType: string;
  contentType: string;
  status: "published";
  publishedAt: string;
  metricsUpdatedAt: string;
  remotePostId: string;
  remoteUrl: string;
  thumbnailUrl: string;
  title: string;
  caption: string;
  hashtags: string[];
  sourceScope: "account";
  accountName: string;
  brandId?: string;
  projectId?: string;
  projectTitle?: string;
  attributionStatus: "unassigned";
  attributionSource: "account-sync";
  metrics: Metrics;
};

type PlatformState = {
  platform: string;
  connected: boolean;
  enabled: boolean;
  accountName: string;
  state: "synced" | "empty" | "paused" | "permission_required" | "error";
  collected: number;
  message: string;
};

type CollectionResult = { posts: AnalyticsPost[]; state: PlatformState };
type StorageContext = { bucket: string; objectName: string; googleToken: string };

function send(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}

function positive(value: unknown): number {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) ? Math.max(0, numberValue) : 0;
}

function text(value: unknown): string {
  return String(value == null ? "" : value).trim();
}

function titleFrom(value: unknown, fallback: string): string {
  const normalized = text(value).replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, 120) : fallback;
}

function hashtagsFrom(value: unknown): string[] {
  const matches = text(value).match(/#[\p{L}\p{N}_-]+/gu) || [];
  return Array.from(new Set(matches.map((item) => item.trim()).filter(Boolean))).slice(0, 30);
}

function emptyMetrics(): Metrics {
  return { views: 0, likes: 0, comments: 0, shares: 0, clicks: 0 };
}

function accountName(entry: any): string {
  return text(entry?.username || entry?.channelTitle || entry?.pageName || entry?.name || entry?.igUserId);
}

function platformState(
  platform: string,
  entry: any,
  state: PlatformState["state"],
  collected: number,
  message: string
): PlatformState {
  return {
    platform,
    connected: !!entry?.connected,
    enabled: entry?.enabled !== false,
    accountName: accountName(entry),
    state,
    collected,
    message,
  };
}

async function readJson(response: Response): Promise<any> {
  const raw = await response.text();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { raw }; }
}

function apiError(platform: string, response: Response, data: any): Error {
  const detail = text(data?.error?.message || data?.error_description || data?.message || data?.raw);
  const error = new Error(`${platform}_api_${response.status}${detail ? `: ${detail}` : ""}`);
  (error as any).status = response.status;
  (error as any).detail = detail;
  return error;
}

function isPermissionError(error: unknown): boolean {
  const status = Number((error as any)?.status || 0);
  const message = text((error as any)?.message || error).toLowerCase();
  return status === 401 || status === 403 || /permission|scope|reconnect|not authorized|access level|forbidden|expired|invalid[^\n]*token|error validating access token|oauth/.test(message);
}

function isoDurationSeconds(value: unknown): number {
  const match = text(value).match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return 0;
  return positive(match[1]) * 3600 + positive(match[2]) * 60 + positive(match[3]);
}

function graphVersion(env: any): string {
  const value = text(env.META_GRAPH_VERSION || "v21.0");
  return /^v\d+\.\d+$/.test(value) ? value : "v21.0";
}

async function writePlatformPatch(ctx: StorageContext, platform: string, patch: Record<string, unknown>): Promise<void> {
  const existing = await readSnsSettings(ctx);
  existing.sns = existing.sns || {};
  existing.sns[platform] = Object.assign({}, existing.sns[platform] || {}, patch);
  existing.updatedAt = new Date().toISOString();
  const writeName = ctx.objectName.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${ctx.bucket}/o?uploadType=media&name=${writeName}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ctx.googleToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(existing),
  });
  if (!response.ok) throw new Error(`sns_settings_write_${response.status}`);
}

async function ensureInstagramToken(entry: any, ctx: StorageContext): Promise<string> {
  const current = text(entry?.accessToken);
  if (!current) throw new Error("instagram_reconnect_required");
  const expiresAt = Date.parse(text(entry?.tokenExpiresAt));
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > 7 * 24 * 3600 * 1000) return current;
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.search = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: current }).toString();
  const response = await fetch(url.toString());
  const data = await readJson(response);
  if (!response.ok || !data?.access_token) throw apiError("instagram", response, data);
  const tokenExpiresAt = new Date(Date.now() + positive(data.expires_in || 60 * 24 * 3600) * 1000).toISOString();
  await writePlatformPatch(ctx, "instagram", { accessToken: data.access_token, tokenExpiresAt, needsReconnect: false });
  return text(data.access_token);
}

async function ensureTikTokToken(env: any, entry: any, ctx: StorageContext): Promise<string> {
  const current = text(entry?.accessToken);
  const expiresAt = Date.parse(text(entry?.tokenExpiresAt));
  if (current && Number.isFinite(expiresAt) && expiresAt - Date.now() > 5 * 60 * 1000) return current;
  const refreshToken = text(entry?.refreshToken);
  if (!refreshToken) throw new Error("tiktok_reconnect_required");
  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: text(env.TIKTOK_CLIENT_KEY),
      client_secret: text(env.TIKTOK_CLIENT_SECRET),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });
  const data = await readJson(response);
  if (!response.ok || !data?.access_token) throw apiError("tiktok", response, data);
  const tokenExpiresAt = new Date(Date.now() + positive(data.expires_in || 86400) * 1000).toISOString();
  await writePlatformPatch(ctx, "tiktok", {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    tokenExpiresAt,
    refreshExpiresAt: data.refresh_expires_in ? new Date(Date.now() + positive(data.refresh_expires_in) * 1000).toISOString() : entry?.refreshExpiresAt,
    needsReconnect: false,
  });
  return text(data.access_token);
}

async function collectYouTube(env: any, userId: string, entry: any, syncedAt: string): Promise<CollectionResult> {
  const accessToken = await ensureFreshAccessToken(env, userId);
  const headers = { Authorization: `Bearer ${accessToken}` };
  const channelRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&mine=true", { headers });
  const channelData = await readJson(channelRes);
  if (!channelRes.ok) throw apiError("youtube", channelRes, channelData);
  const channel = channelData?.items?.[0] || {};
  const uploadsId = text(channel?.contentDetails?.relatedPlaylists?.uploads);
  if (!uploadsId) return { posts: [], state: platformState("youtube", entry, "empty", 0, "업로드된 동영상이 없습니다.") };

  const playlistUrl = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  playlistUrl.search = new URLSearchParams({ part: "contentDetails", playlistId: uploadsId, maxResults: "50" }).toString();
  const playlistRes = await fetch(playlistUrl.toString(), { headers });
  const playlistData = await readJson(playlistRes);
  if (!playlistRes.ok) throw apiError("youtube", playlistRes, playlistData);
  const ids = (playlistData?.items || []).map((item: any) => text(item?.contentDetails?.videoId)).filter(Boolean);
  if (!ids.length) return { posts: [], state: platformState("youtube", entry, "empty", 0, "업로드된 동영상이 없습니다.") };

  const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  videosUrl.search = new URLSearchParams({ part: "snippet,statistics,contentDetails", id: ids.join(",") }).toString();
  const videosRes = await fetch(videosUrl.toString(), { headers });
  const videosData = await readJson(videosRes);
  if (!videosRes.ok) throw apiError("youtube", videosRes, videosData);
  const channelName = text(channel?.snippet?.title) || accountName(entry);
  const posts = (videosData?.items || []).map((item: any): AnalyticsPost => {
    const id = text(item?.id);
    const snippet = item?.snippet || {};
    const statistics = item?.statistics || {};
    const seconds = isoDurationSeconds(item?.contentDetails?.duration);
    const isShorts = seconds > 0 && seconds <= 180 && /#shorts\b/i.test(`${text(snippet?.title)} ${text(snippet?.description)}`);
    const caption = text(snippet?.description);
    return {
      id: `${isShorts ? "youtube-shorts" : "youtube"}_${id}`,
      channelType: isShorts ? "youtube-shorts" : "youtube",
      contentType: isShorts ? "shorts-promo" : "sns-post",
      status: "published",
      publishedAt: text(snippet?.publishedAt),
      metricsUpdatedAt: syncedAt,
      remotePostId: id,
      remoteUrl: id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : "",
      thumbnailUrl: text(snippet?.thumbnails?.maxres?.url || snippet?.thumbnails?.high?.url || snippet?.thumbnails?.medium?.url),
      title: titleFrom(snippet?.title, "YouTube 동영상"),
      caption,
      hashtags: Array.isArray(snippet?.tags) ? snippet.tags.map((tag: unknown) => `#${text(tag).replace(/^#/, "")}`).filter(Boolean) : hashtagsFrom(caption),
      sourceScope: "account",
      accountName: channelName,
      attributionStatus: "unassigned",
      attributionSource: "account-sync",
      metrics: {
        views: positive(statistics?.viewCount),
        likes: positive(statistics?.likeCount),
        comments: positive(statistics?.commentCount),
        shares: 0,
        clicks: 0,
      },
    };
  }).filter((item: AnalyticsPost) => !!item.remotePostId);
  return { posts, state: platformState("youtube", Object.assign({}, entry, { channelTitle: channelName }), posts.length ? "synced" : "empty", posts.length, posts.length ? "최근 동영상 성과를 동기화했습니다." : "업로드된 동영상이 없습니다.") };
}

async function collectInstagram(env: any, entry: any, syncedAt: string, ctx: StorageContext): Promise<CollectionResult> {
  const token = await ensureInstagramToken(entry, ctx);
  const version = graphVersion(env);
  const url = new URL(`https://graph.instagram.com/${version}/me/media`);
  url.search = new URLSearchParams({
    fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
    limit: "5",
    access_token: token,
  }).toString();
  const response = await fetch(url.toString());
  const data = await readJson(response);
  if (!response.ok) throw apiError("instagram", response, data);

  const media = Array.isArray(data?.data) ? data.data : [];
  let insightPermissionFailures = 0;
  const posts = await Promise.all(media.map(async (item: any): Promise<AnalyticsPost> => {
    const id = text(item?.id);
    const metrics = emptyMetrics();
    metrics.likes = positive(item?.like_count);
    metrics.comments = positive(item?.comments_count);
    try {
      const insightsUrl = new URL(`https://graph.instagram.com/${version}/${encodeURIComponent(id)}/insights`);
      insightsUrl.search = new URLSearchParams({ metric: "views,reach", access_token: token }).toString();
      const insightsRes = await fetch(insightsUrl.toString());
      const insightsData = await readJson(insightsRes);
      if (insightsRes.ok) {
        (insightsData?.data || []).forEach((row: any) => {
          const value = positive(row?.total_value?.value ?? row?.values?.[0]?.value);
          if (row?.name === "views") metrics.views = value;
          if (row?.name === "reach" && !metrics.views) metrics.views = value;
        });
      } else if (insightsRes.status === 400 || insightsRes.status === 401 || insightsRes.status === 403) insightPermissionFailures += 1;
    } catch { /* 공개 반응 수치만 유지 */ }
    const caption = text(item?.caption);
    const product = text(item?.media_product_type).toUpperCase();
    return {
      id: `instagram_${id}`,
      channelType: "instagram",
      contentType: product === "REELS" ? "shorts-promo" : "sns-post",
      status: "published",
      publishedAt: text(item?.timestamp),
      metricsUpdatedAt: syncedAt,
      remotePostId: id,
      remoteUrl: text(item?.permalink),
      thumbnailUrl: text(item?.thumbnail_url || item?.media_url),
      title: titleFrom(caption, product === "REELS" ? "Instagram 릴스" : "Instagram 게시물"),
      caption,
      hashtags: hashtagsFrom(caption),
      sourceScope: "account",
      accountName: accountName(entry),
      attributionStatus: "unassigned",
      attributionSource: "account-sync",
      metrics,
    };
  }));
  const state = !posts.length ? "empty" : (insightPermissionFailures ? "permission_required" : "synced");
  const message = !posts.length
    ? "게시물이 없습니다."
    : (insightPermissionFailures ? "게시물은 가져왔지만 조회·도달 Insights 권한은 재연결이 필요합니다." : "최근 게시물과 Insights를 동기화했습니다.");
  return { posts, state: platformState("instagram", entry, state, posts.length, message) };
}

async function collectFacebook(env: any, userId: string, entry: any, syncedAt: string): Promise<CollectionResult> {
  const page = await getFacebookPageToken(env, userId);
  const version = graphVersion(env);
  let response: Response | null = null;
  let data: any = null;
  for (const edge of ["published_posts", "feed"]) {
    const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(page.pageId)}/${edge}`);
    url.search = new URLSearchParams({
      fields: "id,message,created_time,permalink_url,full_picture",
      limit: "5",
      access_token: page.pageToken,
    }).toString();
    response = await fetch(url.toString());
    data = await readJson(response);
    if (response.ok || response.status < 500) break;
  }
  if (!response) throw new Error("facebook_api_unavailable");
  if (!response.ok) throw apiError("facebook", response, data);
  const rows = Array.isArray(data?.data) ? data.data : [];
  let insightPermissionFailures = 0;
  const posts = await Promise.all(rows.map(async (item: any): Promise<AnalyticsPost> => {
    const id = text(item?.id);
    const metrics = emptyMetrics();
    try {
      const reactionsUrl = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(id)}`);
      reactionsUrl.search = new URLSearchParams({
        fields: "shares,reactions.limit(0).summary(true),comments.limit(0).summary(true)",
        access_token: page.pageToken,
      }).toString();
      const reactionsRes = await fetch(reactionsUrl.toString());
      const reactionsData = await readJson(reactionsRes);
      if (reactionsRes.ok) {
        metrics.likes = positive(reactionsData?.reactions?.summary?.total_count);
        metrics.comments = positive(reactionsData?.comments?.summary?.total_count);
        metrics.shares = positive(reactionsData?.shares?.count);
      }
    } catch { /* 게시물 기본 정보는 유지 */ }
    try {
      const insightsUrl = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(id)}/insights`);
      insightsUrl.search = new URLSearchParams({ metric: "post_impressions,post_clicks", period: "lifetime", access_token: page.pageToken }).toString();
      const insightsRes = await fetch(insightsUrl.toString());
      const insightsData = await readJson(insightsRes);
      if (insightsRes.ok) {
        (insightsData?.data || []).forEach((row: any) => {
          const value = positive(row?.values?.[0]?.value);
          if (row?.name === "post_impressions") metrics.views = value;
          if (row?.name === "post_clicks") metrics.clicks = value;
        });
      } else if (insightsRes.status === 400 || insightsRes.status === 401 || insightsRes.status === 403) insightPermissionFailures += 1;
    } catch { /* 공개 반응 수치만 유지 */ }
    const caption = text(item?.message);
    return {
      id: `facebook_${id}`,
      channelType: "facebook",
      contentType: "sns-post",
      status: "published",
      publishedAt: text(item?.created_time),
      metricsUpdatedAt: syncedAt,
      remotePostId: id,
      remoteUrl: text(item?.permalink_url),
      thumbnailUrl: text(item?.full_picture),
      title: titleFrom(caption, "Facebook 게시물"),
      caption,
      hashtags: hashtagsFrom(caption),
      sourceScope: "account",
      accountName: page.pageName,
      attributionStatus: "unassigned",
      attributionSource: "account-sync",
      metrics,
    };
  }));
  const state = !posts.length ? "empty" : (insightPermissionFailures ? "permission_required" : "synced");
  const message = !posts.length
    ? "페이지 게시물이 없습니다."
    : (insightPermissionFailures ? "게시물 반응은 가져왔지만 노출·클릭 Insights 권한은 재연결이 필요합니다." : "최근 페이지 게시물 성과를 동기화했습니다.");
  return { posts, state: platformState("facebook", Object.assign({}, entry, { pageName: page.pageName }), state, posts.length, message) };
}

async function collectTikTok(env: any, entry: any, syncedAt: string, ctx: StorageContext): Promise<CollectionResult> {
  const token = await ensureTikTokToken(env, entry, ctx);
  const fields = "id,title,video_description,duration,cover_image_url,embed_link,create_time,like_count,comment_count,share_count,view_count";
  const response = await fetch(`https://open.tiktokapis.com/v2/video/list/?fields=${encodeURIComponent(fields)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ max_count: 20 }),
  });
  const data = await readJson(response);
  if (!response.ok || (data?.error?.code && data.error.code !== "ok")) throw apiError("tiktok", response, data);
  const rows = Array.isArray(data?.data?.videos) ? data.data.videos : [];
  const posts = rows.map((item: any): AnalyticsPost => {
    const id = text(item?.id);
    const caption = text(item?.video_description || item?.title);
    const createdAt = positive(item?.create_time) ? new Date(positive(item.create_time) * 1000).toISOString() : "";
    return {
      id: `tiktok_${id}`,
      channelType: "tiktok",
      contentType: "shorts-promo",
      status: "published",
      publishedAt: createdAt,
      metricsUpdatedAt: syncedAt,
      remotePostId: id,
      remoteUrl: text(item?.embed_link),
      thumbnailUrl: text(item?.cover_image_url),
      title: titleFrom(item?.title || caption, "TikTok 동영상"),
      caption,
      hashtags: hashtagsFrom(caption),
      sourceScope: "account",
      accountName: accountName(entry),
      attributionStatus: "unassigned",
      attributionSource: "account-sync",
      metrics: {
        views: positive(item?.view_count),
        likes: positive(item?.like_count),
        comments: positive(item?.comment_count),
        shares: positive(item?.share_count),
        clicks: 0,
      },
    };
  }).filter((item: AnalyticsPost) => !!item.remotePostId);
  return { posts, state: platformState("tiktok", entry, posts.length ? "synced" : "empty", posts.length, posts.length ? "최근 동영상 성과를 동기화했습니다." : "동영상이 없습니다.") };
}

async function collectThreads(env: any, userId: string, entry: any, syncedAt: string): Promise<CollectionResult> {
  const token = await getThreadsToken(env, userId);
  const url = new URL(`https://graph.threads.net/v1.0/${encodeURIComponent(token.threadsUserId)}/threads`);
  url.search = new URLSearchParams({ fields: "id,media_type,media_url,permalink,text,timestamp,shortcode,thumbnail_url", limit: "5", access_token: token.accessToken }).toString();
  const response = await fetch(url.toString());
  const data = await readJson(response);
  if (!response.ok) throw apiError("threads", response, data);
  const rows = Array.isArray(data?.data) ? data.data : [];
  let insightPermissionFailures = 0;
  let insightFailures = 0;
  const posts = await Promise.all(rows.map(async (item: any): Promise<AnalyticsPost> => {
    const id = text(item?.id);
    const metrics = emptyMetrics();
    const insightsUrl = new URL(`https://graph.threads.net/v1.0/${encodeURIComponent(id)}/insights`);
    insightsUrl.search = new URLSearchParams({ metric: "views,likes,replies,reposts,quotes", access_token: token.accessToken }).toString();
    try {
      const insightsRes = await fetch(insightsUrl.toString());
      const insightsData = await readJson(insightsRes);
      if (insightsRes.ok) {
        (insightsData?.data || []).forEach((row: any) => {
          const value = positive(row?.total_value?.value ?? row?.values?.[0]?.value);
          if (row?.name === "views") metrics.views = value;
          if (row?.name === "likes") metrics.likes = value;
          if (row?.name === "replies") metrics.comments = value;
          if (row?.name === "reposts" || row?.name === "quotes") metrics.shares += value;
        });
      } else {
        const error = apiError("threads", insightsRes, insightsData);
        if (isPermissionError(error)) insightPermissionFailures += 1;
        else insightFailures += 1;
      }
    } catch { insightFailures += 1; }
    const caption = text(item?.text);
    return {
      id: `threads_${id}`,
      channelType: "threads",
      contentType: "sns-post",
      status: "published",
      publishedAt: text(item?.timestamp),
      metricsUpdatedAt: syncedAt,
      remotePostId: id,
      remoteUrl: text(item?.permalink),
      thumbnailUrl: text(item?.thumbnail_url || item?.media_url),
      title: titleFrom(caption, "Threads 게시물"),
      caption,
      hashtags: hashtagsFrom(caption),
      sourceScope: "account",
      accountName: token.username || accountName(entry),
      attributionStatus: "unassigned",
      attributionSource: "account-sync",
      metrics,
    };
  }));
  const state = !posts.length ? "empty" : (insightPermissionFailures ? "permission_required" : (insightFailures ? "error" : "synced"));
  const message = !posts.length
    ? "게시물이 없습니다."
    : (insightPermissionFailures
      ? "게시물은 가져왔지만 Insights 권한은 재연결이 필요합니다."
      : (insightFailures ? "게시물은 가져왔지만 일부 Insights 조회가 실패했습니다." : "최근 게시물 Insights를 동기화했습니다."));
  return { posts, state: platformState("threads", entry, state, posts.length, message) };
}

async function collectX(env: any, userId: string, entry: any, syncedAt: string): Promise<CollectionResult> {
  const token = await getXToken(env, userId);
  let xUserId = text(token.xUserId);
  if (!xUserId) {
    const meRes = await fetch("https://api.x.com/2/users/me", { headers: { Authorization: `Bearer ${token.accessToken}` } });
    const meData = await readJson(meRes);
    if (!meRes.ok) throw apiError("x", meRes, meData);
    xUserId = text(meData?.data?.id);
  }
  if (!xUserId) throw new Error("x_user_id_missing");
  const url = new URL(`https://api.x.com/2/users/${encodeURIComponent(xUserId)}/tweets`);
  url.search = new URLSearchParams({ max_results: "100", "tweet.fields": "created_at,public_metrics,entities", exclude: "retweets,replies" }).toString();
  const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token.accessToken}` } });
  const data = await readJson(response);
  if (!response.ok) throw apiError("x", response, data);
  const rows = Array.isArray(data?.data) ? data.data : [];
  const posts = rows.map((item: any): AnalyticsPost => {
    const id = text(item?.id);
    const caption = text(item?.text);
    const metrics = item?.public_metrics || {};
    return {
      id: `x_${id}`,
      channelType: "x",
      contentType: "sns-post",
      status: "published",
      publishedAt: text(item?.created_at),
      metricsUpdatedAt: syncedAt,
      remotePostId: id,
      remoteUrl: id && token.username ? `https://x.com/${encodeURIComponent(token.username)}/status/${encodeURIComponent(id)}` : "",
      thumbnailUrl: "",
      title: titleFrom(caption, "X 게시물"),
      caption,
      hashtags: Array.isArray(item?.entities?.hashtags)
        ? item.entities.hashtags.map((tag: any) => `#${text(tag?.tag)}`).filter((tag: string) => tag !== "#")
        : hashtagsFrom(caption),
      sourceScope: "account",
      accountName: token.username || accountName(entry),
      attributionStatus: "unassigned",
      attributionSource: "account-sync",
      metrics: {
        views: positive(metrics?.impression_count),
        likes: positive(metrics?.like_count),
        comments: positive(metrics?.reply_count),
        shares: positive(metrics?.retweet_count) + positive(metrics?.quote_count),
        clicks: 0,
      },
    };
  }).filter((item: AnalyticsPost) => !!item.remotePostId);
  return { posts, state: platformState("x", entry, posts.length ? "synced" : "empty", posts.length, posts.length ? "최근 게시물 공개 지표를 동기화했습니다." : "게시물이 없습니다.") };
}

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);
  let body: any = {};
  try { body = await request.json(); } catch { body = {}; }

  const requesterId = auth.userId;
  const ownerId = sanitizeUserId(body?.ownerId || "");
  const projectId = text(body?.projectId);
  let userId = requesterId;
  if (ownerId && ownerId !== requesterId) {
    if (!projectId) return send({ error: "projectId required for shared access" }, 400);
    const shares = await loadShares(env);
    if (!getGrantRole(shares, ownerId, projectId, requesterId)) return send({ error: "forbidden" }, 403);
    userId = ownerId;
  }

  const googleToken = await getGoogleServiceAccountToken({
    clientEmail: env.GOOGLE_CLIENT_EMAIL,
    privateKeyPem: env.GOOGLE_PRIVATE_KEY,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  });
  const gcs = resolveGcsContextForUser(env, userId);
  const storageContext = { ...gcs, googleToken };
  const settings = await readSnsSettings(storageContext);
  const sns = settings?.sns || {};
  const syncedAt = new Date().toISOString();
  const supported = ["instagram", "youtube", "tiktok", "facebook", "threads", "x"];
  const connections = Object.keys(sns).filter((platform) => {
    const entry = sns[platform];
    return !!entry?.connected && platform !== "youtube-shorts";
  }).map((platform) => ({
    channelType: platform,
    accountName: accountName(sns[platform]),
    connected: true,
    enabled: sns[platform]?.enabled !== false,
    needsReconnect: !!sns[platform]?.needsReconnect,
  }));

  const posts: AnalyticsPost[] = [];
  const platforms: PlatformState[] = [];
  for (const platform of supported) {
    const entry = sns[platform] || {};
    if (!entry.connected) continue;
    if (entry.enabled === false) {
      platforms.push(platformState(platform, entry, "paused", 0, "계정은 연결되어 있지만 사용이 중지되어 있습니다."));
      continue;
    }
    try {
      let result: CollectionResult;
      if (platform === "youtube") result = await collectYouTube(env, userId, entry, syncedAt);
      else if (platform === "instagram") result = await collectInstagram(env, entry, syncedAt, storageContext);
      else if (platform === "facebook") result = await collectFacebook(env, userId, entry, syncedAt);
      else if (platform === "tiktok") result = await collectTikTok(env, entry, syncedAt, storageContext);
      else if (platform === "threads") result = await collectThreads(env, userId, entry, syncedAt);
      else result = await collectX(env, userId, entry, syncedAt);
      posts.push(...result.posts);
      platforms.push(result.state);
    } catch (error) {
      const errorText = text((error as any)?.detail || (error as any)?.message || error);
      const permissionRequired = isPermissionError(error)
        || /reconnect_required|not_connected/.test(text((error as any)?.message))
        || (platform === "instagram" && /expired|error validating access token|oauth/i.test(errorText));
      platforms.push(platformState(
        platform,
        entry,
        permissionRequired ? "permission_required" : "error",
        0,
        permissionRequired
          ? (platform === "x" ? "X API의 게시물 조회 권한 또는 이용 요금제를 확인해 주세요." : "성과 조회 권한이 없습니다. SNS 설정에서 계정을 다시 연결해 주세요.")
          : `성과 수집 실패: ${errorText.slice(0, 180)}`
      ));
    }
  }

  return send({
    ok: true,
    syncedAt,
    connections,
    posts,
    platforms,
    summary: {
      connected: connections.length,
      enabled: connections.filter((item) => item.enabled).length,
      collected: posts.length,
      errors: platforms.filter((item) => item.state === "error" || item.state === "permission_required").length,
    },
  });
};
