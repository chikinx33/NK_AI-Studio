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
    scope: "video.publish,video.upload,user.info.basic",
    response_type: "code",
    redirect_uri: redirectUri,
    state,
  });

  const oauthUrl = `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;

  return send({ ok: true, oauthUrl });
};
