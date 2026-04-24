/**
 * scenario/compose.js
 *
 * Phase 0 Step 5 — 블록 머지 엔진.
 *
 * 사용자 선택(durationSec / purposeCategory / purposeTag / target / need / tone / style)
 * 을 받아서, 각 레이어의 규칙 블록을 우선순위대로 AND-머지한 단일 EffectiveRuleSet 을
 * 만든다. 이 객체 하나만 있으면 prompt-builder 와 validator 가 동일한 근거로 동작한다.
 *
 * 설계 원칙
 * - 머지 순서는 LAYER_PRIORITY 낮은 → 높은 순. 동일 키는 더 높은 priority 가 덮어쓴다.
 *   단 severity:critical 은 mergeConstraint 내부에서 보호된다.
 * - promptFragments 는 "덮어쓰기" 가 아니라 "이어 붙이기" — 각 레이어가 고유한 말을 보태므로.
 * - signals 는 Set 으로 합친다.
 * - stage (장소/배경/서브로케이션/배우 라벨) 는 genre 블록에만 존재 → 그대로 반출.
 * - beatStructure / sceneCount* 는 format 이 기본값, subgenre 가 오버라이드 가능.
 * - progressLabel 은 "가장 구체적인 블록의 라벨" 하나만 반출 (subgenre > genre > purpose > audience).
 */

import { LAYER_PRIORITY, mergeConstraint, mergeTokens } from "./schema.js";
import { baseBlock } from "./rules/base.js";
import { resolveFormatBlock, resolveSceneCount } from "./rules/format.js";
import { resolveGenreBlock } from "./rules/genre.js";
import { resolveSubgenreBlock } from "./rules/subgenre.js";
import { resolveAudienceBlock } from "./rules/audience.js";
import { resolvePurposeBlock } from "./rules/purpose.js";
import { resolveToneBlock } from "./rules/tone.js";
import { resolveStyleBlock } from "./rules/style.js";

/**
 * @typedef {Object} Selection
 * @property {number|string} [durationSec]
 * @property {string} [purposeCategory]
 * @property {string} [purposeTag]
 * @property {string} [target]
 * @property {string} [need]
 * @property {string} [tone]
 * @property {string} [style]
 */

/**
 * @typedef {Object} EffectiveRuleSet
 * @property {Array<Object>} blocks              레이어 우선순위 낮은 → 높은 순
 * @property {Object} constraints                머지된 수치 제약
 * @property {Array<Object>} forbiddenTokens     머지된 금칙어
 * @property {Array<Object>} mandatoryTokens     머지된 필수 토큰
 * @property {string[]} signals                  모든 레이어의 signals 합집합
 * @property {Array<Object>} [beatStructure]
 * @property {number} [sceneCountMin]
 * @property {number} [sceneCountMax]
 * @property {number} [sceneCountPreferred]
 * @property {Object} [stage]
 * @property {{ko: string, en: string}} promptFragments  레이어별 이어 붙여진 자연어 지시
 * @property {string} [progressLabelKo]
 * @property {string} [progressLabelEn]
 * @property {Object} meta                        디버깅용 (선택 원본, 매칭된 블록 id 등)
 */

/**
 * 사용자 선택 → EffectiveRuleSet.
 * 매칭되지 않은 레이어는 조용히 스킵 (base 만으로도 동작 가능).
 *
 * @param {Selection} selection
 * @returns {EffectiveRuleSet}
 */
