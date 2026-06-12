import {
  getGoogleServiceAccountToken,
  resolveGcsContextForUser,
  writeYoutubeWithShortsMirror,
} from "../../api/_shared/youtube-token";

function popupHtml(result: { ok: boolean; username?: string; error?: string }) {
  const payload = JSON.stringify(result);
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>연결 중...</title></head>
<body>
<script>
  try {
    if (window.opener) {
      window.opener.postMessage({ type: 'sns_oauth_result', platform: 'youtube', result: ${payload} }, '*');
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

  if (error) return popupHtml({ ok: false, error: "OAuth cancelled" });
  if (!code || !stateRaw) return popupHtml({ ok: false, error: "Missing code or state" });

  let userId = "owner";
  try {
    const decoded = JSON.parse(atob(stateRaw));
    userId = String(decoded.userId || "owner");
  } catch {
    return popupHtml({ ok: false, error: "Invalid state" });
  }

  const clientId = env.YOUTUBE_CLIENT_ID;
  const clientSecret = env.YOUTUBE_CLIENT_SECRET;
  const redirectUri = env.YOUTUBE_REDIRECT_URI || `${url.origin}/auth/youtube/callback`;

  if (!clientId || !clientSecret) {
    return popupHtml({ ok: false, error: "Server config missing" });
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
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
      throw new Error("refresh_token missing — user must reconsent (prompt=consent)");
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();

    // 사용자 채널 정보 조회 (표시용)
    let channelId = "";
    let channelTitle = "";
    let channelHandle = "";
    try {
      const chRes = await fetch(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const chData = (await chRes.json()) as {
        items?: Array<{ id?: string; snippet?: { title?: string; customUrl?: string } }>;
      };
      const first = chData.items?.[0];
      channelId = first?.id || "";
      channelTitle = first?.snippet?.title || "";
      channelHandle = first?.snippet?.customUrl || "";  // e.g. "@shapesU"
    } catch {
      // 채널 조회 실패는 치명적이지 않음 — 토큰만 저장
    }

    const googleToken = await getGoogleServiceAccountToken({
      clientEmail: env.GOOGLE_CLIENT_EMAIL,
      privateKeyPem: env.GOOGLE_PRIVATE_KEY,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });

    const gcs = resolveGcsContextForUser(env, userId);
    await writeYoutubeWithShortsMirror(
      { ...gcs, googleToken },
      {
        connected: true,
        enabled: true,
        channelId,
        channelTitle,
        channelHandle,
        accessToken,
        refreshToken,
        tokenExpiresAt: expiresAt,
        scope: tokenData.scope || "https://www.googleapis.com/auth/youtube.upload",
        needsReconnect: false,  // 재연결 완료 → 만료 플래그 해제
      }
    );

    return popupHtml({ ok: true, username: channelTitle || channelId });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return popupHtml({ ok: false, error: msg });
  }
};
