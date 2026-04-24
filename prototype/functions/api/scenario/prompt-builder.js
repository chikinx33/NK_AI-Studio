/**
 * scenario/prompt-builder.js
 *
 * Phase 0 Step 6 — 블록 시스템 기반 시나리오 시스템 프롬프트 빌더.
 *
 * 설계 목표
 * - 입력은 기존 scenario.js 의 input 객체와 호환되는 가벼운 shape.
 * - 내부에서 composeRuleSet() 을 호출해 EffectiveRuleSet 을 만들고,
 *   거기서 나온 자연어 조각 + 비트 구조 + 제약을 시스템 프롬프트로 직렬화.
 * - 출력은 {systemPrompt, validatorSpec, ruleSet} — Step 7 validator 가
 *   validatorSpec 을 바로 소비할 수 있도록 같이 내보낸다.
 *
 * Step 8 에서 scenario.js 가 buildSystemPromptKo/En 대신 이 빌더를 쓰게 되면,
 * 700+ 라인의 수작업 문자열 조립 코드가 선언적 블록 합성으로 교체된다.
 */

import {
  composeRuleSet,
  toSystemPromptFragment,
  toValidatorSpec,
} from "./compose.js";

/**
 * @typedef {Object} PromptBuilderInput
 * @property {string}   [lang]             "ko" | "en"
 * @property {number|string} [durationSec]
 * @property {number}   [sceneCount]       지정 시 최우선
 * @property {string}   [purposeCategory]
 * @property {string[]|string} [purposeTags]
 * @property {string}   [target]
 * @property {string[]|string} [needs]
 * @property {string[]|string} [tones]
 * @property {string[]|string} [styles]
 * @property {string}   [topic]
 * @property {string}   [episodeTitle]
 * @property {string}   [story]
 */

/**
 * UI 에서 배열/문자열이 섞여 넘어오는 필드를 첫 번째 문자열로 정규화.
 */
function firstText(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const s = String(item || "").trim();
      if (s) return s;
    }
    return "";
  }
  return String(value || "").trim();
}

/**
 * 사용자 입력에서 composeRuleSet 이 받는 Selection 을 뽑아낸다.
 */
function toSelection(input) {
  return {
    durationSec: input.durationSec,
    purposeCategory: firstText(input.purposeCategory),
    purposeTag: firstText(input.purposeTags),
    target: firstText(input.target),
    need: firstText(input.needs),
    tone: firstText(input.tones),
    style: firstText(input.styles),
  };
}

/**
 * Beat 시트를 프롬프트 문자열로 직렬화.
 * 예) "Hook(2s): 즉각적 시선 장악 — 1~2컷"
 */
function describeBeats(beats, language) {
  if (!Array.isArray(beats) || beats.length === 0) return "";
  const isEn = language === "en";
  const lines = beats.map((b, i) => {
    const goal = isEn ? b.goalEn : b.goalKo;
    const cuts =
      b.minCuts || b.maxCuts
        ? ` — ${b.minCuts ?? "?"}~${b.maxCuts ?? "?"} ${isEn ? "cuts" : "컷"}`
        : "";
    return `  ${i + 1}. ${b.name} (${b.sec}s): ${goal || ""}${cuts}`;
  });
  const header = isEn ? "[Beat sheet]" : "[비트 시트]";
  return [header, ...lines].join("\n");
}

/**
 * 제약 수치를 사용자/LLM 가 이해 가능한 한 줄 요약으로.
 */
function describeConstraints(constraints, language) {
  if (!constraints || typeof constraints !== "object") return "";
  const entries = Object.entries(constraints);
  if (!entries.length) return "";
  const isEn = language === "en";
  const header = isEn ? "[Hard limits]" : "[수치 제약]";
  const lines = entries.map(([key, rule]) => {
    const label = (isEn ? rule.labelEn : rule.labelKo) || key;
    const range =
      rule.min != null && rule.max != null
        ? `${rule.min}~${rule.max}`
        : rule.min != null
          ? `≥ ${rule.min}`
          : rule.max != null
            ? `≤ ${rule.max}`
            : "";
    const sev = rule.severity ? ` (${rule.severity})` : "";
    return `  - ${label}: ${range}${sev}`;
  });
  return [header, ...lines].join("\n");
}

/**
 * 금칙/필수 토큰 요약.
 */
