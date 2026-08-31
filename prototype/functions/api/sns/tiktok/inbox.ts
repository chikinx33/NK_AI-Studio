/**
 * POST /api/sns/tiktok/inbox — 초안함(inbox) 업로드. 스코프: video.upload
 *
 * Direct Post(video.publish)와 다른 흐름이다. 여기서는 영상 파일만 사용자의 TikTok
 * 초안함으로 보내고, 캡션·공개 범위·상호작용 설정은 **사용자가 TikTok 앱에서 직접**
 * 마무리한다. 영상은 post_info 를 아예 싣지 않고, 사진은 TikTok 편집 화면에 그대로
 * 실리는 description 만 싣는다(공개범위·브랜드 고지는 Direct Post 전용이라 넣지 않는다).
 * 어느 쪽도 확인 모달을 거치지 않는다
 * (게시가 아니므로 Direct Post UX 가이드라인의 확인 화면 요구 대상이 아니다).
 *
 * ⚠️ video.upload 스코프를 요청하는 근거가 바로 이 엔드포인트다. 심사는 "요청한 모든
 * 스코프를 데모로 증명"을 요구하므로, 이 흐름을 지우려면 connect/tiktok.ts 의 scope
 * 문자열에서 video.upload 도 같이 빼야 한다.
 */
import { authorizeRequest, sanitizeUserId } from "../../_shared/auth.js";
import { loadShares, getGrantRole } from "../../_shared/shares";
import { getTikTokAccessToken, waitForTikTokStatus } from "../../_shared/tiktok-token";

