/**
 * scenario/schema.js
 *
 * Phase 0 Step 1 — 규칙 블록 공통 스키마 정의.
 *
 * 모든 규칙 레이어 (base / format / genre / subgenre / audience / purpose / tone / style) 는
 * 이 파일의 Block 스키마를 따른다. compose.js 가 각 블록을 AND-머지할 때
 * 동일한 키를 공유하기 때문에 머지 로직이 단순해진다.
 *
 * 설계 원칙
 * - 블록은 "한 개의 선언적 데이터 조각" 이고 함수를 포함하지 않는다.
 * - 사용자 편의성: 프롬프트 조각은 자연어로, 체크리스트는 기계 검증 가능한 형태로.
 * - 충돌 해결: priority 숫자가 높을수록 우선. 단 severity:critical 은 절대 덮이지 않는다.
 *
 * 우선순위 테이블 (compose 시 lower → higher 순으로 덮어쓰기)
 *   base       10
 *   format     40
 *   genre      30
 *   subgenre   50
 *   audience   70   (영유아 안전 등은 거의 최상위)
 *   purpose    60
 *   tone       20
 *   style      15
 *
 * 이유: audience 가 가장 높은 이유는 "영유아에게 공포 표현 금지" 같은 안전 규칙이
 *       어떤 장르·톤에 의해서도 덮이면 안 되기 때문.
 */

export const LAYER_PRIORITY = Object.freeze({
  base: 10,
  style: 15,
  tone: 20,
  genre: 30,
  format: 40,
  subgenre: 50,
  purpose: 60,
  audience: 70,
});

export const SEVERITY = Object.freeze({
  CRITICAL: "critical", // 자동 재생성 트리거. 사용자에게 숨김.
  HIGH: "high",         // 고급 모드에서 표시. 재생성 제안.
  MEDIUM: "medium",     // 고급 모드에서만 표시.
  LOW: "low",           // 디버그용.
});

/**
 * @typedef {Object} BeatBlock
 * @property {string} name       비트 이름 (예: "Hook", "Body", "CTA")
 * @property {number} sec        기본 할당 초 (format 블록이 정의)
 * @property {string} goalKo     이 비트에서 달성해야 할 서사 목표 (한국어)
 * @property {string} goalEn     동일 (영어)
 * @property {number} [minCuts]  이 비트 안 컷 최소 개수
 * @property {number} [maxCuts]  이 비트 안 컷 최대 개수
 */

/**
 * @typedef {Object} ConstraintRule
 * @property {number}  [min]
 * @property {number}  [max]
 * @property {string}  severity   SEVERITY 값 중 하나.
 * @property {string}  [labelKo]  사용자 노출 레이블 (고급 모드)
 * @property {string}  [labelEn]
 */

/**
 * @typedef {Object} TokenRule
 * @property {RegExp|string} pattern   정규식 또는 문자열 (문자열이면 includes 검사)
 * @property {string}        severity
 * @property {string}        labelKo
 * @property {string}        labelEn
 * @property {string}        [suggestionKo]  검증 실패 시 LLM 재생성 프롬프트에 주입할 수정 제안
 * @property {string}        [suggestionEn]
 */

