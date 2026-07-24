// prototype/functions/api/auth/google/start.ts
// 구글 로그인 시작점: Google OAuth 2.0 authorize URL 을 생성해 반환한다.
// SNS '연동'(api/sns/connect/*)과 달리 이 흐름은 '로그인'이므로 사전 인증을 요구하지 않는다.
// 콜백(/auth/google/callback)에서 구글 이메일을 확인해 '승인된(레지스트리에 등록된) 이메일'만
// NK 세션을 발급한다.
type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const corsHeaders = (origin: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Vary": "Origin",
});

const send = (data: any, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });

// base64url 인코딩(state 용).
function b64url(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const rememberDevice = new URL(request.url).searchParams.get("rememberDevice") !== "0";

  const clientId = env.GOOGLE_LOGIN_CLIENT_ID || env.GOOGLE_CLIENT_ID;
  const redirectUri =
    env.GOOGLE_LOGIN_REDIRECT_URI || `${new URL(request.url).origin}/auth/google/callback`;

  if (!clientId) {
    return send({ error: "GOOGLE_LOGIN_CLIENT_ID not configured" }, 500, origin);
  }

  // CSRF 방지용 nonce + 발급시각을 state 에 담는다(서버 세션 저장소 없이 stateless 유지).
  // 콜백에서 ts 신선도(10분)만 검증한다 — 이 앱의 위협모델 및 기존 OAuth 코드와 동일한 수준.
  const nonceBytes = new Uint8Array(24);
  crypto.getRandomValues(nonceBytes);
  const state = b64url(new TextEncoder().encode(JSON.stringify({
    n: b64url(nonceBytes),
    ts: Date.now(),
    rememberDevice,
  })));

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
    include_granted_scopes: "true",
  });

  const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return send({ ok: true, oauthUrl }, 200, origin);
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
