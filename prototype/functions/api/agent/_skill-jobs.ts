import type { SqlFn } from "../knowledge/_shared";

export const COMPANY_SKILL_JOB_STATUSES = [
  "draft",
  "validating",
  "planning",
  "running",
  "reviewing",
  "revision",
  "completed",
  "failed",
  "cancelled",
] as const;

export type CompanySkillJobStatus = (typeof COMPANY_SKILL_JOB_STATUSES)[number];
export type CompanySkillInvocationMode = "agent" | "manual";
export type CompanySkillArtifactKind = "source" | "preview" | "final" | "manifest" | "report";

export const COMPANY_SKILL_JOB_TRANSITIONS: Readonly<Record<CompanySkillJobStatus, readonly CompanySkillJobStatus[]>> = {
  draft: ["validating", "cancelled"],
  validating: ["planning", "failed", "cancelled"],
  planning: ["running", "failed", "cancelled"],
  running: ["reviewing", "failed", "cancelled"],
  reviewing: ["revision", "completed", "failed", "cancelled"],
  revision: ["running", "reviewing", "failed", "cancelled"],
  completed: [],
  failed: ["validating", "planning", "running", "reviewing", "cancelled"],
  cancelled: [],
};

export function canTransitionCompanySkillJob(
  current: CompanySkillJobStatus,
  next: CompanySkillJobStatus,
): boolean {
  return COMPANY_SKILL_JOB_TRANSITIONS[current].includes(next);
}

