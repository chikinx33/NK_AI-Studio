export interface CompanySkillJsonSchema {
  $id: string;
  type: "object";
  additionalProperties: boolean;
  required: string[];
  properties: Record<string, unknown>;
}

const commonProperties = {
  invocationMode: { type: "string", enum: ["agent", "manual"] },
  request: { type: "string", minLength: 1, maxLength: 4_000 },
  conversationId: { type: "string", maxLength: 120 },
  companyId: { type: "string", maxLength: 120 },
  idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
  references: {
    type: "array",
    maxItems: 20,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "value"],
      properties: {
        kind: { type: "string", enum: ["file", "url", "knowledge", "work-artifact"] },
        id: { type: "string", maxLength: 200 },
        value: { type: "string", minLength: 1, maxLength: 4_000 },
      },
    },
  },
  costControl: {
    type: "object",
    additionalProperties: false,
    properties: {
      maxAmountUsd: { type: "number", minimum: 0 },
    },
  },
} as const;

export const COMPANY_SKILL_INPUT_SCHEMAS: Record<string, CompanySkillJsonSchema> = {
  "company-skill/infographic/v1": {
    $id: "company-skill/infographic/v1",
    type: "object",
    additionalProperties: false,
    required: ["invocationMode", "request"],
    properties: {
      ...commonProperties,
      options: {
        type: "object",
        additionalProperties: false,
        required: ["durationSec", "aspectRatio", "audience", "tone", "style"],
        properties: {
          durationSec: { type: "integer", minimum: 10, maximum: 60 },
          aspectRatio: { type: "string", enum: ["16:9", "9:16", "1:1"] },
          audience: { type: "string", minLength: 1, maxLength: 200 },
          purpose: { type: "string", maxLength: 200 },
          tone: { type: "string", minLength: 1, maxLength: 200 },
          style: { type: "string", minLength: 1, maxLength: 200 },
        },
      },
    },
  },
};

export function getCompanySkillInputSchema(schemaId: string): CompanySkillJsonSchema | undefined {
  return COMPANY_SKILL_INPUT_SCHEMAS[schemaId];
}
