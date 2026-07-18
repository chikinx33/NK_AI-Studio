import { authorizeRequest } from "../../../_shared/auth.js";
import { corsHeaders, ensureAgentSchema, getSql, send } from "../../_shared";
import { cancelCompanySkillJob, CompanySkillJobTransitionError, isCompanySkillJobId, toCompanySkillJobDto } from "../../_skill-jobs";

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
    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
    await ensureAgentSchema(sql);
    const job = await cancelCompanySkillJob(sql, auth.userId, jobId);
    if (!job) return send({ error: "not_found" }, 404, origin);
    return send({ ok: true, job: toCompanySkillJobDto(job) }, 200, origin);
  } catch (error: any) {
    if (error instanceof CompanySkillJobTransitionError) {
      return send({ error: "완료된 업무는 취소할 수 없습니다.", currentStatus: error.currentStatus }, 409, origin);
    }
    return send({ error: String(error?.message || error || "SkillJob 취소 실패") }, 500, origin);
  }
};
