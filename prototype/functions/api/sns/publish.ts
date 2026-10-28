import { ensureMetaToken } from "../_shared/meta-token.js";
import { patchSnsPlatform } from "../_shared/sns-store.js";
import { buildUserDataObject, gcsObjectPath } from "../_shared/storage";
import { authorizeRequest, readSecret, sanitizeUserId } from "../_shared/auth.js";
import { loadShares, getGrantRole } from "../_shared/shares";
import { ensureFreshAccessToken } from "../_shared/youtube-token";
import { getFacebookPageToken } from "../_shared/facebook-token";
import { getThreadsToken } from "../_shared/threads-token";
import { getXToken } from "../_shared/x-token";
import {
  DISCORD_CONTENT_LIMIT, DISCORD_FILE_LIMIT, DISCORD_MAX_ATTACHMENTS,
  discordMessageUrl, getDiscordWebhook, postDiscordMessage, writeDiscordEntry,
  type DiscordFile,
} from "../_shared/discord-webhook";
import { readQueuedSchedule, enqueueScheduledPost } from "../_shared/sns-schedule";
import { MEDIA_PATH_FORBIDDEN, authorizePublishMediaPaths, publishMediaLocation } from "../_shared/publish-media-path";
import {
  isTikTokAppAudited,
  isValidPrivacyLevel,
  resolveTikTokPrivacyLevel,
  queryTikTokCreatorInfo,
} from "../_shared/tiktok-token";

function send(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseGcsUri(uri: string): { bucket: string; object: string } {
  const without = String(uri || "").replace(/^gs:\/\//, "");
  const slash = without.indexOf("/");
  if (slash === -1) return { bucket: without, object: "" };
  return { bucket: without.slice(0, slash), object: without.slice(slash + 1) };
}

// ── TikTok Photo 프록시 URL 서명 (api/sns/tiktok-media 와 공유하는 규칙) ──────
// 세션 토큰과 같은 서명 키(_shared/auth.js readSecret). 비밀 값이 없으면 던진다 —
// 공개 저장소에 박힌 기본 문자열로 서명하면 누구나 버킷 객체 URL 을 만들 수 있다.
function readMediaSecret(env: any): string {
  return readSecret(env);
}

async function hmacSha256B64url(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  let bin = "";
  new Uint8Array(sig).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/**
 * GCS 객체를 우리 도메인 경로(/api/sns/tiktok-media)로 중계하는 서명된 URL 생성.
 * TikTok PULL_FROM_URL 의 도메인 ownership 검증을 통과시키기 위함.
 */
async function buildTikTokProxyUrl(
  origin: string,
  objectName: string,
  secret: string,
  ttlSec = 3600
): Promise<string> {
  // ttlSec 0 = 만료 없는 링크(e=0). 채널 게시물에 남는 링크용 — tiktok-media.ts 가 e=0 을 영구로 받는다.
  const exp = ttlSec === 0 ? 0 : Math.floor(Date.now() / 1000) + ttlSec;
  const sig = await hmacSha256B64url(secret, `${objectName}|${exp}`);
  return `${origin}/api/sns/tiktok-media?o=${encodeURIComponent(objectName)}&e=${exp}&s=${encodeURIComponent(sig)}`;
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

async function sha256Hex(message: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64urlToHex(b64url: string): string {
  const b64 = b64url.replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(b64);
  return Array.from(raw).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}

async function signRS256(message: string, privateKeyPem: string): Promise<string> {
  const pem = privateKeyPem.replace(/\\n/g, "\n").trim();
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
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function buildSignedUrl(
  bucket: string,
  objectPath: string,
  clientEmail: string,
  privateKeyPem: string,
  expiresInSec = 3600
): Promise<string> {
  const now = new Date();
  const pad = (n: number) => `${n}`.padStart(2, "0");
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${date}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const credential = `${clientEmail}/${date}/auto/storage/goog4_request`;
  const host = "storage.googleapis.com";
  const canonicalUri =
    `/${encodeURIComponent(bucket)}/` +
    objectPath.split("/").map(encodeURIComponent).join("/");
  const signedHeaders = "host";
  const query = new URLSearchParams({
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": credential,
    "X-Goog-Date": time,
    "X-Goog-Expires": `${expiresInSec}`,
    "X-Goog-SignedHeaders": signedHeaders,
  });
  const canonicalQuery = query.toString();
  const canonicalRequest = [
    "GET", canonicalUri, canonicalQuery,
    `host:${host}`, "", signedHeaders, "UNSIGNED-PAYLOAD",
  ].join("\n");
  const hashedRequest = await sha256Hex(canonicalRequest);
  const stringToSign = [
    "GOOG4-RSA-SHA256", time,
    `${date}/auto/storage/goog4_request`, hashedRequest,
  ].join("\n");
  const sig = await signRS256(stringToSign, privateKeyPem);
  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Goog-Signature=${b64urlToHex(sig)}`;
}

async function loadSnsSettings(
  bucket: string,
  objectName: string,
  googleToken: string
): Promise<any> {
  const encodedName = gcsObjectPath(objectName);
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodedName}?alt=media`,
    { headers: { Authorization: `Bearer ${googleToken}` } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GCS read error: ${res.status}`);
  return await res.json();
}

// ── TikTok 헬퍼 ───────────────────────────────────────────────────────────

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
    throw new Error(`TikTok 토큰 갱신 실패: ${data.error_description || data.error}`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || opts.refreshToken,
    tokenExpiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : new Date(Date.now() + 86400 * 1000).toISOString(),
    refreshExpiresAt: data.refresh_expires_in
      ? new Date(Date.now() + data.refresh_expires_in * 1000).toISOString()
      : new Date(Date.now() + 365 * 86400 * 1000).toISOString(),
  };
}

/** sns-settings.json 의 한 플랫폼 항목을 병합 저장(needsReconnect·갱신 토큰). */
async function saveSnsPlatformPatch(opts: { bucket: string; objectName: string; googleToken: string; platform: string; patch: Record<string, unknown> }): Promise<void> {
  await patchSnsPlatform(opts, opts.platform, opts.patch);
}

/** 인스타그램 만료 토큰 오류인가(Graph API code 190 계열). */
function isInstagramTokenError(message: string): boolean {
  return /session has expired|error validating access token|invalid oauth access token|access token.*(expired|invalid)|\(#190\)|code":\s*190/i.test(String(message || ""));
}

/**
 * 연결된 인스타그램 계정의 토큰. 만료 7일 전부터 ig_refresh_token 으로 갱신해 저장한다(성과 동기화와 같은 규칙).
 * 이미 만료됐거나 갱신이 거절되면 needsReconnect 를 기록하고 던진다 — 재연결이 유일한 해법이다.
 */
async function ensureInstagramPublishToken(entry: any, store: { bucket: string; objectName: string; googleToken: string }): Promise<string> {
  return ensureMetaToken(store, "instagram", entry);
}

async function saveTikTokTokenPatch(opts: {
  bucket: string;
  objectName: string;
  googleToken: string;
  patch: Record<string, unknown>;
}): Promise<void> {
  const readName = gcsObjectPath(opts.objectName);
  const writeName = opts.objectName.split("/").map(encodeURIComponent).join("/");
  const readRes = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${opts.bucket}/o/${readName}?alt=media`,
    { headers: { Authorization: `Bearer ${opts.googleToken}` } }
  );
  let existing: any = { sns: {}, deployDefaults: {} };
  if (readRes.ok) {
    try { existing = await readRes.json(); } catch { /* keep default */ }
  }
  existing.sns = existing.sns || {};
  existing.sns.tiktok = Object.assign({}, existing.sns.tiktok, opts.patch);
  existing.updatedAt = new Date().toISOString();
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${opts.bucket}/o?uploadType=media&name=${writeName}`;
  const upRes = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.googleToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(existing),
  });
  if (!upRes.ok) throw new Error(`GCS save error: ${upRes.status}`);
}

// 상태 폴링은 초안함(inbox) 업로드와 공유한다 → _shared/tiktok-token.ts 참조.

/**
 * 확인 모달에서 사용자가 고른 게시 옵션. 서버는 여기에 묵시적 기본값을 채우지 않는다
 * (privacy_level 이 없으면 400). 사용자가 화면에서 고른 값 그대로 TikTok 에 보내는 것이
 * Direct Post 승인 조건이기 때문.
 */
/**
 * TikTok init 실패를 코드가 붙은 Error 로 만든다.
 * 사용자에게 보여줄 문구는 클라이언트가 code 로 골라 한/영으로 표시한다
 * (서버는 UI 언어를 모른다). 진단용 상세는 로그에만 남긴다.
 */
function tiktokInitError(kind: 'video' | 'photo', code: string | undefined, detail: string): Error {
  const err = new Error(`tiktok_${kind}_init_failed: ${code || 'unknown'}`) as Error & { tiktokCode?: string; detail?: string };
  err.tiktokCode = String(code || '');
  err.detail = detail;
  return err;
}

type TikTokPostOptions = {
  privacyLevel: string;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  brandContentToggle: boolean;
  brandOrganicToggle: boolean;
};

/**
 * TikTok init 에 실을 post_info 를 만든다.
 *
 * disable_* 하드코딩은 전부 제거됐다 — 이 값들은 확인 모달에서 사용자가 체크한 값의
 * 반전이고, 크리에이터가 계정에서 막아둔 항목은 호출부에서 이미 강제 반영해 둔다.
 */
function tiktokPostInfoBase(post: TikTokPostOptions): Record<string, unknown> {
  return {
    privacy_level: post.privacyLevel,
    disable_comment: post.disableComment,
    brand_content_toggle: post.brandContentToggle,
    brand_organic_toggle: post.brandOrganicToggle,
  };
}

async function publishTikTokVideo(opts: {
  accessToken: string;
  caption: string;
  videoUrl: string;
  postOptions: TikTokPostOptions;
}): Promise<{ publishId: string }> {
  const { accessToken, caption, videoUrl } = opts;
  console.log(`[tiktok] 영상 발행 시작 (file_upload): ${videoUrl.slice(0, 80)}...`);

  // Step 1: 영상 크기 확인 (HEAD)
  const headRes = await fetch(videoUrl, { method: "HEAD" });
  if (!headRes.ok) throw new Error(`영상 메타데이터 조회 실패: ${headRes.status}`);
  const videoSize = parseInt(headRes.headers.get("content-length") || "0");
  if (!videoSize) throw new Error("영상 파일 크기를 확인할 수 없습니다");
  // 우리는 total_chunk_count:1 로 통짜 업로드한다. TikTok 의 단일 청크 상한은 64MB 이므로
  // 그 이상은 TikTok 이 init 단계에서 거부한다. 분할 업로드를 붙이기 전까지는 여기서 막아
  // "왜 실패했는지 모르는 실패" 대신 원인이 분명한 메시지를 준다.
  const TIKTOK_MAX_SINGLE_CHUNK = 64 * 1024 * 1024;
  if (videoSize > TIKTOK_MAX_SINGLE_CHUNK) {
    throw new Error(
      `영상이 너무 큽니다 (${Math.round(videoSize / 1024 / 1024)}MB). ` +
      `TikTok 단일 업로드 상한은 64MB 입니다. 렌더 화질을 낮추거나 길이를 줄여 주세요.`
    );
  }
  console.log(`[tiktok] 영상 크기: ${Math.round(videoSize / 1024)}KB`);

  // 확인 모달에서 사용자가 확정한 값. 호출부가 이미 creator_info 로 검증·보정해 뒀다.
  const post = opts.postOptions;
  const privacyLevel = post.privacyLevel;
  console.log(`[tiktok] 사용할 privacy_level: ${privacyLevel}`);

  // Step 2: TikTok 발행 초기화 (FILE_UPLOAD)
  const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      post_info: {
        title: caption.slice(0, 2200),
        ...tiktokPostInfoBase(post),
        // 듀엣·스티치는 영상 게시에만 존재한다.
        disable_duet: post.disableDuet,
        disable_stitch: post.disableStitch,
        video_cover_timestamp_ms: 1000,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: videoSize,
        chunk_size: videoSize,
        total_chunk_count: 1,
      },
    }),
  });
  const initData = (await initRes.json()) as {
    data?: { publish_id?: string; upload_url?: string };
    error?: { code?: string; message?: string };
  };
  console.log(`[tiktok] video/init 응답 (${initRes.status}):`, JSON.stringify(initData));
  const publishId = initData.data?.publish_id;
  const uploadUrl = initData.data?.upload_url;
  if (!publishId || !uploadUrl) {
    const detail = [
      `httpStatus=${initRes.status}`,
      `code=${initData.error?.code || "?"}`,
      `msg=${initData.error?.message || "?"}`,
      `privacyLevel=${privacyLevel}`,
      `postInfo=${JSON.stringify(post)}`,
    ].join(" | ");
    console.log(`[tiktok] video/init 실패: ${detail}`);
    throw tiktokInitError('video', initData.error?.code, detail);
  }
  console.log(`[tiktok] 발행 초기화 완료, publish_id: ${publishId}`);

  // Step 3: GCS에서 영상 다운로드 후 TikTok에 직접 업로드
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error(`GCS 영상 다운로드 실패: ${videoRes.status}`);
  const videoBuffer = await videoRes.arrayBuffer();

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(videoBuffer.byteLength),
      "Content-Range": `bytes 0-${videoBuffer.byteLength - 1}/${videoBuffer.byteLength}`,
    },
    body: videoBuffer,
  });
  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => "");
    throw new Error(`TikTok 영상 업로드 실패: ${uploadRes.status} ${errText}`);
  }
  // 업로드가 끝나면 TikTok 이 발행을 수락한 것이다. 여기서 상태를 폴링하지 않는다 —
  // 폴링은 정보성인데, 요청 안에서 기다리면 실행 제한을 넘겨 응답 자체를 잃고
  // "이미 게시됐는데 실패로 보이는" 상태가 된다. 상태 확인은 클라이언트가
  // /api/sns/tiktok/publish-status 로 따로 한다.
  console.log(`[tiktok] 영상 업로드 완료(수락됨): ${publishId}`);
  return { publishId, status: "processing" as const };
}

async function publishTikTokPhoto(opts: {
  accessToken: string;
  caption: string;
  photoUrls: string[];
  postOptions: TikTokPostOptions;
}): Promise<{ publishId: string }> {
  const { accessToken, caption, photoUrls } = opts;
  console.log(`[tiktok] 이미지 발행 시작 (${photoUrls.length}장, photo_mode)`);
  // 사진 게시에는 듀엣·스티치 개념이 없어 disable_duet/disable_stitch 를 보내지 않는다.
  const post = opts.postOptions;
  const privacyLevel = post.privacyLevel;
  console.log(`[tiktok] 사용할 privacy_level: ${privacyLevel}`);
  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/content/init/", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      post_info: {
        // Photo title 은 최대 90 UTF-16 runes
        title: caption.slice(0, 90),
        // Photo description 은 최대 4000 runes
        description: caption.slice(0, 4000),
        auto_add_music: true,
        // TikTok Photo Post API 필수: 두 brand 토글은 항상 포함해야 함.
        ...tiktokPostInfoBase(post),
      },
      source_info: {
        source: "PULL_FROM_URL",
        photo_images: photoUrls,
        photo_cover_index: 0,
      },
      post_mode: "DIRECT_POST",
      media_type: "PHOTO",
    }),
  });
  const data = (await res.json()) as { data?: { publish_id?: string }; error?: { code?: string; message?: string } };
  console.log(`[tiktok] content/init 응답 (${res.status}):`, JSON.stringify(data));
  if (!data.data?.publish_id || data.error?.code !== "ok") {
    const detail = [
      `httpStatus=${res.status}`,
      `code=${data.error?.code || "?"}`,
      `msg=${data.error?.message || "?"}`,
      `privacyLevel=${privacyLevel}`,
      `postInfo=${JSON.stringify(post)}`,
    ].join(" | ");
    console.log(`[tiktok] content/init 실패: ${detail}`);
    throw tiktokInitError('photo', data.error?.code, detail);
  }
  const publishId = data.data.publish_id;
  // 사진은 TikTok 이 URL 에서 직접 가져간다. publish_id 가 나온 시점에 수락된 것이므로
  // 여기서 기다리지 않는다(위 영상 경로와 같은 이유).
  console.log(`[tiktok] 이미지 발행 수락됨: ${publishId}`);
  return { publishId, status: "processing" as const };
}

// ── Instagram 헬퍼 ─────────────────────────────────────────────────────────

async function waitForIgMedia(
  accessToken: string,
  mediaId: string,
  maxMs = 180000
): Promise<void> {
  const start = Date.now();
  // 첫 폴은 1초 후(이미지는 보통 즉시 FINISHED), 이후엔 5초 간격.
  let nextDelay = 1000;
  while (Date.now() - start < maxMs) {
    const r = await fetch(
      `https://graph.instagram.com/v21.0/${mediaId}?fields=status_code&access_token=${accessToken}`
    );
    const d = (await r.json()) as { status_code?: string };
    if (d.status_code === "FINISHED") return;
    if (d.status_code === "ERROR") throw new Error("Instagram 미디어 처리 실패");
    await new Promise((res) => setTimeout(res, nextDelay));
    nextDelay = 5000;
  }
  throw new Error("Instagram 미디어 처리 시간 초과");
}

async function postInstagramComment(opts: {
  postId: string;
  accessToken: string;
  message: string;
}): Promise<void> {
  const { postId, accessToken, message } = opts;
  const res = await fetch(
    `https://graph.instagram.com/v21.0/${postId}/comments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, access_token: accessToken }),
    }
  );
  const data = (await res.json()) as { id?: string; error?: { message: string } };
  if (!data.id) throw new Error(`첫 댓글 게시 실패: ${data.error?.message}`);
}

/**
 * 게시가 끝난 뒤의 첫 댓글. 실패해도 게시는 이미 올라갔으므로 실패로 돌려주지 않는다(페이스북과 같은 규칙).
 * 예전엔 여기서 던져서 실제로 올라간 릴스·캐러셀이 '발행 실패'로 기록되고 '배포 완료'가 안 떴다(2026-10-20 NEKOBAN EP01).
 * 인스타 로그인 연결에 instagram_business_manage_comments 가 없으면 댓글은 항상 실패한다.
 */
async function tryInstagramFirstComment(postId: string, accessToken: string, firstComment?: string): Promise<{ commentError?: string; note?: string }> {
  const message = String(firstComment || "").trim();
  if (!message) return {};
  try {
    await postInstagramComment({ postId, accessToken, message });
    return {};
  } catch (e) {
    const commentError = /permission|scope|\(#10\)/i.test(String(e instanceof Error ? e.message : e)) ? "instagram_comment_permission_required" : "instagram_first_comment_failed";
    console.log("[instagram publish] first comment failed (post still ok)");
    return { commentError, note: `게시는 됐지만 첫 댓글은 달지 못했어요(${commentError.slice(0, 160)}).` };
  }
}

const INSTAGRAM_THUMB_OFFSET_MS = 1000;

async function publishCarouselToInstagram(opts: {
  igUserId: string;
  accessToken: string;
  items: Array<{ mediaType: "image" | "video"; mediaUrl: string }>;
  caption: string;
}): Promise<{ postId: string }> {
  const { igUserId, accessToken, items, caption } = opts;

  // Step 1: 각 미디어를 개별 Container로 생성 (영상 → VIDEO, 이미지 → IMAGE)
  const containerIds: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    console.log(`[carousel] Step 1/${items.length}: ${item.mediaType} 컨테이너 생성 중 (index ${i})`);

    const containerBody: Record<string, unknown> =
      item.mediaType === "video"
        ? { media_type: "VIDEO", video_url: item.mediaUrl, is_carousel_item: true, thumb_offset: INSTAGRAM_THUMB_OFFSET_MS, access_token: accessToken }
        : { image_url: item.mediaUrl, is_carousel_item: true, access_token: accessToken };

    const cRes = await fetch(
      `https://graph.instagram.com/v21.0/${igUserId}/media`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(containerBody) }
    );
    const cData = (await cRes.json()) as { id?: string; error?: { message: string } };
    if (!cData.id) {
      throw new Error(`[carousel] 컨테이너 생성 실패 (아이템 ${i + 1}/${items.length}, ${item.mediaType}): ${cData.error?.message}`);
    }

    // 카루셀의 모든 자식 컨테이너(영상/이미지)는 CAROUSEL 컨테이너에 묶기 전에
    // 반드시 FINISHED 상태여야 한다. 이미지도 즉시 FINISHED 가 아닐 수 있으므로
    // 명시적으로 대기한다 ("Media ID is not available" 오류 방지).
    console.log(`[carousel] 자식 컨테이너 처리 대기: ${cData.id} (${item.mediaType})`);
    await waitForIgMedia(accessToken, cData.id);
    console.log(`[carousel] 자식 컨테이너 완료: ${cData.id}`);

    containerIds.push(cData.id);
  }

  // Step 2: 생성된 Container ID 배열을 묶어 캐러셀 Container 생성
  console.log(`[carousel] Step 2: 캐러셀 컨테이너 생성 (children: ${containerIds.join(",")})`);
  const carouselRes = await fetch(
    `https://graph.instagram.com/v21.0/${igUserId}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: "CAROUSEL",
        children: containerIds.join(","),
        caption,
        access_token: accessToken,
      }),
    }
  );
  const carouselData = (await carouselRes.json()) as { id?: string; error?: { message: string } };
  if (!carouselData.id) {
    throw new Error(`[carousel] 캐러셀 컨테이너 생성 실패: ${carouselData.error?.message}`);
  }

  // CAROUSEL 컨테이너 자체도 비동기 처리됨 — FINISHED 가 되기 전에 publish 하면
  // "Media ID is not available" 오류가 발생한다. 단일 REELS 와 동일하게 대기.
  console.log(`[carousel] 캐러셀 컨테이너 처리 대기: ${carouselData.id}`);
  await waitForIgMedia(accessToken, carouselData.id);
  console.log(`[carousel] 캐러셀 컨테이너 완료: ${carouselData.id}`);

  // Step 3: 캐러셀 게시
  console.log(`[carousel] Step 3: 캐러셀 게시 (creation_id: ${carouselData.id})`);
  const pRes = await fetch(
    `https://graph.instagram.com/v21.0/${igUserId}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: carouselData.id, access_token: accessToken }),
    }
  );
  const pData = (await pRes.json()) as { id?: string; error?: { message: string } };
  if (!pData.id) throw new Error(`[carousel] 캐러셀 게시 실패: ${pData.error?.message}`);

  return { postId: pData.id };
}

async function publishToInstagram(opts: {
  igUserId: string;
  accessToken: string;
  mediaType: "image" | "video";
  mediaUrl: string;
  caption: string;
}): Promise<{ postId: string }> {
  const { igUserId, accessToken, mediaType, mediaUrl, caption } = opts;

  const containerBody: Record<string, unknown> =
    mediaType === "video"
      ? {
          media_type: "REELS",
          video_url: mediaUrl,
          caption,
          share_to_feed: true,
          thumb_offset: INSTAGRAM_THUMB_OFFSET_MS,
          access_token: accessToken,
        }
      : {
          image_url: mediaUrl,
          caption,
          access_token: accessToken,
        };

  const cRes = await fetch(
    `https://graph.instagram.com/v21.0/${igUserId}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(containerBody),
    }
  );
  const cData = (await cRes.json()) as { id?: string; error?: { message: string } };
  if (!cData.id) throw new Error(`컨테이너 생성 실패: ${cData.error?.message}`);

  if (mediaType === "video") await waitForIgMedia(accessToken, cData.id);

  const pRes = await fetch(
    `https://graph.instagram.com/v21.0/${igUserId}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: cData.id, access_token: accessToken }),
    }
  );
  const pData = (await pRes.json()) as { id?: string; error?: { message: string } };
  if (!pData.id) throw new Error(`게시 실패: ${pData.error?.message}`);

  return { postId: pData.id };
}

// ── Facebook 헬퍼 ───────────────────────────────────────────────────────────

async function publishPhotoToFacebook(opts: {
  pageId: string;
  pageToken: string;
  mediaUrl: string;
  caption: string;
  linkUrl?: string;
}): Promise<{ postId: string }> {
  const { pageId, pageToken, mediaUrl, caption, linkUrl } = opts;
  const body: Record<string, unknown> = {
    url: mediaUrl,
    message: caption,
    access_token: pageToken,
  };
  if (linkUrl) body.link = linkUrl;
  const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { post_id?: string; id?: string; error?: { message: string } };
  const postId = data.post_id || data.id;
  if (!postId) throw new Error(`Facebook 이미지 게시 실패: ${data.error?.message}`);
  return { postId };
}

async function publishVideoToFacebook(opts: {
  pageId: string;
  pageToken: string;
  mediaUrl: string;
  caption: string;
  linkUrl?: string;
}): Promise<{ postId: string }> {
  const { pageId, pageToken, mediaUrl, caption, linkUrl } = opts;
  // /videos 엔드포인트는 link 파라미터를 받지 않으므로 description 끝에 링크를 첨부한다.
  const description = linkUrl ? `${caption}\n\n${linkUrl}` : caption;
  const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_url: mediaUrl, description, access_token: pageToken }),
  });
  const data = (await res.json()) as { id?: string; error?: { message: string } };
  if (!data.id) throw new Error(`Facebook 동영상 게시 실패: ${data.error?.message}`);
  return { postId: data.id };
}

