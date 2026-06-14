// prototype/functions/api/agent/jobs.ts
// GET /api/agent/jobs?limit=30 — 본인 잡 목록(검수 대기/내역). ★ user_id 격리.
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, listJobs } from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
    await ensureAgentSchema(sql);

    const limit = Number(new URL(request.url).searchParams.get("limit") || "30");
    const items = await listJobs(sql, auth.userId, limit);
    return send({ ok: true, items, total: items.length }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "잡 목록 조회 중 오류" }, 500, origin);
  }
};
