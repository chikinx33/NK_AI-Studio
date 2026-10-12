// POST /api/director/delegate — 디렉터 세션용 위임 토큰 발급.
// 디렉터 에이전트의 도구(MCP)는 사용자가 브라우저를 닫은 뒤에도 사이트 API 를 사용자 권한으로 불러야 한다.
// 그래서 디렉터 서비스(공유 비밀 확인)에게만 7일짜리 사용자 세션 토큰을 내준다. 토큰은 Anthropic 볼트에
// 쓰기 전용으로 보관되고 샌드박스에는 들어가지 않는다.
import { issueSessionToken } from "../_shared/auth.js";
import { requireMaster } from "../_shared/admin-users";
import { directorAuth, onOptions, send, type PagesFunction } from "./_shared";

export const DIRECTOR_DELEGATE_TTL_SEC = 7 * 24 * 3600;

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await directorAuth(request, env, true);
  if (!auth.ok) return auth.response;
  const issued = await issueSessionToken(auth.userId, env, DIRECTOR_DELEGATE_TTL_SEC, { persistent: false });
  return send({ token: issued.token, userId: issued.userId, expiresAt: issued.expiresAt, isOwner: requireMaster(env, auth.userId) }, 200, origin);
};

export const onRequestOptions = onOptions;
