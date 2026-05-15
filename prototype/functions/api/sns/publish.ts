import { buildUserDataObject, gcsObjectPath } from "../_shared/storage";
import { authorizeRequest } from "../_shared/auth.js";
import { ensureFreshAccessToken } from "../_shared/youtube-token";
import { getFacebookPageToken } from "../_shared/facebook-token";

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
function readMediaSecret(env: any): string {
  return String(
    (env && (env.AUTH_SESSION_SECRET || env.NK_AUTH_SESSION_SECRET)) ||
    (env && (env.AUTH_PW || env.GOOGLE_PRIVATE_KEY || env.GOOGLE_PROJECT_ID)) ||
    "nk_studio_legacy_session_secret_v1"
  ).trim();
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
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
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

/**
 * TikTok 발행 상태를 폴링한다.
 *
 * 중요: init 이 publish_id 를 반환한 시점에 TikTok 은 이미 발행을 "수락"한 것이며,
 * 실제 처리는 비동기로 진행돼 수 분이 걸릴 수 있다. 이 세션에서 status 폴링은
 * 타임아웃·FAILED 를 반환해도 실제로는 게시가 정상 완료된 사례가 반복 확인됐다.
 * 즉 status 폴링은 신뢰할 수 있는 성공/실패 oracle 이 아니다. 따라서:
 *  - 절대 throw 하지 않는다 (배포를 막지 않음).
 *  - 결과는 정보성으로만 반환하고, FAILED 면 fail_reason 을 캡처해 노출한다.
 * 진짜 init 단계 실패(파라미터/ownership 등)는 init 호출에서 이미 throw 되므로
 * 여기서 막을 필요가 없다.
 */
async function waitForTikTokStatus(
  accessToken: string,
  publishId: string,
  maxRetries = 12,
  intervalMs = 3000
): Promise<{ status: "complete" | "processing" | "failed"; failReason?: string }> {
  let lastStatus = "";
  for (let i = 0; i < maxRetries; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    let status: string | undefined;
    let failReason: string | undefined;
    try {
      const r = await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ publish_id: publishId }),
      });
      const d = (await r.json()) as {
        data?: { status?: string; fail_reason?: string };
        error?: { code?: string; message?: string };
      };
      status = d.data?.status;
      failReason = d.data?.fail_reason;
      console.log(`[tiktok] status poll ${i + 1}/${maxRetries}: ${JSON.stringify(d.data || {})} (publish_id: ${publishId})`);
    } catch (err) {
      // 상태 조회 일시 실패는 무시하고 계속 폴링
      console.log(`[tiktok] status poll ${i + 1}/${maxRetries} fetch 실패:`, err);
      continue;
    }
    if (status) lastStatus = status;
    if (status === "PUBLISH_COMPLETE") return { status: "complete" };
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

/**
 * 게시 전 creator_info 조회로 해당 앱·계정이 허용하는 privacy level을 가져온다.
 * 심사 미통과(unaudited) 앱은 보통 ["SELF_ONLY"]만 허용되며, 허용되지 않는
 * privacy_level로 init을 호출하면 "integration guidelines" 에러가 난다.
 */
/**
 * creator_info 를 조회하고 사용할 privacy_level 을 결정한다.
 *
 * 중요: TikTok 앱이 심사(audit)를 통과하기 전에는 `unaudited_client_can_only_post_
 * to_private_accounts` 에러로 SELF_ONLY 외 게시가 모두 거부된다. creator_info 가
 * 돌려주는 privacy_level_options 는 "계정 설정" 기준이라 PUBLIC 이 포함돼 있어도
 * 앱이 미심사면 못 쓴다. 따라서 기본값은 SELF_ONLY 로 강제하고, 앱 심사를 통과한
 * 뒤에는 env.TIKTOK_APP_AUDITED="true" 로 공개 게시를 허용한다.
 */
