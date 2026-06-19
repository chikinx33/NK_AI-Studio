// prototype/functions/api/agent/google/connect.ts
// 싱크 구글 연동 시작/해제.
//  GET    /api/agent/google/connect → 동의 URL(oauthUrl) 발급. 프런트가 팝업으로 연다.
//  DELETE /api/agent/google/connect → 연결 해제(저장된 refresh_token 삭제).
// state 에 단기 세션 토큰을 담아 콜백에서 userId 를 검증·복원한다(서버 세션 저장소 불필요).
import { authorizeRequest, issueSessionToken } from "../../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, deleteGoogleOAuth } from "../_shared";
import { googleConnectCreds, connectRedirectUri, buildAuthUrl } from "../_google";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

function b64url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

  const { clientId, clientSecret } = googleConnectCreds(env);
  if (!clientId || !clientSecret) {
    return send(
      { error: "google_connect_not_configured", message: "GOOGLE_CONNECT_CLIENT_ID/SECRET(또는 로그인용 구글 클라이언트)이 서버에 설정되지 않았어요." },
      500,
      origin
    );
  }

  // 콜백에서 userId 를 복원·검증하기 위한 단기(10분) 세션 토큰을 state 로 사용.
  const sess = await issueSessionToken(auth.userId, env, 600);
  const state = b64url(JSON.stringify({ t: sess.token, ts: Date.now() }));
  const redirectUri = connectRedirectUri(request, env);
  const oauthUrl = buildAuthUrl(clientId, redirectUri, state);
  return send({ ok: true, oauthUrl }, 200, origin);
};

export const onRequestDelete: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const sql = getSql(env);
  await ensureAgentSchema(sql);
  await deleteGoogleOAuth(sql, auth.userId);
  return send({ ok: true }, 200, origin);
};
