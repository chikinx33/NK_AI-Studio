import { authorizeRequest } from "../../_shared/auth.js";

function send(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);

  const clientKey = env.TIKTOK_CLIENT_KEY;
  if (!clientKey) {
    return send({ error: "TIKTOK_CLIENT_KEY not configured" }, 500);
  }

  const redirectUri = env.TIKTOK_REDIRECT_URI || `${new URL(request.url).origin}/auth/tiktok/callback`;

  const state = btoa(JSON.stringify({
    userId: auth.userId,
    ts: Date.now(),
  }));

  const params = new URLSearchParams({
    client_key: clientKey,
    // 심사 제출 스코프 3개. video.upload 는 코드상 사용처(inbox 게시)가 없어 제거.
    // 요청만 하고 데모로 증명 못 하는 스코프는 그 자체가 반려 사유가 된다.
    scope: "user.info.basic,video.publish,video.list",
    response_type: "code",
    redirect_uri: redirectUri,
    state,
  });

  const oauthUrl = `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;

  return send({ ok: true, oauthUrl });
};
