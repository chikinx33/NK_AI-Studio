import { authorizeRequest } from "../../../_shared/auth.js";
import { corsHeaders, ensureAgentSchema, getSql, send } from "../../_shared";
import { buildCompanySkillJobTitle, normalizeCompanySkillJobInput, SERVER_COMPANY_SKILLS } from "../../_company-skill-registry";
import { createCompanySkillJob, toCompanySkillJobDto } from "../../_skill-jobs";

type PagesFunction = (ctx: {
  request: Request;
  env: any;
  params: { skillId?: string };
}) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const skillId = String(params?.skillId || "").trim();
    const skill = SERVER_COMPANY_SKILLS[skillId];
    if (!skill) return send({ error: "활성화되지 않았거나 존재하지 않는 Skill입니다." }, 404, origin);
    const body = await request.json().catch(() => ({}));
    const normalized = normalizeCompanySkillJobInput(
      skillId,
      body,
      String(request.headers.get("Idempotency-Key") || ""),
    );
    if (!normalized.ok) return send({ error: normalized.error }, 400, origin);
    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
    await ensureAgentSchema(sql);
    const title = buildCompanySkillJobTitle((body as any)?.title, normalized.input.request);
    const result = await createCompanySkillJob(sql, {
      userId: auth.userId,
      conversationId: normalized.input.conversationId,
      companyId: normalized.input.companyId,
      categoryId: skill.categoryId,
      skillId,
      invocationMode: normalized.input.invocationMode,
      title: title.title,
      originalTitle: title.originalTitle,
      input: normalized.input,
      warnings: normalized.warnings,
      idempotencyKey: normalized.input.idempotencyKey,
    });
    return send({ ok: true, created: result.created, job: toCompanySkillJobDto(result.job) }, result.created ? 201 : 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "SkillJob 생성 실패") }, 500, origin);
  }
};
