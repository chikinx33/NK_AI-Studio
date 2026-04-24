/**
 * scenario/validator.js
 *
 * Phase 0 Step 7 — 규칙 블록 기반 씬 검증기 + 자동 재시도 러너.
 *
 * 입력
 *   - scenes: LLM 이 돌려준 씬 배열. 각 씬은 {sceneIntent, sceneLocation, visual, narration, dialogue, estSec, ...}
 *   - spec: compose.js 의 toValidatorSpec() 출력 (constraints/tokens/sceneCountMin|Max|Preferred/beatStructure)
 *
 * 출력
 *   - violations: [{key, severity, labelKo, labelEn, sceneIndex?, evidence, suggestionKo, suggestionEn}]
 *   - hasCritical: boolean
 *   - refinePromptKo / En: 재생성 시 시스템 프롬프트 뒤에 이어붙일 수정 지시 문자열
 *
 * 재시도 러너 runWithAutoRetry():
 *   - severity=critical 이 하나라도 있으면 regenerate() 를 1회 호출해 다시 생성.
 *   - 두 번째 결과는 다시 검증하되, critical 이 여전히 남아도 최종 결과로 반환 (무한 루프 방지).
 *   - retried flag 로 재시도 여부 보고. 사용자에게는 숨김.
 */

// --- 유틸 ----------------------------------------------------------------

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

function textOfScene(scene) {
  if (!scene || typeof scene !== "object") return "";
  return [
    scene.sceneIntent,
    scene.sceneLocation,
    scene.visual,
    scene.narration,
    scene.dialogue,
  ]
    .map((v) => (v == null ? "" : String(v)))
    .join("\n");
}

function allText(scenes) {
  if (!Array.isArray(scenes)) return "";
  return scenes.map(textOfScene).join("\n---\n");
}

/**
 * pattern(RegExp|string) 이 text 안에 나타나는지 검사.
 */
function patternHits(pattern, text) {
  if (!text) return false;
  if (pattern instanceof RegExp) {
    return pattern.test(text);
  }
  const s = String(pattern || "");
  if (!s) return false;
  return text.includes(s);
}

/**
 * 반복 횟수 추정 — 한 씬에 같은 단어가 2회 이상 나오면 카운트, 혹은 씬들 사이에 같은 단어가 나오면 누적.
 * 아주 단순한 bag-of-words 추정. "후렴" 같은 메타 토큰도 함께 탐지.
 */
