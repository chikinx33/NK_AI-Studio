import type { SqlFn } from "../knowledge/_shared";
import { SERVER_COMPANY_SKILLS } from "./_company-skill-registry";
import { buildActualCompanySkillCost, estimateCompanySkillJobCost, hasMatchingCostApproval } from "./_company-skill-costs";
import { dispatchCompanySkillRender, resolveCompanySkillRenderer } from "./_company-skill-renderer";
import {
  appendCompanySkillJobEvent,
  claimCompanySkillJobExecution,
  CompanySkillJobTransitionError,
  getCompanySkillJob,
  transitionCompanySkillJob,
  type CompanySkillJobRow,
} from "./_skill-jobs";
import { AGENT_TOOLS } from "./_shared";
import {
  buildVideoPipelinePlan,
  describePlanProgress,
  readVideoPipelinePlan,
  runVideoPipelineBatch,
  VIDEO_PIPELINE_EXECUTOR_ID,
  type VideoPipelinePlan,
} from "./_video-pipeline-executor";

export interface CompanySkillExecutorContext {
  request: Request;
  env: any;
  authHeader: string;
  userId: string;
  sql: SqlFn;
}

export interface CompanySkillExecutorResult {
  workItemId: string;
  agentReports: unknown[];
  qualityResults: unknown[];
  // 배치형 실행기(영상 파이프라인): 예산이 남은 스텝보다 먼저 끝나면 true — running 을 유지하고 continue 로 재개한다.
  continueRunning?: boolean;
  executionPlan?: unknown;
  events?: Array<{ stage: string; status: string; summary: string; details?: unknown; eventKey: string }>;
}

export interface CompanySkillExecutor {
  id: string;
  execute: (job: CompanySkillJobRow, context: CompanySkillExecutorContext) => Promise<CompanySkillExecutorResult>;
}

function internalUrl(request: Request, path: string): string {
  return new URL(path, request.url).toString();
}

async function callInternalJson(
  context: CompanySkillExecutorContext,
  path: string,
  body: unknown,
): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (context.authHeader) headers.Authorization = context.authHeader;
  const cookie = String(context.request.headers.get("Cookie") || "");
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(internalUrl(context.request, path), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(data?.error || `${path} 호출 실패 (${response.status})`);
  return data;
}

const infographicExecutor: CompanySkillExecutor = {
  id: "infographic-adapter-v1",
  async execute(job, context) {
    const input = job.input && typeof job.input === "object" ? job.input as any : {};
    const options = input.options && typeof input.options === "object" ? input.options : {};
    const result = await callInternalJson(context, "/api/agent/agent-video", {
      prompt: String(input.request || ""),
      durationSec: Number(options.durationSec) || 30,
      aspectRatio: String(options.aspectRatio || "16:9"),
      audience: String(options.audience || "일반 시청자"),
      tone: String(options.tone || "명료하고 신뢰감 있게"),
      style: String(options.style || "시네마틱 모션 인포그래픽"),
      conversationId: job.conversation_id,
      skillCategoryId: job.category_id,
      skillId: job.skill_id,
      invocationMode: job.invocation_mode,
      skillJobId: job.id,
    });
    const workItemId = String(result?.work?.id || "");
    if (!workItemId) throw new Error("인포그래픽 결과가 회사 업무 탐색기에 등록되지 않았습니다.");
    const now = new Date().toISOString();
    const contributions = Array.isArray(result?.contributions) ? result.contributions : [];
    const agentReports = contributions.map((item: any) => ({
      agentId: String(item?.agentId || ""),
      agentName: String(item?.agentName || item?.agentId || "에이전트"),
      status: "completed",
      decision: String(item?.summary || "업무를 완료했습니다."),
      artifactIds: [],
      remainingRisks: [],
      createdAt: now,
    }));
    const qualityResults = [
      {
        gateId: "infographic-spec",
        status: result?.spec?.scenes?.length ? "passed" : "failed",
        summary: result?.spec?.scenes?.length
          ? `${result.spec.scenes.length}개 씬의 Remotion 명세를 생성했습니다.`
          : "Remotion 장면 명세가 없습니다.",
        checkedAt: now,
      },
      {
        gateId: "common-work-library-registration",
        status: "passed",
        summary: "회사 업무 탐색기 항목과 SkillJob을 연결했습니다.",
        checkedAt: now,
      },
    ];
    if (qualityResults.some((result) => result.status === "failed")) {
      throw new Error("인포그래픽 명세 품질 게이트를 통과하지 못했습니다.");
    }
    return { workItemId, agentReports, qualityResults };
  },
};

