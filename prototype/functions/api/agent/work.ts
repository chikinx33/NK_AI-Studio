// prototype/functions/api/agent/work.ts
// POST /api/agent/work { workMode: "on"|"off" } — 출근/퇴근. 끄면 status.workMode=off → 전원 퇴근 UI.
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, setWorkMode } from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const body = await request.json().catch(() => ({} as any));
  const workMode = body?.workMode === "off" ? "off" : "on";
  const sql = getSql(env);
  if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
  await ensureAgentSchema(sql);
  await setWorkMode(sql, auth.userId, workMode);
  return send({ ok: true, workMode }, 200, origin);
};