function estimateRepetitions(scenes) {
  const allTokens = [];
  for (const s of scenes || []) {
    const text = textOfScene(s);
    const tokens = text
      .split(/[\s,.!?；。、\-(){}\[\]"'`]+/u)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
    allTokens.push(...tokens);
  }
  const freq = new Map();
  for (const tok of allTokens) freq.set(tok, (freq.get(tok) || 0) + 1);
  // "가장 많이 반복된 의미 있는 토큰" 의 빈도
  let best = 0;
  for (const [, n] of freq) if (n > best) best = n;
  return best;
}

// --- 개별 검사 -----------------------------------------------------------

function checkSceneCount(scenes, spec, violations) {
  const count = Array.isArray(scenes) ? scenes.length : 0;
  if (spec.sceneCountMin != null && count < spec.sceneCountMin) {
    violations.push({
      key: "sceneCount.min",
      severity: "high",
      labelKo: "씬 개수가 기준보다 적음",
      labelEn: "Scene count below minimum",
      evidence: `got ${count}, need >= ${spec.sceneCountMin}`,
      suggestionKo: `씬을 ${spec.sceneCountMin}개 이상으로 늘려서 다시 생성하세요.`,
      suggestionEn: `Regenerate with at least ${spec.sceneCountMin} scenes.`,
    });
  }
  if (spec.sceneCountMax != null && count > spec.sceneCountMax) {
    violations.push({
      key: "sceneCount.max",
      severity: "high",
      labelKo: "씬 개수가 기준보다 많음",
      labelEn: "Scene count above maximum",
      evidence: `got ${count}, need <= ${spec.sceneCountMax}`,
      suggestionKo: `씬을 ${spec.sceneCountMax}개 이하로 통합해 다시 생성하세요.`,
      suggestionEn: `Regenerate with at most ${spec.sceneCountMax} scenes.`,
    });
  }
}

function checkForbiddenTokens(scenes, spec, violations) {
  const tokens = spec.forbiddenTokens || [];
  if (!tokens.length || !Array.isArray(scenes)) return;
  scenes.forEach((scene, idx) => {
    const text = textOfScene(scene);
    for (const rule of tokens) {
      if (patternHits(rule.pattern, text)) {
        violations.push({
          key: `forbidden:${String(rule.pattern)}`,
          severity: rule.severity || "medium",
          labelKo: rule.labelKo,
          labelEn: rule.labelEn,
          sceneIndex: idx,
          evidence: text.slice(0, 200),
          suggestionKo: rule.suggestionKo,
          suggestionEn: rule.suggestionEn,
        });
      }
    }
  });
}

function checkMandatoryTokens(scenes, spec, violations) {
  const tokens = spec.mandatoryTokens || [];
  if (!tokens.length) return;
  const allTextBlob = allText(scenes);
  for (const rule of tokens) {
    if (!patternHits(rule.pattern, allTextBlob)) {
      violations.push({
        key: `mandatory:${String(rule.pattern)}`,
        severity: rule.severity || "high",
        labelKo: rule.labelKo,
        labelEn: rule.labelEn,
        evidence: "missing from all scenes",
        suggestionKo:
          rule.suggestionKo ||
          `"${rule.labelKo || rule.pattern}" 요소가 최소 1개 씬에 나타나도록 추가하세요.`,
        suggestionEn:
          rule.suggestionEn ||
          `Add "${rule.labelEn || rule.pattern}" to at least one scene.`,
      });
    }
  }
}

function checkNarrationLength(scenes, spec, violations) {
  const rule = spec.constraints?.narrationMaxChars;
  if (!rule || rule.max == null || !Array.isArray(scenes)) return;
  scenes.forEach((scene, idx) => {
    const nar = String(scene?.narration || "").trim();
    if (!nar) return;
    if (nar.length > rule.max) {
      violations.push({
        key: "narrationMaxChars",
        severity: rule.severity || "medium",
        labelKo: rule.labelKo || "나레이션 글자 수 초과",
        labelEn: rule.labelEn || "Narration over char limit",
        sceneIndex: idx,
        evidence: `scene ${idx + 1}: ${nar.length} chars > ${rule.max}`,
        suggestionKo: `씬 ${idx + 1} 의 나레이션을 ${rule.max}자 이하로 줄이세요.`,
        suggestionEn: `Shorten scene ${idx + 1} narration to ${rule.max} chars or less.`,
      });
    }
  });
}

function checkShotLength(scenes, spec, violations) {
  const rule = spec.constraints?.shotLengthAvgSec;
  if (!rule || !Array.isArray(scenes) || scenes.length === 0) return;
  const secs = scenes
    .map((s) => Number(s?.estSec))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!secs.length) return;
  const avg = secs.reduce((a, b) => a + b, 0) / secs.length;
  if (rule.min != null && avg < rule.min) {
    violations.push({
      key: "shotLengthAvgSec.min",
      severity: rule.severity || "medium",
      labelKo: rule.labelKo || "평균 샷 길이 너무 짧음",
      labelEn: rule.labelEn || "Avg shot length too short",
      evidence: `avg ${avg.toFixed(1)}s < min ${rule.min}s`,
      suggestionKo: `평균 샷 길이가 ${rule.min}초 이상 되도록 컷을 줄이거나 씬을 길게 다시 구성하세요.`,
      suggestionEn: `Reduce cuts or lengthen scenes so the average shot is at least ${rule.min}s.`,
    });
  }
  if (rule.max != null && avg > rule.max) {
    violations.push({
      key: "shotLengthAvgSec.max",
      severity: rule.severity || "medium",
      labelKo: rule.labelKo || "평균 샷 길이 너무 긺",
      labelEn: rule.labelEn || "Avg shot length too long",
      evidence: `avg ${avg.toFixed(1)}s > max ${rule.max}s`,
      suggestionKo: `평균 샷 길이가 ${rule.max}초 이하가 되도록 씬을 더 쪼개세요.`,
      suggestionEn: `Split scenes further so the average shot is at most ${rule.max}s.`,
    });
  }
}

function checkRepetition(scenes, spec, violations) {
  const rule = spec.constraints?.repetitionMin;
  if (!rule || rule.min == null) return;
  const best = estimateRepetitions(scenes);
  if (best < rule.min) {
    violations.push({
      key: "repetitionMin",
      severity: rule.severity || "medium",
      labelKo: rule.labelKo || "반복 횟수 부족",
      labelEn: rule.labelEn || "Insufficient repetition",
      evidence: `max repeated token count ${best} < min ${rule.min}`,
      suggestionKo: `핵심 표현이나 후렴이 ${rule.min}회 이상 반복되도록 다시 구성하세요.`,
      suggestionEn: `Rebuild so the core phrase or hook repeats at least ${rule.min} times.`,
    });
  }
}

// --- 메인 API ------------------------------------------------------------

/**
 * 씬 배열을 spec 으로 검증한다.
 *
 * @param {Array} scenes
 * @param {ReturnType<typeof import("./compose.js").toValidatorSpec>} spec
 * @param {"ko"|"en"} [language="ko"]
 * @returns {{
 *   violations: Array,
 *   hasCritical: boolean,
 *   summary: {total:number, byLevel:Object},
 *   refinePromptKo: string,
 *   refinePromptEn: string,
 * }}
 */
export function validateScenes(scenes, spec, language = "ko") {
  const safeSpec = spec || {};
  const violations = [];

  checkSceneCount(scenes, safeSpec, violations);
  checkForbiddenTokens(scenes, safeSpec, violations);
  checkMandatoryTokens(scenes, safeSpec, violations);
  checkNarrationLength(scenes, safeSpec, violations);
  checkShotLength(scenes, safeSpec, violations);
  checkRepetition(scenes, safeSpec, violations);

  const byLevel = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const v of violations) {
    byLevel[v.severity] = (byLevel[v.severity] || 0) + 1;
  }
  const hasCritical = byLevel.critical > 0;

  return {
    violations: violations.sort(
      (a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0),
    ),
    hasCritical,
    summary: { total: violations.length, byLevel },
    refinePromptKo: buildRefinePrompt(violations, "ko"),
    refinePromptEn: buildRefinePrompt(violations, "en"),
    language,
  };
}

