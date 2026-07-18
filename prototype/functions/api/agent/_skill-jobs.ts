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
