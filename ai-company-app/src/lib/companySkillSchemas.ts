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
        role: { type: "string", enum: ["source", "style", "identity", "product", "mask", "layout"] },
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
  "company-skill/image/v1": {
    $id: "company-skill/image/v1",
    type: "object",
    additionalProperties: false,
    required: ["invocationMode", "request"],
    properties: {
      ...commonProperties,
      options: {
        type: "object",
        additionalProperties: false,
        required: ["mode", "purpose", "aspectRatio", "candidateCount", "style", "qualityPriority"],
        properties: {
          mode: { type: "string", enum: ["create", "edit", "variation", "background-remove", "background-replace", "resize-extend"] },
          purpose: { type: "string", minLength: 1, maxLength: 200 },
          channel: { type: "string", maxLength: 120 },
          audience: { type: "string", maxLength: 200 },
          aspectRatio: { type: "string", enum: ["1:1", "4:5", "3:2", "2:3", "16:9", "9:16", "custom"] },
          widthPx: { type: "integer", minimum: 256, maximum: 8192 },
          heightPx: { type: "integer", minimum: 256, maximum: 8192 },
          candidateCount: { type: "integer", minimum: 1, maximum: 4 },
          style: { type: "string", minLength: 1, maxLength: 200 },
          brandId: { type: "string", maxLength: 120 },
          editInstruction: { type: "string", maxLength: 4_000 },
          referenceStrength: { type: "number", minimum: 0, maximum: 1 },
          preserveIdentity: { type: "boolean" },
          preserveElements: { type: "array", maxItems: 20, items: { type: "string", maxLength: 200 } },
          forbiddenElements: { type: "array", maxItems: 20, items: { type: "string", maxLength: 200 } },
          transparentBackground: { type: "boolean" },
          textOverlay: {
            type: "object",
            additionalProperties: false,
            properties: {
              enabled: { type: "boolean" },
              text: { type: "string", maxLength: 1_000 },
              language: { type: "string", maxLength: 40 },
              exact: { type: "boolean" },
            },
          },
          outputFormat: { type: "string", enum: ["png", "jpeg", "webp"] },
          qualityPriority: { type: "string", enum: ["speed", "balanced", "quality"] },
        },
      },
    },
  },
};

export function getCompanySkillInputSchema(schemaId: string): CompanySkillJsonSchema | undefined {
  return COMPANY_SKILL_INPUT_SCHEMAS[schemaId];
}
