import type { SqlFn } from "../knowledge/_shared";
import { SERVER_COMPANY_SKILLS } from "./_company-skill-registry";
import {
  appendCompanySkillJobEvent,
  claimCompanySkillJobExecution,
  CompanySkillJobTransitionError,
  getCompanySkillJob,
  transitionCompanySkillJob,
  type CompanySkillJobRow,
} from "./_skill-jobs";

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

export const COMPANY_SKILL_EXECUTORS: Readonly<Record<string, CompanySkillExecutor>> = {
  [infographicExecutor.id]: infographicExecutor,
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
      job = await transitionCompanySkillJob(context.sql, context.userId, job.id, "reviewing", {
        progress: 85,
        agentReports: result.agentReports,
        qualityResults: result.qualityResults,
        workItemId: result.workItemId,
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
      if (!job.work_item_id) throw new Error("검수할 회사 업무 결과가 연결되지 않았습니다.");
      job = await transitionCompanySkillJob(context.sql, context.userId, job.id, "completed", {
        progress: 100,
        resetExecutionLease: true,
        expectedExecutionToken: executionToken,
      }) as CompanySkillJobRow;
      await appendCompanySkillJobEvent(context.sql, {
        jobId: job.id, userId: context.userId, eventType: "stage", stage: "completed", status: "completed",
        summary: "SkillJob 결과를 회사 업무 탐색기에 등록했습니다.",
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