/**
 * @typedef {Object} Block
 * @property {string}   id                    블록 고유 ID (예: "format.15s", "audience.infant")
 * @property {keyof LAYER_PRIORITY} layer     어느 레이어에 속하는지
 * @property {string}   [labelKo]             UI 표시용 라벨
 * @property {string}   [labelEn]
 *
 * @property {number}   [sceneCountMin]       최소 씬 개수
 * @property {number}   [sceneCountMax]       최대 씬 개수
 * @property {number}   [sceneCountPreferred] 권장 씬 개수
 *
 * @property {BeatBlock[]} [beatStructure]    비트 시트 (format/subgenre 가 제공)
 *
 * @property {Object<string, ConstraintRule>} [constraints]
 *   범용 수치 제약. 키는 규약으로 정해진 이름 사용:
 *     - cutDensity            : 영상 전체 컷 수
 *     - shotLengthAvgSec      : 평균 샷 길이 (초)
 *     - narrationMaxChars     : 나레이션 1문장 최대 글자
 *     - paletteColorsMax      : 주요 색상 개수 상한
 *     - cutMinIntervalSec     : 컷 최소 간격
 *     - faceCloseupRatio      : 얼굴 클로즈업 비율 (0~1)
 *     - repetitionMin         : 반복 횟수 최소값
 *
 * @property {TokenRule[]} [mandatoryTokens]  반드시 결과에 등장해야 할 요소
 * @property {TokenRule[]} [forbiddenTokens]  절대 등장해선 안 될 요소
 *
 * @property {{ko: string, en: string}} [promptFragments]
 *   system prompt 에 그대로 붙일 자연어 지시.
 *
 * @property {string[]} [signals]             다른 블록 간 연계용 태그 (옵션)
 *
 * @property {string}   [fewShotKey]          Phase 3 에서 Gold Standard 레퍼런스 조회용 키
 *
 * @property {string}   [progressLabelKo]     진행 표시 UI 의 장르별 커스텀 문구
 * @property {string}   [progressLabelEn]
 */

/**
 * 빈 블록 헬퍼. 자식 블록 작성 시 누락 필드를 방지한다.
 * @param {Partial<Block>} override
 * @returns {Block}
 */
export function defineBlock(override) {
  if (!override || !override.id || !override.layer) {
    throw new Error("defineBlock: id and layer are required");
  }
  return {
    id: override.id,
    layer: override.layer,
    labelKo: override.labelKo || override.id,
    labelEn: override.labelEn || override.id,
    constraints: override.constraints || {},
    mandatoryTokens: override.mandatoryTokens || [],
    forbiddenTokens: override.forbiddenTokens || [],
    promptFragments: override.promptFragments || { ko: "", en: "" },
    signals: override.signals || [],
    ...override,
  };
}

/**
 * 두 제약(ConstraintRule) 을 머지한다.
 * 규칙:
 *   - severity:critical 은 더 엄격한 쪽(더 작은 max, 더 큰 min) 을 채택하고 내려쓰기 불가.
 *   - 그 외는 priority 가 높은 쪽이 덮어쓴다.
 */
export function mergeConstraint(base, incoming, incomingPriority, basePriority) {
  if (!base) return { ...incoming };
  if (!incoming) return base;

  const isCritical = base.severity === SEVERITY.CRITICAL || incoming.severity === SEVERITY.CRITICAL;
  if (isCritical) {
    return {
      ...base,
      ...incoming,
      min: Math.max(base.min ?? -Infinity, incoming.min ?? -Infinity) === -Infinity
        ? undefined
        : Math.max(base.min ?? -Infinity, incoming.min ?? -Infinity),
      max: Math.min(base.max ?? Infinity, incoming.max ?? Infinity) === Infinity
        ? undefined
        : Math.min(base.max ?? Infinity, incoming.max ?? Infinity),
      severity: SEVERITY.CRITICAL,
    };
  }
  return incomingPriority >= basePriority ? { ...base, ...incoming } : base;
}

/**
 * 토큰 규칙 배열을 합친다. 중복 pattern 은 더 높은 severity 를 채택한다.
 */
export function mergeTokens(base = [], incoming = []) {
  const out = [...base];
  const severityRank = { critical: 4, high: 3, medium: 2, low: 1 };
  for (const inc of incoming) {
    const idx = out.findIndex(
      (b) => String(b.pattern) === String(inc.pattern) && b.labelKo === inc.labelKo,
    );
    if (idx === -1) {
      out.push(inc);
    } else {
      const curRank = severityRank[out[idx].severity] || 0;
      const incRank = severityRank[inc.severity] || 0;
      if (incRank > curRank) out[idx] = inc;
    }
  }
  return out;
}