/**
 * critical 만 모아서 LLM 재생성 지시문을 만든다.
 * high/medium 은 고급 모드 UI 에서 따로 노출 (여기선 포함 X).
 */
function buildRefinePrompt(violations, lang) {
  const isEn = lang === "en";
  const criticals = violations.filter((v) => v.severity === "critical");
  if (!criticals.length) return "";
  const header = isEn
    ? "The previous output violated critical rules. Regenerate the full JSON, fixing every item below:"
    : "직전 결과가 치명적 규칙을 위반했습니다. 아래 항목을 모두 고쳐서 JSON 전체를 다시 생성하세요:";
  const lines = criticals.map((v, i) => {
    const label = (isEn ? v.labelEn : v.labelKo) || v.key;
    const sugg = (isEn ? v.suggestionEn : v.suggestionKo) || "";
    const where = v.sceneIndex != null ? ` (scene ${v.sceneIndex + 1})` : "";
    return `${i + 1}. ${label}${where}${sugg ? ` — ${sugg}` : ""}`;
  });
  return [header, ...lines].join("\n");
}

/**
 * critical 위반 시 자동 재시도 1회.
 *
 * @param {{
 *   scenes: Array,
 *   spec: ReturnType<typeof import("./compose.js").toValidatorSpec>,
 *   language?: "ko"|"en",
 *   regenerate: (refinePrompt: string) => Promise<Array>,
 *   logger?: (msg: string, ctx?: any) => void,
 * }} args
 * @returns {Promise<{
 *   scenes: Array,
 *   violations: Array,
 *   hasCritical: boolean,
 *   retried: boolean,
 * }>}
 */
export async function runWithAutoRetry(args) {
  const { scenes, spec, regenerate, language } = args || {};
  const lang = language === "en" ? "en" : "ko";
  const logger = args?.logger || (() => {});

  // 1st pass
  let first = validateScenes(scenes, spec, lang);
  if (!first.hasCritical || typeof regenerate !== "function") {
    return {
      scenes,
      violations: first.violations,
      hasCritical: first.hasCritical,
      retried: false,
    };
  }

  // 재시도 — critical 지시문 + 원본 위반 요약을 regenerate 에 전달
  const refine = lang === "en" ? first.refinePromptEn : first.refinePromptKo;
  logger("scenario_validator:retry", {
    reason: "critical_violations",
    count: first.summary.byLevel.critical,
  });

  let retriedScenes = scenes;
  try {
    retriedScenes = await regenerate(refine);
  } catch (err) {
    logger("scenario_validator:retry_failed", { error: err?.message || String(err) });
    return {
      scenes,
      violations: first.violations,
      hasCritical: true,
      retried: true,
      retryError: err,
    };
  }

  // 2nd validate — critical 이 남아도 최종 결과로 수용 (무한 루프 방지)
  const second = validateScenes(retriedScenes, spec, lang);
  return {
    scenes: retriedScenes,
    violations: second.violations,
    hasCritical: second.hasCritical,
    retried: true,
  };
}

export default { validateScenes, runWithAutoRetry };
