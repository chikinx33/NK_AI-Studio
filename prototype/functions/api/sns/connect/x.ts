import { authorizeRequest } from "../../_shared/auth.js";

function send(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// base64url 인코딩 (PKCE code_verifier/challenge 및 state 용)
function b64url(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

// PKCE S256: code_challenge = base64url(SHA-256(code_verifier))
// Cloudflare Workers 환경 → Node crypto 불가, Web Crypto(crypto.subtle) 사용.
async function sha256Base64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return b64url(new Uint8Array(digest));
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);

  const clientId = env.X_CLIENT_ID;
  const redirectUri = env.X_REDIRECT_URI || "https://nk-ai-studio.pages.dev/auth/x/callback";

  if (!clientId) {
    return send({ error: "X_CLIENT_ID not configured" }, 500);
  }

  // PKCE: code_verifier 를 생성해 state 에 담아 콜백으로 전달(서버 세션 저장소 없이 stateless 유지).
  // X API 는 plain 을 지원하지 않으므로 S256 방식 사용:
  // code_challenge = base64url(SHA-256(code_verifier)). 콜백에서는 state 의 raw verifier 를 그대로 전송.
  const verifierBytes = new Uint8Array(48);
  crypto.getRandomValues(verifierBytes);
  const codeVerifier = b64url(verifierBytes);
  const codeChallenge = await sha256Base64url(codeVerifier);

  const state = btoa(JSON.stringify({
    userId: auth.userId,
    v: codeVerifier,
    ts: Date.now(),
  }));

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "tweet.read tweet.write users.read media.write offline.access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  // 로그인 세션 쿠키는 x.com 도메인에 저장되므로, authorize 도 x.com 으로 호출해야
  // 세션을 인식한다. twitter.com 으로 호출하면 쿠키를 못 읽어 "Redirect is requested"(로그인
  // 플로우로 리다이렉트) invalid_request 400 이 발생한다.
  const oauthUrl = `https://x.com/i/oauth2/authorize?${params.toString()}`;

  return send({ ok: true, oauthUrl });
};
