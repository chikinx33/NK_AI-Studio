// prototype/functions/api/_shared/cloud-models.js
// 에이전트별 두뇌 모델 매핑 + 제공사 카탈로그.
//
// 원래는 Claude 모델 이름만 담은 문자열 맵이었다. 사용자가 에이전트마다
// Claude / OpenAI 를 골라 쓸 수 있게 되면서 "제공사 + 모델" 두 축이 필요해졌고,
// 기존 CLOUD_MODELS(문자열 맵)는 그대로 두고 위에 해석 계층을 얹었다.
// 문자열이면 anthropic 으로 읽는다 — 옛 설정·옛 호출부가 그대로 동작한다.

/** 기본 매핑(제공사 생략 = anthropic). 사용자가 따로 고르지 않으면 이 값이 쓰인다. */
export const CLOUD_MODELS = {
  core: "claude-opus-4-8",      // 코어(오케스트레이터) — 최상위 판단(가장 똑똑한 모델)
  edge: "claude-sonnet-4-6",
  radar: "claude-sonnet-4-6",
  maki: "claude-sonnet-4-6",
  plot: "claude-sonnet-4-6",
  ink: "claude-sonnet-4-6",
  pixel: "claude-sonnet-4-6",
  beat: "claude-sonnet-4-6",
  engi: "claude-sonnet-4-6",
  reach: "claude-sonnet-4-6",
  sync: "claude-haiku-4-5",     // 단순/저비용 작업
};

const DEFAULT_MODEL = "claude-sonnet-4-6";
export const DEFAULT_PROVIDER = "anthropic";

/**
 * 고를 수 있는 제공사·모델 목록. 설정 화면이 이 카탈로그를 그대로 받아 그린다.
 *
 * atlas = 이미 쓰고 있는 ATLASCLOUD_API_KEY 로 OpenAI 모델을 부르는 경로.
 *   새 벤더 계약이 필요 없고, 모델 ID·단가는 Atlas 카탈로그에서 확인한 값이다.
 * openai = api.openai.com 직접 호출. 모델 ID 는 계정이 실제로 열어 준 것과
 *   일치해야 하므로 직접 입력(allowCustom)을 함께 연다.
 */
export const MODEL_CATALOG = {
  anthropic: {
    label: "Claude (Anthropic)",
    keyLabel: "구독 토큰 또는 ANTHROPIC_API_KEY",
    allowCustom: false,
    models: [
      { id: "claude-opus-4-8", label: "Opus 4.8 — 최상위 판단, 가장 비쌈" },
      { id: "claude-sonnet-4-6", label: "Sonnet 4.6 — 기본 균형" },
      { id: "claude-haiku-4-5", label: "Haiku 4.5 — 빠르고 저렴" },
    ],
  },
  atlas: {
    label: "OpenAI · Atlas Cloud 경유",
    keyLabel: "ATLASCLOUD_API_KEY",
    allowCustom: false,
    models: [
      { id: "openai/gpt-5.6-sol", label: "GPT 5.6 Sol — 심층 추론" },
      { id: "openai/gpt-5.6-terra", label: "GPT 5.6 Terra — 실무·분석 ($2.5/$15 per M)" },
      { id: "openai/gpt-5.6-luna", label: "GPT 5.6 Luna — 창작·대화 ($1/$6 per M)" },
      { id: "openai/gpt-5.5", label: "GPT 5.5 — 범용" },
      { id: "openai/gpt-5.4", label: "GPT 5.4 — 범용, 400K 컨텍스트" },
    ],
  },
  openai: {
    label: "OpenAI · API 키 직접",
    keyLabel: "OPENAI_API_KEY",
    allowCustom: true,
    models: [
      { id: "gpt-5.6-sol", label: "GPT 5.6 Sol" },
      { id: "gpt-5.6-terra", label: "GPT 5.6 Terra" },
      { id: "gpt-5.6-luna", label: "GPT 5.6 Luna" },
      { id: "gpt-5.5", label: "GPT 5.5" },
      { id: "gpt-5.4", label: "GPT 5.4" },
    ],
  },
};