function toolContext(job: CompanySkillJobRow, context: CompanySkillExecutorContext) {
  return { request: context.request, env: context.env, authHeader: context.authHeader, userId: context.userId, jobId: job.id };
}

/** 계획 선행 단계: 프로젝트 씬을 읽어 스텝·예상 크레딧을 execution_plan 에 남긴다(비용 게이트가 이걸 읽는다). */
async function prepareVideoPipelinePlan(job: CompanySkillJobRow, context: CompanySkillExecutorContext): Promise<CompanySkillJobRow> {
  const input = job.input && typeof job.input === "object" ? job.input as any : {};
  const projectId = String(input?.options?.projectId || "").trim();
  if (!projectId) throw new Error("영상 파이프라인에는 projectId 가 필요합니다.");
  const project = await AGENT_TOOLS.project_get.run({ projectId }, toolContext(job, context) as any);
  if (!Array.isArray(project?.scenes) || !project.scenes.length) {
    throw new Error("프로젝트에 씬이 없어요. 먼저 시나리오를 만들어 씬을 저장하세요.");
  }
  const plan = buildVideoPipelinePlan(job, project, context.env);
  const next = await transitionCompanySkillJob(context.sql, context.userId, job.id, "planning", {
    progress: 10,
    currentStage: "planning",
    executionPlan: plan,
    resolvedBrief: {
      request: input.request || "",
      options: input.options || {},
      projectId,
      projectTitle: String(project?.title || ""),
      sceneCount: project.scenes.length,
    },
  }) as CompanySkillJobRow;
  await appendCompanySkillJobEvent(context.sql, {
    jobId: job.id, userId: context.userId, eventType: "stage", stage: "planning", status: "working",
    summary: `플롯이 ${plan.summary.scenes}개 컷을 점검했습니다 — 스틸 ${plan.summary.pendingStills}개 · 영상 ${plan.summary.pendingVideos}개 생성 예정 (예상 ${plan.summary.credits} 크레딧).`,
    details: plan.summary, eventKey: `video-pipeline:plan:${job.version}`,
  });
  return next;
}

const videoPipelineExecutor: CompanySkillExecutor = {
  id: VIDEO_PIPELINE_EXECUTOR_ID,
  async execute(job, context) {
    const plan = readVideoPipelinePlan(job);
    if (!plan) throw new Error("영상 파이프라인 계획이 없습니다. 다시 시작해 주세요.");
    const batch = await runVideoPipelineBatch(plan, toolContext(job, context));
    const now = new Date().toISOString();
    const progress = describePlanProgress(batch.plan);
    const agentReports = [
      {
        agentId: "pixel", agentName: "픽셀", status: batch.continueRunning ? "working" : "completed",
        decision: `스틸·영상 ${progress.done}/${progress.total} 스텝 완료${progress.failed ? `, 실패 ${progress.failed}` : ""}.`,
        artifactIds: [], remainingRisks: progress.failed ? ["실패한 컷은 재시도가 필요합니다."] : [], createdAt: now,
      },
    ];
    const qualityResults = batch.continueRunning ? [] : [
      {
        gateId: "video-pipeline-coverage",
        status: progress.failed === 0 ? "passed" : (progress.done > 0 ? "warning" : "failed"),
        summary: progress.failed === 0
          ? `대상 컷 ${progress.total}개 스텝을 모두 생성했습니다.`
          : `${progress.failed}개 스텝이 실패했습니다. 캔버스에서 해당 컷을 확인하세요.`,
        checkedAt: now,
      },
    ];
    return { workItemId: "", agentReports, qualityResults, continueRunning: batch.continueRunning, executionPlan: batch.plan, events: batch.events };
  },
};

