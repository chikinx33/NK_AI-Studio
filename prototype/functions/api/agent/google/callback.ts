// prototype/functions/api/agent/google/callback.ts
// 싱크 구글 연동 콜백: authorization code 교환 → refresh_token 을 user_id 별로 저장.
// state(단기 세션 토큰)로 userId 를 검증·복원한다. 결과는 팝업에서 opener 로 postMessage.
import { verifySessionToken, sanitizeUserId } from "../../_shared/auth.js";
import { getSql, ensureAgentSchema, saveGoogleOAuth } from "../_shared";
import { connectRedirectUri, exchangeCode, fetchUserEmail } from "../_google";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

function popupHtml(result: Record<string, any>): Response {
  const payload = JSON.stringify(result);
  return new Response(
    `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>구글 연동</title>
<style>body{font-family:system-ui,sans-serif;background:#0f1115;color:#e5e7eb;display:grid;place-items:center;height:100vh;margin:0}
.card{max-width:440px;padding:26px 30px;border:1px solid #2a2f3a;border-radius:16px;background:#151922;text-align:center}
h1{font-size:17px;margin:0 0 8px}p{font-size:13px;color:#9ca3af;line-height:1.6}</style></head>
<body><div class="card"><h1>${result.ok ? "✅ 연동 완료" : "❌ 연동 실패"}</h1>
<p>${result.ok ? `${result.email || "구글 계정"} 이 싱크에 연결되었어요. 이 창은 곧 닫힙니다.` : (result.error || "다시 시도해주세요.")}</p></div>
<script>
  try { if (window.opener) window.opener.postMessage({ type: 'sns_oauth_result', platform: 'google_connect', result: ${payload} }, '*'); } catch(e) {}
  setTimeout(function(){ try{ window.close(); }catch(e){} }, 2000);
<\/script></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) return popupHtml({ ok: false, error: "구글 인증이 취소되었어요." });
  if (!code || !stateRaw) return popupHtml({ ok: false, error: "code/state 누락" });

  // state → 단기 세션 토큰 → userId 복원·검증 + 신선도(10분).
  let userId = "";
  try {
    const decoded = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(stateRaw.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))
      )
    );
    const ts = Number(decoded?.ts);
    if (!Number.isFinite(ts) || Date.now() - ts > 10 * 60 * 1000) {
      return popupHtml({ ok: false, error: "인증 세션이 만료되었어요. 다시 시도해주세요." });
    }
    const payload = await verifySessionToken(String(decoded?.t || ""), env);
    userId = sanitizeUserId(payload?.sub || "");
  } catch {
    return popupHtml({ ok: false, error: "유효하지 않은 인증 상태(state)예요." });
  }
  if (!userId) return popupHtml({ ok: false, error: "사용자 식별 실패" });

  try {
    const redirectUri = connectRedirectUri(request, env);
    const tok = await exchangeCode(env, code, redirectUri);
    if (!tok.refresh_token) {
      return popupHtml({
        ok: false,
        error: "refresh_token 미발급. 구글 계정 → 보안 → 타사 앱에서 기존 권한을 해제한 뒤 다시 시도하면 발급돼요.",
      });
    }
    const email = await fetchUserEmail(tok.access_token);
    const sql = getSql(env);
    await ensureAgentSchema(sql);
    await saveGoogleOAuth(sql, userId, { refreshToken: tok.refresh_token, email, scopes: tok.scope });
    return popupHtml({ ok: true, email });
  } catch (err: any) {
    return popupHtml({ ok: false, error: String(err?.message || err || "연동 실패") });
  }
};
