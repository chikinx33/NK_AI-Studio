import { authorizeRequest } from "../../../_shared/auth.js";
import { corsHeaders, ensureAgentSchema, getSql, send } from "../../_shared";
import { appendCompanySkillJobEvent, getCompanySkillJob, isCompanySkillJobId, setCompanySkillJobApproval, toCompanySkillJobDto } from "../../_skill-jobs";

type PagesFunction = (ctx: { request: Request; env: any; params: { jobId?: string } }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const jobId = String(params?.jobId || "").trim();
    if (!isCompanySkillJobId(jobId)) return send({ error: "올바른 SkillJob ID가 필요합니다." }, 400, origin);
    const body: any = await request.json().catch(() => ({}));
    const decision = body?.decision === "rejected" ? "rejected" : body?.decision === "approved" ? "approved" : "";
    if (!decision) return send({ error: "decision은 approved 또는 rejected여야 합니다." }, 400, origin);
    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
    await ensureAgentSchema(sql);
    const current = await getCompanySkillJob(sql, auth.userId, jobId);
    if (!current) return send({ error: "not_found" }, 404, origin);
    const job = await setCompanySkillJobApproval(sql, auth.userId, jobId, {
      status: decision,
      action: String(body?.action || "").trim().slice(0, 200),
      scope: body?.scope && typeof body.scope === "object" ? body.scope : {},
      decidedAt: new Date().toISOString(),
    });
    await appendCompanySkillJobEvent(sql, {
      jobId,
      userId: auth.userId,
      eventType: "approval",
      stage: current.current_stage,
      status: decision,
      summary: decision === "approved" ? "사용자가 외부 변경 작업을 승인했습니다." : "사용자가 외부 변경 작업을 거절했습니다.",
      details: { action: String(body?.action || "").trim().slice(0, 200) },
      eventKey: `approval:${decision}:${Date.now()}`,
    });
    return send({ ok: true, job: job ? toCompanySkillJobDto(job) : null }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "SkillJob 승인 처리 실패") }, 500, origin);
  }
};
