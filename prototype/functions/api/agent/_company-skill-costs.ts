import type { SqlFn } from "../knowledge/_shared";
import { resolveAuth } from "../_shared/claude-auth.js";
import type { CompanySkillJobRow } from "./_skill-jobs";

export interface CompanySkillCost {
  category: "none" | "estimated" | "included" | "unavailable";
  currency: "USD";
  amount: number | null;
  isEstimate: boolean;
  breakdown: Array<{ provider: string; operation: string; amount: number | null }>;
  basis: Record<string, unknown>;
}

export interface CompanySkillCostGate {
  cost: CompanySkillCost;
  approvalRequired: boolean;
  gateId: string;
  action: string;
  scope: Record<string, unknown>;
}

const INFOGRAPHIC_MAX_OUTPUT_TOKENS = 10_200;
const INFOGRAPHIC_BASE_INPUT_TOKENS = 12_000;

function nonNegativeNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export async function estimateCompanySkillJobCost(
  sql: SqlFn,
  userId: string,
  env: any,
  job: CompanySkillJobRow,
  costPolicy: "no-external-cost" | "estimate-before-paid-provider",
): Promise<CompanySkillCostGate> {
  const auth = await resolveAuth(sql, userId, env);
  const input = job.input && typeof job.input === "object" ? job.input as any : {};
  const maxAmountUsd = nonNegativeNumber(input?.costControl?.maxAmountUsd) ?? 0;
  const baseGateId = `${job.skill_id}:provider-cost:v1`;
  const action = "외부 AI 제공자를 사용해 인포그래픽 제작 회의를 실행합니다.";

  // 영상 파이프라인은 Anthropic 토큰이 아니라 이미지·영상 생성 크레딧을 쓴다.
  // USD 환산 단가가 없으므로 amount 는 null 로 두고 항상 승인을 요구한다 — 크레딧이 실제로 빠지는 작업은
  // 계획(몇 컷·어느 단계)과 예상 크레딧을 사람이 보고 누르기 전엔 돌지 않는다.
  if (job.skill_id === "video_pipeline") {
    return estimateVideoPipelineCost(job, maxAmountUsd);
  }

  if (costPolicy === "no-external-cost") {
    const gateId = `${baseGateId}:none`;
    return {
      cost: { category: "none", currency: "USD", amount: 0, isEstimate: true, breakdown: [], basis: { costPolicy } },
      approvalRequired: false,
      gateId,
      action: "추가 외부 비용이 없는 작업을 실행합니다.",
      scope: { gateId, costPolicy, maxAmountUsd },
    };
  }

  if (auth.mode === "subscription") {
    return {
      cost: {
        category: "included", currency: "USD", amount: 0, isEstimate: true,
        breakdown: [{ provider: "anthropic", operation: "subscription-included", amount: 0 }],
        basis: { authMode: "subscription", callCount: 5, maxOutputTokens: INFOGRAPHIC_MAX_OUTPUT_TOKENS },
      },
      approvalRequired: false,
      gateId: `${baseGateId}:subscription`,
      action,
      scope: { gateId: `${baseGateId}:subscription`, provider: "anthropic", authMode: "subscription", maxAmountUsd },
    };
  }

  const requestTokens = Math.ceil(String(input?.request || "").length / 4) * 5;
  const estimatedInputTokens = INFOGRAPHIC_BASE_INPUT_TOKENS + requestTokens;
  const inputRate = nonNegativeNumber(env?.COMPANY_SKILL_ANTHROPIC_INPUT_USD_PER_MTOK);
  const outputRate = nonNegativeNumber(env?.COMPANY_SKILL_ANTHROPIC_OUTPUT_USD_PER_MTOK);
  const amount = inputRate == null || outputRate == null
    ? null
    : roundUsd((estimatedInputTokens * inputRate + INFOGRAPHIC_MAX_OUTPUT_TOKENS * outputRate) / 1_000_000);
  const approvalRequired = amount == null || amount > maxAmountUsd;
  const gateId = `${baseGateId}:${amount == null ? "unavailable" : amount}:${maxAmountUsd}`;
  const cost: CompanySkillCost = {
    category: amount == null ? "unavailable" : "estimated",
    currency: "USD",
    amount,
    isEstimate: true,
    breakdown: [{ provider: "anthropic", operation: "infographic-planning-and-synthesis", amount }],
    basis: {
      authMode: "api_key",
      callCount: 5,
      estimatedInputTokens,
      maxOutputTokens: INFOGRAPHIC_MAX_OUTPUT_TOKENS,
      inputRateUsdPerMillionTokens: inputRate,
      outputRateUsdPerMillionTokens: outputRate,
      rateSource: inputRate == null || outputRate == null ? "not-configured" : "deployment-environment",
    },
  };
  return {
    cost,
    approvalRequired,
    gateId,
    action,
    scope: { gateId, provider: "anthropic", authMode: "api_key", maxAmountUsd, estimatedAmountUsd: amount },
  };
}

