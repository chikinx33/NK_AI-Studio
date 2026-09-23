// prototype/functions/api/agent/jobs.ts
// GET /api/agent/jobs?limit=30 — 본인 잡 목록(검수 대기/내역). ★ user_id 격리.
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, expireStaleQueuedAgentJobs, expireStaleWorkingAgentJobs, listJobs, pollCached, reconcileSubscriptionJobs, reconcileVideoJobs, healMediaObjectNames } from "./_shared";

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
    await expireStaleQueuedAgentJobs(sql, auth.userId);
    await expireStaleWorkingAgentJobs(sql, auth.userId);
    const pollCtx = { request, env, userId: auth.userId, authHeader: request.headers.get('Authorization') || '' };
    await reconcileSubscriptionJobs(pollCtx, sql);
    await reconcileVideoJobs(pollCtx, sql);

    const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit") || "30") || 30, 1), 100);
    const items = await pollCached(sql, "jobs", `jobs:${auth.userId}:${limit}`, [auth.userId, limit], () => listJobs(sql, auth.userId, limit));
    // 서명 URL 만 남은 옛 영상·오디오 잡은 목록을 낼 때 경로를 되찾아 둔다(보고 썸네일·업무 등록이 프록시를 쓰게). 한 번 고치면 다시 안 건드린다.
    await healMediaObjectNames(sql, auth.userId, items as any[]).catch(() => 0);
    return send({ ok: true, items, total: items.length }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "잡 목록 조회 중 오류" }, 500, origin);
  }
};
