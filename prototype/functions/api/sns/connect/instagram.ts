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
  const redirectUri = env.META_REDIRECT_URI;

  if (!appId || !redirectUri) {
    return send({ error: "META_APP_ID or META_REDIRECT_URI not configured" }, 500);
  }

  const state = btoa(JSON.stringify({
    userId: auth.userId,
    ts: Date.now(),
  }));

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: [
      "instagram_business_basic",
      "instagram_business_content_publish",
    ].join(","),
    response_type: "code",
    state,
  });

  // Instagram Business Login endpoint (new, replaces deprecated Facebook Login scopes)
  const oauthUrl = `https://api.instagram.com/oauth/authorize?${params.toString()}`;

  return send({ ok: true, oauthUrl });
};