async function getTikTokCreatorInfo(
  accessToken: string,
  appAudited: boolean
): Promise<{ level: string; raw: any }> {
  let raw: any = {};
  let options: string[] = [];
  try {
    const res = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    });
    const d = (await res.json()) as {
      data?: { privacy_level_options?: string[] };
      error?: { code?: string; message?: string };
    };
    console.log(`[tiktok] creator_info 응답 (${res.status}):`, JSON.stringify(d));
    options = d.data?.privacy_level_options || [];
    raw = { httpStatus: res.status, ...d };
  } catch (err) {
    console.log(`[tiktok] creator_info 조회 실패:`, err);
    raw = { fetchError: String(err) };
  }

  // 미심사 앱은 무조건 SELF_ONLY. 심사 통과 후에만 공개 게시 허용.
  let level = "SELF_ONLY";
  if (appAudited && options.includes("PUBLIC_TO_EVERYONE")) {
    level = "PUBLIC_TO_EVERYONE";
  }
  return { level, raw: { ...raw, appAudited } };
}

async function publishTikTokVideo(opts: {
  accessToken: string;
  caption: string;
  videoUrl: string;
  appAudited: boolean;
}): Promise<{ publishId: string }> {
  const { accessToken, caption, videoUrl, appAudited } = opts;
  console.log(`[tiktok] 영상 발행 시작 (file_upload): ${videoUrl.slice(0, 80)}...`);

  // Step 1: 영상 크기 확인 (HEAD)
  const headRes = await fetch(videoUrl, { method: "HEAD" });
  if (!headRes.ok) throw new Error(`영상 메타데이터 조회 실패: ${headRes.status}`);
  const videoSize = parseInt(headRes.headers.get("content-length") || "0");
  if (!videoSize) throw new Error("영상 파일 크기를 확인할 수 없습니다");
  if (videoSize > 100 * 1024 * 1024) {
    throw new Error(`영상이 너무 큽니다 (${Math.round(videoSize / 1024 / 1024)}MB, 최대 100MB)`);
  }
  console.log(`[tiktok] 영상 크기: ${Math.round(videoSize / 1024)}KB`);

  // Step 1.5: 허용된 privacy level 조회 (심사 미통과 앱은 SELF_ONLY만 가능)
  const creatorInfo = await getTikTokCreatorInfo(accessToken, appAudited);
  const privacyLevel = creatorInfo.level;
  console.log(`[tiktok] 사용할 privacy_level: ${privacyLevel}`);

  // Step 2: TikTok 발행 초기화 (FILE_UPLOAD)
  const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      post_info: {
        title: caption.slice(0, 2200),
        privacy_level: privacyLevel,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
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
      `creatorInfo=${JSON.stringify(creatorInfo.raw)}`,
    ].join(" | ");
    throw new Error(`TikTok 영상 발행 초기화 실패: ${detail}`);
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
  console.log(`[tiktok] 영상 업로드 완료, 상태 폴링 시작`);
  const r = await waitForTikTokStatus(accessToken, publishId);
  console.log(`[tiktok] 영상 발행 status=${r.status}: ${publishId}`);
  return { publishId, status: r.status, failReason: r.failReason };
}