function describeTokens(forbidden, mandatory, language) {
  const isEn = language === "en";
  const out = [];
  if (Array.isArray(forbidden) && forbidden.length) {
    const lines = forbidden.map((t) => {
      const label = (isEn ? t.labelEn : t.labelKo) || String(t.pattern);
      return `  - ${label}${t.severity ? ` (${t.severity})` : ""}`;
    });
    out.push(isEn ? "[Forbidden]" : "[금지]", ...lines);
  }
  if (Array.isArray(mandatory) && mandatory.length) {
    const lines = mandatory.map((t) => {
      const label = (isEn ? t.labelEn : t.labelKo) || String(t.pattern);
      return `  - ${label}${t.severity ? ` (${t.severity})` : ""}`;
    });
    out.push(isEn ? "[Required]" : "[필수]", ...lines);
  }
  return out.join("\n");
}

/**
 * 씬 개수 결정.
 * 사용자가 sceneCount 를 명시하면 그대로, 아니면 ruleSet.sceneCountPreferred 사용.
 */
function resolveSceneCount(input, ruleSet) {
  const explicit = Number(input.sceneCount);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  if (ruleSet.sceneCountPreferred) return ruleSet.sceneCountPreferred;
  return 4; // 기본값
}

/**
 * 시스템 프롬프트 본체. 언어별로 공통 스케폴드는 유지하고,
 * 규칙/비트/제약/토큰은 composeRuleSet 의 결과를 그대로 꽂는다.
 */
function buildSystemPromptBody(ruleSet, sceneCount, language) {
  const isEn = language === "en";
  const rules = toSystemPromptFragment(ruleSet, language);
  const beats = describeBeats(ruleSet.beatStructure, language);
  const constraints = describeConstraints(ruleSet.constraints, language);
  const tokens = describeTokens(
    ruleSet.forbiddenTokens,
    ruleSet.mandatoryTokens,
    language,
  );

  const stage = ruleSet.stage;
  let stageLine = "";
  if (stage) {
    const place = isEn ? stage.placeEn : stage.placeKo;
    const bg = isEn ? stage.backgroundEn : stage.backgroundKo;
    if (place) {
      stageLine = isEn
        ? `[Stage] ${place}. ${bg || ""}`.trim()
        : `[무대] ${place}. ${bg || ""}`.trim();
    }
  }

  const intro = isEn
    ? `You are a senior video pre-production director. Produce exactly ${sceneCount} scenes as valid JSON following the rules below. Do not explain. Every scene must show, never tell.`
    : `당신은 숙련된 영상 프리 프로덕션 디렉터다. 아래 규칙을 따라 정확히 ${sceneCount}개 씬을 JSON 으로 생성한다. 해설 금지, 모든 씬은 "보여주기" 로만 쓴다.`;

  return [intro, stageLine, rules, beats, constraints, tokens]
    .filter((s) => s && String(s).trim())
    .join("\n\n");
}

/**
 * Phase 0 Step 6 메인 API.
 *
 * @param {PromptBuilderInput} input
 * @returns {{
 *   systemPrompt: string,
 *   validatorSpec: ReturnType<typeof toValidatorSpec>,
 *   ruleSet: ReturnType<typeof composeRuleSet>,
 *   language: "ko"|"en",
 *   sceneCount: number,
 *   progressLabel: string|null
 * }}
 */
export function buildSystemPrompt(input = {}) {
  const language = input.lang === "en" ? "en" : "ko";
  const selection = toSelection(input);
  const ruleSet = composeRuleSet(selection);
  const sceneCount = resolveSceneCount(input, ruleSet);
  const systemPrompt = buildSystemPromptBody(ruleSet, sceneCount, language);
  const validatorSpec = toValidatorSpec(ruleSet);
  const progressLabel =
    language === "en" ? ruleSet.progressLabelEn : ruleSet.progressLabelKo;

  return {
    systemPrompt,
    validatorSpec,
    ruleSet,
    language,
    sceneCount,
    progressLabel,
  };
}

/**
 * 디버깅/로그용 — 프롬프트 + 디스크립터를 한 문자열로.
 */
export function describeBuilt(result) {
  if (!result) return "(empty)";
  return [
    `language=${result.language}, sceneCount=${result.sceneCount}, progress=${result.progressLabel || "-"}`,
    result.systemPrompt,
  ].join("\n---\n");
}

export default { buildSystemPrompt, describeBuilt };
