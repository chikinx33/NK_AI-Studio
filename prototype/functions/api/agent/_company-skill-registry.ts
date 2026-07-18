import type { CompanySkillInvocationMode } from "./_skill-jobs";

export interface ServerCompanySkillDefinition {
  id: string;
  categoryId: string;
  inputSchema: string;
  executorId: string;
  permissionPolicy: string;
  costPolicy: "no-external-cost" | "estimate-before-paid-provider";
}

export interface NormalizedCompanySkillJobInput {
  invocationMode: CompanySkillInvocationMode;
  request: string;
  conversationId: string;
  companyId: string | null;
  references: Array<{ kind: "file" | "url" | "knowledge" | "work-artifact"; id?: string; value: string }>;
  options: Record<string, unknown>;
  costControl: { maxAmountUsd: number };
  idempotencyKey: string | null;
}

export const SERVER_COMPANY_SKILLS: Readonly<Record<string, ServerCompanySkillDefinition>> = {
  infographic: {
    id: "infographic",
    categoryId: "design-content",
    inputSchema: "company-skill/infographic/v1",
    executorId: "infographic-adapter-v1",
    permissionPolicy: "local-draft",
    costPolicy: "estimate-before-paid-provider",
  },
};

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeReferences(value: unknown): NormalizedCompanySkillJobInput["references"] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(["file", "url", "knowledge", "work-artifact"]);
  return value.slice(0, 20).flatMap((item: any) => {
    const kind = cleanText(item?.kind, 30) as NormalizedCompanySkillJobInput["references"][number]["kind"];
    const referenceValue = cleanText(item?.value, 4_000);
    if (!allowed.has(kind) || !referenceValue) return [];
    const id = cleanText(item?.id, 200);
    return [{ kind, ...(id ? { id } : {}), value: referenceValue }];
  });
}

function normalizeInfographicOptions(value: unknown): { options: Record<string, unknown>; warnings: string[] } {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const warnings: string[] = [];
  const requestedDuration = Number(input.durationSec);
  const durationSec = Number.isFinite(requestedDuration)
    ? Math.min(60, Math.max(10, Math.round(requestedDuration)))
    : 30;
  const aspectRatio = ["16:9", "9:16", "1:1"].includes(String(input.aspectRatio))
    ? String(input.aspectRatio)
    : "16:9";
  const audience = cleanText(input.audience, 200) || "일반 시청자";
  const purpose = cleanText(input.purpose, 200);
  const tone = cleanText(input.tone, 200) || "명료하고 신뢰감 있게";
  const style = cleanText(input.style, 200) || "시네마틱 모션 인포그래픽";
  if (!Number.isFinite(requestedDuration)) warnings.push("영상 길이가 없어 기본값 30초를 적용했습니다.");
  if (!["16:9", "9:16", "1:1"].includes(String(input.aspectRatio))) warnings.push("화면 비율이 없어 기본값 16:9를 적용했습니다.");
  if (!cleanText(input.audience, 200)) warnings.push("시청 대상이 없어 일반 시청자를 적용했습니다.");
  if (!cleanText(input.tone, 200)) warnings.push("톤이 없어 명료하고 신뢰감 있는 톤을 적용했습니다.");
  if (!cleanText(input.style, 200)) warnings.push("스타일이 없어 시네마틱 모션 인포그래픽을 적용했습니다.");
  return { options: { durationSec, aspectRatio, audience, purpose, tone, style }, warnings };
}

export function normalizeCompanySkillJobInput(
  skillId: string,
  raw: unknown,
  headerIdempotencyKey = "",
): { ok: true; input: NormalizedCompanySkillJobInput; warnings: string[] } | { ok: false; error: string } {
  const skill = SERVER_COMPANY_SKILLS[skillId];
  if (!skill) return { ok: false, error: "활성화되지 않았거나 존재하지 않는 Skill입니다." };
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const invocationMode = body.invocationMode === "agent" ? "agent" : body.invocationMode === "manual" ? "manual" : null;
  if (!invocationMode) return { ok: false, error: "invocationMode는 agent 또는 manual이어야 합니다." };
  const request = cleanText(body.request, 4_000);
  if (!request) return { ok: false, error: "업무 요청(request)이 필요합니다." };
  const rawIdempotencyKey = cleanText(headerIdempotencyKey || body.idempotencyKey, 200);
  if (rawIdempotencyKey && rawIdempotencyKey.length < 8) {
    return { ok: false, error: "중복 실행 방지 키는 8자 이상이어야 합니다." };
  }

  if (skillId === "infographic") {
    const normalized = normalizeInfographicOptions(body.options);
    const requestedMaxAmountUsd = Number((body.costControl as any)?.maxAmountUsd);
    return {
      ok: true,
      input: {
        invocationMode,
        request,
        conversationId: cleanText(body.conversationId, 120) || "main",
        companyId: cleanText(body.companyId, 120) || null,
        references: normalizeReferences(body.references),
        options: normalized.options,
        costControl: {
          maxAmountUsd: Number.isFinite(requestedMaxAmountUsd) ? Math.max(0, requestedMaxAmountUsd) : 0,
        },
        idempotencyKey: rawIdempotencyKey || null,
      },
      warnings: normalized.warnings,
    };
  }
  return { ok: false, error: "Skill 입력 정규화기가 준비되지 않았습니다." };
}

export function buildCompanySkillJobTitle(rawTitle: unknown, request: string): { title: string; originalTitle: string } {
  const originalTitle = cleanText(rawTitle, 500) || cleanText(request, 500) || "회사 업무";
  return { title: originalTitle.slice(0, 20), originalTitle };
}
