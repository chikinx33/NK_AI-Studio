// prototype/functions/auth/google/callback.ts
// 구글 로그인 콜백: authorization code 를 교환하고 구글 이메일을 확인한 뒤,
// '승인된(레지스트리 admin/users.json 에 같은 이메일로 등록된) 활성 회원'에 한해 NK 세션을 발급한다.
// 결과는 팝업 창에서 opener 로 postMessage(platform: 'google_login') 하여 전달한다.
import { issueSessionToken } from "../../api/_shared/auth.js";
import {
  loadRegistry,
  findUserByEmail,
  primaryAdminId,
} from "../../api/_shared/admin-users";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

interface LoginResult {
  ok: boolean;
  user?: string;
  token?: string;
  expiresAt?: string;
  permissions?: string[];
  role?: string;
  email?: string;
  error?: string;
}

function popupHtml(result: LoginResult): Response {
  const payload = JSON.stringify(result);
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>로그인 중...</title></head>
<body>
<script>
  try {
    if (window.opener) {
      window.opener.postMessage({ type: 'sns_oauth_result', platform: 'google_login', result: ${payload} }, '*');
    }
  } catch(e) {}
  window.close();
<\/script>
<p>잠시 후 자동으로 닫힙니다...</p>
</body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) return popupHtml({ ok: false, error: "OAuth cancelled" });
  if (!code || !stateRaw) return popupHtml({ ok: false, error: "Missing code or state" });

  // state 신선도 검증(10분). 실패해도 흐름을 막진 않되, 명백히 오래된/손상된 state 는 거부.
  try {
    const decoded = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(stateRaw.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))
    ));
    const ts = Number(decoded && decoded.ts);
    if (!Number.isFinite(ts) || Date.now() - ts > 10 * 60 * 1000) {
      return popupHtml({ ok: false, error: "state_expired" });
    }
  } catch {
    return popupHtml({ ok: false, error: "Invalid state" });
  }

  const clientId = env.GOOGLE_LOGIN_CLIENT_ID || env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_LOGIN_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    env.GOOGLE_LOGIN_REDIRECT_URI || "https://nk-ai-studio.pages.dev/auth/google/callback";

  if (!clientId || !clientSecret) {
    return popupHtml({ ok: false, error: "Server config missing" });
  }

  try {
    // 1) code → access_token / id_token 교환
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
      error?: string;
      error_description?: string;
    };
    if (!tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || "Token exchange failed");
    }

    // 2) access_token → 사용자 정보(이메일/검증여부) 조회
    const infoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const info = (await infoRes.json()) as {
      email?: string;
      email_verified?: boolean | string;
      name?: string;
    };

    const email = String(info.email || "").trim().toLowerCase();
    const verified = info.email_verified === true || info.email_verified === "true";
    if (!email) return popupHtml({ ok: false, error: "no_email" });
    if (!verified) return popupHtml({ ok: false, error: "email_not_verified", email });

    // 3) 승인된 이메일인지 확인 — 레지스트리에서 같은 이메일의 회원을 찾는다.
    const reg = await loadRegistry(env);
    const user = findUserByEmail(reg, email);
    if (!user) return popupHtml({ ok: false, error: "not_approved", email });
    if (user.active === false) return popupHtml({ ok: false, error: "account_disabled", email });

    // 4) NK 세션 발급. role/permissions 는 /api/login 과 동일 규칙으로 산출.
    const isPrimary = user.id === primaryAdminId(env);
    const role = isPrimary ? "master" : "member";
    const permissions = isPrimary ? [] : (user.permissions || []);
    const session = await issueSessionToken(user.id, env);

    return popupHtml({
      ok: true,
      user: user.id,
      token: session.token,
      expiresAt: session.expiresAt,
      permissions,
      role,
      email,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return popupHtml({ ok: false, error: msg });
  }
};
