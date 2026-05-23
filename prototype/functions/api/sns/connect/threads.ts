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

  const appId = env.THREADS_APP_ID;
  const redirectUri = env.THREADS_REDIRECT_URI;

  if (!appId || !redirectUri) {
    return send({ error: "THREADS_APP_ID or THREADS_REDIRECT_URI not configured" }, 500);
  }

  const state = btoa(JSON.stringify({
    userId: auth.userId,
    ts: Date.now(),
  }));

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: "threads_basic,threads_content_publish",
    response_type: "code",
    state,
  });

  const oauthUrl = `https://threads.net/oauth/authorize?${params.toString()}`;

  return send({ ok: true, oauthUrl });
};