async function publishCarouselToFacebook(opts: {
  pageId: string;
  pageToken: string;
  imageUrls: string[];
  caption: string;
  linkUrl?: string;
}): Promise<{ postId: string }> {
  const { pageId, pageToken, imageUrls, caption, linkUrl } = opts;

  // Step 1: 각 이미지를 미발행(unpublished) 상태로 업로드
  const mediaFbids: string[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const r = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: imageUrls[i], published: false, access_token: pageToken }),
    });
    const d = (await r.json()) as { id?: string; error?: { message: string } };
    if (!d.id) throw new Error(`Facebook 캐러셀 이미지 ${i + 1} 업로드 실패: ${d.error?.message}`);
    mediaFbids.push(d.id);
  }

  // Step 2: feed 포스트로 묶어서 게시
  const attached = mediaFbids.map((fbid) => ({ media_fbid: fbid }));
  const feedBody: Record<string, unknown> = {
    message: caption,
    attached_media: attached,
    access_token: pageToken,
  };
  if (linkUrl) feedBody.link = linkUrl;
  const feedRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(feedBody),
  });
  const feedData = (await feedRes.json()) as { id?: string; error?: { message: string } };
  if (!feedData.id) throw new Error(`Facebook 캐러셀 게시 실패: ${feedData.error?.message}`);
  return { postId: feedData.id };
}

