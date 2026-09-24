// prototype/functions/api/agent/jobs.ts
// GET /api/agent/jobs?limit=30 — 본인 잡 목록(검수 대기/내역). ★ user_id 격리.
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, listJobs, pollCached, runJobMaintenance } from "./_shared";

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
    const pollCtx = { request, env, userId: auth.userId, authHeader: request.headers.get('Authorization') || '' };

    const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit") || "30") || 30, 1), 100);
    const items = await pollCached(sql, "jobs", `jobs:${auth.userId}:${limit}`, [auth.userId, limit], () => listJobs(sql, auth.userId, limit));
    // 정비(만료·완료 확인·경로 복원)는 사용자별 20초에 한 번만 — 4초 폴링마다 Neon 을 두드리지 않는다.
    await runJobMaintenance(pollCtx, sql, { items: items as any[] });
    return send({ ok: true, items, total: items.length }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "잡 목록 조회 중 오류" }, 500, origin);
  }
};
