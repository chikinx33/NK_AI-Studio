import { ensureAgentSchema, getSql, send } from "../../_shared";
import {
  COMPANY_SKILL_ARTIFACT_MAX_BYTES,
  uploadCompanySkillArtifactBytes,
} from "../../_company-skill-artifact-storage";
import { matchesCompanySkillRendererToken } from "../../_company-skill-renderer";
import {
  appendCompanySkillJobEvent,
  getCompanySkillJobById,
  isCompanySkillJobId,
  listCompanySkillArtifacts,
  registerCompanySkillArtifact,
  toCompanySkillArtifactDto,
  transitionCompanySkillJob,
  type CompanySkillArtifactKind,
  type CompanySkillArtifactRow,
  type CompanySkillJobRow,
} from "../../_skill-jobs";

type PagesFunction = (ctx: { request: Request; env: any; params: { jobId?: string } }) => Promise<Response>;

const encoder = new TextEncoder();

async function sha256Hex(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function jsonBytes(value: unknown) {
  return encoder.encode(JSON.stringify(value, null, 2)).buffer;
}

async function storeArtifact(
  env: any,
  job: CompanySkillJobRow,
  kind: CompanySkillArtifactKind,
  fileName: string,
  contentType: string,
  bytes: ArrayBuffer,
  metadata: Record<string, unknown> = {},
): Promise<CompanySkillArtifactRow> {
  const stored = await uploadCompanySkillArtifactBytes(env, {
    userId: job.user_id,
    workItemId: String(job.work_item_id || ""),
    fileName,
    contentType,
    bytes,
  });
  const artifact = await registerCompanySkillArtifact(getSql(env)!, {
    jobId: job.id,
    userId: job.user_id,
    workItemId: job.work_item_id,
    kind,
    fileName: stored.fileName,
    objectPath: stored.objectName,
    mimeType: stored.contentType,
    sizeBytes: stored.size,
    checksum: await sha256Hex(bytes),
    version: job.version,
    metadata,
  });
  if (!artifact) throw new Error(`${kind} 산출물을 SkillJob에 등록하지 못했습니다.`);
  return artifact;
}

function artifactManifestEntry(artifact: CompanySkillArtifactRow) {
  return {
    kind: artifact.kind,
    objectPath: artifact.object_path,
    checksum: artifact.checksum,
    mimeType: artifact.mime_type,
    sizeBytes: artifact.size_bytes,
  };
}

async function emitArtifactEvent(sql: any, job: CompanySkillJobRow, artifact: CompanySkillArtifactRow) {
  await appendCompanySkillJobEvent(sql, {
    jobId: job.id,
    userId: job.user_id,
    eventType: "artifact",
    stage: "rendering",
    status: "completed",
    summary: `${artifact.kind} 산출물 ${artifact.file_name}을(를) 서버에서 등록했습니다.`,
    details: { artifactId: artifact.id, kind: artifact.kind, version: artifact.version },
    eventKey: `server-artifact:${artifact.kind}:${artifact.version}`,
  });
}

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  try {
    if (!String(env?.COMPANY_SKILL_RENDERER_TOKEN || "").trim()) {
      return send({ error: "COMPANY_SKILL_RENDERER_TOKEN 미설정" }, 503, null);
    }
    if (!await matchesCompanySkillRendererToken(request, env)) {
      return send({ error: "renderer_unauthorized" }, 401, null);
    }
    const jobId = String(params?.jobId || "").trim();
    if (!isCompanySkillJobId(jobId)) return send({ error: "올바른 SkillJob ID가 필요합니다." }, 400, null);
    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, null);
    await ensureAgentSchema(sql);
    let job = await getCompanySkillJobById(sql, jobId);
    if (!job) return send({ error: "not_found" }, 404, null);
    if (job.status === "cancelled") return send({ error: "cancelled" }, 409, null);

    const renderStatus = String(request.headers.get("X-Company-Skill-Render-Status") || "completed").toLowerCase();
    if (renderStatus === "failed") {
      const payload: any = await request.json().catch(() => ({}));
      if (job.status === "completed") return send({ ok: true, jobId, status: "completed" }, 200, null);
      if (job.status !== "reviewing") return send({ error: `render_callback_invalid_status:${job.status}` }, 409, null);
      const failed = await transitionCompanySkillJob(sql, job.user_id, job.id, "failed", {
        error: {
          code: "SERVER_RENDER_FAILED",
          message: String(payload?.error || "서버 Remotion 렌더에 실패했습니다."),
          retryable: true,
          stage: "rendering",
        },
        resetExecutionLease: true,
      });
      await appendCompanySkillJobEvent(sql, {
        jobId: job.id,
        userId: job.user_id,
        eventType: "error",
        stage: "rendering",
        status: "failed",
        summary: String(payload?.error || "서버 Remotion 렌더에 실패했습니다."),
        details: { retryable: true },
        eventKey: `server-render:${job.version}:failed`,
      });
      return send({ ok: true, jobId, status: failed?.status || "failed" }, 200, null);
    }

    if (job.status === "completed") {
      const artifacts = await listCompanySkillArtifacts(sql, job.user_id, job.id);
      return send({ ok: true, jobId, status: "completed", artifacts: artifacts.map(toCompanySkillArtifactDto) }, 200, null);
    }
    if (job.status !== "reviewing" || !job.work_item_id) {
      return send({ error: `render_callback_invalid_status:${job.status}` }, 409, null);
    }
    const declaredSize = Number(request.headers.get("Content-Length") || 0);
    if (declaredSize > COMPANY_SKILL_ARTIFACT_MAX_BYTES) return send({ error: "MP4는 100MB 이하만 저장할 수 있습니다." }, 413, null);
    const videoBytes = await request.arrayBuffer();
    if (!videoBytes.byteLength) return send({ error: "렌더된 MP4가 비어 있습니다." }, 400, null);
    if (videoBytes.byteLength > COMPANY_SKILL_ARTIFACT_MAX_BYTES) return send({ error: "MP4는 100MB 이하만 저장할 수 있습니다." }, 413, null);

    const workRows = await sql(
      "SELECT metadata FROM company_work_items WHERE id = $1 AND user_id = $2 LIMIT 1",
      [job.work_item_id, job.user_id],
    );
    const workMetadata: any = workRows[0]?.metadata || {};
    const existing = await listCompanySkillArtifacts(sql, job.user_id, job.id);
    const byKind = new Map(existing.map((artifact) => [artifact.kind, artifact]));
    const created: CompanySkillArtifactRow[] = [];

    let finalArtifact = byKind.get("final");
    if (!finalArtifact) {
      finalArtifact = await storeArtifact(env, job, "final", "raviok-agent-video.mp4", "video/mp4", videoBytes);
      created.push(finalArtifact);
    }
    let sourceArtifact = byKind.get("source");
    if (!sourceArtifact) {
      sourceArtifact = await storeArtifact(env, job, "source", "source.json", "application/json", jsonBytes({
        schema: "company-skill/infographic-source/v1",
        jobId: job.id,
        workItemId: job.work_item_id,
        spec: workMetadata?.spec || null,
      }));
      created.push(sourceArtifact);
    }
    let reportArtifact = byKind.get("report");
    if (!reportArtifact) {
      reportArtifact = await storeArtifact(env, job, "report", "report.json", "application/json", jsonBytes({
        schema: "company-skill/report/v1",
        jobId: job.id,
        workItemId: job.work_item_id,
        agentReports: job.agent_reports || [],
        qualityResults: job.quality_results || [],
        warnings: job.warnings || [],
        costEstimate: job.cost_estimate || null,
        actualCost: job.actual_cost || null,
        providerUsage: job.provider_usage || {},
        renderedAt: new Date().toISOString(),
      }));
      created.push(reportArtifact);
    }
    let manifestArtifact = byKind.get("manifest");
    if (!manifestArtifact) {
      manifestArtifact = await storeArtifact(env, job, "manifest", "manifest.json", "application/json", jsonBytes({
        schema: "company-skill/manifest/v1",
        version: job.version,
        lineage: job.lineage || [],
        jobId: job.id,
        workItemId: job.work_item_id,
        archivedAt: new Date().toISOString(),
        cost: { estimate: job.cost_estimate || null, actual: job.actual_cost || null },
        artifacts: [finalArtifact, sourceArtifact, reportArtifact].map(artifactManifestEntry),
      }), { lineage: job.lineage || [] });
      created.push(manifestArtifact);
    }
    for (const artifact of created) await emitArtifactEvent(sql, job, artifact);

    const qualityResults = [
      ...(Array.isArray(job.quality_results) ? job.quality_results : []),
      {
        gateId: "server-render-artifacts",
        status: "passed",
        summary: "서버 렌더 MP4와 source·report·manifest를 저장하고 SkillJob에 등록했습니다.",
        checkedAt: new Date().toISOString(),
      },
    ];
    job = await transitionCompanySkillJob(sql, job.user_id, job.id, "completed", {
      progress: 100,
      currentStage: "completed",
      qualityResults,
      resetExecutionLease: true,
    }) as CompanySkillJobRow;
    await appendCompanySkillJobEvent(sql, {
      jobId: job.id,
      userId: job.user_id,
      eventType: "stage",
      stage: "completed",
      status: "completed",
      summary: "서버 렌더와 최종 산출물 등록을 완료했습니다.",
      details: { workItemId: job.work_item_id, artifactKinds: ["final", "source", "report", "manifest"] },
      eventKey: `server-render:${job.version}:completed`,
    });
    const artifacts = await listCompanySkillArtifacts(sql, job.user_id, job.id);
    return send({ ok: true, jobId, status: job.status, artifacts: artifacts.map(toCompanySkillArtifactDto) }, 201, null);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "서버 렌더 산출물 등록 실패") }, 500, null);
  }
};
