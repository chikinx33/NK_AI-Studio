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
