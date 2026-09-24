// prototype/functions/api/sns/post-proof.ts
// POST /api/sns/post-proof { platform, postId }
//
// 채널에 실제로 올라간 게시물 한 건의 "확인 정보"(대표 이미지·링크·캡션·시각)를 채널 API 에서 받아온다.
// 에이전트의 publish_proof 도구가 "각 채널에 올라간 걸 보여줘" 에 답할 때 쓴다(2026-09-24).
//  - instagram / facebook / threads: 연결 계정 토큰으로 Graph API 조회
//  - youtube(-shorts): 토큰 없이 썸네일·링크
//  - x: 링크만(무료 등급은 게시물 이미지 조회 불가)
//  - tiktok: 초안함 전송이라 공개 게시물이 없음 → unsupported
import { authorizeRequest } from "../_shared/auth.js";
import { getGoogleServiceAccountToken, readSnsSettings, resolveGcsContextForUser } from "../_shared/youtube-token";
import { getFacebookPageToken } from "../_shared/facebook-token";
import { getThreadsToken } from "../_shared/threads-token";

function send(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}
const text = (v: unknown) => String(v ?? "").trim();
function graphVersion(env: any): string {
  const value = text(env.META_GRAPH_VERSION || "v21.0");
  return /^v\d+\.\d+$/.test(value) ? value : "v21.0";
}
async function readJson(res: Response): Promise<any> { try { return await res.json(); } catch { return {}; } }

export interface PostProof {
  platform: string; postId: string; permalink: string; imageUrl: string; mediaType: string;
  caption: string; publishedAt: string; supported: boolean; note?: string;
}

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);
  let body: any = {};
  try { body = await request.json(); } catch { body = {}; }
  const platform = text(body?.platform).toLowerCase();
  const postId = text(body?.postId || body?.videoId || body?.id);
  if (!platform || !postId) return send({ ok: false, error: "platform, postId required" }, 400);
  const userId = auth.userId;
  const base: PostProof = { platform, postId, permalink: "", imageUrl: "", mediaType: "", caption: "", publishedAt: "", supported: true };

  try {
    if (platform === "youtube" || platform === "youtube-shorts") {
      return send({ ok: true, proof: { ...base, permalink: platform === "youtube-shorts" ? `https://youtube.com/shorts/${postId}` : `https://youtu.be/${postId}`,
        imageUrl: `https://i.ytimg.com/vi/${encodeURIComponent(postId)}/hqdefault.jpg`, mediaType: "video" } });
    }
    if (platform === "x") {
      return send({ ok: true, proof: { ...base, permalink: `https://x.com/i/web/status/${postId}`, note: "X 는 현재 API 등급에서 게시물 이미지를 받을 수 없어 링크만 드려요." } });
    }
    if (platform === "tiktok") {
      return send({ ok: true, proof: { ...base, supported: false, note: "틱톡은 초안함 전송이라 사용자가 앱에서 게시하기 전엔 공개 게시물이 없어요." } });
    }
    const ver = graphVersion(env);
    if (platform === "instagram") {
      const googleToken = await getGoogleServiceAccountToken({ clientEmail: env.GOOGLE_CLIENT_EMAIL, privateKeyPem: env.GOOGLE_PRIVATE_KEY, scope: "https://www.googleapis.com/auth/cloud-platform" });
      const settings = await readSnsSettings({ ...resolveGcsContextForUser(env, userId), googleToken } as any);
      const token = text(settings?.sns?.instagram?.accessToken);
      if (!token) return send({ ok: false, error: "instagram_not_connected" }, 412);
      const url = new URL(`https://graph.instagram.com/${ver}/${encodeURIComponent(postId)}`);
      url.search = new URLSearchParams({ fields: "id,media_type,media_url,thumbnail_url,permalink,caption,timestamp", access_token: token }).toString();
      const res = await fetch(url.toString()); const data = await readJson(res);
      if (!res.ok) return send({ ok: false, error: text(data?.error?.message || `instagram_${res.status}`), reconnect: /session|token|oauth/i.test(text(data?.error?.message)) }, res.status === 400 ? 412 : 502);
      const mediaType = text(data.media_type).toLowerCase();
      return send({ ok: true, proof: { ...base, permalink: text(data.permalink), imageUrl: text(mediaType === "video" ? (data.thumbnail_url || data.media_url) : data.media_url),
        mediaType: mediaType === "video" ? "video" : (mediaType === "carousel_album" ? "carousel" : "image"), caption: text(data.caption).slice(0, 300), publishedAt: text(data.timestamp) } });
    }
    if (platform === "facebook") {
      const { pageToken } = await getFacebookPageToken(env, userId);
      const url = new URL(`https://graph.facebook.com/${ver}/${encodeURIComponent(postId)}`);
      url.search = new URLSearchParams({ fields: "id,permalink_url,full_picture,message,created_time", access_token: pageToken }).toString();
      const res = await fetch(url.toString()); const data = await readJson(res);
      if (!res.ok) return send({ ok: false, error: text(data?.error?.message || `facebook_${res.status}`) }, 502);
      return send({ ok: true, proof: { ...base, permalink: text(data.permalink_url), imageUrl: text(data.full_picture), mediaType: data.full_picture ? "image" : "", caption: text(data.message).slice(0, 300), publishedAt: text(data.created_time) } });
    }
    if (platform === "threads") {
      const { accessToken } = await getThreadsToken(env, userId);
      const url = new URL(`https://graph.threads.net/v1.0/${encodeURIComponent(postId)}`);
      url.search = new URLSearchParams({ fields: "id,media_type,media_url,thumbnail_url,permalink,text,timestamp", access_token: accessToken }).toString();
      const res = await fetch(url.toString()); const data = await readJson(res);
      if (!res.ok) return send({ ok: false, error: text(data?.error?.message || `threads_${res.status}`) }, 502);
      const mediaType = text(data.media_type).toLowerCase();
      return send({ ok: true, proof: { ...base, permalink: text(data.permalink), imageUrl: text(mediaType === "video" ? (data.thumbnail_url || data.media_url) : data.media_url),
        mediaType: mediaType.includes("video") ? "video" : (mediaType.includes("carousel") ? "carousel" : (data.media_url ? "image" : "text")), caption: text(data.text).slice(0, 300), publishedAt: text(data.timestamp) } });
    }
    return send({ ok: true, proof: { ...base, supported: false, note: `${platform} 은(는) 확인 조회를 지원하지 않아요.` } });
  } catch (e: any) {
    const msg = text(e?.message || e);
    return send({ ok: false, error: msg, reconnect: /reconnect_required|not_connected/.test(msg) }, /reconnect_required|not_connected/.test(msg) ? 412 : 502);
  }
};
