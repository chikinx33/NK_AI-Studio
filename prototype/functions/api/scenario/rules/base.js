/**
 * scenario/rules/base.js
 *
 * 모든 영상에 공통 적용되는 기본 문법. 우선순위 가장 낮음(10).
 * 다른 블록이 구체값을 주면 덮어쓰인다.
 */

import { defineBlock, SEVERITY } from "../schema.js";

export const baseBlock = defineBlock({
  id: "base",
  layer: "base",
  labelKo: "공통 영상 문법",
  labelEn: "Common Video Grammar",

  constraints: {
    shotLengthAvgSec: {
      min: 1.0,
      max: 6.0,
      severity: SEVERITY.MEDIUM,
      labelKo: "평균 샷 길이",
      labelEn: "Average shot length",
    },
    maxSecPerScene: {
      min: 1,
      max: 6,
      severity: SEVERITY.CRITICAL,
      labelKo: "씬당 최대 길이",
      labelEn: "Max seconds per scene",
    },
  },

  forbiddenTokens: [
    {
      pattern: /(~한 느낌|~적인 분위기|아름다운|감동적인|화려한|따뜻한 톤|세련된|역동적인|인상적인|드라마틱한|감성적인|몽환적인)/,
      severity: SEVERITY.HIGH,
      labelKo: "추상적/상투적 표현",
      labelEn: "Abstract cliché phrasing",
      suggestionKo: "구체적 시각 요소(사물·행동·빛·각도)로 치환해 다시 작성하세요.",
      suggestionEn: "Replace with concrete visible elements (object, action, light, angle).",
    },
  ],

  promptFragments: {
    ko: `[공통 영상 문법]
- 모든 씬은 '보여주기'만 한다. 설명하지 않는다.
- visual 에는 카메라가 실제로 찍는 것만 쓴다: 장소, 사물, 인물의 물리적 행동, 앵글/움직임.
- 추상 형용사(느낌/분위기/감성/드라마틱) 금지. 구체 명사·동사로 쓴다.
- 각 씬의 visual 첫 문장은 이전 씬의 마지막 상태와 연결된다.
- 점프컷이 필요하면 시간/장소 전환을 명시한다.
- 한 씬은 절대 6초를 넘기지 않는다. 영상 생성 모델의 안정 출력 한계 때문이다. 더 긴 흐름이 필요하면 씬을 쪼개라.
- estSec 과 내용 밀도를 맞춘다: 2~3초 = 행동 1개, 4~5초 = 행동+환경, 6초 = 짧은 동작 시퀀스 또는 대사 1마디(상한).`,
    en: `[Common Video Grammar]
- Every scene must "show", not "explain".
- In visual, write only what the camera literally captures: place, objects, human physical action, angle/movement.
- No abstract adjectives (feeling/mood/emotional/dramatic). Use concrete nouns and verbs.
- The first sentence of each scene's visual must connect to the ending state of the previous scene.
- If a jump cut is needed, explicitly mark the time/place change.
- A single scene must never exceed 6 seconds — current AI video models cannot reliably hold longer takes. Split into multiple scenes if needed.
- Match estSec to content density: 2-3s = one action, 4-5s = action+detail, 6s (max) = short motion sequence or one line+reaction.`,
  },

  signals: ["show_dont_tell", "concrete_visual"],
});

export default baseBlock;
