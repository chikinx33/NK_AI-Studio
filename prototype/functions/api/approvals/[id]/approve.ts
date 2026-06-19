// prototype/functions/api/approvals/[id]/approve.ts
// POST /api/approvals/:id/approve — 승인 패널 '승인·실행'.
// 구 프런트 번들(캐시)이 이 경로를 호출하므로 호환용으로 유지. 새 번들은 /api/agent/review 사용.
// 승인 게이트 도구(gate)는 여기서 비로소 실제 실행한다("승인 후 실제 업무 추진").
import { authorizeRequest } from "../../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, getJob, setJobStatus, AGENT_TOOLS } from "../../agent/_shared";

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

    const tool = AGENT_TOOLS[job.type];
    // 게이트 도구이면서 아직 실행 전(output 없음)이면 → 승인된 지금 실제 실행.
    if (tool?.gate && !job.output) {
      try {
        const authHeader = String(request.headers.get("Authorization") || "");
        const input = typeof job.input === "string" ? (() => { try { return JSON.parse(job.input); } catch { return {}; } })() : (job.input || {});
        const output = await tool.run(input, { request, env, authHeader, userId: auth.userId });
        const updated = await setJobStatus(sql, id, auth.userId, { status: "approved", output, reviewStatus: "approved" });
        return send({ ok: true, job: updated }, 200, origin);
      } catch (e: any) {
        await setJobStatus(sql, id, auth.userId, { status: "error", error: String(e?.message || e) });
        return send({ error: `승인 실행 중 오류: ${e?.message || e}` }, 500, origin);
      }
    }
    // 이미 실행된(산출물 있는) 잡이거나 게이트 아님 → 상태만 확정.
    const updated = await setJobStatus(sql, id, auth.userId, { status: "approved", reviewStatus: "approved" });
    return send({ ok: true, job: updated }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "승인 처리 중 오류" }, 500, origin);
  }
};
