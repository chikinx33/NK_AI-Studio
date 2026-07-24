import {
  authorizeRequest,
  issueSessionToken,
  resolveSessionTtlSec,
} from "../_shared/auth.js";
import {
  findUser,
  loadRegistry,
  primaryAdminId,
} from "../_shared/admin-users";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const corsHeaders = (origin: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Vary": "Origin",
});

const send = (data: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status || 401, origin);

  try {
    const body = await request.json().catch(() => ({} as any));
    const payload = auth.payload || {};
    // 배포 전 v1 세션만 사용자의 저장된 선택에 따라 장기 세션으로 안전하게 마이그레이션한다.
    const persistent = payload.persistent === true
      || (Number(payload.v || 1) < 2 && body.rememberDevice === true);
    const isPrimary = auth.userId === primaryAdminId(env);
    let permissions: string[] = [];
    let role = isPrimary ? "master" : "member";

    if (!isPrimary) {
      const registry = await loadRegistry(env);
      const user = findUser(registry, auth.userId);
      if (!user) return send({ error: "account_not_found" }, 401, origin);
      if (user.active === false) return send({ error: "account_disabled" }, 403, origin);
      permissions = user.permissions || [];
    }

    const session = await issueSessionToken(
      auth.userId,
      env,
      resolveSessionTtlSec(persistent),
      { persistent },
    );
    return send({
      ok: true,
      user: auth.userId,
      token: session.token,
      expiresAt: session.expiresAt,
      permissions,
      role,
      persistent,
    }, 200, origin);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "session_refresh_failed";
    return send({ error: message }, 503, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
