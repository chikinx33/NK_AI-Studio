import { getGoogleServiceAccountToken, resolveGcsContextForUser } from "../../api/_shared/youtube-token";
import { writeThreadsPatch } from "../../api/_shared/threads-token";

function popupHtml(result: { ok: boolean; username?: string; error?: string }) {
  const payload = JSON.stringify(result);
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>연결 중...</title></head>
<body>
<script>
  try {
    if (window.opener) {
      window.opener.postMessage({ type: 'sns_oauth_result', platform: 'threads', result: ${payload} }, '*');
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
  try {
    const decoded = JSON.parse(atob(stateRaw));
    userId = String(decoded.userId || "owner");
  } catch {
    return popupHtml({ ok: false, error: "Invalid state" });
  }

  const appId = env.THREADS_APP_ID;
  const appSecret = env.THREADS_APP_SECRET;
  const redirectUri = env.THREADS_REDIRECT_URI;

  if (!appId || !appSecret || !redirectUri) {
    return popupHtml({ ok: false, error: "Server config missing" });
  }

  try {
    // Step 1: code → 단기 액세스 토큰 + threads user id
    const tokenRes = await fetch("https://graph.threads.net/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }).toString(),
    });
    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      user_id?: string | number;
      error_message?: string;
      error?: { message?: string };
    };
    if (!tokenData.access_token) {
      throw new Error(tokenData.error_message || tokenData.error?.message || "Token exchange failed");
    }
    const shortToken = tokenData.access_token;
    let threadsUserId = String(tokenData.user_id || "");

    // Step 2: 단기 토큰 → 장기 토큰 (60일)
    const longRes = await fetch(
      `https://graph.threads.net/access_token?` +
      new URLSearchParams({
        grant_type: "th_exchange_token",
        client_secret: appSecret,
        access_token: shortToken,
      }).toString()
    );
    const longData = (await longRes.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: { message?: string };
    };
    if (!longData.access_token) {
      throw new Error(longData.error?.message || "Long-lived token exchange failed");
    }
    const longToken = longData.access_token;
    const tokenExpiresAt = longData.expires_in
      ? new Date(Date.now() + longData.expires_in * 1000).toISOString()
      : new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();

    // Step 3: 사용자 정보 조회 (id, username)
    const meRes = await fetch(
      `https://graph.threads.net/v1.0/me?` +
      new URLSearchParams({ fields: "id,username", access_token: longToken }).toString()
    );
    const meData = (await meRes.json()) as { id?: string; username?: string; error?: { message?: string } };
    if (meData.id) threadsUserId = String(meData.id);
    const username = meData.username || threadsUserId;
    if (!threadsUserId) {
      throw new Error(meData.error?.message || "Threads 사용자 ID를 가져오지 못했습니다");
    }

    // Step 4: GCS 저장
    const googleToken = await getGoogleServiceAccountToken({
      clientEmail: env.GOOGLE_CLIENT_EMAIL,
      privateKeyPem: env.GOOGLE_PRIVATE_KEY,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });
    const gcs = resolveGcsContextForUser(env, userId);
    console.log("[threads callback] writing GCS for userId:", userId, "threadsUserId:", threadsUserId, "username:", username);
    await writeThreadsPatch(
      { ...gcs, googleToken },
      {
        connected: true,
        enabled: true,
        threadsUserId,
        username,
        accessToken: longToken,
        tokenExpiresAt,
      }
    );

    return popupHtml({ ok: true, username });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return popupHtml({ ok: false, error: msg });
  }
};