async function postFacebookComment(opts: {
  postId: string;
  pageToken: string;
  message: string;
}): Promise<void> {
  const { postId, pageToken, message } = opts;
  console.log(`[postFacebookComment] target post:`, postId, "message length:", message.length);
  const res = await fetch(`https://graph.facebook.com/v21.0/${postId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, access_token: pageToken }),
  });
  const rawText = await res.text();
  console.log(`[postFacebookComment] HTTP ${res.status} response:`, rawText);
  let data: { id?: string; error?: { message?: string; type?: string; code?: number } } = {};
  try { data = JSON.parse(rawText); } catch { /* keep empty */ }
  if (!data.id) {
    const err = data.error || {};
    throw new Error(`Facebook 첫 댓글 게시 실패: status=${res.status} code=${err.code || "?"} type=${err.type || "?"} message=${err.message || rawText.slice(0, 200)}`);
  }
}

/**
 * 올린 영상을 이름이 같은 내 재생목록에 넣는다(없으면 만든다). 성공이면 "", 실패면 안내 문장.
 * 목록 조회는 youtube.readonly 로 되지만 만들기·넣기는 youtube 권한이 있어야 한다 —
 * 그 권한 없이 연결된 계정은 403 이 오고, 다시 연결하면 된다.
 */
async function addVideoToYouTubePlaylist(accessToken: string, videoId: string, title: string, privacyStatus: "public" | "private"): Promise<string> {
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" };
  const failNote = async (res: Response, step: string) => {
    const text = await res.text().catch(() => "");
    if (res.status === 403 && /insufficient|scope|permission/i.test(text)) {
      return `재생목록 "${title}" 에는 넣지 못했어요 — YouTube 연결에 재생목록 권한이 없어요. SNS 설정에서 YouTube 를 다시 연결해 주세요.`;
    }
    return `재생목록 "${title}" ${step}에 실패했어요(${res.status} ${text.slice(0, 120)}).`;
  };
  try {
    const want = title.trim().toLowerCase();
    let playlistId = "";
    let pageToken = "";
    for (let page = 0; page < 4 && !playlistId; page++) {
      const q = new URLSearchParams({ part: "snippet", mine: "true", maxResults: "50", ...(pageToken ? { pageToken } : {}) });
      const res = await fetch(`https://www.googleapis.com/youtube/v3/playlists?${q}`, { headers });
      if (!res.ok) return await failNote(res, "찾기");
      const data = (await res.json()) as { items?: Array<{ id?: string; snippet?: { title?: string } }>; nextPageToken?: string };
      playlistId = String((data.items || []).find((p) => String(p.snippet?.title || "").trim().toLowerCase() === want)?.id || "");
      pageToken = String(data.nextPageToken || "");
      if (!pageToken) break;
    }
    if (!playlistId) {
      const res = await fetch("https://www.googleapis.com/youtube/v3/playlists?part=snippet,status", {
        method: "POST", headers,
        body: JSON.stringify({ snippet: { title: title.slice(0, 150) }, status: { privacyStatus } }),
      });
      if (!res.ok) return await failNote(res, "만들기");
      playlistId = String(((await res.json()) as { id?: string }).id || "");
      if (!playlistId) return `재생목록 "${title}" 을 만들었지만 번호를 받지 못해 영상을 넣지 못했어요.`;
    }
    const res = await fetch("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet", {
      method: "POST", headers,
      body: JSON.stringify({ snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } }),
    });
    if (!res.ok) return await failNote(res, "넣기");
    return "";
  } catch (e) {
    return `재생목록 "${title}" 에 넣지 못했어요(${e instanceof Error ? e.message : String(e)}).`;
  }
}

// ── Threads(메타) 헬퍼 ─────────────────────────────────────────────────────

const THREADS_API = "https://graph.threads.com/v1.0";

/**
 * Threads API 응답을 안전하게 읽는다. 메타는 일시 오류(5xx) 때 본문을 아예 비워서 보내는 일이 있어
 * res.json() 을 바로 부르면 "Unexpected end of JSON input" 으로 터지고 원인(HTTP 상태)이 사라졌다(2026-09-24).
 * 비었거나 JSON 이 아니면 { __empty: true } 와 상태·원문 앞부분을 돌려주고, 호출자가 재시도/오류 문구를 정한다.
 */
async function readThreadsJson(res: Response, what: string): Promise<any> {
  const text = await res.text();
  try {
    const parsed = text ? JSON.parse(text) : null;
    if (parsed && typeof parsed === "object") return parsed;
  } catch { /* 아래에서 처리 */ }
  console.log(`[threads] ${what}: HTTP ${res.status} non-JSON response`);
  return { __empty: true, __status: res.status, __raw: text.slice(0, 200) };
}
/** 메타 일시 오류(빈 응답·5xx·"please retry") 인지 — 재시도 대상 */
function isThreadsTransient(data: any, status: number): boolean {
  if (data?.__empty) return true;
  if (status >= 500) return true;
  const msg = String(data?.error?.message || "");
  return /unexpected error|please retry|temporarily|try again later|rate ?limit|reduce the amount|internal/i.test(msg);
}
/**
 * 컨테이너 생성이 빈 500 으로 끝났을 때(2026-09-24: 영상·캐러셀 모두 같은 증상) 원인을 가르는 진단.
 * 메타는 토큰·계정·미디어 어느 쪽이 문제여도 같은 빈 500 을 내므로, 실패 순간에
 *  (1) 이 토큰으로 계정 조회(/me)가 되는지 → 토큰·계정·API 경로 문제인지
 *  (2) 우리가 준 미디어 주소를 외부에서 실제로 받을 수 있는지(HTTP 상태·형식·크기) → 미디어 문제인지
 * 를 확인해 오류 문구에 붙인다. 스레드는 이미지 JPEG/PNG·영상 MP4/MOV 만 받는다.
 */
