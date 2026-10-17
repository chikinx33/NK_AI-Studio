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

  const appId = env.META_APP_ID;
  const redirectUri = env.FACEBOOK_REDIRECT_URI;

  if (!appId || !redirectUri) {
    return send({ error: "META_APP_ID or FACEBOOK_REDIRECT_URI not configured" }, 500);
  }

  // 한 Facebook 사용자가 여러 페이지를 관리할 때 이 nkstudio 계정에 붙일 페이지(id 또는 이름).
  // btoa 는 Latin-1 만 받으므로 한글 이름은 encodeURIComponent 로 감싼다.
  const pageHint = String(new URL(request.url).searchParams.get("page") || "").trim().slice(0, 100);

  const state = btoa(JSON.stringify({
    userId: auth.userId,
    ts: Date.now(),
    ...(pageHint ? { pageHint: encodeURIComponent(pageHint) } : {}),
  }));

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: "public_profile,pages_show_list,pages_manage_posts,pages_read_engagement,business_management,pages_manage_engagement",
    response_type: "code",
    state,
  });

  const oauthUrl = `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;

  return send({ ok: true, oauthUrl });
};