export const COMPANY_SKILL_EXECUTORS: Readonly<Record<string, CompanySkillExecutor>> = {
  [infographicExecutor.id]: infographicExecutor,
  [videoPipelineExecutor.id]: videoPipelineExecutor,
};

function buildExecutionPlan(job: CompanySkillJobRow, executorId: string) {
  return {
    executorId,
    stages: ["planning", "running", "reviewing", "completed"],
    requiredCapabilities: job.skill_id === "infographic"
      ? ["story-structure", "copywriting", "visual-design", "audio-design", "remotion-render"]
      : [],
    createdAt: new Date().toISOString(),
  };
}

export async function runCompanySkillJob(
  context: CompanySkillExecutorContext,
  jobId: string,
): Promise<CompanySkillJobRow | null> {
  let pendingJob = await getCompanySkillJob(context.sql, context.userId, jobId);
  if (!pendingJob || ["completed", "failed", "cancelled"].includes(pendingJob.status)) return pendingJob;
  const pendingDefinition = SERVER_COMPANY_SKILLS[pendingJob.skill_id];
  // 영상 파이프라인은 비용을 셈하려면 먼저 프로젝트를 읽어 계획을 세워야 한다(어느 컷이 비었는지).
  if (pendingJob.skill_id === "video_pipeline" && pendingJob.status === "validating" && !readVideoPipelinePlan(pendingJob)) {
    try {
      pendingJob = await prepareVideoPipelinePlan(pendingJob, context);
    } catch (error: any) {
      const failed = await transitionCompanySkillJob(context.sql, context.userId, jobId, "failed", {
        error: { code: "SKILL_PLAN_FAILED", message: String(error?.message || error || "계획 수립 실패"), retryable: true, stage: "validating" },
        resetExecutionLease: true,
      });
      await appendCompanySkillJobEvent(context.sql, {
        jobId, userId: context.userId, eventType: "error", stage: "validating", status: "failed",
        summary: String(error?.message || error || "계획 수립 실패"), eventKey: `video-pipeline:plan-failed:${Date.now()}`,
      });
      return failed;
    }
  }
  const costGate = await estimateCompanySkillJobCost(
    context.sql,
    context.userId,
    context.env,
    pendingJob,
    pendingDefinition?.costPolicy || "no-external-cost",
  );
  if (costGate.approvalRequired && !hasMatchingCostApproval(pendingJob, costGate)) {
    const requestedAt = new Date().toISOString();
    pendingJob = await transitionCompanySkillJob(context.sql, context.userId, jobId, pendingJob.status, {
      currentStage: "awaiting-approval",
      costEstimate: costGate.cost,
      approvalState: { status: "pending", action: costGate.action, scope: costGate.scope, requestedAt },
      resetExecutionLease: true,
    }) as CompanySkillJobRow;
    await appendCompanySkillJobEvent(context.sql, {
      jobId, userId: context.userId, eventType: "approval", stage: "awaiting-approval", status: "pending",
      summary: costGate.cost.amount == null
        ? "제공자 단가가 설정되지 않아 비용을 산정할 수 없습니다. 실행 승인이 필요합니다."
        : `예상 비용 $${costGate.cost.amount.toFixed(6)}이 자동 실행 상한을 넘어 승인이 필요합니다.`,
      details: { costEstimate: costGate.cost, scope: costGate.scope },
      eventKey: `cost-gate:${costGate.gateId}:pending`,
    });
    return pendingJob;
  }
  if (!costGate.approvalRequired) {
    pendingJob = await transitionCompanySkillJob(context.sql, context.userId, jobId, pendingJob.status, {
      currentStage: pendingJob.status,
      costEstimate: costGate.cost,
      approvalState: { status: "not-required", action: costGate.action, scope: costGate.scope },
    }) as CompanySkillJobRow;
  }
  const executionToken = crypto.randomUUID();
  let job = await claimCompanySkillJobExecution(context.sql, context.userId, jobId, executionToken);
  if (!job) return getCompanySkillJob(context.sql, context.userId, jobId);
  try {
    const definition = SERVER_COMPANY_SKILLS[job.skill_id];
    const executor = definition ? COMPANY_SKILL_EXECUTORS[definition.executorId] : null;
    if (!definition || !executor) throw new Error(`Skill 실행기를 찾지 못했습니다: ${job.skill_id}`);

    await appendCompanySkillJobEvent(context.sql, {
      jobId: job.id,
      userId: context.userId,
      eventType: "stage",
      stage: job.current_stage || job.status,
      status: "working",
      summary: `${job.current_stage || job.status} 단계에서 실행을 시작하거나 복원했습니다.`,
      eventKey: `${executionToken}:claimed:${job.status}`,
    });

    if (job.status === "validating") {
      job = await transitionCompanySkillJob(context.sql, context.userId, job.id, "planning", {
        progress: 10,
        resolvedBrief: {
          request: (job.input as any)?.request || "",
          options: (job.input as any)?.options || {},
          references: (job.input as any)?.references || [],
        },
        executionPlan: buildExecutionPlan(job, executor.id),
        expectedExecutionToken: executionToken,
      }) as CompanySkillJobRow;
      await appendCompanySkillJobEvent(context.sql, {
        jobId: job.id, userId: context.userId, eventType: "stage", stage: "planning", status: "working",
        summary: "코어가 실행 계획과 필요한 에이전트 역량을 확정했습니다.",
        details: job.execution_plan, eventKey: `${executionToken}:planning`,
      });
    }

    if (job.status === "planning") {
      job = await transitionCompanySkillJob(context.sql, context.userId, job.id, "running", {
        progress: 25,
        expectedExecutionToken: executionToken,
      }) as CompanySkillJobRow;
      await appendCompanySkillJobEvent(context.sql, {
        jobId: job.id, userId: context.userId, eventType: "stage", stage: "running", status: "working",
        summary: "에이전트 협업 제작을 시작했습니다.", eventKey: `${executionToken}:running`,
      });
    }

    if (job.status === "running") {
      const result = await executor.execute(job, context);
      for (const [index, ev] of (result.events || []).entries()) {
        await appendCompanySkillJobEvent(context.sql, {
          jobId: job.id, userId: context.userId, eventType: ev.status === "failed" ? "error" : "stage",
          stage: ev.stage, status: ev.status, summary: ev.summary, details: ev.details,
          agentId: "pixel", agentName: "픽셀",
          eventKey: ev.eventKey || `${executionToken}:batch:${index}`,
        });
      }
      if (result.continueRunning) {
        // 예산이 먼저 끝났다 — running 을 유지하고 계획만 갱신한 뒤 리스를 반납한다. continue 엔드포인트가 이어간다.
        const planProgress = result.executionPlan ? describePlanProgress(result.executionPlan as VideoPipelinePlan) : null;
        job = await transitionCompanySkillJob(context.sql, context.userId, job.id, "running", {
          progress: planProgress ? planProgress.progress : job.progress,
          currentStage: "running",
          executionPlan: result.executionPlan,
          agentReports: result.agentReports,
          resetExecutionLease: true,
          expectedExecutionToken: executionToken,
        }) as CompanySkillJobRow;
        await appendCompanySkillJobEvent(context.sql, {
          jobId: job.id, userId: context.userId, eventType: "stage", stage: "running", status: "queued",
          summary: "이번 배치를 마쳤습니다. 남은 컷은 다음 배치에서 이어서 생성합니다.",
          details: planProgress || {}, eventKey: `${executionToken}:batch-paused`,
        });
        return job;
      }
      job = await transitionCompanySkillJob(context.sql, context.userId, job.id, "reviewing", {
        ...(result.executionPlan ? { executionPlan: result.executionPlan } : {}),
        progress: 85,
        agentReports: result.agentReports,
        qualityResults: result.qualityResults,
        workItemId: result.workItemId || null,
        actualCost: buildActualCompanySkillCost(job.cost_estimate as any),
        providerUsage: {
          provider: "anthropic",
          plannedCalls: 5,
          actualUsageAvailable: false,
          renderMode: resolveCompanySkillRenderer(context.env) ? "server" : "browser",
        },
        expectedExecutionToken: executionToken,
      }) as CompanySkillJobRow;
      for (const [index, report] of result.agentReports.entries()) {
        const value: any = report || {};
        await appendCompanySkillJobEvent(context.sql, {
          jobId: job.id, userId: context.userId, eventType: "agent-report", stage: "reviewing",
          agentId: String(value.agentId || ""), agentName: String(value.agentName || ""),
          status: String(value.status || "completed"), summary: String(value.decision || "업무를 완료했습니다."),
          details: value, eventKey: `${executionToken}:agent:${value.agentId || index}`,
        });
      }
      for (const [index, quality] of result.qualityResults.entries()) {
        const value: any = quality || {};
        await appendCompanySkillJobEvent(context.sql, {
          jobId: job.id, userId: context.userId, eventType: "quality", stage: "reviewing",
          status: String(value.status || "warning"), summary: String(value.summary || "품질 검사를 수행했습니다."),
          details: value, eventKey: `${executionToken}:quality:${value.gateId || index}`,
        });
      }
      await appendCompanySkillJobEvent(context.sql, {
        jobId: job.id, userId: context.userId, eventType: "stage", stage: "reviewing", status: "working",
        summary: "에이전트 결과와 품질 게이트를 검수했습니다.", eventKey: `${executionToken}:reviewing`,
      });
    }

    if (job.status === "reviewing") {
      // 인포그래픽은 업무 탐색기 항목이 산출물이지만, 영상 파이프라인의 산출물은 프로젝트 씬 자체다.
      if (!job.work_item_id && job.skill_id === "infographic") throw new Error("검수할 회사 업무 결과가 연결되지 않았습니다.");
      if (job.skill_id === "infographic" && resolveCompanySkillRenderer(context.env)) {
        await dispatchCompanySkillRender({ request: context.request, env: context.env, sql: context.sql, job });
        job = await transitionCompanySkillJob(context.sql, context.userId, job.id, "reviewing", {
          progress: 90,
          currentStage: "rendering",
          resetExecutionLease: true,
          expectedExecutionToken: executionToken,
        }) as CompanySkillJobRow;
        await appendCompanySkillJobEvent(context.sql, {
          jobId: job.id,
          userId: context.userId,
          eventType: "stage",
          stage: "rendering",
          status: "queued",
          summary: "서버 Remotion 렌더 큐에 등록했으며 최종 산출물 콜백을 기다립니다.",
          details: { workItemId: job.work_item_id, renderMode: "server" },
          eventKey: `server-render:${job.version}:queued`,
        });
        return job;
      }
      job = await transitionCompanySkillJob(context.sql, context.userId, job.id, "completed", {
        progress: 100,
        resetExecutionLease: true,
        expectedExecutionToken: executionToken,
      }) as CompanySkillJobRow;
      await appendCompanySkillJobEvent(context.sql, {
        jobId: job.id, userId: context.userId, eventType: "stage", stage: "completed", status: "completed",
        summary: job.skill_id === "video_pipeline"
          ? "영상 파이프라인을 마쳤습니다. 프로젝트 씬에 스틸·영상과 프롬프트 계보가 저장됐습니다."
          : "SkillJob 결과를 회사 업무 탐색기에 등록했습니다.",
        details: { workItemId: job.work_item_id }, eventKey: `${executionToken}:completed`,
      });
    }
    return job;
  } catch (error: any) {
    const latest = await getCompanySkillJob(context.sql, context.userId, jobId);
    if (!latest || latest.status === "cancelled") return latest;
    if (latest.execution_token !== executionToken) return latest;
    if (error instanceof CompanySkillJobTransitionError && error.currentStatus === "cancelled") return latest;
    if (["completed", "failed", "cancelled"].includes(latest.status)) return latest;
    const failed = await transitionCompanySkillJob(context.sql, context.userId, jobId, "failed", {
      error: {
        code: "SKILL_EXECUTION_FAILED",
        message: String(error?.message || error || "Skill 실행 실패"),
        retryable: true,
        stage: latest.current_stage,
      },
      resetExecutionLease: true,
      expectedExecutionToken: executionToken,
    });
    await appendCompanySkillJobEvent(context.sql, {
      jobId, userId: context.userId, eventType: "error", stage: latest.current_stage, status: "failed",
      summary: String(error?.message || error || "Skill 실행 실패"),
      details: { retryable: true }, eventKey: `${executionToken}:failed`,
    });
    return failed;
  }
}
