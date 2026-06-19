// prototype/functions/api/approvals/[id]/reject.ts
// POST /api/approvals/:id/reject — 승인 패널 '거절'. 잡을 취소 상태로.
// 구 프런트 번들(캐시) 호환용. 게이트 도구는 실행 전이라 거절하면 아무 부작용 없이 폐기된다.
import { authorizeRequest } from "../../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, getJob, setJobStatus } from "../../agent/_shared";

type PagesFunction = (ctx: { request: Request; env: any; params: { id?: string } }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
    await ensureAgentSchema(sql);

    const id = String(params?.id || "").trim();
    if (!id) return send({ error: "id required" }, 400, origin);
    const job = await getJob(sql, id, auth.userId);
    if (!job) return send({ error: "not_found" }, 404, origin);

    const updated = await setJobStatus(sql, id, auth.userId, { status: "cancelled" });
    return send({ ok: true, job: updated }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "거절 처리 중 오류" }, 500, origin);
  }
};