export function composeRuleSet(selection) {
  const sel = selection || {};
  const seconds = Number(sel.durationSec);
  const hasSeconds = Number.isFinite(seconds) && seconds > 0;

  // 1) 레이어별 블록 해석
  const format   = hasSeconds ? resolveFormatBlock(seconds) : null;
  const genre    = resolveGenreBlock(sel.purposeCategory);
  const subgenre = resolveSubgenreBlock(sel.purposeTag);
  const audience = resolveAudienceBlock(sel.target);
  const purpose  = resolvePurposeBlock(sel.need);
  const tone     = resolveToneBlock(sel.tone);
  const style    = resolveStyleBlock(sel.style);

  // 2) 우선순위 낮은 → 높은 순으로 정렬.
  //    base 10 < style 15 < tone 20 < genre 30 < format 40 < subgenre 50 < purpose 60 < audience 70
  const activeBlocks = [baseBlock, style, tone, genre, format, subgenre, purpose, audience]
    .filter(Boolean)
    .sort((a, b) => (LAYER_PRIORITY[a.layer] ?? 0) - (LAYER_PRIORITY[b.layer] ?? 0));

  // 3) constraints 머지 — 같은 키는 mergeConstraint 규칙 적용
  const constraints = {};
  for (const block of activeBlocks) {
    const p = LAYER_PRIORITY[block.layer] ?? 0;
    const blockConstraints = block.constraints || {};
    for (const [key, rule] of Object.entries(blockConstraints)) {
      const existing = constraints[key];
      const existingPriority = existing?._priority ?? 0;
      const merged = mergeConstraint(existing, rule, p, existingPriority);
      merged._priority = Math.max(existingPriority, p);
      constraints[key] = merged;
    }
  }
  // _priority 는 내부 메타, 외부 노출 전 제거
  for (const key of Object.keys(constraints)) delete constraints[key]._priority;

  // 4) 토큰 머지 (금칙/필수)
  let forbiddenTokens = [];
  let mandatoryTokens = [];
  for (const block of activeBlocks) {
    forbiddenTokens = mergeTokens(forbiddenTokens, block.forbiddenTokens || []);
    mandatoryTokens = mergeTokens(mandatoryTokens, block.mandatoryTokens || []);
  }

  // 5) signals 합집합
  const signalsSet = new Set();
  for (const block of activeBlocks) {
    for (const s of block.signals || []) signalsSet.add(s);
  }

  // 6) promptFragments — 레이어 순으로 이어 붙인다 (낮은 → 높은).
  //    독자는 구체적 지시일수록 아래에서 읽게 됨.
  const koParts = [];
  const enParts = [];
  for (const block of activeBlocks) {
    const frag = block.promptFragments || {};
    if (frag.ko && String(frag.ko).trim()) koParts.push(String(frag.ko).trim());
    if (frag.en && String(frag.en).trim()) enParts.push(String(frag.en).trim());
  }
  const promptFragments = {
    ko: koParts.join("\n\n"),
    en: enParts.join("\n\n"),
  };

  // 7) beatStructure / sceneCount — format 우선, subgenre 가 명시적으로 주면 오버라이드
  const beatStructure = subgenre?.beatStructure || format?.beatStructure || null;
  const sceneCountMin = subgenre?.sceneCountMin ?? format?.sceneCountMin ?? null;
  const sceneCountMax = subgenre?.sceneCountMax ?? format?.sceneCountMax ?? null;
  let sceneCountPreferred = subgenre?.sceneCountPreferred ?? format?.sceneCountPreferred ?? null;
  if (hasSeconds && !subgenre?.sceneCountPreferred) {
    // 초수 → 씬 개수 계산에 format.resolveSceneCount 사용
    sceneCountPreferred = resolveSceneCount(seconds);
  }

  // 8) stage — genre 가 정의 (subgenre 가 override 원하면 stage 필드를 주면 됨)
  const stage = subgenre?.stage || genre?.stage || null;

  // 9) progressLabel — 가장 구체적인 블록 우선, 단 실제 라벨을 가진 블록을 골라야
  //    한다. audience/purpose 처럼 라벨이 비어 있는 블록이 중간에 끼면 건너뛰고
  //    다음 블록으로 폴백.
  const progressChain = [subgenre, audience, purpose, genre, format];
  let progressLabelKo = null;
  let progressLabelEn = null;
  for (const b of progressChain) {
    if (b && (b.progressLabelKo || b.progressLabelEn)) {
      progressLabelKo = b.progressLabelKo || progressLabelKo;
      progressLabelEn = b.progressLabelEn || progressLabelEn;
      break;
    }
  }

  return {
    blocks: activeBlocks,
    constraints,
    forbiddenTokens,
    mandatoryTokens,
    signals: Array.from(signalsSet),
    beatStructure,
    sceneCountMin,
    sceneCountMax,
    sceneCountPreferred,
    stage,
    promptFragments,
    progressLabelKo,
    progressLabelEn,
    meta: {
      selection: {
        durationSec: hasSeconds ? seconds : null,
        purposeCategory: sel.purposeCategory || null,
        purposeTag: sel.purposeTag || null,
        target: sel.target || null,
        need: sel.need || null,
        tone: sel.tone || null,
        style: sel.style || null,
      },
      resolvedIds: {
        base: baseBlock.id,
        format: format?.id || null,
        genre: genre?.id || null,
        subgenre: subgenre?.id || null,
        audience: audience?.id || null,
        purpose: purpose?.id || null,
        tone: tone?.id || null,
        style: style?.id || null,
      },
    },
  };
}

