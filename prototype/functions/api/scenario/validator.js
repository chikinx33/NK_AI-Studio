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

const BEAT_STOPWORDS = new Set([
  "그리고","그때","이후","그러다","바로","다시","그러면","그래서","그러나","하지만","또","또한",
  "and","then","after","but","with","into","from","that","this","there","here","just","like",
]);

function tokenizeBeatAction(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[\s,.;:!?，。、・(){}\[\]"'`/\\\-—…]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !BEAT_STOPWORDS.has(t));
}

function beatMatchesSceneText(beat, sceneText) {
  const tokens = tokenizeBeatAction(beat?.action || "");
  if (!tokens.length) return false;
  const charTokens = tokens.filter((t) => t.startsWith("@"));
  const wordTokens = tokens.filter((t) => !t.startsWith("@"));
  const lowerScene = String(sceneText || "").toLowerCase();
  if (charTokens.length) {
    const charHit = charTokens.every((t) => lowerScene.includes(t));
    if (!charHit) return false;
  }
  if (!wordTokens.length) return charTokens.length > 0;
  const hits = wordTokens.filter((t) => lowerScene.includes(t)).length;
  const ratio = hits / wordTokens.length;
  return ratio >= 0.34 || hits >= 2;
}

function checkShotRhythm(scenes, spec, violations) {
  if (!Array.isArray(scenes) || scenes.length < 3) return;
  const secs = scenes.map((s) => Number(s?.estSec)).filter((n) => Number.isFinite(n) && n > 0);
  if (secs.length < 3) return;

  // 1) 동일 estSec 3개 이상 연속 — 균등 분배의 가장 명백한 신호
  let run = 1;
  let maxRun = 1;
  let runValue = secs[0];
  let maxRunValue = secs[0];
  let maxRunStartIdx = 0;
  let runStartIdx = 0;
  for (let i = 1; i < secs.length; i++) {
    if (Math.abs(secs[i] - runValue) < 0.01) {
      run += 1;
      if (run > maxRun) {
        maxRun = run;
        maxRunValue = runValue;
        maxRunStartIdx = runStartIdx;
      }
    } else {
      run = 1;
      runValue = secs[i];
      runStartIdx = i;
    }
  }
  if (maxRun >= 3) {
    violations.push({
      key: "shotRhythm.uniformRun",
      severity: "critical",
      labelKo: "균등 시간 분배 — 동일 길이 씬이 연속",
      labelEn: "Uniform pacing — consecutive identical-length scenes",
      evidence: `${maxRun} scenes in a row at ${maxRunValue}s (starting at scene ${maxRunStartIdx + 1})`,
      suggestionKo: `씬 ${maxRunStartIdx + 1}부터 동일 시간(${maxRunValue}초)이 ${maxRun}개 연속됩니다. 비트 강도(intensity)에 따라 차등 분배하세요. 차분한 비트는 길게(3~5초), 긴장·클라이맥스 비트는 짧게(1~2초) 분배하고 균등 분배(3·3·3·3·6·6·6 식)는 절대 금지입니다.`,
      suggestionEn: `Scenes ${maxRunStartIdx + 1}+ stay at ${maxRunValue}s for ${maxRun} in a row. Allocate by beat intensity instead — calm beats long (3-5s), tense/climax beats short (1-2s). Never use uniform pacing like 3-3-3-3-6-6-6.`,
    });
  }

  // 2) 전체 표준편차가 평균의 15% 미만 — 단조로움
  const mean = secs.reduce((a, b) => a + b, 0) / secs.length;
  const variance = secs.reduce((acc, n) => acc + (n - mean) * (n - mean), 0) / secs.length;
  const stddev = Math.sqrt(variance);
  if (mean > 0 && stddev / mean < 0.15 && secs.length >= 4) {
    violations.push({
      key: "shotRhythm.lowVariance",
      severity: "critical",
      labelKo: "씬 길이 단조로움 — 리듬감 없음",
      labelEn: "Scene lengths too uniform — no rhythm",
      evidence: `mean=${mean.toFixed(2)}s, stddev=${stddev.toFixed(2)}s (${((stddev / mean) * 100).toFixed(1)}% of mean)`,
      suggestionKo: `전체 씬 길이가 평균(${mean.toFixed(1)}초) 대비 표준편차가 ${((stddev / mean) * 100).toFixed(1)}%로 너무 일정합니다. 강약 리듬을 만들기 위해 일부 씬은 1~2초, 일부는 4~5초로 차등 배분하세요.`,
      suggestionEn: `Scene lengths are too uniform (stddev ${((stddev / mean) * 100).toFixed(1)}% of mean). Build rhythm by mixing 1-2s scenes with 4-5s scenes based on beat intensity.`,
    });
  }

  // 3) 클라이맥스 비트가 spec.storyBeats에 있으면, 마지막 씬이 평균보다 짧고 컷 수가 많아야 함
  const beats = Array.isArray(spec.storyBeats) ? spec.storyBeats : [];
  const climaxBeat = beats.find((b) => b && b.isClimax);
  if (climaxBeat && scenes.length >= 3) {
    const lastSec = Number(scenes[scenes.length - 1]?.estSec) || 0;
    // 클라이맥스 씬이 평균보다 1초 이상 길면 critical (긴장 페이오프 부족)
    if (lastSec > mean + 1.0) {
      violations.push({
        key: "shotRhythm.climaxTooLong",
        severity: "critical",
        labelKo: "클라이맥스 씬이 너무 김 — 긴장 페이오프 부족",
        labelEn: "Climax scene too long — weak payoff pacing",
        evidence: `final scene ${lastSec}s > mean ${mean.toFixed(1)}s + 1s`,
        suggestionKo: `마지막 클라이맥스 씬(${lastSec}초)이 평균(${mean.toFixed(1)}초)보다 깁니다. 클라이맥스는 짧고 빠른 컷(1~2초) 다수로 분해해 긴장의 페이오프를 만드세요.`,
        suggestionEn: `Final climax scene (${lastSec}s) is longer than the mean (${mean.toFixed(1)}s). Decompose into many short cuts (1-2s) for tension payoff.`,
      });
    }
  }
}

function checkSceneCountVsBeats(scenes, spec, violations) {
  const beats = Array.isArray(spec.storyBeats) ? spec.storyBeats : [];
  if (!beats.length) return;
  const sceneCount = Array.isArray(scenes) ? scenes.length : 0;
  if (sceneCount >= beats.length) return;
  violations.push({
    key: "sceneCount.vsBeats",
    severity: "critical",
    labelKo: "씬 수가 비트 수보다 적음 — 비트 압축/누락 구조적 발생",
    labelEn: "Scene count below beat count — beats will be dropped",
    evidence: `scenes=${sceneCount}, beats=${beats.length}`,
    suggestionKo: `이야기 비트가 ${beats.length}개인데 씬은 ${sceneCount}개만 생성됐습니다. 비트 하나당 최소 1개 씬을 배정하도록 재생성하세요. 클라이맥스 비트(발견·페이오프)는 절대 다른 비트와 같은 씬에 묶지 마세요.`,
    suggestionEn: `${beats.length} story beats but only ${sceneCount} scenes. Each beat needs at least one scene. Never merge a climax beat (discovery/payoff) into another beat's scene.`,
  });
}

function checkStoryBeatCoverage(scenes, spec, violations) {
  const beats = Array.isArray(spec.storyBeats) ? spec.storyBeats : [];
  if (!beats.length || !Array.isArray(scenes) || !scenes.length) return;
  const sceneTexts = scenes.map((s) => textOfScene(s).toLowerCase());
  const lastIdx = scenes.length - 1;
  const lastSceneText = sceneTexts[lastIdx] || "";

  beats.forEach((beat, beatIdx) => {
    const matchedAny = sceneTexts.some((t) => beatMatchesSceneText(beat, t));
    if (!matchedAny) {
      const isClimax = Boolean(beat?.isClimax);
      violations.push({
        key: `storyBeat.uncovered:${beatIdx}`,
        severity: isClimax ? "critical" : "high",
        labelKo: isClimax
          ? `이야기의 클라이맥스 비트가 시나리오에 없음 (비트 ${beatIdx + 1})`
          : `이야기 비트가 시나리오에 반영되지 않음 (비트 ${beatIdx + 1})`,
        labelEn: isClimax
          ? `Story climax beat is missing from the scenario (beat ${beatIdx + 1})`
          : `Story beat not represented in the scenario (beat ${beatIdx + 1})`,
        evidence: `beat: "${String(beat?.action || "").slice(0, 120)}"`,
        suggestionKo: isClimax
          ? `마지막 씬에 다음 결말 비트를 반드시 시각적으로 포함하세요: "${beat.action}". 행동·반응·발견 순간을 visual 필드에 구체적으로 적습니다.`
          : `다음 비트를 시나리오 어느 한 씬의 visual/action 에 시각적으로 포함하세요: "${beat.action}".`,
        suggestionEn: isClimax
          ? `Make sure the final scene visibly contains this resolution beat: "${beat.action}". Write the action, reaction, and discovery moment concretely in the visual field.`
          : `Include this beat visibly in at least one scene's visual/action: "${beat.action}".`,
      });
      return;
    }
    if (beat?.isClimax && !beatMatchesSceneText(beat, lastSceneText)) {
      violations.push({
        key: `storyBeat.climaxNotInFinal:${beatIdx}`,
        severity: "critical",
        labelKo: "클라이맥스 비트가 마지막 씬에 없음",
        labelEn: "Climax beat is not in the final scene",
        evidence: `beat: "${String(beat?.action || "").slice(0, 120)}"`,
        suggestionKo: `클라이맥스/결말 비트는 반드시 마지막 씬(${scenes.length}번)에 시각적으로 페이오프돼야 합니다. 마지막 씬을 이 비트의 결말 행동·반응으로 다시 작성하세요: "${beat.action}".`,
        suggestionEn: `The climax/resolution beat must visually pay off in the FINAL scene (${scenes.length}). Rewrite the final scene around this beat's action and reaction: "${beat.action}".`,
      });
    }
  });
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
  checkSceneCountVsBeats(scenes, safeSpec, violations);
  checkStoryBeatCoverage(scenes, safeSpec, violations);
  checkShotRhythm(scenes, safeSpec, violations);

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