/** 실행기의 계획 선행 단계(prepareVideoPipelinePlan)가 execution_plan.summary 에 남긴 크레딧 합계를 읽는다. */
export function estimateVideoPipelineCost(job: CompanySkillJobRow, maxAmountUsd: number): CompanySkillCostGate {
  const plan = job.execution_plan && typeof job.execution_plan === "object" ? job.execution_plan as any : {};
  const summary = plan.summary && typeof plan.summary === "object" ? plan.summary : {};
  const pendingStills = Math.max(0, Number(summary.pendingStills) || 0);
  const pendingVideos = Math.max(0, Number(summary.pendingVideos) || 0);
  const credits = Math.max(0, Number(summary.credits) || 0);
  const steps = pendingStills + pendingVideos;
  const gateId = `video_pipeline:credits:v1:${pendingStills}s-${pendingVideos}v:${credits}`;
  if (steps === 0) {
    return {
      cost: { category: "none", currency: "USD", amount: 0, isEstimate: true, breakdown: [], basis: { credits: 0, pendingStills, pendingVideos } },
      approvalRequired: false,
      gateId,
      action: "생성할 컷이 없어 추가 비용 없이 상태만 정리합니다.",
      scope: { gateId, credits: 0, pendingStills, pendingVideos, maxAmountUsd },
    };
  }
  const breakdown: CompanySkillCost["breakdown"] = [];
  if (pendingStills) breakdown.push({ provider: "imagen", operation: `still x${pendingStills}`, amount: null });
  if (pendingVideos) breakdown.push({ provider: "video", operation: `clip x${pendingVideos}`, amount: null });
  const cost: CompanySkillCost = {
    category: "estimated",
    currency: "USD",
    amount: null,
    isEstimate: true,
    breakdown,
    basis: {
      credits,
      pendingStills,
      pendingVideos,
      videoModel: String(summary.videoModel || ""),
      rateSource: "credit-rates",
      note: "크레딧 단가는 USD 환산 없이 표시됩니다.",
    },
  };
  return {
    cost,
    approvalRequired: true,
    gateId,
    action: `${pendingStills}개 스틸 · ${pendingVideos}개 영상 컷을 생성합니다 (예상 ${credits} 크레딧).`,
    scope: { gateId, credits, pendingStills, pendingVideos, maxAmountUsd },
  };
}

export function hasMatchingCostApproval(job: CompanySkillJobRow, gate: CompanySkillCostGate): boolean {
  const approval = job.approval_state && typeof job.approval_state === "object" ? job.approval_state as any : {};
  return approval.status === "approved" && approval.scope?.gateId === gate.gateId;
}

export function buildActualCompanySkillCost(estimate: CompanySkillCost | null): CompanySkillCost | null {
  if (!estimate) return null;
  if (estimate.category === "included" || estimate.category === "none") return { ...estimate, isEstimate: false };
  return {
    category: "unavailable",
    currency: "USD",
    amount: null,
    isEstimate: false,
    breakdown: [{ provider: "anthropic", operation: "provider-usage-not-returned", amount: null }],
    basis: { estimate, reason: "현재 제공자 어댑터가 실제 토큰 사용량을 반환하지 않습니다." },
  };
}
