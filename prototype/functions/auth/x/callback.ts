import { getGoogleServiceAccountToken, resolveGcsContextForUser } from "../../api/_shared/youtube-token";
import { writeXPatch } from "../../api/_shared/x-token";

function popupHtml(result: { ok: boolean; username?: string; error?: string }) {
  const payload = JSON.stringify(result);
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>연결 중...</title></head>
<body>
<script>
  try {
    if (window.opener) {
      window.opener.postMessage({ type: 'sns_oauth_result', platform: 'x', result: ${payload} }, '*');
    }
  } catch(e) {}
  window.close();
<\/script>
<p>잠시 후 자동으로 닫힙니다...</p>
</body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDesc = url.searchParams.get("error_description");

  if (error) {
    return popupHtml({ ok: false, error: "OAuth cancelled: " + (errorDesc || error) });
  }
  if (!code || !stateRaw) return popupHtml({ ok: false, error: "Missing code or state" });

  let userId = "owner";
  let codeVerifier = "";
  try {
    const decoded = JSON.parse(atob(stateRaw));
    userId = String(decoded.userId || "owner");
    codeVerifier = String(decoded.v || "");
  } catch {
    return popupHtml({ ok: false, error: "Invalid state" });
  }
  if (!codeVerifier) return popupHtml({ ok: false, error: "Missing PKCE verifier" });

  const clientId = env.X_CLIENT_ID;
  const clientSecret = env.X_CLIENT_SECRET;
  const redirectUri = env.X_REDIRECT_URI || "https://nk-ai-studio.pages.dev/auth/x/callback";

  if (!clientId || !clientSecret) {
    return popupHtml({ ok: false, error: "Server config missing" });
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
      throw new Error(tokenData.error_description || tokenData.error || "Token exchange failed");
    }
    if (!tokenData.refresh_token) {
      throw new Error("refresh_token missing — offline.access 스코프가 필요합니다");
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

    return popupHtml({ ok: true, username: username || name || xUserId });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return popupHtml({ ok: false, error: msg });
  }
};
