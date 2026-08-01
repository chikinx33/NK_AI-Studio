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
    // 심사 제출 스코프 3개.
    //  - video.list 제거: 이 앱에 Display API 제품이 추가돼 있지 않아 요청해도 토큰에
    //    실리지 않는다(Analytics 의 TikTok "권한 필요"가 이것 때문). 승인 후 별도 신청.
    //  - video.upload 유지: 초안함(inbox) 업로드에서 실제로 쓴다.
    //    요청만 하고 데모로 증명 못 하는 스코프는 그 자체가 반려 사유가 되므로,
    //    이 스코프를 넣는 한 api/sns/tiktok/inbox 흐름을 반드시 유지할 것.
    scope: "user.info.basic,video.publish,video.upload",
    response_type: "code",
    redirect_uri: redirectUri,
    state,
  });

  const oauthUrl = `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;

  return send({ ok: true, oauthUrl });
};
