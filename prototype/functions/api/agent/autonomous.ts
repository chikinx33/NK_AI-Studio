// prototype/functions/api/agent/autonomous.ts
// POST /api/agent/autonomous { enabled } — 자율 근무 토글 저장(상태 유지).
// 실제 자율 스텝 실행(Cloudflare Cron)은 후속. 지금은 토글 상태만 영속.
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, setAutonomousMode } from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const body = await request.json().catch(() => ({} as any));
  const enabled = !!body?.enabled;
  const sql = getSql(env);
  if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
  await ensureAgentSchema(sql);
  await setAutonomousMode(sql, auth.userId, enabled);
  return send({ ok: true, autonomous: enabled }, 200, origin);
};
