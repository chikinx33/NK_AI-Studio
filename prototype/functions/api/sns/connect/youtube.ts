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

  const clientId = env.YOUTUBE_CLIENT_ID;
  if (!clientId) {
    return send({ error: "YOUTUBE_CLIENT_ID not configured" }, 500);
  }

  const redirectUri = env.YOUTUBE_REDIRECT_URI || "https://nk-ai-studio.pages.dev/auth/youtube/callback";

  const state = btoa(JSON.stringify({
    userId: auth.userId,
    ts: Date.now(),
  }));

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/youtube.upload",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });

  const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return send({ ok: true, oauthUrl });
};
