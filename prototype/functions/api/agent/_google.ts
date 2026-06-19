// prototype/functions/api/agent/_google.ts
// 싱크(비서) 구글 연동 공통 헬퍼 — Gmail(읽기) + Calendar(읽기/쓰기) OAuth.
// 한 번의 동의로 두 스코프를 받아 refresh_token 을 user_id 별로 Neon 에 저장한다.
// 로그인용 OAuth(api/auth/google)와 별개의 연동 흐름(offline + 확장 스코프).

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
export const GOOGLE_CONNECT_SCOPES = `openid email ${GMAIL_SCOPE} ${CALENDAR_SCOPE}`;

/** 연동용 OAuth 클라이언트 자격증명. 로그인용 클라이언트를 재사용하되 전용 env 우선. */
export function googleConnectCreds(env: any): { clientId: string; clientSecret: string } {
  const clientId = String(
    env?.GOOGLE_CONNECT_CLIENT_ID || env?.GOOGLE_LOGIN_CLIENT_ID || env?.GOOGLE_CLIENT_ID || ""
  ).trim();
  const clientSecret = String(
    env?.GOOGLE_CONNECT_CLIENT_SECRET || env?.GOOGLE_LOGIN_CLIENT_SECRET || env?.GOOGLE_CLIENT_SECRET || ""
  ).trim();
  return { clientId, clientSecret };
}

/** 연동 콜백 redirect_uri (요청 origin 기준 — GCP 콘솔에 이 값을 등록). */
export function connectRedirectUri(request: Request, env: any): string {
  const custom = String(env?.GOOGLE_CONNECT_REDIRECT_URI || "").trim();
  if (custom) return custom;
  return `${new URL(request.url).origin}/api/agent/google/callback`;
}

/** authorize URL 생성. state 에 단기 세션 토큰을 담아 콜백에서 userId 복원·검증. */
export function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: GOOGLE_CONNECT_SCOPES,
    state,
    access_type: "offline",
    prompt: "consent", // refresh_token 을 매번 확실히 발급
    include_granted_scopes: "true",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** authorization code → 토큰(access_token / refresh_token / scope). */
export async function exchangeCode(
  env: any,
  code: string,
  redirectUri: string
): Promise<{ access_token: string; refresh_token: string; scope: string }> {
  const { clientId, clientSecret } = googleConnectCreds(env);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  const data = (await res.json()) as Record<string, any>;
  if (!res.ok) throw new Error(data?.error_description || data?.error || `token exchange ${res.status}`);
  return {
    access_token: String(data.access_token || ""),
    refresh_token: String(data.refresh_token || ""),
    scope: String(data.scope || ""),
  };
}

/** refresh_token → access_token (도구 실행 시마다 갱신). */
export async function refreshAccessToken(env: any, refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = googleConnectCreds(env);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const data = (await res.json()) as Record<string, any>;
  if (!res.ok) throw new Error(data?.error_description || data?.error || `token refresh ${res.status}`);
  const access = String(data.access_token || "");
  if (!access) throw new Error("no access_token");
  return access;
}

/** access_token → 구글 이메일(연결 계정 표시용). */
export async function fetchUserEmail(accessToken: string): Promise<string> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return "";
    const info = (await res.json()) as Record<string, any>;
    return String(info.email || "").trim().toLowerCase();
  } catch {
    return "";
  }
}
