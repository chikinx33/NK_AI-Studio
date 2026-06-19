// prototype/functions/api/agent/clear-approvals.ts
// POST /api/agent/clear-approvals — 승인 대기(실행 전, 산출물 없는) 잡을 일괄 취소. ★ user_id 격리.
// 테스트로 쌓인 잔여 승인 정리용. 산출물 있는 잡(보고/검수)은 영향 없음.
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, clearPendingApprovals } from "./_shared";

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
    const cleared = await clearPendingApprovals(sql, auth.userId);
    return send({ ok: true, cleared }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "정리 중 오류" }, 500, origin);
  }
};
