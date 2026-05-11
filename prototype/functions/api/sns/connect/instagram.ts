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
      "instagram_basic",
      "instagram_content_publish",
      "pages_read_engagement",
    ].join(","),
    response_type: "code",
    state,
  });

  const oauthUrl = `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;

  return send({ ok: true, oauthUrl });
};
