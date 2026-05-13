import { buildUserDataObject } from "../_shared/storage";
import { authorizeRequest } from "../_shared/auth.js";

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
  const encodedName = objectName.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodedName}?alt=media`,
    { headers: { Authorization: `Bearer ${googleToken}` } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GCS read error: ${res.status}`);
  return await res.json();
}

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
    void googleToken;

    const outParsed = parseGcsUri(env.VIDEO_OUTPUT_GCS_URI);
    const bucket = outParsed.bucket;

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

    return send({ error: `'${platform}' 플랫폼은 아직 지원되지 않습니다.` }, 400);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return send({ ok: false, error: msg }, 500);
  }
};
