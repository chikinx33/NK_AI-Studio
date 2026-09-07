// POST /api/agent/skill-jobs/:jobId/continue
//
// 영상 파이프라인처럼 한 번의 실행(CF waitUntil 수명)에 다 끝나지 않는 SkillJob 을 다음 배치로 이어간다.
// 실행기는 시간 예산이 다하면 running 상태를 유지한 채 execution_plan.steps 에 진행을 남기고
// 실행 리스(execution_token)를 반납한다. 이 엔드포인트가 다시 claim 해서 남은 스텝을 돌린다.
// 브라우저(캔버스·스킬 워크스페이스) 폴링과 자율 근무 스텝이 이걸 호출한다.
import { authorizeRequest } from "../../../_shared/auth.js";
import { corsHeaders, ensureAgentSchema, getSql, send } from "../../_shared";
import { runCompanySkillJob } from "../../_company-skill-executors";
import { getCompanySkillJob, isCompanySkillJobId, listCompanySkillJobEvents, toCompanySkillJobDto } from "../../_skill-jobs";

type PagesFunction = (ctx: { request: Request; env: any; params: { jobId?: string }; waitUntil: (promise: Promise<unknown>) => void }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

export const onRequestPost: PagesFunction = async ({ request, env, params, waitUntil }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const jobId = String(params?.jobId || "").trim();
    if (!isCompanySkillJobId(jobId)) return send({ error: "올바른 SkillJob ID가 필요합니다." }, 400, origin);
    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
    await ensureAgentSchema(sql);
    const job = await getCompanySkillJob(sql, auth.userId, jobId);
    if (!job) return send({ error: "not_found" }, 404, origin);
    if (["completed", "failed", "cancelled"].includes(job.status)) {
      return send({ ok: true, job: toCompanySkillJobDto(job), resumed: false, reason: "finished" }, 200, origin);
    }
    const approval = job.approval_state && typeof job.approval_state === "object" ? job.approval_state as any : {};
    if (approval.status === "pending") {
      return send({ ok: true, job: toCompanySkillJobDto(job), resumed: false, reason: "awaiting-approval" }, 200, origin);
    }
    // 다른 워커가 아직 실행 중(리스 살아 있음)이면 중복 실행하지 않는다 — claim 이 알아서 거절한다.
    const execution = runCompanySkillJob({
      request, env, authHeader: String(request.headers.get("Authorization") || ""), userId: auth.userId, sql,
    }, jobId);
    if (new URL(request.url).searchParams.get("wait") === "1") {
      const finished = await execution;
      const events = finished ? await listCompanySkillJobEvents(sql, auth.userId, jobId) : [];
      return send({ ok: true, job: finished ? toCompanySkillJobDto(finished, events) : toCompanySkillJobDto(job), resumed: true }, 200, origin);
    }
    waitUntil(execution.then(() => undefined));
    return send({ ok: true, job: toCompanySkillJobDto(job), resumed: true }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "SkillJob 이어가기 실패") }, 500, origin);
  }
};
