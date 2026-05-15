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

    // Step 3: 관리 중인 페이지 목록 조회 — NPE/Business 자산 케이스를 위해 4단계 폴백
    type FbPage = { id: string; name: string; access_token: string; tasks?: string[] };
    let pages: FbPage[] = [];
    const attemptLogs: string[] = [];

    async function tryFetch(label: string, url: string): Promise<string> {
      const res = await fetch(url);
      const text = await res.text();
      console.log(`[facebook callback] ${label} HTTP status:`, res.status);
      console.log(`[facebook callback] ${label} raw body:`, text);
      attemptLogs.push(`[${label} status=${res.status}]\n${text}`);
      return text;
    }

    // Attempt 1: /me/accounts (Classic Pages)
    {
      const text = await tryFetch(
        "/me/accounts",
        `https://graph.facebook.com/v21.0/me/accounts?` +
        new URLSearchParams({ access_token: longToken, fields: "id,name,access_token,tasks" }).toString()
      );
      try {
        const d = JSON.parse(text) as { data?: FbPage[] };
        if (Array.isArray(d.data) && d.data.length > 0) pages = d.data;
      } catch (e) { console.log("[facebook callback] attempt1 parse error:", e); }
      console.log("[facebook callback] attempt1 page count:", pages.length);
    }

    // Attempt 2: /me?fields=id,name,accounts{...} (nested edge)
    let userId = "";
    if (pages.length === 0) {
      const text = await tryFetch(
        "/me?fields=id,name,accounts{...}",
        `https://graph.facebook.com/v21.0/me?` +
        new URLSearchParams({
          access_token: longToken,
          fields: "id,name,accounts{id,name,access_token,tasks,instagram_business_account}",
        }).toString()
      );
      try {
        const d = JSON.parse(text) as { id?: string; accounts?: { data?: FbPage[] } };
        if (d.id) userId = d.id;
        const arr = d.accounts?.data || [];
        if (arr.length > 0) pages = arr;
      } catch (e) { console.log("[facebook callback] attempt2 parse error:", e); }
      console.log("[facebook callback] attempt2 page count:", pages.length, "userId:", userId);
    }

    // Attempt 3: /{user-id}/accounts?limit=100 (페이지 ID 직접 지정)
    if (pages.length === 0 && userId) {
      const text = await tryFetch(
        `/${userId}/accounts?limit=100`,
        `https://graph.facebook.com/v21.0/${userId}/accounts?` +
        new URLSearchParams({
          access_token: longToken,
          fields: "id,name,access_token,tasks",
          limit: "100",
        }).toString()
      );
      try {
        const d = JSON.parse(text) as { data?: FbPage[] };
        if (Array.isArray(d.data) && d.data.length > 0) pages = d.data;
      } catch (e) { console.log("[facebook callback] attempt3 parse error:", e); }
      console.log("[facebook callback] attempt3 page count:", pages.length);
    }

    // Attempt 4: /me/businesses?fields=owned_pages{...} (Business Portfolio 소유 페이지)
    if (pages.length === 0) {
      const text = await tryFetch(
        "/me/businesses?fields=owned_pages{...}",
        `https://graph.facebook.com/v21.0/me/businesses?` +
        new URLSearchParams({
          access_token: longToken,
          fields: "id,name,owned_pages{id,name,access_token,tasks}",
        }).toString()
      );
      try {
        const d = JSON.parse(text) as {
          data?: Array<{ id: string; name?: string; owned_pages?: { data?: FbPage[] } }>;
        };
        const collected: FbPage[] = [];
        (d.data || []).forEach((biz) => {
          (biz.owned_pages?.data || []).forEach((p) => collected.push(p));
        });
        if (collected.length > 0) pages = collected;
      } catch (e) { console.log("[facebook callback] attempt4 parse error:", e); }
      console.log("[facebook callback] attempt4 page count:", pages.length);
    }

    // 모든 시도 실패 — 진단 정보(/me/permissions) 추가 후 에러 throw
    if (pages.length === 0) {
      const permsText = await tryFetch(
        "/me/permissions",
        `https://graph.facebook.com/v21.0/me/permissions?` +
        new URLSearchParams({ access_token: longToken }).toString()
      );
      throw new Error(
        `관리 중인 Facebook 페이지가 없습니다 (4단계 폴백 모두 빈 결과).\n\n` +
        attemptLogs.join("\n\n")
      );
    }

    // 첫 번째 페이지 사용 (추후 UI에서 선택 가능하도록 확장 가능)
    const page = pages[0];
    const pageId = page.id;
    const pageName = page.name;
    // 장기 사용자 토큰에서 파생된 페이지 토큰은 만료 없음
    const pageToken = page.access_token;
    console.log("[facebook callback] selected page:", pageId, pageName, "(found via attempt — see logs above)");

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
