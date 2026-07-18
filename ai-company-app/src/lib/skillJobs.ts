export const SKILL_JOB_STATUSES = [
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

export type SkillJobStatus = (typeof SKILL_JOB_STATUSES)[number];
export type SkillInvocationMode = "agent" | "manual";
export type SkillArtifactKind = "source" | "preview" | "final" | "manifest" | "report";
export type AgentReportStatus = "waiting" | "working" | "completed" | "revision" | "failed";
export type ApprovalStatus = "not-required" | "pending" | "approved" | "rejected";

export interface SkillJobInput {
  invocationMode: SkillInvocationMode;
  request: string;
  conversationId?: string;
  companyId?: string;
  references?: Array<{
    kind: "file" | "url" | "knowledge" | "work-artifact";
    id?: string;
    value: string;
  }>;
  options?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface SkillJobAgentReport {
  agentId: string;
  agentName: string;
  status: AgentReportStatus;
  decision: string;
  evidence?: string;
  artifactIds: string[];
  remainingRisks: string[];
  createdAt: string;
}

export interface SkillJobQualityResult {
  gateId: string;
  status: "passed" | "failed" | "warning";
  summary: string;
  details?: Record<string, unknown>;
  checkedAt: string;
}

export interface SkillJobEvent {
  id: string;
  jobId: string;
  eventType: "stage" | "agent-report" | "quality" | "warning" | "error" | "approval" | "artifact";
  stage: string;
  agentId: string | null;
  agentName: string | null;
  status: string;
  summary: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface SkillJobCost {
  currency: string;
  amount: number;
  isEstimate: boolean;
  breakdown: Array<{ provider: string; operation: string; amount: number }>;
}

export interface SkillJobApprovalState {
  status: ApprovalStatus;
  action?: string;
  scope?: Record<string, unknown>;
  requestedAt?: string;
  decidedAt?: string;
}

export interface SkillJobError {
  code: string;
  message: string;
  retryable: boolean;
  stage: string;
  details?: Record<string, unknown>;
}

export interface SkillJob {
  id: string;
  userId: string;
  conversationId: string;
  companyId: string | null;
  categoryId: string;
  skillId: string;
  invocationMode: SkillInvocationMode;
  title: string;
  originalTitle: string;
  status: SkillJobStatus;
  progress: number;
  currentStage: string;
  input: SkillJobInput;
  resolvedBrief: Record<string, unknown> | null;
  executionPlan: Record<string, unknown> | null;
  agentReports: SkillJobAgentReport[];
  warnings: string[];
  error: SkillJobError | null;
  costEstimate: SkillJobCost | null;
  actualCost: SkillJobCost | null;
  providerUsage: Record<string, unknown>;
  qualityResults: SkillJobQualityResult[];
  approvalState: SkillJobApprovalState | null;
  parentWorkId: string | null;
  version: number;
  lineage: string[];
  workItemId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  events: SkillJobEvent[];
}

export interface SkillArtifact {
  id: string;
  jobId: string;
  workItemId: string | null;
  kind: SkillArtifactKind;
  fileName: string;
  objectPath: string;
  mimeType: string;
  sizeBytes: number | null;
  checksum: string;
  version: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const SKILL_JOB_TRANSITIONS: Readonly<Record<SkillJobStatus, readonly SkillJobStatus[]>> = {
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

export function canTransitionSkillJob(current: SkillJobStatus, next: SkillJobStatus): boolean {
  return SKILL_JOB_TRANSITIONS[current].includes(next);
}
