import { getGoogleServiceAccountToken, resolveGcsContextForUser } from "../../api/_shared/youtube-token";
import { writeXPatch } from "../../api/_shared/x-token";

// X 는 팝업 환경에서 로그인 세션을 인식하지 못해 authorize 단계에서 400 이 나므로,
// 다른 SNS 의 popup+postMessage 와 달리 현재 탭 리다이렉트 방식으로 처리한다.
// 결과는 SNS 설정 페이지로 302 리다이렉트하며 sns=x & connected/error 쿼리로 전달한다.
function redirectResult(returnTo: string, params: Record<string, string>) {
  // returnTo 는 connect 단계에서 검증된 같은 사이트 절대경로. 비어있으면 기본 페이지로.
  const base = returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")
    ? returnTo
    : "/sns-settings.html";
  const qs = new URLSearchParams(Object.assign({ sns: "x" }, params)).toString();
  const sep = base.includes("?") ? "&" : "?";
  return new Response(null, {
    status: 302,
    headers: { Location: base + sep + qs },
  });
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDesc = url.searchParams.get("error_description");

  // state 를 먼저 디코드해 returnTo 를 확보(에러 리다이렉트에도 사용).
  let userId = "owner";
  let codeVerifier = "";
  let returnTo = "";
  if (stateRaw) {
    try {
      const decoded = JSON.parse(atob(stateRaw));
      userId = String(decoded.userId || "owner");
      codeVerifier = String(decoded.v || "");
      returnTo = String(decoded.r || "");
    } catch {
      return redirectResult("", { error: "Invalid state" });
    }
  }

  if (error) {
    return redirectResult(returnTo, { error: "OAuth cancelled: " + (errorDesc || error) });
  }
  if (!code || !stateRaw) return redirectResult(returnTo, { error: "Missing code or state" });
  if (!codeVerifier) return redirectResult(returnTo, { error: "Missing PKCE verifier" });

  const clientId = env.X_CLIENT_ID;
  const clientSecret = env.X_CLIENT_SECRET;
  const redirectUri = env.X_REDIRECT_URI || "https://nk-ai-studio.pages.dev/auth/x/callback";

  if (!clientId || !clientSecret) {
    return redirectResult(returnTo, { error: "Server config missing" });
  }

  try {
    // Step 1: code → 액세스 토큰 + refresh 토큰 (confidential client → Basic 인증)
    const basic = btoa(`${clientId}:${clientSecret}`);
    const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      }).toString(),
    });
    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
      error_description?: string;
    };
    if (!tokenData.access_token) {
      return redirectResult(returnTo, { error: tokenData.error_description || tokenData.error || "Token exchange failed" });
    }
    if (!tokenData.refresh_token) {
      return redirectResult(returnTo, { error: "refresh_token missing — offline.access 스코프가 필요합니다" });
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 7200) * 1000).toISOString();

    // Step 2: 사용자 정보 조회 (id, username, name)
    let xUserId = "";
    let username = "";
    let name = "";
    try {
      const meRes = await fetch("https://api.twitter.com/2/users/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const meData = (await meRes.json()) as {
        data?: { id?: string; username?: string; name?: string };
        error?: string;
      };
      xUserId = meData.data?.id || "";
      username = meData.data?.username || "";
      name = meData.data?.name || "";
    } catch {
      // 사용자 조회 실패는 치명적이지 않음 — 토큰만 저장
    }

    // Step 3: GCS 저장
    const googleToken = await getGoogleServiceAccountToken({
      clientEmail: env.GOOGLE_CLIENT_EMAIL,
      privateKeyPem: env.GOOGLE_PRIVATE_KEY,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });
    const gcs = resolveGcsContextForUser(env, userId);
    await writeXPatch(
      { ...gcs, googleToken },
      {
        connected: true,
        enabled: true,
        xUserId,
        username,
        name,
        accessToken,
        refreshToken,
        tokenExpiresAt: expiresAt,
        scope: tokenData.scope || "tweet.read tweet.write users.read offline.access",
        needsReconnect: false,
      }
    );

    return redirectResult(returnTo, { connected: "true", username: username || name || xUserId });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return redirectResult(returnTo, { error: msg });
  }
};
