import { authorizeRequest } from "../../../_shared/auth.js";
import { resolveGcsEnv } from "../../../_shared/gcs.js";
import { buildAiVideoProjectPrefix } from "../../../_shared/storage";
import { corsHeaders, ensureAgentSchema, getSql, send } from "../../_shared";
import {
  COMPANY_SKILL_ARTIFACT_KINDS,
  appendCompanySkillJobEvent,
  getCompanySkillJob,
  isCompanySkillJobId,
  listCompanySkillArtifacts,
  registerCompanySkillArtifact,
  toCompanySkillArtifactDto,
  type CompanySkillArtifactKind,
} from "../../_skill-jobs";

type PagesFunction = (ctx: { request: Request; env: any; params: { jobId?: string } }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

export const onRequestGet: PagesFunction = async ({ request, env, params }) => {
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
    const artifacts = await listCompanySkillArtifacts(sql, auth.userId, jobId);
    return send({ ok: true, artifacts: artifacts.map(toCompanySkillArtifactDto) }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "SkillJob 산출물 조회 실패") }, 500, origin);
  }
};

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
    const job = await getCompanySkillJob(sql, auth.userId, jobId);
    if (!job) return send({ error: "not_found" }, 404, origin);
    const body: any = await request.json().catch(() => ({}));
    const inputs = Array.isArray(body?.artifacts) ? body.artifacts : [];
    if (!inputs.length || inputs.length > 20) {
      return send({ error: "한 번에 1~20개의 산출물을 등록해 주세요." }, 400, origin);
    }
    const storage = resolveGcsEnv(env);
    const allowedPrefix = `${buildAiVideoProjectPrefix(storage.basePrefix, auth.userId, "ai-company")}/work-library/`;
    const workItemId = String(job.work_item_id || "");
    const artifacts = [];
    for (const input of inputs) {
      const kind = String(input?.kind || "") as CompanySkillArtifactKind;
      const objectPath = String(input?.objectPath || "").trim();
      if (!COMPANY_SKILL_ARTIFACT_KINDS.includes(kind)) {
        return send({ error: `지원하지 않는 산출물 종류입니다: ${kind}` }, 400, origin);
      }
      if (!objectPath.startsWith(allowedPrefix) || !workItemId || !objectPath.includes(`/${workItemId}/`)) {
        return send({ error: "현재 사용자와 업무에 속한 저장소 경로만 등록할 수 있습니다." }, 400, origin);
      }
      const artifact = await registerCompanySkillArtifact(sql, {
        jobId,
        userId: auth.userId,
        workItemId,
        kind,
        fileName: String(input?.fileName || objectPath.split("/").pop() || "artifact"),
        objectPath,
        mimeType: String(input?.mimeType || "application/octet-stream"),
        sizeBytes: input?.sizeBytes == null ? null : Number(input.sizeBytes),
        checksum: String(input?.checksum || ""),
        version: Number(input?.version || job.version || 1),
        metadata: input?.metadata && typeof input.metadata === "object" ? input.metadata : {},
      });
      if (!artifact) return send({ error: "SkillJob과 산출물의 업무 연결을 확인하지 못했습니다." }, 409, origin);
      artifacts.push(toCompanySkillArtifactDto(artifact));
      await appendCompanySkillJobEvent(sql, {
        jobId,
        userId: auth.userId,
        eventType: "artifact",
        stage: job.current_stage,
        status: "completed",
        summary: `${artifact.kind} 산출물 ${artifact.file_name}을(를) 등록했습니다.`,
        details: { artifactId: artifact.id, kind: artifact.kind, version: artifact.version },
        eventKey: `artifact:${artifact.id}`,
      });
    }
    return send({ ok: true, artifacts }, 201, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "SkillJob 산출물 등록 실패") }, 500, origin);
  }
};
