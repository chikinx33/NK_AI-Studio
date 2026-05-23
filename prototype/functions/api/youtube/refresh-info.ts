import { authorizeRequest } from "../_shared/auth.js";
import {
  ensureFreshAccessToken,
  getGoogleServiceAccountToken,
  resolveGcsContextForUser,
  writeYoutubeWithShortsMirror,
  writeYoutubePatch,
} from "../_shared/youtube-token";

// 토큰 만료/취소를 GCS sns.youtube.needsReconnect=true 로 영속화(best-effort).
async function persistNeedsReconnect(env: any, userId: string): Promise<void> {
  try {
    const googleToken = await getGoogleServiceAccountToken({
      clientEmail: env.GOOGLE_CLIENT_EMAIL,
      privateKeyPem: env.GOOGLE_PRIVATE_KEY,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });
    const gcs = resolveGcsContextForUser(env, userId);
    await writeYoutubePatch({ ...gcs, googleToken }, { needsReconnect: true });
  } catch (_) { /* best-effort */ }
}

function send(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * 현재 저장된 user OAuth 토큰으로 channels.list?mine=true 호출 →
 * channelId/channelTitle 을 GCS sns.youtube 및 sns['youtube-shorts'] 에 mirror 저장.
 *
 * 토큰이 youtube.readonly 스코프를 못 받은 구버전 연결인 경우 403 가 떨어진다.
 * 그 경우 needsReconnect: true 를 반환 → 프론트가 재연결을 유도.
 */
export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);

  let userAccessToken: string;
  try {
    userAccessToken = await ensureFreshAccessToken(env, auth.userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "youtube_not_connected") return send({ error: msg, needsReconnect: true }, 412);
    // 토큰 만료/취소 → ensureFreshAccessToken 이 이미 needsReconnect 를 저장함
    if (msg === "youtube_reconnect_required") return send({ error: msg, needsReconnect: true }, 412);
    return send({ error: msg }, 500);
  }

  const chRes = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    { headers: { Authorization: `Bearer ${userAccessToken}` } }
  );

  if (chRes.status === 401 || chRes.status === 403) {
    await persistNeedsReconnect(env, auth.userId);
    return send(
      { error: "insufficient_scope", needsReconnect: true, detail: await chRes.text() },
      412
    );
  }
  if (!chRes.ok) {
    return send({ error: `youtube_api_error_${chRes.status}`, detail: await chRes.text() }, 502);
  }

  const data = (await chRes.json()) as {
    items?: Array<{ id?: string; snippet?: { title?: string; customUrl?: string } }>;
  };
  const first = data.items?.[0];
  const channelId = first?.id || "";
  const channelTitle = first?.snippet?.title || "";
  const channelHandle = first?.snippet?.customUrl || "";  // e.g. "@shapesU"

  if (!channelId && !channelTitle) {
    return send({ error: "no_channel_found" }, 404);
  }

  // GCS 미러 업데이트 (youtube + youtube-shorts 모두)
  try {
    const googleToken = await getGoogleServiceAccountToken({
      clientEmail: env.GOOGLE_CLIENT_EMAIL,
      privateKeyPem: env.GOOGLE_PRIVATE_KEY,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });
    const gcs = resolveGcsContextForUser(env, auth.userId);
    await writeYoutubeWithShortsMirror(
      { ...gcs, googleToken },
      { channelId, channelTitle, channelHandle }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return send({ error: msg }, 500);
  }

  return send({ ok: true, channelId, channelTitle, channelHandle });
};