/**
 * EffectiveRuleSet 에서 시스템 프롬프트용 자연어 조각만 꺼낸다.
 * prompt-builder 가 이 문자열을 LLM system prompt 에 이어 붙이면 된다.
 *
 * @param {EffectiveRuleSet} ruleSet
 * @param {"ko"|"en"} language
 * @returns {string}
 */
export function toSystemPromptFragment(ruleSet, language) {
  if (!ruleSet) return "";
  const lang = language === "en" ? "en" : "ko";
  return (ruleSet.promptFragments && ruleSet.promptFragments[lang]) || "";
}

/**
 * EffectiveRuleSet 에서 기계 검증용 체크리스트만 꺼낸다.
 * Step 7 validator 가 이 spec 을 읽어 씬 결과를 검사한다.
 *
 * @param {EffectiveRuleSet} ruleSet
 * @returns {{
 *   constraints: Object,
 *   forbiddenTokens: Array,
 *   mandatoryTokens: Array,
 *   sceneCountMin: number|null,
 *   sceneCountMax: number|null,
 *   sceneCountPreferred: number|null,
 *   beatStructure: Array|null
 * }}
 */
export function toValidatorSpec(ruleSet) {
  if (!ruleSet) {
    return {
      constraints: {},
      forbiddenTokens: [],
      mandatoryTokens: [],
      sceneCountMin: null,
      sceneCountMax: null,
      sceneCountPreferred: null,
      beatStructure: null,
    };
  }
  return {
    constraints: ruleSet.constraints || {},
    forbiddenTokens: ruleSet.forbiddenTokens || [],
    mandatoryTokens: ruleSet.mandatoryTokens || [],
    sceneCountMin: ruleSet.sceneCountMin ?? null,
    sceneCountMax: ruleSet.sceneCountMax ?? null,
    sceneCountPreferred: ruleSet.sceneCountPreferred ?? null,
    beatStructure: ruleSet.beatStructure || null,
  };
}

/**
 * 디버깅용: 머지 결과를 요약 문자열로 만든다.
 *
 * @param {EffectiveRuleSet} ruleSet
 * @returns {string}
 */
export function describeRuleSet(ruleSet) {
  if (!ruleSet) return "(empty ruleset)";
  const ids = Object.entries(ruleSet.meta?.resolvedIds || {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  const conKeys = Object.keys(ruleSet.constraints || {}).join(", ");
  return [
    `layers: [${ids}]`,
    `sceneCount: ${ruleSet.sceneCountMin}~${ruleSet.sceneCountMax} (pref ${ruleSet.sceneCountPreferred})`,
    `beats: ${ruleSet.beatStructure ? ruleSet.beatStructure.map((b) => b.name).join("/") : "(none)"}`,
    `constraints: ${conKeys || "(none)"}`,
    `forbidden: ${ruleSet.forbiddenTokens.length}, mandatory: ${ruleSet.mandatoryTokens.length}`,
    `signals: ${ruleSet.signals.join(", ")}`,
  ].join("\n");
}

export default { composeRuleSet, toSystemPromptFragment, toValidatorSpec, describeRuleSet };