export function isCompanySkillJobId(value: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

export interface CompanySkillJobRow {
  id: string;
  user_id: string;
  conversation_id: string;
  company_id: string | null;
  category_id: string;
  skill_id: string;
  invocation_mode: CompanySkillInvocationMode;
  title: string;
  original_title: string;
  status: CompanySkillJobStatus;
  progress: number;
  current_stage: string;
  input: unknown;
  resolved_brief: unknown;
  execution_plan: unknown;
  agent_reports: unknown[];
  warnings: unknown[];
  error: unknown | null;
  cost_estimate: unknown | null;
  actual_cost: unknown | null;
  provider_usage: unknown;
  quality_results: unknown[];
  approval_state: unknown | null;
  parent_work_id: string | null;
  version: number;
  lineage: unknown[];
  idempotency_key: string | null;
  execution_token: string | null;
  execution_started_at: string | null;
  work_item_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CompanySkillArtifactRow {
  id: string;
  job_id: string;
  user_id: string;
  work_item_id: string | null;
  kind: CompanySkillArtifactKind;
  file_name: string;
  object_path: string;
  mime_type: string;
  size_bytes: number | null;
  checksum: string;
  version: number;
  metadata: unknown;
  created_at: string;
  updated_at: string;
}

export interface CreateCompanySkillJobArgs {
  userId: string;
  conversationId: string;
  companyId?: string | null;
  categoryId: string;
  skillId: string;
  invocationMode: CompanySkillInvocationMode;
  title: string;
  originalTitle: string;
  input: unknown;
  warnings?: unknown[];
  idempotencyKey?: string | null;
  parentWorkId?: string | null;
  version?: number;
  lineage?: unknown[];
}

export interface CompanySkillJobPatch {
  progress?: number;
  currentStage?: string;
  resolvedBrief?: unknown;
  executionPlan?: unknown;
  agentReports?: unknown[];
  warnings?: unknown[];
  error?: unknown | null;
  costEstimate?: unknown | null;
  actualCost?: unknown | null;
  providerUsage?: unknown;
  qualityResults?: unknown[];
  approvalState?: unknown | null;
  workItemId?: string | null;
  resetExecutionLease?: boolean;
  expectedExecutionToken?: string;
}

export function toCompanySkillJobDto(row: CompanySkillJobRow): Record<string, unknown> {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    companyId: row.company_id,
    categoryId: row.category_id,
    skillId: row.skill_id,
    invocationMode: row.invocation_mode,
    title: row.title,
    originalTitle: row.original_title,
    status: row.status,
    progress: row.progress,
    currentStage: row.current_stage,
    input: row.input,
    resolvedBrief: row.resolved_brief,
    executionPlan: row.execution_plan,
    agentReports: row.agent_reports,
    warnings: row.warnings,
    error: row.error,
    costEstimate: row.cost_estimate,
    actualCost: row.actual_cost,
    providerUsage: row.provider_usage,
    qualityResults: row.quality_results,
    approvalState: row.approval_state,
    parentWorkId: row.parent_work_id,
    version: row.version,
    lineage: row.lineage,
    workItemId: row.work_item_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function toCompanySkillArtifactDto(row: CompanySkillArtifactRow): Record<string, unknown> {
  return {
    id: row.id,
    jobId: row.job_id,
    workItemId: row.work_item_id,
    kind: row.kind,
    fileName: row.file_name,
    objectPath: row.object_path,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    checksum: row.checksum,
    version: row.version,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class CompanySkillJobTransitionError extends Error {
  readonly currentStatus: CompanySkillJobStatus;
  readonly requestedStatus: CompanySkillJobStatus;

  constructor(currentStatus: CompanySkillJobStatus, requestedStatus: CompanySkillJobStatus) {
    super(`SkillJob status cannot transition from ${currentStatus} to ${requestedStatus}`);
    this.name = "CompanySkillJobTransitionError";
    this.currentStatus = currentStatus;
    this.requestedStatus = requestedStatus;
  }
}

export class CompanySkillJobExecutionLeaseError extends Error {
  constructor() {
    super("SkillJob execution lease is no longer owned by this worker");
    this.name = "CompanySkillJobExecutionLeaseError";
  }
}

export async function createCompanySkillJob(
  sql: SqlFn,
  args: CreateCompanySkillJobArgs,
): Promise<{ job: CompanySkillJobRow; created: boolean }> {
  const idempotencyKey = String(args.idempotencyKey || "").trim() || null;
  const rows = await sql(
    `INSERT INTO company_skill_jobs
      (user_id, conversation_id, company_id, category_id, skill_id, invocation_mode,
       title, original_title, status, progress, current_stage, input, warnings,
       idempotency_key, parent_work_id, version, lineage)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'validating', 5, 'validating',
       $9::jsonb, $10::jsonb, $11, $12, $13, $14::jsonb)
     ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
     RETURNING *`,
    [
      args.userId,
      args.conversationId || "main",
      args.companyId || null,
      args.categoryId,
      args.skillId,
      args.invocationMode,
      args.title,
      args.originalTitle,
      JSON.stringify(args.input ?? {}),
      JSON.stringify(args.warnings ?? []),
      idempotencyKey,
      args.parentWorkId || null,
      Math.max(1, Number(args.version) || 1),
      JSON.stringify(args.lineage ?? []),
    ],
  );
  if (rows[0]) return { job: rows[0] as CompanySkillJobRow, created: true };
  if (!idempotencyKey) throw new Error("SkillJob insert returned no row");
  const existing = await sql(
    "SELECT * FROM company_skill_jobs WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1",
    [args.userId, idempotencyKey],
  );
  if (!existing[0]) throw new Error("Idempotent SkillJob could not be restored");
  return { job: existing[0] as CompanySkillJobRow, created: false };
}

export async function getCompanySkillJob(
  sql: SqlFn,
  userId: string,
  jobId: string,
): Promise<CompanySkillJobRow | null> {
  const rows = await sql(
    "SELECT * FROM company_skill_jobs WHERE id = $1 AND user_id = $2 LIMIT 1",
    [jobId, userId],
  );
  return (rows[0] as CompanySkillJobRow) || null;
}

export async function listCompanySkillJobs(
  sql: SqlFn,
  userId: string,
  limit = 50,
): Promise<CompanySkillJobRow[]> {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const rows = await sql(
    "SELECT * FROM company_skill_jobs WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2",
    [userId, safeLimit],
  );
  return rows as CompanySkillJobRow[];
}

function appendJsonPatch(
  sets: string[],
  values: unknown[],
  column: string,
  value: unknown,
  cast = "::jsonb",
) {
  values.push(JSON.stringify(value));
  sets.push(`${column} = $${values.length}${cast}`);
}

export async function transitionCompanySkillJob(
  sql: SqlFn,
  userId: string,
  jobId: string,
  nextStatus: CompanySkillJobStatus,
  patch: CompanySkillJobPatch = {},
): Promise<CompanySkillJobRow | null> {
  const current = await getCompanySkillJob(sql, userId, jobId);
  if (!current) return null;
  if (current.status !== nextStatus && !canTransitionCompanySkillJob(current.status, nextStatus)) {
    throw new CompanySkillJobTransitionError(current.status, nextStatus);
  }

  const values: unknown[] = [nextStatus];
  const sets = ["status = $1"];
  if (patch.progress !== undefined) {
    values.push(Math.min(100, Math.max(0, Math.round(Number(patch.progress) || 0))));
    sets.push(`progress = $${values.length}`);
  }
  if (patch.currentStage !== undefined) {
    values.push(String(patch.currentStage || nextStatus));
    sets.push(`current_stage = $${values.length}`);
  } else if (!["failed", "cancelled"].includes(nextStatus)) {
    values.push(nextStatus);
    sets.push(`current_stage = $${values.length}`);
  }
  if (patch.resolvedBrief !== undefined) appendJsonPatch(sets, values, "resolved_brief", patch.resolvedBrief);
  if (patch.executionPlan !== undefined) appendJsonPatch(sets, values, "execution_plan", patch.executionPlan);
  if (patch.agentReports !== undefined) appendJsonPatch(sets, values, "agent_reports", patch.agentReports);
  if (patch.warnings !== undefined) appendJsonPatch(sets, values, "warnings", patch.warnings);
  if (patch.error !== undefined) appendJsonPatch(sets, values, "error", patch.error);
  if (patch.costEstimate !== undefined) appendJsonPatch(sets, values, "cost_estimate", patch.costEstimate);
  if (patch.actualCost !== undefined) appendJsonPatch(sets, values, "actual_cost", patch.actualCost);
  if (patch.providerUsage !== undefined) appendJsonPatch(sets, values, "provider_usage", patch.providerUsage);
  if (patch.qualityResults !== undefined) appendJsonPatch(sets, values, "quality_results", patch.qualityResults);
  if (patch.approvalState !== undefined) appendJsonPatch(sets, values, "approval_state", patch.approvalState);
  if (patch.workItemId !== undefined) {
    values.push(patch.workItemId);
    sets.push(`work_item_id = $${values.length}`);
  }
  if (patch.resetExecutionLease) sets.push("execution_token = NULL", "execution_started_at = NULL");
  if (nextStatus === "completed") {
    sets.push("progress = 100", "completed_at = COALESCE(completed_at, now())");
  } else if (nextStatus !== "completed" && current.status === "completed") {
    sets.push("completed_at = NULL");
  }
  sets.push("updated_at = now()");
  values.push(jobId, userId, current.status);
  const jobIdIndex = values.length - 2;
  const userIdIndex = values.length - 1;
  const currentStatusIndex = values.length;
  let where = `id = $${jobIdIndex} AND user_id = $${userIdIndex} AND status = $${currentStatusIndex}`;
  if (patch.expectedExecutionToken) {
    values.push(patch.expectedExecutionToken);
    where += ` AND execution_token = $${values.length}`;
  }
  const rows = await sql(
    `UPDATE company_skill_jobs SET ${sets.join(", ")}
     WHERE ${where}
     RETURNING *`,
    values,
  );
  if (rows[0]) return rows[0] as CompanySkillJobRow;
  const latest = await getCompanySkillJob(sql, userId, jobId);
  if (!latest) return null;
  if (patch.expectedExecutionToken && latest.execution_token !== patch.expectedExecutionToken) {
    throw new CompanySkillJobExecutionLeaseError();
  }
  if (latest.status === nextStatus) return latest;
  throw new CompanySkillJobTransitionError(latest.status, nextStatus);
}

export async function cancelCompanySkillJob(
  sql: SqlFn,
  userId: string,
  jobId: string,
): Promise<CompanySkillJobRow | null> {
  const current = await getCompanySkillJob(sql, userId, jobId);
  if (!current || current.status === "cancelled") return current;
  return transitionCompanySkillJob(sql, userId, jobId, "cancelled", { resetExecutionLease: true });
}

export async function retryCompanySkillJob(
  sql: SqlFn,
  userId: string,
  jobId: string,
): Promise<CompanySkillJobRow | null> {
  const current = await getCompanySkillJob(sql, userId, jobId);
  if (!current) return null;
  if (current.status !== "failed") throw new CompanySkillJobTransitionError(current.status, "validating");
  const retryStage = (["validating", "planning", "running", "reviewing"] as const).includes(current.current_stage as any)
    ? current.current_stage as "validating" | "planning" | "running" | "reviewing"
    : "validating";
  return transitionCompanySkillJob(sql, userId, jobId, retryStage, {
    progress: retryStage === "validating" ? 5 : current.progress,
    currentStage: retryStage,
    error: null,
    resetExecutionLease: true,
  });
}

export async function claimCompanySkillJobExecution(
  sql: SqlFn,
  userId: string,
  jobId: string,
  executionToken: string,
): Promise<CompanySkillJobRow | null> {
  const rows = await sql(
    `UPDATE company_skill_jobs
     SET execution_token = $3, execution_started_at = now(), updated_at = now()
     WHERE id = $1 AND user_id = $2
       AND status IN ('validating', 'planning', 'running', 'reviewing')
       AND (execution_token IS NULL OR execution_started_at < now() - interval '30 minutes')
     RETURNING *`,
    [jobId, userId, executionToken],
  );
  return (rows[0] as CompanySkillJobRow) || null;
}

export async function setCompanySkillJobApproval(
  sql: SqlFn,
  userId: string,
  jobId: string,
  approvalState: unknown,
): Promise<CompanySkillJobRow | null> {
  const rows = await sql(
    `UPDATE company_skill_jobs
     SET approval_state = $3::jsonb, updated_at = now()
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [jobId, userId, JSON.stringify(approvalState)],
  );
  return (rows[0] as CompanySkillJobRow) || null;
}

export async function listCompanySkillArtifacts(
  sql: SqlFn,
  userId: string,
  jobId: string,
): Promise<CompanySkillArtifactRow[]> {
  const rows = await sql(
    `SELECT artifact.* FROM company_skill_artifacts artifact
     INNER JOIN company_skill_jobs job ON job.id = artifact.job_id AND job.user_id = artifact.user_id
     WHERE artifact.user_id = $1 AND artifact.job_id = $2
     ORDER BY artifact.created_at ASC`,
    [userId, jobId],
  );
  return rows as CompanySkillArtifactRow[];
}

export async function ensureCompanySkillJobSchema(sql: SqlFn): Promise<void> {
  await sql(`
    CREATE TABLE IF NOT EXISTS company_skill_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      conversation_id text NOT NULL DEFAULT 'main',
      company_id text,
      category_id text NOT NULL,
      skill_id text NOT NULL,
      invocation_mode text NOT NULL,
      title text NOT NULL,
      original_title text NOT NULL,
      status text NOT NULL DEFAULT 'draft',
      progress smallint NOT NULL DEFAULT 0,
      current_stage text NOT NULL DEFAULT 'draft',
      input jsonb NOT NULL DEFAULT '{}'::jsonb,
      resolved_brief jsonb,
      execution_plan jsonb,
      agent_reports jsonb NOT NULL DEFAULT '[]'::jsonb,
      warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
      error jsonb,
      cost_estimate jsonb,
      actual_cost jsonb,
      provider_usage jsonb NOT NULL DEFAULT '{}'::jsonb,
      quality_results jsonb NOT NULL DEFAULT '[]'::jsonb,
      approval_state jsonb,
      parent_work_id uuid,
      version integer NOT NULL DEFAULT 1,
      lineage jsonb NOT NULL DEFAULT '[]'::jsonb,
      idempotency_key text,
      execution_token text,
      execution_started_at timestamptz,
      work_item_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      CONSTRAINT company_skill_jobs_identity_user UNIQUE (id, user_id),
      CONSTRAINT company_skill_jobs_progress_range CHECK (progress BETWEEN 0 AND 100),
      CONSTRAINT company_skill_jobs_version_positive CHECK (version > 0),
      CONSTRAINT company_skill_jobs_invocation_mode CHECK (invocation_mode IN ('agent', 'manual'))
    )
  `);
  await sql("ALTER TABLE company_skill_jobs ADD COLUMN IF NOT EXISTS execution_token text");
  await sql("ALTER TABLE company_skill_jobs ADD COLUMN IF NOT EXISTS execution_started_at timestamptz");
  await sql(`
    CREATE TABLE IF NOT EXISTS company_skill_artifacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id uuid NOT NULL,
      user_id text NOT NULL,
      work_item_id uuid,
      kind text NOT NULL,
      file_name text NOT NULL,
      object_path text NOT NULL,
      mime_type text NOT NULL DEFAULT 'application/octet-stream',
      size_bytes bigint,
      checksum text NOT NULL DEFAULT '',
      version integer NOT NULL DEFAULT 1,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT company_skill_artifacts_job_user_fk
        FOREIGN KEY (job_id, user_id) REFERENCES company_skill_jobs(id, user_id) ON DELETE CASCADE,
      CONSTRAINT company_skill_artifacts_kind CHECK (kind IN ('source', 'preview', 'final', 'manifest', 'report')),
      CONSTRAINT company_skill_artifacts_version_positive CHECK (version > 0)
    )
  `);
  await sql("CREATE INDEX IF NOT EXISTS company_skill_jobs_user_updated_idx ON company_skill_jobs (user_id, updated_at DESC)");
  await sql("CREATE INDEX IF NOT EXISTS company_skill_jobs_user_status_idx ON company_skill_jobs (user_id, status, updated_at DESC)");
  await sql("CREATE UNIQUE INDEX IF NOT EXISTS company_skill_jobs_user_idempotency_idx ON company_skill_jobs (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL");
  await sql("CREATE INDEX IF NOT EXISTS company_skill_artifacts_user_job_idx ON company_skill_artifacts (user_id, job_id, created_at)");
  await sql("CREATE UNIQUE INDEX IF NOT EXISTS company_skill_artifacts_job_path_idx ON company_skill_artifacts (job_id, object_path)");
}
