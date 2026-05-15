import { buildUserDataObject, gcsObjectPath } from "../../api/_shared/storage";
import { getGoogleServiceAccountToken, resolveGcsContextForUser } from "../../api/_shared/youtube-token";
import { writeFacebookPatch } from "../../api/_shared/facebook-token";

function popupHtml(result: { ok: boolean; username?: string; error?: string }) {
  const payload = JSON.stringify(result);
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>연결 중...</title></head>
<body>
<script>
  try {
    if (window.opener) {
      window.opener.postMessage({ type: 'sns_oauth_result', platform: 'facebook', result: ${payload} }, '*');
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
  const errorCode = url.searchParams.get("error_code");
  const errorMsg = url.searchParams.get("error_message") || url.searchParams.get("error_description");

  if (error || errorCode) {
    const detail = errorMsg || error || `error_code=${errorCode}`;
    return popupHtml({ ok: false, error: "OAuth cancelled: " + detail });
  }
  if (!code) return popupHtml({ ok: false, error: "Missing code — Facebook redirect did not include authorization code" });

  let userId = "owner";
  try {
    const decoded = JSON.parse(atob(stateRaw));
    userId = String(decoded.userId || "owner");
  } catch {
    return popupHtml({ ok: false, error: "Invalid state" });
  }

  const appId = env.META_APP_ID;
  const appSecret = env.META_APP_SECRET;
  const redirectUri = env.FACEBOOK_REDIRECT_URI;

  if (!appId || !appSecret || !redirectUri) {
    return popupHtml({ ok: false, error: "Server config missing" });
  }

  try {
    // Step 1: code → 단기 사용자 토큰 교환
    const tokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?` +
      new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        code,
      }).toString()
    );
    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      token_type?: string;
      expires_in?: number;
      error?: { message?: string; type?: string };
    };
    if (!tokenData.access_token) {
      throw new Error(tokenData.error?.message || "Token exchange failed");
    }
    const shortToken = tokenData.access_token;

    // Step 2: 단기 토큰 → 장기 사용자 토큰 (60일)
    const longRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?` +
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortToken,
      }).toString()
    );
    const longData = (await longRes.json()) as {
      access_token?: string;
      token_type?: string;
      expires_in?: number;
      error?: { message?: string };
    };
    if (!longData.access_token) {
      throw new Error(longData.error?.message || "Long-lived token exchange failed");
    }
    const longToken = longData.access_token;
    const userTokenExpiresAt = longData.expires_in
      ? new Date(Date.now() + longData.expires_in * 1000).toISOString()
      : new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();

    // Step 3: 관리 중인 페이지 목록 조회 (첫 번째 페이지 선택)
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?` +
      new URLSearchParams({ access_token: longToken, fields: "id,name,access_token,tasks" }).toString()
    );
    const pagesRawText = await pagesRes.text();
    console.log("[facebook callback] /me/accounts HTTP status:", pagesRes.status);
    console.log("[facebook callback] /me/accounts raw body:", pagesRawText);

    let pagesData: {
      data?: Array<{ id: string; name: string; access_token: string; tasks?: string[] }>;
      paging?: { cursors?: { before?: string; after?: string }; next?: string };
      error?: { message?: string; type?: string; code?: number; fbtrace_id?: string };
    } = {};
    try { pagesData = JSON.parse(pagesRawText); } catch (e) {
      console.log("[facebook callback] /me/accounts JSON parse error:", e);
    }
    console.log("[facebook callback] /me/accounts parsed:", JSON.stringify(pagesData));
    console.log("[facebook callback] data array exists?", !!pagesData.data, "length:", pagesData.data?.length || 0);

    // /me/accounts 가 비었으면 사용자 정보도 함께 조회해서 어떤 계정으로 로그인됐는지 확인
    if (!pagesData.data || pagesData.data.length === 0) {
      const meRes = await fetch(
        `https://graph.facebook.com/v21.0/me?` +
        new URLSearchParams({ access_token: longToken, fields: "id,name" }).toString()
      );
      const meText = await meRes.text();
      console.log("[facebook callback] /me HTTP status:", meRes.status);
      console.log("[facebook callback] /me raw body:", meText);

      // granular_scopes 확인 — 실제로 어떤 권한이 승인됐는지
      const permsRes = await fetch(
        `https://graph.facebook.com/v21.0/me/permissions?` +
        new URLSearchParams({ access_token: longToken }).toString()
      );
      const permsText = await permsRes.text();
      console.log("[facebook callback] /me/permissions HTTP status:", permsRes.status);
      console.log("[facebook callback] /me/permissions raw body:", permsText);

      throw new Error(
        `관리 중인 Facebook 페이지가 없습니다.\n` +
        `\n[/me/accounts status=${pagesRes.status}]\n${pagesRawText}\n` +
        `\n[/me status=${meRes.status}]\n${meText}\n` +
        `\n[/me/permissions status=${permsRes.status}]\n${permsText}`
      );
    }

    // 첫 번째 페이지 사용 (추후 UI에서 선택 가능하도록 확장 가능)
    const page = pagesData.data[0];
    const pageId = page.id;
    const pageName = page.name;
    // 장기 사용자 토큰에서 파생된 페이지 토큰은 만료 없음
    const pageToken = page.access_token;

    // Step 4: GCS 저장
    const googleToken = await getGoogleServiceAccountToken({
      clientEmail: env.GOOGLE_CLIENT_EMAIL,
      privateKeyPem: env.GOOGLE_PRIVATE_KEY,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });

    const gcs = resolveGcsContextForUser(env, userId);
    await writeFacebookPatch(
      { ...gcs, googleToken },
      {
        connected: true,
        enabled: true,
        pageId,
        pageName,
        userToken: longToken,
        pageToken,
        tokenExpiresAt: userTokenExpiresAt,
      }
    );

    return popupHtml({ ok: true, username: pageName });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return popupHtml({ ok: false, error: msg });
  }
};