async function diagnoseThreadsFailure(accessToken: string, params: Record<string, string>): Promise<string> {
  const parts: string[] = [];
  try {
    const meRes = await fetch(`${THREADS_API}/me?${new URLSearchParams({ fields: "id,username", access_token: accessToken }).toString()}`);
    const me = await readThreadsJson(meRes, "진단 /me");
    parts.push(me.id ? `계정 조회 OK(@${me.username || me.id})` : `계정 조회 실패 HTTP ${meRes.status}${me.error?.message ? `: ${me.error.message}` : (me.__empty ? " 빈 응답" : "")}`);
  } catch (e) { parts.push(`계정 조회 예외: ${e instanceof Error ? e.message : String(e)}`); }
  // 미디어가 없는 요청(캐러셀 상위·텍스트)은 본문·설정이 원인 후보라 그 정보를 남긴다.
  const shape: string[] = [];
  if (params.media_type) shape.push(`종류 ${params.media_type}`);
  if (typeof params.text === "string") shape.push(`본문 ${Array.from(params.text).length}자`);
  if (params.reply_control) shape.push(`답글설정 ${params.reply_control}`);
  if (params.children) shape.push(`자식 ${params.children.split(",").filter(Boolean).length}개`);
  if (shape.length) parts.push(shape.join("/"));
  const mediaUrl = params.image_url || params.video_url || "";
  if (mediaUrl) {
    try {
      let r = await fetch(mediaUrl, { method: "HEAD" });
      if (!r.ok) r = await fetch(mediaUrl, { headers: { Range: "bytes=0-0" } });
      const type = r.headers.get("content-type") || "?";
      const len = Number(r.headers.get("content-length") || 0);
      const size = len ? `${(len / 1024 / 1024).toFixed(1)}MB` : "크기 미상";
      const okType = params.image_url ? /^image\/(jpeg|jpg|png)/i.test(type) : /^video\/(mp4|quicktime)/i.test(type);
      parts.push(`미디어 ${r.ok ? "받기 OK" : `받기 실패 HTTP ${r.status}`} ${type} ${size}${r.ok && !okType ? " ← 스레드가 받지 않는 형식(이미지는 JPEG/PNG, 영상은 MP4/MOV)" : ""}`);
    } catch (e) { parts.push(`미디어 확인 예외: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return parts.join(" · ");
}
/**
 * Threads 본문 정리. 코드포인트 단위로 자르고(이모지 반쪽 방지), 홀로 남은 서로게이트·제어문자(개행 제외)를 뺀다.
 * strict 면 변형 선택자·제로폭 문자·특수 공백까지 걷어낸다(메타가 빈 500 을 낼 때의 2차 시도용).
 */
function sanitizeThreadsText(input: string, maxChars: number, strict = false): string {
  const chars = Array.from(String(input || ""));
  const kept = chars.filter((ch) => {
    const code = ch.codePointAt(0) || 0;
    if (code >= 0xd800 && code <= 0xdfff) return false;               // 홀로 남은 서로게이트
    if (code < 0x20 && ch !== "\n") return false;                     // 제어문자(개행 제외)
    if (code === 0x7f) return false;
    if (strict && (code === 0xfe0f || code === 0xfe0e)) return false;  // 변형 선택자
    if (strict && (code === 0x200b || code === 0x200c || code === 0x200d || code === 0xfeff)) return false; // 제로폭
    if (strict && code === 0x2028) return false;
    return true;
  });
  return kept.slice(0, maxChars).join("").replace(/\n{3,}/g, "\n\n").trim();
}
function threadsErrorText(data: any, status: number): string {
  if (data?.__empty) return `메타 서버가 HTTP ${status} 로 빈 응답을 보냈어요(일시 오류일 수 있어요 — 잠시 후 다시 발행해 주세요)${data.__raw ? `: ${data.__raw}` : ""}`;
  return String(data?.error?.message || status);
}

/**
 * Threads 미디어 컨테이너 생성. media_type 에 따라 image_url/video_url/children 을 받는다.
 * 캐러셀 자식은 is_carousel_item=true 로 만든다. creation id 를 반환.
 */
async function createThreadsContainer(opts: {
  threadsUserId: string;
  accessToken: string;
  params: Record<string, string>;
}): Promise<string> {
  const { threadsUserId, accessToken, params } = opts;
  const body = new URLSearchParams({ ...params, access_token: accessToken });
  // 영상 컨테이너는 메타가 일시 오류(빈 응답/5xx)를 자주 낸다 → 3회까지 재시도. 영구 오류는 즉시 실패.
  let lastText = "";
  let opaque = false;
  let metaCode = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${THREADS_API}/${threadsUserId}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = await readThreadsJson(res, `컨테이너 생성(${params.media_type || "?"})`);
    if (data.id) return String(data.id);
    lastText = threadsErrorText(data, res.status);
    opaque = !!data.__empty;
    metaCode = Number(data?.error?.code) || 0;
    if (!isThreadsTransient(data, res.status)) break;
  }
  // 빈 응답이면 메타가 원인을 안 알려준 것 — 토큰/계정/미디어 중 어디가 문제인지 우리가 직접 가른다.
  const diag = opaque ? await diagnoseThreadsFailure(accessToken, params) : "";
  const err = new Error(`Threads 컨테이너 생성 실패: ${lastText}${diag ? ` [진단] ${diag}` : ""}`);
  // 메타 오류 코드(10 = 앱 권한 없음). 상위 컨테이너 사다리가 답글 설정 권한 문제를 가른다.
  (err as any).metaCode = metaCode;
  (err as any).opaque = opaque;
  throw err;
}

/**
 * 컨테이너가 게시 가능(FINISHED) 상태가 될 때까지 대기.
 * 영상/캐러셀은 비동기 처리되므로 publish 전에 반드시 FINISHED 여야 한다.
 */
async function waitForThreadsContainer(
  accessToken: string,
  containerId: string,
  maxMs = 180000
): Promise<void> {
  const start = Date.now();
  let nextDelay = 2000;
  while (Date.now() - start < maxMs) {
    const r = await fetch(
      `${THREADS_API}/${containerId}?` +
      new URLSearchParams({ fields: "status,error_message", access_token: accessToken }).toString()
    );
    const d = await readThreadsJson(r, "컨테이너 상태 조회");
    if (d.status === "FINISHED") return;
    if (d.__empty && r.status < 500 && r.status !== 200) {
      // 4xx 인데 본문이 없으면 계속 물어봐도 답이 없다 — 상태와 함께 바로 실패
      throw new Error(`Threads 미디어 상태 조회 실패: ${threadsErrorText(d, r.status)}`);
    }
    if (d.status === "ERROR" || d.status === "EXPIRED") {
      throw new Error(`Threads 미디어 처리 실패: ${d.error_message || d.status}`);
    }
    await new Promise((res) => setTimeout(res, nextDelay));
    nextDelay = 5000;
  }
  throw new Error("Threads 미디어 처리 시간 초과");
}

async function publishThreadsContainer(opts: {
  threadsUserId: string;
  accessToken: string;
  creationId: string;
}): Promise<{ postId: string }> {
  const { threadsUserId, accessToken, creationId } = opts;
  const url = `${THREADS_API}/${threadsUserId}/threads_publish`;
  const bodyStr = new URLSearchParams({ creation_id: creationId, access_token: accessToken }).toString();
  // Meta 의 "An unexpected error has occurred. Please retry your request later." 는 일시적 서버 오류로,
  // 실제로는 게시가 처리됐는데 응답만 에러로 오는 경우가 있다(글은 올라갔는데 실패로 표시되는 원인).
  // creation_id 는 1회만 게시 가능하므로 같은 id 재시도는 중복 게시를 만들지 않는다 →
  // 일시 오류면 재시도하고, "이미 게시됨" 응답이면 성공으로 간주한다.
  let lastMsg = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: bodyStr,
      });
    } catch (e) {
      lastMsg = e instanceof Error ? e.message : String(e);
      continue;
    }
    const data = await readThreadsJson(res, "게시(threads_publish)");
    if (data.id) return { postId: String(data.id) };
    lastMsg = threadsErrorText(data, res.status);
    if (data.__empty) continue; // 빈 응답 = 일시 오류로 보고 재시도(같은 creation_id 라 중복 게시 없음)
    // 이미 게시된 컨테이너 → 게시 성공으로 간주 (직전 시도가 서버측에서 성공한 경우)
    if (/already.*publish|has already been published|already exists/i.test(lastMsg)) {
      return { postId: "" };
    }
    // 일시적 오류가 아니면(영구 오류) 즉시 실패. 일시 오류면 루프가 재시도.
    if (!/unexpected error|please retry|temporarily|try again later|rate ?limit|reduce the amount|internal/i.test(lastMsg)) {
      throw new Error(`Threads 게시 실패: ${lastMsg}`);
    }
  }
  throw new Error(`Threads 게시 실패: ${lastMsg}`);
}

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);

  let body: {
    platform: string;
    caption: string;
    scheduledAt?: string;
    firstComment?: string;
    // 단일 포스트
    mediaType?: "image" | "video";
    mediaGcsPath?: string;
    mediaDirectUrl?: string;
    // 캐러셀
    mediaItems?: Array<{ mediaType: "image" | "video"; gcsPath?: string; mediaUrl?: string }>;
    // YouTube 전용
    title?: string;
    tags?: string[];
    // 'scheduled' 는 publishAt 과 짝지어 보낸다 (백엔드가 private + publishAt 으로 변환).
    privacyStatus?: "public" | "private" | "unlisted" | "scheduled";
    publishAt?: string;
    // UI 카테고리 키 (entertainment/education/gaming/music/etc) → 백엔드가 YouTube categoryId 로 매핑.
    categoryKey?: string;
    isShorts?: boolean;
    // 영어 제목 — 본제목(한국어)의 번역 칸(localizations.en)에 넣는다.
    titleEn?: string;
    // 넣을 재생목록 이름. 내 채널에 같은 이름이 없으면 만든다.
    playlist?: string;
    // '변경된 콘텐츠(합성 미디어)' 표시. 값을 줬을 때만 보낸다(true/false).
    alteredContent?: boolean;
    // 공유받은 프로젝트를 소유자 자격증명으로 게시할 때 사용
    projectId?: string;
    ownerId?: string;
    // X · Threads 답글 허용 범위. UI 값(public|followers|mentioned)을 그대로 받아
    // 플랫폼별 어휘로 매핑한다.
    replySetting?: string;
    // TikTok Direct Post 전용 — 게시 전 확인 모달이 확정한 설정.
    // 서버는 여기에 묵시적 기본값을 채우지 않는다(누락 시 400).
    // 명세: docs/tiktok_direct_post_modal_spec_20260801.md §4-1
    tiktok?: {
      privacyLevel?: string;
      allowComment?: boolean;
      allowDuet?: boolean;
      allowStitch?: boolean;
      commercialContent?: boolean;
      brandOrganic?: boolean;
      brandedContent?: boolean;
      consentAcknowledged?: boolean;
      // 영상 길이 상한 검증용 (creator_info 의 max_video_post_duration_sec 와 대조)
      videoDurationSec?: number;
    };
  };
  try {
    body = await request.json();
  } catch {
    return send({ error: "Invalid JSON" }, 400);
  }

  const { platform, caption, firstComment } = body;
  let usedMetaToken = "";
  const isCarousel = Array.isArray(body.mediaItems) && body.mediaItems.length > 0;

  if (!platform || caption === undefined) {
    return send({ error: "필수 필드 누락: platform, caption" }, 400);
  }

  // 게시에 사용할 자격증명 소유자 결정. 기본은 요청자 본인.
  // 공유받은 프로젝트(ownerId≠본인)면 editor 권한이 있어야 소유자 자격증명으로 게시한다.
  let publishUserId = auth.userId;
  const reqOwnerId = sanitizeUserId(body.ownerId || "");
  const reqProjectId = String(body.projectId || "").trim();
  if (reqOwnerId && reqOwnerId !== auth.userId) {
    if (!reqProjectId) return send({ error: "projectId required for shared publish" }, 400);
    const sharesReg = await loadShares(env);
    const role = getGrantRole(sharesReg, reqOwnerId, reqProjectId, auth.userId);
    if (role !== "editor") return send({ error: "forbidden: editor role required to publish" }, 403);
    publishUserId = reqOwnerId;
  }
  // 서명해 넘길 GCS 경로는 요청자 본인 루트(공유 게시면 소유자 루트까지)만 허용한다.
  // 예약 게시도 여기서 걸러 대기열에 남의 경로가 들어가지 않게 한다(실행 때 이 검사를 다시 거친다).
  const mediaScope = { ...publishMediaLocation(env), requesterId: auth.userId, publishUserId };
  const mediaCheck = authorizePublishMediaPaths(body, mediaScope);
  if (!mediaCheck.ok) {
    return send({ error: MEDIA_PATH_FORBIDDEN, code: MEDIA_PATH_FORBIDDEN, field: mediaCheck.field }, 400);
  }
  // Threads·X·디스코드는 텍스트 전용 게시를 허용하므로 미디어 필수 가드에서 제외한다.
  if (!isCarousel && !body.mediaType && !body.mediaGcsPath && !body.mediaDirectUrl && platform !== "threads" && platform !== "x" && platform !== "discord") {
    return send({ error: "단일 포스트에는 mediaType, mediaGcsPath 또는 mediaDirectUrl이 필요합니다." }, 400);
  }

  // 디스코드 본문은 2000자까지다. 잘라서 올리지 않고(뜻이 끊긴다) 예약 전에도 바로 알린다.
  if (platform === "discord" && String(caption || "").length > DISCORD_CONTENT_LIMIT) {
    return send({ ok: false, code: "discord_content_too_long", limit: DISCORD_CONTENT_LIMIT, length: String(caption || "").length,
      error: `디스코드 본문은 ${DISCORD_CONTENT_LIMIT}자까지입니다(현재 ${String(caption || "").length}자). 줄인 뒤 다시 배포해 주세요.` }, 400);
  }

  // 예약 시각이 미래면 지금 게시하지 않고 대기열에 넣는다(Instagram·Facebook·Threads·X).
  // 예전엔 이 채널들의 예약 시각을 무시하고 바로 게시했다. 정기 실행이 그 시각에 이 엔드포인트로 다시 보낸다.
  const queuedAt = readQueuedSchedule(platform, body);
  if (typeof queuedAt === "object") return send({ error: queuedAt.error, code: queuedAt.error }, 400);
  if (queuedAt) {
    try {
      const job = await enqueueScheduledPost(env, auth.userId, platform, queuedAt, body);
      return send({ ok: true, scheduled: true, scheduledJobId: job.id,
        result: { status: "scheduled", scheduledFor: job.runAt, scheduledJobId: job.id, postId: "", url: "" } });
    } catch (e: any) {
      return send({ error: "schedule_unavailable", code: "schedule_unavailable", detail: String(e?.message || e) }, 503);
    }
  }

  try {
    const googleToken = await getGoogleAccessToken({
      clientEmail: env.GOOGLE_CLIENT_EMAIL,
      privateKeyPem: env.GOOGLE_PRIVATE_KEY,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });

    const outParsed = parseGcsUri(env.VIDEO_OUTPUT_GCS_URI);
    const bucket = outParsed.bucket;

    if (platform === "tiktok") {
      // TikTok 토큰을 GCS 사용자 설정에서 로드
      const basePrefix = outParsed.object.replace(/\/$/, "");
      const objectName = buildUserDataObject(basePrefix, publishUserId, "sns-settings.json");
      console.log("[sns/publish] tiktok: bucket:", bucket, "objectName:", objectName, "userId:", publishUserId);
      const settings = await loadSnsSettings(bucket, objectName, googleToken);
      const tiktokSettings = settings?.sns?.tiktok;
      console.log("[sns/publish] tiktokSettings found:", !!tiktokSettings, "connected:", tiktokSettings?.connected, "hasToken:", !!tiktokSettings?.accessToken);
      if (!tiktokSettings?.connected || !tiktokSettings?.accessToken) {
        return send({ error: "TikTok 계정이 연결되지 않았습니다. SNS 설정에서 먼저 연결해 주세요." }, 400);
      }

      let accessToken: string = tiktokSettings.accessToken;

      // 만료 5분 전 자동 갱신
      const expiresAt = tiktokSettings.tokenExpiresAt ? new Date(tiktokSettings.tokenExpiresAt).getTime() : 0;
      if (expiresAt && Date.now() > expiresAt - 5 * 60 * 1000) {
        if (!tiktokSettings.refreshToken) {
          return send({ error: "TikTok 액세스 토큰이 만료되었습니다. SNS 설정에서 재연결해 주세요." }, 400);
        }
        console.log(`[tiktok] 액세스 토큰 만료 임박, 갱신 중...`);
        const refreshed = await refreshTikTokToken({
          refreshToken: tiktokSettings.refreshToken,
          clientKey: env.TIKTOK_CLIENT_KEY,
          clientSecret: env.TIKTOK_CLIENT_SECRET,
        });
        accessToken = refreshed.accessToken;
        await saveTikTokTokenPatch({
          bucket,
          objectName,
          googleToken,
          patch: {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            tokenExpiresAt: refreshed.tokenExpiresAt,
            refreshExpiresAt: refreshed.refreshExpiresAt,
          },
        });
        console.log(`[tiktok] 토큰 갱신 완료`);
      }

      // ── 확인 모달이 확정한 게시 설정 검증 ────────────────────────────────
      // 명세: docs/tiktok_direct_post_modal_spec_20260801.md §4
      // 서버가 묵시적 기본값을 채우면 그 자체가 Direct Post 가이드라인 위반이다.
      // 옛 클라이언트가 확인 화면 없이 게시하는 경로도 여기서 원천 차단된다.
      const tt = (body.tiktok || {}) as Record<string, any>;

      if (tt.consentAcknowledged !== true) {
        return send({
          error: "The TikTok confirmation dialog must be completed before posting.",
          code: "consent_required",
        }, 400);
      }

      const requestedPrivacy = String(tt.privacyLevel || "").trim().toUpperCase();
      if (!requestedPrivacy) {
        return send({
          error: "Choose who can view this post in the TikTok confirmation dialog.",
          code: "privacy_level_required",
        }, 400);
      }
      if (!isValidPrivacyLevel(requestedPrivacy)) {
        return send({ error: `Unknown privacy level: ${requestedPrivacy}`, code: "privacy_level_not_allowed" }, 400);
      }

      const brandedContent = tt.brandedContent === true;
      const brandOrganic = tt.brandOrganic === true;
      if (tt.commercialContent === true && !brandedContent && !brandOrganic) {
        return send({
          error: "Select 'Your brand' and/or 'Branded content' for the commercial content disclosure.",
          code: "commercial_disclosure_incomplete",
        }, 400);
      }
      // TikTok 규칙: 브랜디드 콘텐츠는 비공개로 올릴 수 없다.
      if (brandedContent && requestedPrivacy === "SELF_ONLY") {
        return send({
          error: "Branded content visibility cannot be set to private.",
          code: "branded_content_cannot_be_private",
        }, 400);
      }

      // creator_info 는 여기서 딱 한 번 조회해 (a) 허용 공개범위 검증 (b) 영상 길이 상한
      // (c) 크리에이터가 꺼둔 상호작용 강제 반영에 함께 쓴다.
      let creatorInfoData: any = {};
      try {
        creatorInfoData = (await queryTikTokCreatorInfo(accessToken)).data;
      } catch (err) {
        return send({
          error: "creator_info_unavailable",
          code: "creator_info_unavailable",
          detail: err instanceof Error ? err.message : String(err),
        }, 502);
      }
      const allowedOptions: string[] = Array.isArray(creatorInfoData?.privacy_level_options)
        ? creatorInfoData.privacy_level_options.map((v: any) => String(v))
        : [];
      if (allowedOptions.length && allowedOptions.indexOf(requestedPrivacy) === -1) {
        return send({
          error: `Privacy level ${requestedPrivacy} is not available for this TikTok account.`,
          code: "privacy_level_not_allowed",
        }, 400);
      }

      const maxDurationSec = Number(creatorInfoData?.max_video_post_duration_sec || 0);
      const requestedDurationSec = Number(tt.videoDurationSec || 0);
      if (maxDurationSec > 0 && requestedDurationSec > maxDurationSec) {
        return send({
          error: `This video is longer than your TikTok limit of ${maxDurationSec} seconds.`,
          code: "video_too_long",
        }, 400);
      }

      // TikTok 앱 심사 통과 여부. 미심사 앱은 SELF_ONLY 게시만 가능.
      // 심사 통과 후 Cloudflare 환경변수 TIKTOK_APP_AUDITED="true" 설정 시 공개 게시 허용.
      const appAudited = isTikTokAppAudited(env);
      const resolvedPrivacy = resolveTikTokPrivacyLevel(requestedPrivacy, appAudited);
      // 미심사 상태에서 SELF_ONLY 로 강등되면 브랜디드 콘텐츠는 게시 자체가 불가능하다.
      // TikTok 이 거부하기 전에 사유를 명확히 돌려준다.
      if (brandedContent && resolvedPrivacy.level === "SELF_ONLY") {
        return send({
          error: "Branded content visibility cannot be set to private. This app is awaiting TikTok's review, so posts are forced to private for now.",
          code: "branded_content_cannot_be_private",
        }, 400);
      }

      // disable_* 는 사용자가 체크한 값의 반전이다. 크리에이터가 계정에서 꺼둔 항목은
      // 사용자가 무엇을 골랐든 강제로 비활성(=disable true)으로 보낸다.
      const postOptions = {
        privacyLevel: resolvedPrivacy.level,
        disableComment: !(tt.allowComment === true) || !!creatorInfoData?.comment_disabled,
        disableDuet: !(tt.allowDuet === true) || !!creatorInfoData?.duet_disabled,
        disableStitch: !(tt.allowStitch === true) || !!creatorInfoData?.stitch_disabled,
        brandContentToggle: brandedContent,
        brandOrganicToggle: brandOrganic,
      };

      // Photo PULL_FROM_URL 의 도메인 ownership 검증을 위해 우리 도메인 프록시 사용.
      const origin = new URL(request.url).origin;
      const mediaSecret = readMediaSecret(env);

      const publishResults: {
        publishId: string;
        type: string;
        status: "complete" | "processing" | "failed";
        failReason?: string;
        // 발행 완료 시 status/fetch 가 돌려주는 실제 게시물 id (링크 생성용)
        postId?: string;
      }[] = [];

      if (isCarousel) {
        const rawItems = body.mediaItems!;
        const videos = rawItems.filter((i) => i.mediaType === "video");
        const images = rawItems.filter((i) => i.mediaType === "image");

        // Case 3: 영상 먼저 발행
        for (let i = 0; i < videos.length; i++) {
          const v = videos[i];
          const videoUrl = v.gcsPath
            ? await buildSignedUrl(bucket, v.gcsPath, env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY, 3600)
            : v.mediaUrl!;
          console.log(`[tiktok] 영상 ${i + 1}/${videos.length} 발행 중`);
          const r = await publishTikTokVideo({ accessToken, caption, videoUrl, postOptions });
          publishResults.push({ publishId: r.publishId, type: "video", status: r.status, failReason: r.failReason, postId: r.postId });
        }

        // Case 3: 이미지 별도 발행 (슬라이드쇼)
        if (images.length > 0) {
          const photoUrls: string[] = [];
          for (const img of images) {
            // gcsPath 가 있으면 우리 도메인 프록시(ownership 검증 통과)로 제공.
            // mediaUrl 만 있는 경우는 도메인 인증이 안 돼 실패할 수 있음.
            const url = img.gcsPath
              ? await buildTikTokProxyUrl(origin, img.gcsPath, mediaSecret)
              : img.mediaUrl!;
            photoUrls.push(url);
          }
          console.log(`[tiktok] 이미지 ${images.length}장 포토 모드 발행 중`);
          const r = await publishTikTokPhoto({ accessToken, caption, photoUrls, postOptions });
          publishResults.push({ publishId: r.publishId, type: "photo", status: r.status, failReason: r.failReason, postId: r.postId });
        }

      } else {
        const mediaType = body.mediaType!;

        if (mediaType === "video") {
          // Case 1: 영상만 — FILE_UPLOAD 방식이라 서버가 직접 다운로드하므로 GCS signed URL 사용
          let videoUrl: string;
          if (body.mediaGcsPath) {
            videoUrl = await buildSignedUrl(bucket, body.mediaGcsPath, env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY, 3600);
          } else if (body.mediaDirectUrl) {
            videoUrl = body.mediaDirectUrl;
          } else {
            return send({ error: "mediaGcsPath 또는 mediaDirectUrl 중 하나가 필요합니다." }, 400);
          }
          const r = await publishTikTokVideo({ accessToken, caption, videoUrl, postOptions });
          publishResults.push({ publishId: r.publishId, type: "video", status: r.status, failReason: r.failReason, postId: r.postId });
        } else {
          // Case 2: 이미지만 (단일) — PULL_FROM_URL 이라 ownership 검증된 우리 도메인 프록시 사용
          let photoUrl: string;
          if (body.mediaGcsPath) {
            photoUrl = await buildTikTokProxyUrl(origin, body.mediaGcsPath, mediaSecret);
          } else if (body.mediaDirectUrl) {
            photoUrl = body.mediaDirectUrl;
          } else {
            return send({ error: "mediaGcsPath 또는 mediaDirectUrl 중 하나가 필요합니다." }, 400);
          }
          const r = await publishTikTokPhoto({ accessToken, caption, photoUrls: [photoUrl], postOptions });
          publishResults.push({ publishId: r.publishId, type: "photo", status: r.status, failReason: r.failReason, postId: r.postId });
        }
      }

      // 아무것도 발행하지 않았는데 성공으로 응답하면 안 된다. 화면은 publish_id 로
      // 완료를 확인하는데, 그게 없으면 "확인할 수 없음"에 갇혀 원인을 영영 모른다.
      if (!publishResults.length) {
        const kinds = (body.mediaItems || []).map((i) => String(i.mediaType || "?")).join(",");
        console.log(`[tiktok] 발행 대상이 없다: isCarousel=${isCarousel} mediaType=${body.mediaType || "?"} items=[${kinds}]`);
        return send(
          {
            ok: false,
            error: "게시할 미디어를 찾지 못했습니다. 자산 선택을 확인해 주세요.",
            code: "tiktok_no_media_resolved",
            detail: `isCarousel=${isCarousel} mediaType=${body.mediaType || "?"} items=[${kinds}]`,
          },
          400
        );
      }

      // publish_id 가 발급된 시점에 TikTok 은 발행을 수락한 상태이므로 항상 ok:true.
      // status 폴링 결과는 정보성: 전부 complete → published, 하나라도 failed →
      // status_reported_failed(이 세션에서 FAILED 여도 실제 게시 성공 사례 반복 확인됨),
      // 그 외 → processing. fail_reason 은 publishResults 에 그대로 노출된다.
      const anyFailed = publishResults.some((r) => r.status === "failed");
      const failReasons = publishResults
        .filter((r) => r.status === "failed" && r.failReason)
        .map((r) => `${r.type}:${r.failReason}`);
      // 게시물 URL 은 여기서 만들지 않는다. 실제 게시물 id 는 TikTok 이 처리를 끝낸 뒤에야
      // 나오는데, 그걸 기다리면 요청이 실행 제한을 넘긴다. 클라이언트가
      // /api/sns/tiktok/publish-status 로 확인해 링크를 만든다.
      // 게시물 URL 에 필요한 진짜 @handle 은 방금 조회한 creator_info 값을 함께 내려준다
      // (저장된 username 필드에는 display_name 이 들어있어 그대로 쓰면 링크가 깨진다).
      const tiktokUsername = String(
        creatorInfoData?.creator_username || tiktokSettings.username || ""
      ).replace(/^@/, "");
      return send({
        ok: true,
        result: {
          platform: "tiktok",
          postId: publishResults[0]?.publishId,
          // 상태 조회에 쓸 publish_id 목록과 핸들
          publishIds: publishResults.map((r) => r.publishId).filter(Boolean),
          handle: tiktokUsername || undefined,
          username: tiktokSettings.username || "",
          // TikTok 이 발행을 수락한 상태. 완료 여부는 별도 조회로 확인한다.
          status: anyFailed ? "status_reported_failed" : "processing",
          failReasons: failReasons.length ? failReasons : undefined,
          publishedAt: new Date().toISOString(),
          // 사용자가 고른 공개 범위와 실제 적용된 값. 강등됐다면 사유를 함께 노출해
          // "왜 나만 볼 수 있게 올라갔는지" 화면에서 설명할 수 있게 한다(명세 §4-2).
          requestedPrivacyLevel: requestedPrivacy,
          privacyLevel: resolvedPrivacy.level,
          downgradedTo: resolvedPrivacy.downgraded ? resolvedPrivacy.level : undefined,
          reason: resolvedPrivacy.downgraded ? "app_not_audited" : undefined,
          privacyDowngraded: resolvedPrivacy.downgraded || undefined,
          privacyDowngradeReason: resolvedPrivacy.reason,
          publishResults,
        },
      });
    }

    if (platform === "instagram") {
      // Only the authorized publishing user's stored connection may publish.
      const igBasePrefix = outParsed.object.replace(/\/$/, "");
      const igSettingsName = buildUserDataObject(igBasePrefix, publishUserId, "sns-settings.json");
      const igSettings = await loadSnsSettings(bucket, igSettingsName, googleToken).catch(() => null);
      const igEntry = igSettings?.sns?.instagram;
      const igStore = { bucket, objectName: igSettingsName, googleToken };
      let accessToken = "";
      let igUserId = "";
      if (igEntry?.connected && igEntry?.accessToken) {
        if (igEntry.enabled === false) return send({ error: "instagram_paused", message: "인스타그램 계정이 연결돼 있지만 사용 중지 상태예요. SNS 설정에서 켜 주세요." }, 412);
        try {
          accessToken = await ensureInstagramPublishToken(igEntry, igStore);
        } catch (e: any) {
          if (!/reconnect_required/.test(String(e?.message || ""))) return send({ error: "sns_connection_unavailable", category: "service_unavailable", needsReconnect: false }, 503);
          return send({ error: "instagram_reconnect_required", needsReconnect: true,
            message: "인스타그램 연결을 확인할 수 없습니다. SNS 설정에서 본인 계정으로 다시 연결해 주세요." }, 412);
        }
        igUserId = String(igEntry.igUserId || "");
        usedMetaToken = accessToken;
      } else {
        return send({ error: "instagram_not_connected", needsReconnect: true, message: "SNS 설정에서 본인의 인스타그램 계정을 연결해 주세요." }, 412);
      }
      if (!accessToken || !igUserId) {
        return send({ error: "instagram_not_connected", needsReconnect: true, message: "인스타그램이 연결돼 있지 않아요. SNS 설정에서 인스타그램을 연결해 주세요." }, 412);
      }
      try {

      if (isCarousel) {
        // 캐러셀 포스트: 각 아이템에 대해 서명 URL 생성 후 업로드
        const rawItems = body.mediaItems!;
        const resolvedItems: Array<{ mediaType: "image" | "video"; mediaUrl: string }> = [];
        for (let i = 0; i < rawItems.length; i++) {
          const item = rawItems[i];
          let mediaUrl: string;
          if (item.gcsPath) {
            console.log(`[carousel] 서명 URL 생성 중 (${item.mediaType}, gcsPath: ${item.gcsPath})`);
            mediaUrl = await buildSignedUrl(bucket, item.gcsPath, env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY, 3600);
          } else if (item.mediaUrl) {
            mediaUrl = item.mediaUrl;
          } else {
            return send({ error: `캐러셀 아이템 ${i + 1}에 gcsPath 또는 mediaUrl이 없습니다.` }, 400);
          }
          resolvedItems.push({ mediaType: item.mediaType, mediaUrl });
        }

        const { postId } = await publishCarouselToInstagram({ igUserId, accessToken, items: resolvedItems, caption });
        const comment = await tryInstagramFirstComment(postId, accessToken, firstComment);

        return send({ ok: true, result: { platform: "instagram", postId, username: igEntry?.username || igUserId, status: "published", publishedAt: new Date().toISOString(), ...comment } });

      } else {
        // 단일 포스트 (기존 로직 유지)
        const mediaType = body.mediaType!;
        let mediaUrl: string;
        if (body.mediaGcsPath) {
          mediaUrl = await buildSignedUrl(bucket, body.mediaGcsPath, env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY, 3600);
        } else if (body.mediaDirectUrl) {
          mediaUrl = body.mediaDirectUrl;
        } else {
          return send({ error: "mediaGcsPath 또는 mediaDirectUrl 중 하나가 필요합니다." }, 400);
        }

        const { postId } = await publishToInstagram({ igUserId, accessToken, mediaType, mediaUrl, caption });
        const comment = await tryInstagramFirstComment(postId, accessToken, firstComment);

        return send({ ok: true, result: { platform: "instagram", postId, username: igEntry?.username || igUserId, status: "published", publishedAt: new Date().toISOString(), ...comment } });
      }
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (isInstagramTokenError(msg)) {
          if (igEntry?.connected) await patchSnsPlatform(igStore, "instagram", { needsReconnect: true }, accessToken).catch(() => {});
          return send({ error: "instagram_reconnect_required", needsReconnect: true,
            message: "인스타그램 권한이 만료되거나 철회됐습니다. SNS 설정에서 다시 연결해 주세요." }, 412);
        }
        throw e;
      }
    }

    if (platform === "youtube" || platform === "youtube-shorts") {
      const isShorts = platform === "youtube-shorts" || !!body.isShorts;

      // YouTube 는 영상만. 이미지 / 캐러셀 거부.
      if (isCarousel) {
        return send({ error: "YouTube는 단일 영상 업로드만 지원합니다." }, 400);
      }
      if (body.mediaType !== "video") {
        return send({ error: "YouTube에는 영상 자산이 필요합니다." }, 400);
      }
      if (!body.mediaGcsPath && !body.mediaDirectUrl) {
        return send({ error: "mediaGcsPath 또는 mediaDirectUrl 중 하나가 필요합니다." }, 400);
      }

      // 사용자 토큰 (자동 갱신)
      let userAccessToken: string;
      try {
        userAccessToken = await ensureFreshAccessToken(env, publishUserId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "youtube_not_connected") {
          return send({ error: "YouTube 계정이 연결되지 않았습니다. SNS 설정에서 먼저 연결해 주세요." }, 412);
        }
        if (msg === "youtube_reconnect_required") {
          return send({ error: "YouTube 연결이 만료되었습니다. SNS 설정에서 YouTube를 다시 연결해 주세요." }, 412);
        }
        return send({ error: msg }, 500);
      }

      // 메타 구성: draft → YouTube 비디오 메타데이터
      const epTitleFallback = String(body.title || "").trim() || "Untitled";
      const captionText = String(body.caption || "").trim();
      let description = captionText;
      const tagSet = new Set<string>();
      if (Array.isArray(body.tags)) {
        body.tags.forEach((t) => {
          const v = String(t || "").trim().replace(/^#/, "");
          if (v) tagSet.add(v);
        });
      }
      // caption 에 #해시태그가 포함되어 있다면 tags 로도 흡수 (#는 제거)
      const inlineHashes = captionText.match(/#[A-Za-z0-9_가-힣]+/g) || [];
      inlineHashes.forEach((h) => tagSet.add(h.replace(/^#/, "")));

      if (isShorts) {
        // Shorts 의도 신호: description 끝과 tags 양쪽
        // 제목에 이미 #shorts 가 있으면 설명엔 덧붙이지 않는다(설명의 해시태그를 사용자가 정한 대로 두기 위해).
        if (!/(^|\s)#Shorts(\s|$)/i.test(description) && !/(^|\s)#Shorts(\s|$)/i.test(epTitleFallback)) {
          description = description ? description + "\n\n#Shorts" : "#Shorts";
        }
        const hasShortsTag = Array.from(tagSet).some((t) => t.toLowerCase() === "shorts");
        if (!hasShortsTag) tagSet.add("Shorts");
      }
      const tags = Array.from(tagSet);

      // 영상 크기 조회. 업로드는 크기와 관계없이 서버가 흘려 보낸다(아래 PUT).
      // 전엔 50MB 가 넘으면 유튜브 업로드 자리(resumable 세션)만 열고, 브라우저가 GCS 서명 주소로 영상을 받아 직접 올리게 했다.
      // 버킷 CORS 가 nkstudio.org 를 허용하지 않아 브라우저가 영상을 받지 못해(status 0) 유튜브엔 '곧 처리 시작됨'에 멈춘
      // 빈 영상만 남았고, 에이전트 발행은 그 응답(업로드 주소만 있고 결과 없음)을 성공으로 기록했다(2026-10-18).
      // 서버 전송은 Worker 메모리에 다 올리지 않는 스트림이라 큰 영상도 된다.
      let contentLength = 0;
      let contentType = "video/mp4";
      let videoSignedUrl = "";
      if (body.mediaGcsPath) {
        // GCS 객체 메타 조회
        const objName = gcsObjectPath(body.mediaGcsPath);
        const metaRes = await fetch(
          `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${objName}`,
          { headers: { Authorization: `Bearer ${googleToken}` } }
        );
        if (!metaRes.ok) {
          const errText = await metaRes.text();
          return send({ error: `GCS 메타 조회 실패: ${metaRes.status} ${errText}` }, 502);
        }
        const meta = (await metaRes.json()) as { size?: string; contentType?: string };
        contentLength = Number(meta.size || 0);
        contentType = meta.contentType || "video/mp4";
        videoSignedUrl = await buildSignedUrl(
          bucket, body.mediaGcsPath, env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY, 3600
        );
      } else if (body.mediaDirectUrl) {
        // direct URL은 HEAD로 크기 확인
        try {
          const headRes = await fetch(body.mediaDirectUrl, { method: "HEAD" });
          contentLength = Number(headRes.headers.get("content-length") || 0);
          contentType = headRes.headers.get("content-type") || "video/mp4";
        } catch { /* 아래에서 크기 없음으로 멈춘다 */ }
        videoSignedUrl = body.mediaDirectUrl;
      }
      // 크기를 꾸며 넣지 않는다 — 업로드 자리를 열 때 알린 크기(X-Upload-Content-Length)가 실제와 다르면
      // 유튜브에 빈 영상만 남는다. 열기 전에 멈춘다.
      if (!contentLength || !videoSignedUrl) {
        return send({ error: "영상 파일 크기를 확인하지 못해 YouTube 에 올리지 않았어요. 영상을 다시 선택해 주세요." }, 400);
      }

      // ── UI 입력값 → YouTube API 매핑 ──────────────────────────
      // 카테고리 키 → YouTube categoryId (videoCategories.list 표준 ID)
      const CATEGORY_MAP: Record<string, string> = {
        entertainment: "24",
        education: "27",
        gaming: "20",
        music: "10",
        etc: "22", // People & Blogs (기본)
      };
      const categoryId = CATEGORY_MAP[String(body.categoryKey || "").toLowerCase()] || "22";

      // 공개 설정 — 'scheduled' 는 YouTube 규약상 privacyStatus=private + publishAt 으로 발행.
      let apiPrivacyStatus: "public" | "private" | "unlisted" = "public";
      let publishAtIso = "";
      const uiPrivacy = String(body.privacyStatus || "public").toLowerCase();
      if (uiPrivacy === "scheduled") {
        const raw = String(body.publishAt || "").trim();
        if (!raw) {
          return send({ error: "예약 발행에는 publishAt(scheduled_at)이 필요합니다." }, 400);
        }
        const d = new Date(raw);
        if (isNaN(d.getTime())) {
          return send({ error: `publishAt 형식 오류: ${raw}` }, 400);
        }
        if (d.getTime() <= Date.now()) {
          return send({ error: "예약 시간은 현재보다 미래여야 합니다." }, 400);
        }
        apiPrivacyStatus = "private";
        publishAtIso = d.toISOString();
      } else if (uiPrivacy === "public" || uiPrivacy === "private" || uiPrivacy === "unlisted") {
        apiPrivacyStatus = uiPrivacy;
      }

      // YouTube resumable session 시작
      const statusObj: Record<string, unknown> = {
        privacyStatus: apiPrivacyStatus,
        selfDeclaredMadeForKids: false,
      };
      if (publishAtIso) statusObj.publishAt = publishAtIso;
      if (typeof body.alteredContent === "boolean") statusObj.containsSyntheticMedia = body.alteredContent;

      const snippet: Record<string, unknown> = {
        title: epTitleFallback.slice(0, 100),
        description: description.slice(0, 5000),
        tags,
        categoryId,
      };
      // 영어 제목 번역: 번역은 기본 언어(defaultLanguage)가 있어야 받는다. 본제목이 한국어일 때만 ko 를 기본으로 두고 en 번역을 단다.
      // 번역의 설명을 비우면 영어 화면 시청자에겐 설명이 빈칸으로 보이므로 본 설명을 그대로 쓴다.
      const titleEn = String(body.titleEn || "").trim().slice(0, 100);
      const localizations = titleEn && /[가-힣]/.test(epTitleFallback)
        ? { en: { title: titleEn, description: description.slice(0, 5000) } }
        : null;
      if (localizations) snippet.defaultLanguage = "ko";
      const metadata: Record<string, unknown> = { snippet, status: statusObj, ...(localizations ? { localizations } : {}) };
      const ytNotes: string[] = [];
      if (titleEn && !localizations) ytNotes.push("본제목이 한국어가 아니라 영어 제목 번역은 넣지 않았어요.");

      const initRes = await fetch(
        `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status${localizations ? ",localizations" : ""}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${userAccessToken}`,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Length": String(contentLength),
            "X-Upload-Content-Type": contentType,
          },
          body: JSON.stringify(metadata),
        }
      );
      if (!initRes.ok) {
        const errText = await initRes.text();
        return send({ error: `YouTube init 실패: ${initRes.status} ${errText}` }, 502);
      }
      const uploadUrl = initRes.headers.get("Location");
      if (!uploadUrl) {
        return send({ error: "YouTube upload URL 누락" }, 502);
      }

      // 서버 전송: GCS 에서 받아 유튜브로 그대로 흘려 보낸다. 길이를 정한 스트림이라 Worker 메모리에 다 올리지 않는다.
      const videoRes = await fetch(videoSignedUrl);
      if (!videoRes.ok || !videoRes.body) {
        return send({ error: `영상 fetch 실패: ${videoRes.status}` }, 502);
      }
      let putBody: any = videoRes.body;
      const FLS: any = (globalThis as any).FixedLengthStream;
      if (typeof FLS === "function") {
        const { readable, writable } = new FLS(contentLength);
        videoRes.body.pipeTo(writable).catch(() => {});
        putBody = readable;
      }
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(contentLength),
        },
        body: putBody,
      });
      if (!putRes.ok) {
        const errText = await putRes.text();
        return send({ error: `YouTube PUT 실패: ${putRes.status} ${errText}` }, 502);
      }
      const result = (await putRes.json()) as { id?: string };
      if (!result.id) {
        return send({ error: "YouTube 가 영상 ID 를 돌려주지 않았어요 — 업로드가 끝나지 않았을 수 있어요. 유튜브 스튜디오에서 확인해 주세요." }, 502);
      }
      // 재생목록: 실패해도 업로드는 성공으로 둔다(쓰기 권한 없이 연결된 계정은 재연결 안내).
      const playlistTitle = String(body.playlist || "").trim();
      if (playlistTitle) {
        const playlistNote = await addVideoToYouTubePlaylist(userAccessToken, result.id, playlistTitle, apiPrivacyStatus === "private" && !publishAtIso ? "private" : "public");
        if (playlistNote) ytNotes.push(playlistNote);
      }

      return send({
        ok: true,
        result: {
          platform,
          ...(ytNotes.length ? { note: ytNotes.join(" ") } : {}),
          postId: result.id,
          status: publishAtIso ? "scheduled" : "published",
          publishedAt: new Date().toISOString(),
          scheduledFor: publishAtIso || "",
          url: `https://youtu.be/${result.id}`,
        },
      });
    }

    if (platform === "facebook") {
      let fbPage: { pageToken: string; pageId: string; pageName: string };
      try {
        fbPage = await getFacebookPageToken(env, publishUserId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "facebook_not_connected") {
          return send({ error: "Facebook 페이지가 연결되지 않았습니다. SNS 설정에서 먼저 연결해 주세요." }, 412);
        }
        return send({ error: msg }, 500);
      }

      const { pageToken, pageId, pageName } = fbPage;

      if (isCarousel) {
        // 사용자가 명시적으로 'video' 를 선택한 경우 → 첫 영상 1개를 단일 영상 포스트로 처리
        const rawItems = body.mediaItems!;
        const fbLinkUrl = String((body as any).linkUrl || "").trim();
        const fbMediaOverride = String((body as any).mediaType || "").trim().toLowerCase();

        let postId: string;

        if (fbMediaOverride === "video") {
          const firstVideo = rawItems.find((it) => it.mediaType === "video");
          if (!firstVideo) {
            return send({ error: "Facebook 영상 게시에 영상 자산이 없습니다." }, 400);
          }
          let videoUrl: string;
          if (firstVideo.gcsPath) {
            videoUrl = await buildSignedUrl(bucket, firstVideo.gcsPath, env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY, 3600);
          } else if (firstVideo.mediaUrl) {
            videoUrl = firstVideo.mediaUrl;
          } else {
            return send({ error: "Facebook 영상 자산 URL이 없습니다." }, 400);
          }
          ({ postId } = await publishVideoToFacebook({ pageId, pageToken, mediaUrl: videoUrl, caption, linkUrl: fbLinkUrl }));
        } else {
          // 이미지만 (override='image' 이거나 미지정인 경우 모두 동일): 영상은 제외하고 이미지만
          const imageUrls: string[] = [];
          for (let i = 0; i < rawItems.length; i++) {
            const item = rawItems[i];
            if (item.mediaType === "video") continue;
            let mediaUrl: string;
            if (item.gcsPath) {
              mediaUrl = await buildSignedUrl(bucket, item.gcsPath, env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY, 3600);
            } else if (item.mediaUrl) {
              mediaUrl = item.mediaUrl;
            } else {
              continue;
            }
            imageUrls.push(mediaUrl);
          }
          if (imageUrls.length === 0) {
            return send({ error: "Facebook 캐러셀에 유효한 이미지가 없습니다." }, 400);
          }
          if (imageUrls.length === 1) {
            ({ postId } = await publishPhotoToFacebook({ pageId, pageToken, mediaUrl: imageUrls[0], caption, linkUrl: fbLinkUrl }));
          } else {
            ({ postId } = await publishCarouselToFacebook({ pageId, pageToken, imageUrls, caption, linkUrl: fbLinkUrl }));
          }
        }

        // 첫 댓글: 실패해도 게시 자체는 성공으로 처리
        let commentError: string | undefined;
        if (firstComment && firstComment.trim()) {
          try {
            await postFacebookComment({ postId, pageToken, message: firstComment.trim() });
          } catch (e) {
            commentError = e instanceof Error ? e.message : String(e);
            console.log("[facebook publish] first comment failed (post still ok):", commentError);
          }
        }

        return send({
          ok: true,
          result: {
            platform: "facebook",
            postId,
            username: pageName,
            status: "published",
            publishedAt: new Date().toISOString(),
            commentError,
          },
        });

      } else {
        const mediaType = body.mediaType!;
        let mediaUrl: string;
        if (body.mediaGcsPath) {
          mediaUrl = await buildSignedUrl(bucket, body.mediaGcsPath, env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY, 3600);
        } else if (body.mediaDirectUrl) {
          mediaUrl = body.mediaDirectUrl;
        } else {
          return send({ error: "mediaGcsPath 또는 mediaDirectUrl 중 하나가 필요합니다." }, 400);
        }

        const fbLinkUrl = String((body as any).linkUrl || "").trim();

        let postId: string;
        if (mediaType === "video") {
          ({ postId } = await publishVideoToFacebook({ pageId, pageToken, mediaUrl, caption, linkUrl: fbLinkUrl }));
        } else {
          ({ postId } = await publishPhotoToFacebook({ pageId, pageToken, mediaUrl, caption, linkUrl: fbLinkUrl }));
        }

        // 첫 댓글: 실패해도 게시 자체는 성공으로 처리
        let commentError: string | undefined;
        if (firstComment && firstComment.trim()) {
          try {
            await postFacebookComment({ postId, pageToken, message: firstComment.trim() });
          } catch (e) {
            commentError = e instanceof Error ? e.message : String(e);
            console.log("[facebook publish] first comment failed (post still ok):", commentError);
          }
        }

        return send({
          ok: true,
          result: {
            platform: "facebook",
            postId,
            username: pageName,
            status: "published",
            publishedAt: new Date().toISOString(),
            commentError,
          },
        });
      }
    }

    if (platform === "threads") {
      let th: { accessToken: string; threadsUserId: string; username: string };
      try {
        th = await getThreadsToken(env, publishUserId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "threads_not_connected") {
          return send({ error: "Threads 계정이 연결되지 않았습니다. SNS 설정에서 먼저 연결해 주세요." }, 412);
        }
        if (msg === "threads_paused") return send({ error: "threads_paused", category: "channel_paused" }, 412);
        const needsReconnect = msg === "threads_reconnect_required";
        return send({ error: needsReconnect ? msg : "threads_connection_unavailable", category: needsReconnect ? "reconnect_required" : "service_unavailable", needsReconnect }, needsReconnect ? 412 : 503);
      }
      const { accessToken, threadsUserId, username } = th;
      usedMetaToken = accessToken;
      // 500자 제한은 코드포인트 단위로 자른다. caption.slice(0, 500) 은 이모지(서로게이트 쌍)를 반쪽으로 잘라
      // 깨진 문자를 만들 수 있고, 메타는 그런 본문에 이유 없는 빈 500 을 낸다(2026-09-25 의심 원인).
      const text = sanitizeThreadsText(caption, 500);

      // 답글 허용 범위 (Threads: reply_control). 최상위 컨테이너에만 붙이고
      // 캐러셀 자식에는 붙이지 않는다 — 게시물 단위 설정이기 때문.
      // 문서상 값은 everyone / accounts_you_follow / mentioned_only /
      // parent_post_author_only / followers_only 다섯 개이고, UI 에 있는 셋만 매핑한다.
      // 'followers'(내 팔로워) 는 accounts_you_follow(내가 팔로우하는 계정) 가 아니라
      // followers_only 다. 둘을 바꿔 쓰면 의미가 정반대가 된다.
      const THREADS_REPLY_CONTROL: Record<string, string> = {
        public: "everyone",
        followers: "followers_only",
        mentioned: "mentioned_only",
      };
      const threadsReply = THREADS_REPLY_CONTROL[String(body.replySetting || "").trim()];
      /**
       * 최상위 컨테이너 params 에 reply_control 을 얹는다.
       * 2026-10-14: reply_control 은 값이 무엇이든(everyone 포함) 답글 관리 권한(threads_manage_replies)이 없으면
       * 메타가 "Application does not have permission for this action"(code 10)으로 거부한다 — 본문만 보내면 된다(실측).
       * everyone 은 Threads 기본값이라 보내지 않는다. 제한(팔로워·언급)만 보내고, 거부되면 아래 사다리가 빼고 다시 올린다.
       */
      function withReplyControl(p: Record<string, string>): Record<string, string> {
        return threadsReply && threadsReply !== "everyone" ? { ...p, reply_control: threadsReply } : p;
      }

      // GCS 경로는 Threads 가 직접 fetch 할 수 있는 signed URL 로 변환.
      async function resolveUrl(gcsPath?: string, directUrl?: string): Promise<string> {
        if (gcsPath) return buildSignedUrl(bucket, gcsPath, env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY, 3600);
        if (directUrl) return directUrl;
        throw new Error("mediaGcsPath 또는 mediaDirectUrl 중 하나가 필요합니다.");
      }

      let creationId: string;
      const fallbackNotes: string[] = [];
      /**
       * 상위(게시될) 컨테이너 생성 사다리. 2026-09-25 진단: 이미지 자식 컨테이너는 되는데 본문·답글설정이 붙는
       * 상위 요청만 메타가 빈 500 을 냈다. 메타가 원인을 안 알려주므로, 빈 500 이면 답글설정을 빼고 → 본문을
       * 정리(깨진 문자·제어문자 제거, 480자)해서 차례로 다시 시도한다. 무엇을 뺐는지는 결과 note 로 알린다.
       */
      async function createTopLevel(params: Record<string, string>): Promise<string> {
        try {
          return await createThreadsContainer({ threadsUserId, accessToken, params });
        } catch (e: any) {
          // 답글 제한이 권한 없음(code 10)으로 거부되면 답글 설정 없이 올리고 그 사실을 알린다.
          if (e?.metaCode === 10 && params.reply_control) {
            const { reply_control: _deniedRc, ...withoutReply } = params;
            const id = await createThreadsContainer({ threadsUserId, accessToken, params: withoutReply });
            fallbackNotes.push("답글 제한은 Threads 연결에 답글 관리 권한이 없어 적용되지 않았어요(모두 답글 가능으로 올렸어요).");
            return id;
          }
          if (!e?.opaque) throw e;
          let lastErr: any = e;
          if (params.reply_control) {
            const { reply_control: _rc, ...rest } = params;
            try { const id = await createThreadsContainer({ threadsUserId, accessToken, params: rest }); fallbackNotes.push("답글 설정은 메타가 거부해 기본값(모두 답글 가능)으로 올렸어요."); return id; }
            catch (e2: any) { if (!e2?.opaque) throw e2; lastErr = e2; params = rest; }
          }
          if (typeof params.text === "string" && params.text.trim()) {
            const cleaned = sanitizeThreadsText(params.text, 480, true);
            if (cleaned !== params.text) {
              try { const id = await createThreadsContainer({ threadsUserId, accessToken, params: { ...params, text: cleaned } }); fallbackNotes.push("본문에 메타가 거부하는 문자가 있어 정리한 본문으로 올렸어요."); return id; }
              catch (e3: any) { if (!e3?.opaque) throw e3; lastErr = e3; }
            }
          }
          throw lastErr;
        }
      }

      if (isCarousel) {
        const rawItems = body.mediaItems!;
        if (rawItems.length === 1) {
          // 단일 아이템 캐러셀은 그냥 단일 게시로 처리
          const it = rawItems[0];
          const url = await resolveUrl(it.gcsPath, it.mediaUrl);
          const p: Record<string, string> = it.mediaType === "video"
            ? { media_type: "VIDEO", video_url: url, text }
            : { media_type: "IMAGE", image_url: url, text };
          creationId = await createTopLevel(withReplyControl(p));
          await waitForThreadsContainer(accessToken, creationId);
        } else {
          // 캐러셀(2~20장): 자식 컨테이너 생성 → CAROUSEL 컨테이너로 묶기
          const childIds: string[] = [];
          for (const it of rawItems) {
            const url = await resolveUrl(it.gcsPath, it.mediaUrl);
            const childParams: Record<string, string> = it.mediaType === "video"
              ? { media_type: "VIDEO", video_url: url, is_carousel_item: "true" }
              : { media_type: "IMAGE", image_url: url, is_carousel_item: "true" };
            const childId = await createThreadsContainer({ threadsUserId, accessToken, params: childParams });
            await waitForThreadsContainer(accessToken, childId);
            childIds.push(childId);
          }
          creationId = await createTopLevel(withReplyControl({ media_type: "CAROUSEL", children: childIds.join(","), text }));
          await waitForThreadsContainer(accessToken, creationId);
        }
      } else if (body.mediaType === "video" || body.mediaType === "image") {
        const url = await resolveUrl(body.mediaGcsPath, body.mediaDirectUrl);
        const p: Record<string, string> = body.mediaType === "video"
          ? { media_type: "VIDEO", video_url: url, text }
          : { media_type: "IMAGE", image_url: url, text };
        creationId = await createTopLevel(withReplyControl(p));
        await waitForThreadsContainer(accessToken, creationId);
      } else {
        // 텍스트 전용 게시
        if (!text.trim()) return send({ error: "Threads 텍스트 게시에는 캡션이 필요합니다." }, 400);
        creationId = await createTopLevel(withReplyControl({ media_type: "TEXT", text }));
      }

      const { postId } = await publishThreadsContainer({ threadsUserId, accessToken, creationId });

      // 첫 답글(예: 본문엔 링크를 안 넣고 답글에 스토어 링크). 실패해도 본문 게시는 성공으로 둔다.
      // 답글(reply_to_id)도 reply_control 처럼 답글 관리 권한(threads_manage_replies)이 없으면 code 10 으로 거부될 수 있다.
      const replyText = sanitizeThreadsText(String(firstComment || ""), 500);
      if (replyText.trim()) {
        if (!postId) {
          fallbackNotes.push("본문 게시 번호를 받지 못해 첫 답글은 달지 못했어요 — 앱에서 직접 달아 주세요.");
        } else {
          try {
            const replyId = await createThreadsContainer({ threadsUserId, accessToken, params: { media_type: "TEXT", text: replyText, reply_to_id: postId } });
            await publishThreadsContainer({ threadsUserId, accessToken, creationId: replyId });
          } catch (e: any) {
            console.log("[threads publish] first reply failed (post still ok)");
            fallbackNotes.push(e?.metaCode === 10
              ? "첫 답글은 Threads 연결에 답글 관리 권한(threads_manage_replies)이 없어 달지 못했어요 — 앱에서 직접 달아 주세요."
              : "첫 답글은 달지 못했어요 — 앱에서 직접 달아 주세요.");
          }
        }
      }

      return send({
        ok: true,
        result: {
          platform: "threads",
          postId,
          username,
          status: "published",
          publishedAt: new Date().toISOString(),
          ...(fallbackNotes.length ? { note: fallbackNotes.join(" ") } : {}),
        },
      });
    }

    if (platform === "x") {
      let xt: { accessToken: string; xUserId: string; username: string };
      try {
        xt = await getXToken(env, publishUserId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "x_not_connected") {
          return send({ error: "X 계정이 연결되지 않았습니다. SNS 설정에서 먼저 연결해 주세요." }, 412);
        }
        return send({ error: msg }, 500);
      }
      const { accessToken, username } = xt;
      const text = caption.slice(0, 280);

      // GCS 경로/직접 URL 에서 미디어 바이트를 받아온다 (X 는 바이트 업로드 방식).
      async function fetchMediaBytes(gcsPath?: string, directUrl?: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
        let url: string;
        if (gcsPath) {
          url = await buildSignedUrl(bucket, gcsPath, env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY, 3600);
        } else if (directUrl) {
          url = directUrl;
        } else {
          throw new Error("mediaGcsPath 또는 mediaDirectUrl 중 하나가 필요합니다.");
        }
        const r = await fetch(url);
        if (!r.ok) throw new Error(`미디어 다운로드 실패: ${r.status}`);
        const ct = r.headers.get("content-type") || "application/octet-stream";
        return { bytes: await r.arrayBuffer(), contentType: ct };
      }

      // X 미디어 업로드는 OAuth2(media.write) 호환 v2 엔드포인트 사용.
      // 레거시 upload.twitter.com/1.1 은 OAuth1.0a 전용이라 Bearer 토큰을 거부함.
      const X_MEDIA_UPLOAD = "https://api.twitter.com/2/media/upload";
      type XMediaResp = {
        data?: { id?: string; media_id_string?: string; processing_info?: XProcInfo };
        media_id_string?: string;
        processing_info?: XProcInfo;
      };
      type XProcInfo = { state: string; check_after_secs?: number; error?: unknown };
      function pickMediaId(j: XMediaResp): string | undefined {
        return j.data?.id || j.data?.media_id_string || j.media_id_string;
      }
      function pickProcInfo(j: XMediaResp): XProcInfo | undefined {
        return j.data?.processing_info || j.processing_info;
      }

      // 이미지: v2 단순 업로드(multipart). data.id 반환.
      async function xUploadSimple(bytes: ArrayBuffer, contentType: string): Promise<string> {
        const form = new FormData();
        form.append("media", new Blob([bytes], { type: contentType }));
        form.append("media_category", "tweet_image");
        const r = await fetch(X_MEDIA_UPLOAD, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: form,
        });
        const j = (await r.json()) as XMediaResp;
        const id = pickMediaId(j);
        if (!r.ok || !id) {
          throw new Error(`X 이미지 업로드 실패: ${r.status} ${JSON.stringify(j)}`);
        }
        return id;
      }

      // 영상: v2 청크 업로드. 단순 업로드 엔드포인트는 command/total_bytes/tweet_video 를
      // 받지 않으므로(이미지 전용 스키마), 전용 하위 엔드포인트를 사용해야 한다.
      //   INIT: POST /2/media/upload/initialize (JSON)
      //   APPEND: POST /2/media/upload/{id}/append (multipart)
      //   FINALIZE: POST /2/media/upload/{id}/finalize
      async function xUploadChunked(bytes: ArrayBuffer, contentType: string): Promise<string> {
        const total = bytes.byteLength;
        const initRes = await fetch(`${X_MEDIA_UPLOAD}/initialize`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            media_category: "tweet_video",
            media_type: contentType,
            total_bytes: total,
          }),
        });
        const initJson = (await initRes.json()) as XMediaResp;
        const mediaId = pickMediaId(initJson);
        if (!initRes.ok || !mediaId) {
          throw new Error(`X 동영상 INIT 실패: ${initRes.status} ${JSON.stringify(initJson)}`);
        }
        const CHUNK = 4 * 1024 * 1024;
        let seg = 0;
        for (let off = 0; off < total; off += CHUNK) {
          const slice = bytes.slice(off, Math.min(off + CHUNK, total));
          const form = new FormData();
          form.append("segment_index", String(seg));
          form.append("media", new Blob([slice], { type: contentType }));
          const apRes = await fetch(`${X_MEDIA_UPLOAD}/${mediaId}/append`, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}` },
            body: form,
          });
          if (!apRes.ok) {
            throw new Error(`X 동영상 APPEND 실패(seg ${seg}): ${apRes.status} ${await apRes.text()}`);
          }
          seg++;
        }
        const finRes = await fetch(`${X_MEDIA_UPLOAD}/${mediaId}/finalize`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const finJson = (await finRes.json()) as XMediaResp;
        if (!finRes.ok || !pickMediaId(finJson)) {
          throw new Error(`X 동영상 FINALIZE 실패: ${finRes.status} ${JSON.stringify(finJson)}`);
        }
        let info = pickProcInfo(finJson);
        let waited = 0;
        while (info && (info.state === "pending" || info.state === "in_progress")) {
          if (waited > 90000) throw new Error("X 동영상 처리 시간 초과");
          const waitMs = Math.min(info.check_after_secs || 1, 10) * 1000;
          await new Promise((res) => setTimeout(res, waitMs));
          waited += waitMs;
          const stRes = await fetch(
            `${X_MEDIA_UPLOAD}?command=STATUS&media_id=${mediaId}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          const stJson = (await stRes.json()) as XMediaResp;
          info = pickProcInfo(stJson);
        }
        if (info && info.state === "failed") {
          throw new Error(`X 동영상 처리 실패: ${JSON.stringify(info.error || info)}`);
        }
        return mediaId;
      }

      // 게시할 미디어 수집. X 는 이미지 최대 4장 또는 영상 1개(혼합 불가).
      const mediaIds: string[] = [];
      if (isCarousel) {
        const items = body.mediaItems!;
        const vid = items.find((i) => i.mediaType === "video");
        if (vid) {
          const { bytes, contentType } = await fetchMediaBytes(vid.gcsPath, vid.mediaUrl);
          mediaIds.push(await xUploadChunked(bytes, contentType));
        } else {
          for (const it of items.slice(0, 4)) {
            const { bytes, contentType } = await fetchMediaBytes(it.gcsPath, it.mediaUrl);
            mediaIds.push(await xUploadSimple(bytes, contentType));
          }
        }
      } else if (body.mediaType === "video") {
        const { bytes, contentType } = await fetchMediaBytes(body.mediaGcsPath, body.mediaDirectUrl);
        mediaIds.push(await xUploadChunked(bytes, contentType));
      } else if (body.mediaType === "image") {
        const { bytes, contentType } = await fetchMediaBytes(body.mediaGcsPath, body.mediaDirectUrl);
        mediaIds.push(await xUploadSimple(bytes, contentType));
      }

      if (!text.trim() && mediaIds.length === 0) {
        return send({ error: "X 게시에는 텍스트 또는 미디어가 필요합니다." }, 400);
      }

      const tweetBody: {
        text?: string;
        media?: { media_ids: string[] };
        reply_settings?: string;
      } = {};
      if (text.trim()) tweetBody.text = text;
      if (mediaIds.length) tweetBody.media = { media_ids: mediaIds };
      // 답글 허용 범위. X 의 어휘는 우리 UI 와 다르다:
      //   following      = 내가 팔로우하는 계정만
      //   mentionedUsers = 게시물에서 언급한 계정만
      // 'public' 은 필드를 아예 보내지 않는 게 X 의 기본값(전체 허용)이다.
      // UI 에 없는 값(subscribers/verified)은 매핑하지 않는다.
      const X_REPLY_SETTINGS: Record<string, string> = {
        followers: "following",
        mentioned: "mentionedUsers",
      };
      const xReply = X_REPLY_SETTINGS[String(body.replySetting || "").trim()];
      if (xReply) tweetBody.reply_settings = xReply;

      const tweetRes = await fetch("https://api.twitter.com/2/tweets", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(tweetBody),
      });
      const tweetJson = (await tweetRes.json()) as { data?: { id?: string }; detail?: string; title?: string };
      if (!tweetRes.ok || !tweetJson.data?.id) {
        return send({ error: `X 게시 실패: ${tweetRes.status} ${tweetJson.detail || tweetJson.title || JSON.stringify(tweetJson)}` }, 502);
      }

      // 첫 답글(예: 본문엔 링크를 안 넣고 답글에 스토어 링크). 내 글에 다는 답글은 reply_settings 와 상관없이 된다.
      // 실패해도 본문 게시는 성공으로 둔다.
      let xNote = "";
      const xReplyText = String(firstComment || "").trim();
      if (xReplyText) {
        try {
          const replyRes = await fetch("https://api.twitter.com/2/tweets", {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ text: xReplyText, reply: { in_reply_to_tweet_id: tweetJson.data.id } }),
          });
          const replyJson = (await replyRes.json().catch(() => ({}))) as { data?: { id?: string }; detail?: string; title?: string };
          if (!replyRes.ok || !replyJson.data?.id) throw new Error(`${replyRes.status} ${replyJson.detail || replyJson.title || ""}`.trim());
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.log("[x publish] first reply failed (post still ok):", msg);
          xNote = `첫 답글은 달지 못했어요(${msg.slice(0, 120)}) — X 에서 직접 달아 주세요.`;
        }
      }

      return send({
        ok: true,
        result: {
          platform: "x",
          postId: tweetJson.data.id,
          username,
          status: "published",
          publishedAt: new Date().toISOString(),
          ...(xNote ? { note: xNote } : {}),
        },
      });
    }

    if (platform === "discord") {
      let hook: { webhookUrl: string; guildId: string; channelId: string; username: string };
      try {
        hook = await getDiscordWebhook(env, publishUserId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "discord_not_connected") {
          return send({ error: "디스코드가 연결되지 않았습니다. SNS 설정에서 웹훅 주소를 먼저 연결해 주세요." }, 412);
        }
        return send({ error: msg }, 500);
      }

      // 첨부 후보: 캐러셀이면 전부, 아니면 단일 미디어. 디스코드는 이미지·영상을 섞어 올릴 수 있다.
      const sources: Array<{ gcsPath?: string; url?: string }> = isCarousel
        ? body.mediaItems!.map((it) => ({ gcsPath: it.gcsPath, url: it.mediaUrl }))
        : (body.mediaGcsPath || body.mediaDirectUrl) ? [{ gcsPath: body.mediaGcsPath, url: body.mediaDirectUrl }] : [];

      // 크기를 먼저 본다 — 큰 영상을 통째로 내려받으면 함수 메모리를 넘는다.
      async function mediaSize(src: { gcsPath?: string; url?: string }): Promise<{ size: number; contentType: string }> {
        if (src.gcsPath) {
          const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(src.gcsPath)}`,
            { headers: { Authorization: `Bearer ${googleToken}` } });
          if (!r.ok) throw new Error(`미디어 확인 실패: ${r.status}`);
          const meta: any = await r.json();
          return { size: Number(meta.size) || 0, contentType: String(meta.contentType || "application/octet-stream") };
        }
        const h = await fetch(String(src.url), { method: "HEAD" }).catch(() => null);
        const len = Number(h?.headers.get("content-length") || 0);
        // 길이를 모르면 큰 파일로 본다(링크로 올린다).
        return { size: len > 0 ? len : DISCORD_FILE_LIMIT + 1, contentType: h?.headers.get("content-type") || "application/octet-stream" };
      }
      // 첨부하지 못한 파일의 링크. GCS 객체는 우리 도메인 프록시의 만료 없는 서명 주소로 준다
      // (GCS 서명 URL 은 1시간이면 끊겨 채널에 죽은 링크가 남는다. 전엔 5년 만료였는데, 게시물은 남는데
      //  링크만 죽는 건 말이 안 된다는 엔케 지적으로 만료를 없앴다 — 2026-10-18).
      async function mediaLink(src: { gcsPath?: string; url?: string }): Promise<string> {
        if (src.gcsPath) {
          const origin = new URL(request.url).origin;
          return await buildTikTokProxyUrl(origin, src.gcsPath, readMediaSecret(env), 0);
        }
        return /^https?:\/\//i.test(String(src.url || "")) ? String(src.url) : "";
      }
      function fileNameOf(src: { gcsPath?: string; url?: string }, contentType: string, i: number): string {
        const raw = String(src.gcsPath || src.url || "").split("?")[0].split("/").pop() || "";
        const clean = raw.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
        if (/\.[A-Za-z0-9]{2,5}$/.test(clean)) return clean;
        const ext = /video/.test(contentType) ? "mp4" : /png/.test(contentType) ? "png" : /webp/.test(contentType) ? "webp" : /gif/.test(contentType) ? "gif" : "jpg";
        return `media-${i + 1}.${ext}`;
      }

      const files: DiscordFile[] = [];
      const links: string[] = [];
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i];
        const { size, contentType } = await mediaSize(src);
        if (size <= DISCORD_FILE_LIMIT && files.length < DISCORD_MAX_ATTACHMENTS) {
          const url = src.gcsPath
            ? await buildSignedUrl(bucket, src.gcsPath, env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY, 3600)
            : String(src.url);
          const r = await fetch(url);
          if (!r.ok) throw new Error(`미디어 다운로드 실패: ${r.status}`);
          const bytes = await r.arrayBuffer();
          const ct = r.headers.get("content-type") || contentType;
          if (bytes.byteLength <= DISCORD_FILE_LIMIT) {
            files.push({ name: fileNameOf(src, ct, i), bytes, contentType: ct });
            continue;
          }
        }
        const link = await mediaLink(src);
        if (link) links.push(link);
      }

      const text = String(caption || "");
      if (!text.trim() && files.length === 0 && links.length === 0) {
        return send({ error: "디스코드 게시에는 본문 또는 미디어가 필요합니다." }, 400);
      }
      // 링크를 본문 뒤에 붙인다. 붙이면 2000자를 넘을 때는 링크만 다음 메시지로 보낸다(본문은 자르지 않는다).
      const linkBlock = links.join("\n");
      const joined = linkBlock ? (text ? `${text}\n\n${linkBlock}` : linkBlock) : text;
      const fits = joined.length <= DISCORD_CONTENT_LIMIT;
      const firstContent = fits ? joined : text;
      const followLinks = fits ? "" : linkBlock;

      let posted = await postDiscordMessage({ webhookUrl: hook.webhookUrl, content: firstContent, files });
      // 413(요청이 너무 큼): 첨부 합계가 서버 한도를 넘었다 — 파일을 모두 링크로 바꿔 한 번 더 보낸다.
      if (!posted.ok && posted.status === 413 && files.length) {
        const allLinks = (await Promise.all(sources.map((src) => mediaLink(src)))).filter(Boolean).join("\n");
        const retryText = allLinks ? (text ? `${text}\n\n${allLinks}` : allLinks) : text;
        posted = await postDiscordMessage({ webhookUrl: hook.webhookUrl, content: retryText.length <= DISCORD_CONTENT_LIMIT ? retryText : text });
      }
      if (!posted.ok) {
        // (502 는 Cloudflare 가 본문을 오류 페이지로 갈아치워 원인이 사라지므로 500 을 쓴다)
        // 웹훅이 지워졌거나 무효해졌다 — 재연결이 유일한 해법이다.
        if (posted.status === 401 || posted.status === 404) {
          await writeDiscordEntry(env, publishUserId, { needsReconnect: true }).catch(() => {});
          return send({ error: "디스코드 웹훅이 삭제됐거나 무효합니다. SNS 설정에서 다시 연결해 주세요." }, 500);
        }
        return send({ error: posted.error, ...(posted.retryAfterSec != null ? { retryAfterSec: posted.retryAfterSec } : {}) }, 500);
      }
      let note = "";
      if (followLinks) {
        const extra = await postDiscordMessage({ webhookUrl: hook.webhookUrl, content: followLinks.slice(0, DISCORD_CONTENT_LIMIT) });
        if (!extra.ok) note = "본문은 올렸지만 큰 파일 링크 메시지는 올리지 못했습니다.";
      }
      const channelId = posted.channelId || hook.channelId;
      return send({
        ok: true,
        result: {
          platform: "discord",
          postId: posted.messageId,
          url: discordMessageUrl(hook.guildId, channelId, posted.messageId),
          username: hook.username,
          status: "published",
          publishedAt: new Date().toISOString(),
          ...(links.length ? { linkedFiles: links.length } : {}),
          ...(note ? { note } : {}),
        },
      });
    }

    return send({ error: `'${platform}' 플랫폼은 아직 지원되지 않습니다.` }, 400);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { tiktokCode?: string })?.tiktokCode || '';
    const detail = (err as { detail?: string })?.detail || '';
    if (code) {
      // 클라이언트가 code 로 한/영 안내 문구를 고른다. 원문 detail 도 함께 주되
      // 화면에는 code 기반 문구를 우선 쓴다.
      return send({ ok: false, error: msg, code, detail }, 502);
    }
    if (platform === "instagram" || platform === "threads") {
      const needsReconnect = isInstagramTokenError(msg) || Number((err as any)?.metaCode) === 190;
      if (needsReconnect && usedMetaToken) {
        const { snsContext } = await import("../_shared/sns-store.js");
        await patchSnsPlatform(await snsContext(env, publishUserId), platform, { needsReconnect: true }, usedMetaToken).catch(() => {});
      }
      return send({ ok: false, error: needsReconnect ? platform + "_reconnect_required" : "sns_publish_failed", needsReconnect,
        category: needsReconnect ? "reconnect_required" : /permission|scope|code.?10/i.test(msg) || Number((err as any)?.metaCode) === 10 ? "permission_required" : "connection_failed" }, needsReconnect ? 412 : 502);
    }
    return send({ ok: false, error: msg }, 500);
  }
};