function send(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function parseGcsUri(uri: string): { bucket: string; object: string } {
  const without = String(uri || "").replace(/^gs:\/\//, "");
  const slash = without.indexOf("/");
  if (slash === -1) return { bucket: without, object: "" };
  return { bucket: without.slice(0, slash), object: without.slice(slash + 1) };
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

/** GCS V4 signed URL. 서버가 영상을 읽어 TikTok 으로 직접 올리기 위해서만 쓴다. */
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

function readMediaSecret(env: any): string {
  return String(
    (env && (env.AUTH_SESSION_SECRET || env.NK_AUTH_SESSION_SECRET)) ||
    (env && (env.AUTH_PW || env.GOOGLE_PRIVATE_KEY || env.GOOGLE_PROJECT_ID)) ||
    "nk_studio_legacy_session_secret_v1"
  ).trim();
}

async function hmacSha256B64url(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  let bin = "";
  new Uint8Array(sig).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/**
 * GCS 객체를 우리 도메인 경로(/api/sns/tiktok-media)로 중계하는 서명 URL.
 * TikTok PULL_FROM_URL 은 URL 이 ownership 인증된 도메인 아래일 것을 요구한다.
 * publish.ts 의 buildTikTokProxyUrl 과 같은 서명 규칙을 쓴다 — 한쪽만 바꾸지 말 것.
 */
async function buildTikTokProxyUrl(
  origin: string, objectName: string, secret: string, ttlSec = 3600
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = await hmacSha256B64url(secret, `${objectName}|${exp}`);
  return `${origin}/api/sns/tiktok-media?o=${encodeURIComponent(objectName)}&e=${exp}&s=${encodeURIComponent(sig)}`;
}

/**
 * 초안 전송에서 실제로 자주 나오는 오류를 사용자가 알아볼 문장으로 바꾼다.
 * 코드 목록 출처: Content Posting API Reference — Photo / Upload 의 error codes 표.
 */
function describeInboxError(rawCode: string, rawMsg: string): { error: string; code: string } | null {
  const c = String(rawCode || "");
  const tail = rawMsg ? ` (${rawMsg})` : "";
  if (c.includes("spam_risk_too_many_pending_share")) {
    return {
      code: "inbox_pending_cap",
      error:
        "TikTok 초안함에 아직 게시하지 않은 업로드가 쌓여 있습니다. 24시간에 5개까지만 보낼 수 있어요. " +
        "TikTok 앱에서 기존 초안을 게시하거나 지운 뒤 다시 시도해 주세요. / " +
        "Too many pending uploads in the TikTok inbox (max 5 per 24 hours)." + tail,
    };
  }
  if (c.includes("app_version_check_failed")) {
    return {
      code: "tiktok_app_too_old",
      error:
        "TikTok 앱 버전이 낮아 초안을 받을 수 없습니다. 앱을 31.8 이상으로 업데이트해 주세요. / " +
        "The TikTok app must be version 31.8 or newer to receive uploads." + tail,
    };
  }
  if (c.includes("url_ownership_unverified")) {
    return {
      code: "url_ownership_unverified",
      error:
        "TikTok 개발자 포털의 도메인 인증이 확인되지 않습니다. URL properties 에서 " +
        "nkstudio.org 인증 상태를 확인해 주세요. / TikTok could not verify URL ownership." + tail,
    };
  }
  if (c.includes("spam_risk_too_many_posts") || c.includes("reached_active_user_cap")) {
    return {
      code: "tiktok_daily_cap",
      error:
        "TikTok 일일 업로드 한도에 도달했습니다. 내일 다시 시도해 주세요. / " +
        "Daily upload cap reached for this account." + tail,
    };
  }
  if (c.includes("spam_risk_user_banned_from_posting")) {
    return {
      code: "tiktok_user_banned",
      error: "이 TikTok 계정은 현재 게시가 제한되어 있습니다. / This TikTok account is banned from posting." + tail,
    };
  }
  if (c.includes("scope_not_authorized")) {
    return {
      code: "tiktok_reconnect_required",
      error:
        "TikTok 연결에 업로드 권한이 없습니다. SNS 설정에서 재연결해 주세요. / " +
        "The TikTok connection is missing the video.upload grant." + tail,
    };
  }
  return null;
}

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);

  let body: {
    mediaGcsPath?: string;
    mediaDirectUrl?: string;
    // 사진 초안: content/init + MEDIA_UPLOAD 로 보낸다. PULL_FROM_URL 만 허용되므로
    // GCS 객체는 반드시 우리 도메인 프록시를 거친다.
    photoGcsPaths?: string[];
    photoUrls?: string[];
    caption?: string;
    projectId?: string;
    ownerId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return send({ error: "Invalid JSON" }, 400);
  }

  // 공유받은 프로젝트는 소유자 자격증명으로 업로드 (publish.ts 와 동일한 권한 검증)
  let targetUserId = auth.userId;
  const reqOwnerId = sanitizeUserId(body.ownerId || "");
  const reqProjectId = String(body.projectId || "").trim();
  if (reqOwnerId && reqOwnerId !== auth.userId) {
    if (!reqProjectId) return send({ error: "projectId required for shared publish" }, 400);
    const sharesReg = await loadShares(env);
    const role = getGrantRole(sharesReg, reqOwnerId, reqProjectId, auth.userId);
    if (role !== "editor") return send({ error: "forbidden: editor role required to publish" }, 403);
    targetUserId = reqOwnerId;
  }

  const photoGcsPaths = Array.isArray(body.photoGcsPaths)
    ? body.photoGcsPaths.map((v) => String(v || "").trim()).filter(Boolean) : [];
  const photoUrls = Array.isArray(body.photoUrls)
    ? body.photoUrls.map((v) => String(v || "").trim()).filter(Boolean) : [];
  const isPhoto = photoGcsPaths.length > 0 || photoUrls.length > 0;

  if (!isPhoto && !body.mediaGcsPath && !body.mediaDirectUrl) {
    return send({ error: "보낼 영상 또는 사진이 필요합니다." }, 400);
  }

  try {
    const { accessToken } = await getTikTokAccessToken(env, targetUserId);

    const origin = new URL(request.url).origin;
    const mediaSecret = readMediaSecret(env);

    // ── 사진 초안 ────────────────────────────────────────────────────────────
    // /v2/post/publish/content/init/ + post_mode:"MEDIA_UPLOAD". 영상과 달리
    // PULL_FROM_URL 만 허용되므로 프록시 경유가 선택이 아니라 필수다.
    // title/description 은 MEDIA_UPLOAD 에서도 지원되고 TikTok 편집 화면에 그대로 실린다.
    if (isPhoto) {
      const photoImages: string[] = [];
      for (const gp of photoGcsPaths) {
        photoImages.push(await buildTikTokProxyUrl(origin, gp, mediaSecret));
      }
      for (const pu of photoUrls) photoImages.push(pu);
      // TikTok 상한 35장.
      const images = photoImages.slice(0, 35);

      const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/content/init/", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({
          post_info: { description: String(body.caption || "").trim().slice(0, 4000) },
          source_info: { source: "PULL_FROM_URL", photo_images: images, photo_cover_index: 0 },
          post_mode: "MEDIA_UPLOAD",
          media_type: "PHOTO",
        }),
      });
      const initData = (await initRes.json()) as {
        data?: { publish_id?: string };
        error?: { code?: string; message?: string };
      };
      console.log(`[tiktok] content/init (MEDIA_UPLOAD/PHOTO ${images.length}장) 응답 (${initRes.status}):`, JSON.stringify(initData));
      if (!initData.data?.publish_id) {
        const friendly = describeInboxError(initData.error?.code || "", initData.error?.message || "");
        if (friendly) return send(friendly, 502);
        return send({
          error: `TikTok 사진 초안 전송 실패: httpStatus=${initRes.status} code=${initData.error?.code || "?"} msg=${initData.error?.message || "?"}`,
          code: "inbox_init_failed",
        }, 502);
      }
      const photoPublishId = initData.data.publish_id;
      const rp = await waitForTikTokStatus(accessToken, photoPublishId);
      console.log(`[tiktok] 사진 초안 status=${rp.status}: ${photoPublishId}`);
      return send({
        ok: true,
        result: {
          platform: "tiktok",
          mode: "inbox",
          mediaType: "photo",
          photoCount: images.length,
          publishId: photoPublishId,
          status: rp.status === "complete" ? "sent_to_inbox" : (rp.status === "failed" ? "status_reported_failed" : "processing"),
          failReason: rp.failReason,
          sentAt: new Date().toISOString(),
        },
      });
    }

    /*
     * 전송 방식 결정.
     *  PULL_FROM_URL — TikTok 이 우리 도메인에서 직접 받아간다. 서버가 영상을 메모리로
     *    들고 있지 않으므로 64MB 단일청크 상한이 없다. 단 URL 이 ownership 인증된
     *    도메인(nkstudio.org) 아래여야 해서 GCS 객체는 /api/sns/tiktok-media 로 낸다.
     *  FILE_UPLOAD — 우리 도메인 밖 직접 URL 이 들어온 경우의 대비책. 통짜 전송이라 64MB 상한.
     */
    let pullUrl = "";
    let fallbackFileUrl = "";

    if (body.mediaGcsPath) {
      pullUrl = await buildTikTokProxyUrl(origin, body.mediaGcsPath, mediaSecret);
      const { bucket } = parseGcsUri(env.VIDEO_OUTPUT_GCS_URI);
      fallbackFileUrl = await buildSignedUrl(
        bucket, body.mediaGcsPath, env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY, 3600
      );
    } else {
      const direct = body.mediaDirectUrl!;
      fallbackFileUrl = direct;
      try {
        if (new URL(direct).origin === origin) pullUrl = direct;
      } catch { /* 잘못된 URL 은 아래 FILE_UPLOAD 경로에서 걸러진다 */ }
    }

    let publishId = "";

    if (pullUrl) {
      // Step 1: 초안함 업로드 초기화 (PULL_FROM_URL).
      // post_info 없음 — 캡션·공개 범위·상호작용은 사용자가 TikTok 앱에서 정한다.
      const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ source_info: { source: "PULL_FROM_URL", video_url: pullUrl } }),
      });
      const initData = (await initRes.json()) as {
        data?: { publish_id?: string };
        error?: { code?: string; message?: string };
      };
      console.log(`[tiktok] inbox/video/init (PULL_FROM_URL) 응답 (${initRes.status}):`, JSON.stringify(initData));
      if (!initData.data?.publish_id) {
        const friendly = describeInboxError(initData.error?.code || "", initData.error?.message || "");
        if (friendly) return send(friendly, 502);
        return send({
          error: `TikTok 초안함 업로드 초기화 실패: httpStatus=${initRes.status} code=${initData.error?.code || "?"} msg=${initData.error?.message || "?"}`,
          code: "inbox_init_failed",
        }, 502);
      }
      publishId = initData.data.publish_id;

    } else {
      // 대비책: 우리 도메인 밖 주소 — 서버가 받아서 통짜로 올린다.
      const headRes = await fetch(fallbackFileUrl, { method: "HEAD" });
      if (!headRes.ok) return send({ error: `영상 메타데이터 조회 실패: ${headRes.status}` }, 502);
      const videoSize = parseInt(headRes.headers.get("content-length") || "0");
      if (!videoSize) return send({ error: "영상 파일 크기를 확인할 수 없습니다" }, 502);
      const TIKTOK_MAX_SINGLE_CHUNK = 64 * 1024 * 1024;
      if (videoSize > TIKTOK_MAX_SINGLE_CHUNK) {
        return send({
          error:
            `영상이 너무 큽니다 (${Math.round(videoSize / 1024 / 1024)}MB). ` +
            `외부 주소 영상은 통짜 업로드만 가능하고 상한은 64MB 입니다. / ` +
            `This video is ${Math.round(videoSize / 1024 / 1024)}MB and exceeds the 64MB single-chunk limit.`,
          code: "video_too_large",
        }, 400);
      }

      const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({
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
      console.log(`[tiktok] inbox/video/init (FILE_UPLOAD) 응답 (${initRes.status}):`, JSON.stringify(initData));
      const uploadUrl = initData.data?.upload_url;
      if (!initData.data?.publish_id || !uploadUrl) {
        return send({
          error: `TikTok 초안함 업로드 초기화 실패: httpStatus=${initRes.status} code=${initData.error?.code || "?"} msg=${initData.error?.message || "?"}`,
          code: "inbox_init_failed",
        }, 502);
      }
      publishId = initData.data.publish_id;

      // Step 2: 파일 업로드
      const videoRes = await fetch(fallbackFileUrl);
      if (!videoRes.ok) return send({ error: `영상 다운로드 실패: ${videoRes.status}` }, 502);
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
        return send({ error: `TikTok 영상 업로드 실패: ${uploadRes.status} ${errText}` }, 502);
      }
    }

    // Step 3: 상태 폴링 (SEND_TO_USER_INBOX 가 완료)
    const r = await waitForTikTokStatus(accessToken, publishId);
    console.log(`[tiktok] 초안함 업로드 status=${r.status}: ${publishId}`);

    return send({
      ok: true,
      result: {
        platform: "tiktok",
        mode: "inbox",
        publishId,
        status: r.status === "complete" ? "sent_to_inbox" : (r.status === "failed" ? "status_reported_failed" : "processing"),
        failReason: r.failReason,
        sentAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log("[tiktok/inbox] 실패:", message);
    if (message.startsWith("tiktok_not_connected")) {
      return send({ error: "TikTok 계정이 연결되지 않았습니다. SNS 설정에서 먼저 연결해 주세요.", code: "tiktok_not_connected" }, 400);
    }
    if (message.startsWith("tiktok_reconnect_required") || message.startsWith("tiktok_refresh_failed")) {
      return send({ error: "TikTok 연결이 만료되었습니다. SNS 설정에서 재연결해 주세요.", code: "tiktok_reconnect_required" }, 400);
    }
    return send({ error: message, code: "inbox_failed" }, 502);
  }
};