export const PROVIDERS = Object.keys(MODEL_CATALOG);

/** 제공사가 Anthropic Messages 규격인가(아니면 OpenAI chat/completions 규격). */
export function isAnthropicProvider(provider) {
  return normalizeProvider(provider) === "anthropic";
}

export function normalizeProvider(provider) {
  const raw = String(provider || "").toLowerCase().trim();
  return PROVIDERS.indexOf(raw) >= 0 ? raw : DEFAULT_PROVIDER;
}

/**
 * 저장값 → {provider, model}.
 * 문자열이면 예전 형식(= Claude 모델 이름)으로 읽는다.
 * 모델이 비었으면 그 제공사의 첫 모델로 채운다(빈 model 로 API 를 때리지 않게).
 */
export function normalizeModelChoice(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const model = value.trim();
    return model ? { provider: DEFAULT_PROVIDER, model } : null;
  }
  if (typeof value !== "object") return null;
  const provider = normalizeProvider(value.provider);
  const model = String(value.model || "").trim() || MODEL_CATALOG[provider].models[0].id;
  return { provider, model };
}

/** 기본 매핑(사용자 설정 없음)에서의 에이전트 모델. 하위호환용 문자열 반환. */
export function modelFor(agentId) {
  const id = String(agentId || "").toLowerCase().trim();
  return CLOUD_MODELS[id] || DEFAULT_MODEL;
}

/**
 * 최종 해석: 강제 지정 > 사용자 선택 > 성능 힌트 > 기본 매핑.
 *
 * override 와 hint 를 나눈 이유: 오케스트레이터에는 "코어 위임 계획은 Sonnet",
 * "5명 이상 그룹은 Haiku" 같은 지연시간 대책이 박혀 있다. 그건 사용자 취향이 아니라
 * Cloudflare 30초 제한 대응이므로, 사용자가 그 에이전트의 두뇌를 직접 골랐다면
 * 그 선택이 이겨야 한다. 반대로 override 는 코드가 반드시 그 모델을 써야 하는 경우다.
 *
 * @param agentId    에이전트 id (core·ink·sync …)
 * @param selections app_settings.agent_model_selections (없으면 {})
 * @param override   무조건 이 모델 (문자열 또는 {provider,model})
 * @param hint       사용자 선택이 없을 때만 쓰는 기본값
 */
export function resolveAgentModel(agentId, selections, override, hint) {
  const forced = normalizeModelChoice(override);
  if (forced) return forced;
  const picked = normalizeModelChoice(selections && selections[String(agentId || "").toLowerCase().trim()]);
  if (picked) return picked;
  const hinted = normalizeModelChoice(hint);
  if (hinted) return hinted;
  return { provider: DEFAULT_PROVIDER, model: modelFor(agentId) };
}

/** 설정 저장 전 검증: 카탈로그에 없는 조합을 걸러낸다(allowCustom 제공사는 통과). */
export function sanitizeModelSelections(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  Object.keys(input).forEach((rawAgentId) => {
    const agentId = String(rawAgentId || "").toLowerCase().trim();
    if (!agentId || !Object.prototype.hasOwnProperty.call(CLOUD_MODELS, agentId)) return;
    const choice = normalizeModelChoice(input[rawAgentId]);
    if (!choice) return;
    const cat = MODEL_CATALOG[choice.provider];
    const known = cat.models.some((m) => m.id === choice.model);
    if (!known && !cat.allowCustom) return;
    // 직접 입력 모델 ID 는 길이·문자만 제한한다(경로 조작·헤더 주입 방지).
    if (!known && !/^[A-Za-z0-9._\/-]{1,120}$/.test(choice.model)) return;
    out[agentId] = { provider: choice.provider, model: choice.model };
  });
  return out;
}
