// prototype/functions/api/agent/project-stage.ts
// POST /api/agent/project-stage { projectId, index, status } — 보드 단계 상태 변경. ★ user_id 격리.
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, setProjectStageDb } from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const body = await request.json().catch(() => ({} as any));
  const projectId = String(body?.projectId || "").trim();
  const index = Number(body?.index);
  const status = String(body?.status || "").trim();
  if (!projectId || Number.isNaN(index) || !status) return send({ error: "projectId, index, status required" }, 400, origin);
  const sql = getSql(env);
  if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
  await ensureAgentSchema(sql);
  const ok = await setProjectStageDb(sql, auth.userId, projectId, index, status);
  return send({ ok }, 200, origin);
};