async function publishTikTokPhoto(opts: {
  accessToken: string;
  caption: string;
  photoUrls: string[];
  appAudited: boolean;
}): Promise<{ publishId: string }> {
  const { accessToken, caption, photoUrls, appAudited } = opts;
  console.log(`[tiktok] 이미지 발행 시작 (${photoUrls.length}장, photo_mode)`);
  const creatorInfo = await getTikTokCreatorInfo(accessToken, appAudited);
  const privacyLevel = creatorInfo.level;
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
        privacy_level: privacyLevel,
        disable_comment: false,
        auto_add_music: true,
        // TikTok Photo Post API 필수: 두 brand 토글은 항상 포함해야 함
        brand_content_toggle: false,
        brand_organic_toggle: false,
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
      `creatorInfo=${JSON.stringify(creatorInfo.raw)}`,
    ].join(" | ");
    throw new Error(`TikTok 이미지 발행 초기화 실패: ${detail}`);
  }
  const publishId = data.data.publish_id;
  console.log(`[tiktok] 이미지 발행 초기화 완료, publish_id: ${publishId}. 상태 폴링 시작.`);
  const r = await waitForTikTokStatus(accessToken, publishId);
  console.log(`[tiktok] 이미지 발행 status=${r.status}: ${publishId}`);
  return { publishId, status: r.status, failReason: r.failReason };
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
}): Promise<{ postId: string }> {
  const { pageId, pageToken, mediaUrl, caption } = opts;
  const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: mediaUrl, message: caption, access_token: pageToken }),
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
}): Promise<{ postId: string }> {
  const { pageId, pageToken, mediaUrl, caption } = opts;
  const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_url: mediaUrl, description: caption, access_token: pageToken }),
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
}): Promise<{ postId: string }> {
  const { pageId, pageToken, imageUrls, caption } = opts;

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
  const feedRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: caption, attached_media: attached, access_token: pageToken }),
  });
  const feedData = (await feedRes.json()) as { id?: string; error?: { message: string } };
  if (!feedData.id) throw new Error(`Facebook 캐러셀 게시 실패: ${feedData.error?.message}`);
  return { postId: feedData.id };
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
  };
  try {
    body = await request.json();
  } catch {
    return send({ error: "Invalid JSON" }, 400);
  }

  const { platform, caption, firstComment } = body;
  const isCarousel = Array.isArray(body.mediaItems) && body.mediaItems.length > 0;

  if (!platform || caption === undefined) {
    return send({ error: "필수 필드 누락: platform, caption" }, 400);
  }
  if (!isCarousel && !body.mediaType && !body.mediaGcsPath && !body.mediaDirectUrl) {
    return send({ error: "단일 포스트에는 mediaType, mediaGcsPath 또는 mediaDirectUrl이 필요합니다." }, 400);
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
      const objectName = buildUserDataObject(basePrefix, auth.userId, "sns-settings.json");
      console.log("[sns/publish] tiktok: bucket:", bucket, "objectName:", objectName, "userId:", auth.userId);
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

      // TikTok 앱 심사 통과 여부. 미심사 앱은 SELF_ONLY 게시만 가능.
      // 심사 통과 후 Cloudflare 환경변수 TIKTOK_APP_AUDITED="true" 설정 시 공개 게시 허용.
      const appAudited = String(env.TIKTOK_APP_AUDITED || "").toLowerCase() === "true";

      // Photo PULL_FROM_URL 의 도메인 ownership 검증을 위해 우리 도메인 프록시 사용.
      const origin = new URL(request.url).origin;
      const mediaSecret = readMediaSecret(env);

      const publishResults: {
        publishId: string;
        type: string;
        status: "complete" | "processing" | "failed";
        failReason?: string;
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
          const r = await publishTikTokVideo({ accessToken, caption, videoUrl, appAudited });
          publishResults.push({ publishId: r.publishId, type: "video", status: r.status, failReason: r.failReason });
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
          const r = await publishTikTokPhoto({ accessToken, caption, photoUrls, appAudited });
          publishResults.push({ publishId: r.publishId, type: "photo", status: r.status, failReason: r.failReason });
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
          const r = await publishTikTokVideo({ accessToken, caption, videoUrl, appAudited });
          publishResults.push({ publishId: r.publishId, type: "video", status: r.status, failReason: r.failReason });
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
          const r = await publishTikTokPhoto({ accessToken, caption, photoUrls: [photoUrl], appAudited });
          publishResults.push({ publishId: r.publishId, type: "photo", status: r.status, failReason: r.failReason });
        }
      }

      // publish_id 가 발급된 시점에 TikTok 은 발행을 수락한 상태이므로 항상 ok:true.
      // status 폴링 결과는 정보성: 전부 complete → published, 하나라도 failed →
      // status_reported_failed(이 세션에서 FAILED 여도 실제 게시 성공 사례 반복 확인됨),
      // 그 외 → processing. fail_reason 은 publishResults 에 그대로 노출된다.
      const anyFailed = publishResults.some((r) => r.status === "failed");
      const allComplete = publishResults.every((r) => r.status === "complete");
      const failReasons = publishResults
        .filter((r) => r.status === "failed" && r.failReason)
        .map((r) => `${r.type}:${r.failReason}`);
      return send({
        ok: true,
        result: {
          platform: "tiktok",
          postId: publishResults[0]?.publishId,
          username: tiktokSettings.username || "",
          status: allComplete ? "published" : (anyFailed ? "status_reported_failed" : "processing"),
          failReasons: failReasons.length ? failReasons : undefined,
          publishedAt: new Date().toISOString(),
          publishResults,
        },
      });
    }

    if (platform === "instagram") {
      const accessToken = env.IG_ACCESS_TOKEN;
      const igUserId = env.IG_USER_ID;
      if (!accessToken || !igUserId) {
        return send({ error: "Instagram 환경변수(IG_ACCESS_TOKEN, IG_USER_ID)가 설정되지 않았습니다." }, 400);
      }

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

        if (firstComment && firstComment.trim()) {
          await postInstagramComment({ postId, accessToken, message: firstComment.trim() });
        }

        return send({ ok: true, result: { platform: "instagram", postId, username: igUserId, status: "published", publishedAt: new Date().toISOString() } });

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

        if (firstComment && firstComment.trim()) {
          await postInstagramComment({ postId, accessToken, message: firstComment.trim() });
        }

        return send({ ok: true, result: { platform: "instagram", postId, username: igUserId, status: "published", publishedAt: new Date().toISOString() } });
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
        userAccessToken = await ensureFreshAccessToken(env, auth.userId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "youtube_not_connected") {
          return send({ error: "YouTube 계정이 연결되지 않았습니다. SNS 설정에서 먼저 연결해 주세요." }, 412);
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
        if (!/(^|\s)#Shorts(\s|$)/i.test(description)) {
          description = description ? description + "\n\n#Shorts" : "#Shorts";
        }
        const hasShortsTag = Array.from(tagSet).some((t) => t.toLowerCase() === "shorts");
        if (!hasShortsTag) tagSet.add("Shorts");
      }
      const tags = Array.from(tagSet);

      // GCS 영상 크기 조회 → 하이브리드 분기 (50MB 임계값)
      const SERVER_RELAY_THRESHOLD = 50 * 1024 * 1024;
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
        if (contentLength <= SERVER_RELAY_THRESHOLD) {
          videoSignedUrl = await buildSignedUrl(
            bucket, body.mediaGcsPath, env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY, 3600
          );
        }
      } else if (body.mediaDirectUrl) {
        // direct URL은 HEAD로 크기 확인
        try {
          const headRes = await fetch(body.mediaDirectUrl, { method: "HEAD" });
          contentLength = Number(headRes.headers.get("content-length") || 0);
          contentType = headRes.headers.get("content-type") || "video/mp4";
        } catch { /* 크기 모르면 안전하게 클라 PUT 라우팅 */ }
        videoSignedUrl = body.mediaDirectUrl;
      }
      if (!contentLength) {
        // 크기를 모르면 클라이언트 PUT 강제
        contentLength = SERVER_RELAY_THRESHOLD + 1;
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

      const metadata = {
        snippet: {
          title: epTitleFallback.slice(0, 100),
          description: description.slice(0, 5000),
          tags,
          categoryId,
        },
        status: statusObj,
      };

      const initRes = await fetch(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
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

      // 큰 영상 분기에서도 클라가 GCS에서 직접 받아야 하므로 signed URL 보장
      let clientSourceUrl = videoSignedUrl;
      if (!clientSourceUrl && body.mediaGcsPath) {
        clientSourceUrl = await buildSignedUrl(
          bucket, body.mediaGcsPath, env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY, 3600
        );
      } else if (!clientSourceUrl && body.mediaDirectUrl) {
        clientSourceUrl = body.mediaDirectUrl;
      }

      // 하이브리드 분기 — 작은 영상은 서버 경유, 큰 영상은 클라 직접 PUT
      if (contentLength <= SERVER_RELAY_THRESHOLD && videoSignedUrl) {
        // 서버 경유: GCS에서 영상 fetch → YouTube로 PUT
        const videoRes = await fetch(videoSignedUrl);
        if (!videoRes.ok || !videoRes.body) {
          return send({ error: `영상 fetch 실패: ${videoRes.status}` }, 502);
        }
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(contentLength),
          },
          body: videoRes.body,
        });
        if (!putRes.ok) {
          const errText = await putRes.text();
          return send({ error: `YouTube PUT 실패: ${putRes.status} ${errText}` }, 502);
        }
        const result = (await putRes.json()) as { id?: string };
        return send({
          ok: true,
          result: {
            platform,
            postId: result.id || "",
            status: publishAtIso ? "scheduled" : "published",
            publishedAt: new Date().toISOString(),
            scheduledFor: publishAtIso || "",
            url: result.id ? `https://youtu.be/${result.id}` : "",
          },
        });
      } else {
        // 클라 직접 PUT: uploadUrl + sourceUrl (GCS signed) 반환
        return send({
          ok: true,
          uploadUrl,
          sourceUrl: clientSourceUrl,
          contentType,
          contentLength,
          platform,
          scheduledPublish: !!publishAtIso,
          scheduledFor: publishAtIso || "",
        });
      }
    }

    if (platform === "facebook") {
      let fbPage: { pageToken: string; pageId: string; pageName: string };
      try {
        fbPage = await getFacebookPageToken(env, auth.userId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "facebook_not_connected") {
          return send({ error: "Facebook 페이지가 연결되지 않았습니다. SNS 설정에서 먼저 연결해 주세요." }, 412);
        }
        return send({ error: msg }, 500);
      }

      const { pageToken, pageId, pageName } = fbPage;

      if (isCarousel) {
        // 캐러셀: 이미지만 지원 (동영상 혼합 시 이미지만 필터링)
        const rawItems = body.mediaItems!;
        const imageUrls: string[] = [];
        for (let i = 0; i < rawItems.length; i++) {
          const item = rawItems[i];
          if (item.mediaType === "video") continue; // Facebook 캐러셀은 이미지만
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
          // 이미지 1장이면 단일 포스트
          const { postId } = await publishPhotoToFacebook({ pageId, pageToken, mediaUrl: imageUrls[0], caption });
          return send({ ok: true, result: { platform: "facebook", postId, username: pageName, status: "published", publishedAt: new Date().toISOString() } });
        }
        const { postId } = await publishCarouselToFacebook({ pageId, pageToken, imageUrls, caption });
        return send({ ok: true, result: { platform: "facebook", postId, username: pageName, status: "published", publishedAt: new Date().toISOString() } });

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

        if (mediaType === "video") {
          const { postId } = await publishVideoToFacebook({ pageId, pageToken, mediaUrl, caption });
          return send({ ok: true, result: { platform: "facebook", postId, username: pageName, status: "published", publishedAt: new Date().toISOString() } });
        } else {
          const { postId } = await publishPhotoToFacebook({ pageId, pageToken, mediaUrl, caption });
          return send({ ok: true, result: { platform: "facebook", postId, username: pageName, status: "published", publishedAt: new Date().toISOString() } });
        }
      }
    }

    return send({ error: `'${platform}' 플랫폼은 아직 지원되지 않습니다.` }, 400);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return send({ ok: false, error: msg }, 500);
  }
};
