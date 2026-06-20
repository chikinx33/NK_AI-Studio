// prototype/functions/api/agent/reminder-delete.ts
// POST /api/agent/reminder-delete { id } — 예약(알람) 직접 삭제(삭제 조건 ② 사용자 삭제). ★ user_id 격리.
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, deleteReminderById } from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
    await ensureAgentSchema(sql);
    const body = await request.json().catch(() => ({} as any));
    const id = String(body?.id || "").trim();
    if (!id) return send({ error: "id required" }, 400, origin);
    const ok = await deleteReminderById(sql, auth.userId, id);
    return send({ ok }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "예약 삭제 오류" }, 500, origin);
  }
};
