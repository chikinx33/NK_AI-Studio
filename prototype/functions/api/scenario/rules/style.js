/**
 * scenario/rules/style.js
 *
 * Phase 0 Step 4 — 비주얼 스타일 블록.
 * 우선순위 15 (base 10 < style 15 < tone 20). 스타일은 최상층에서 쉽게 덮이는 얕은 레이어.
 *
 * UI ALLOWED_STYLES:
 *   실사 / 애니메이션(2D) / 애니메이션(3D) / 일러스트 / 모션그래픽 /
 *   인포그래픽 / 클레이(스톱모션) / 스케치 / 시네마틱
 *
 * 이 블록은 주로 promptFragments 에 "렌더링 힌트" 를 넣는다.
 * prompt-builder 가 모델(Veo/Runway/Sora 등) 별로 이 힌트를 재해석한다.
 */

import { defineBlock, SEVERITY } from "../schema.js";

export const styleLive = defineBlock({
  id: "style.live",
  layer: "style",
  labelKo: "실사",
  labelEn: "Live-action",
  signals: ["live_action", "photographic"],
  promptFragments: {
    ko: `[스타일: 실사]
- 카메라 / 렌즈 / 조명 / 색온도를 구체적으로 기술한다(예: 35mm, 자연광, 5500K).
- 비현실적 왜곡(과장된 원근, 비현실적 그림자) 지양.
- 질감: 피부/직물/표면의 실제 결이 보이게 한다.`,
    en: `[Style: Live-action]
- Describe camera / lens / lighting / color temp (e.g. 35mm, natural light, 5500K).
- Avoid unnatural distortion (exaggerated perspective, surreal shadows).
- Texture: show real grain of skin / fabric / surfaces.`,
  },
});

export const styleAnimation2D = defineBlock({
  id: "style.anim-2d",
  layer: "style",
  labelKo: "애니메이션(2D)",
  labelEn: "2D Animation",
  signals: ["animation", "2d", "stylized"],
  promptFragments: {
    ko: `[스타일: 2D 애니메이션]
- 선/면 기반 스타일 명시(예: 굵은 윤곽선, 플랫 컬러).
- 움직임은 비트에 맞춘 리미티드 애니메이션(프레임 드롭) 감각.
- 배경과 캐릭터의 대비로 가독성 확보.`,
    en: `[Style: 2D Animation]
- Specify line / fill style (e.g. bold outlines, flat colors).
- Motion feels like beat-locked limited animation (frame drops).
- Ensure readability via background/character contrast.`,
  },
});

export const styleAnimation3D = defineBlock({
  id: "style.anim-3d",
  layer: "style",
  labelKo: "애니메이션(3D)",
  labelEn: "3D Animation",
  signals: ["animation", "3d", "stylized"],
  promptFragments: {
    ko: `[스타일: 3D 애니메이션]
- 렌더 룩 명시(셀셰이딩 / 포토리얼 / 스타일라이즈드).
- 카메라 움직임은 연출 의도에 따라(핸드헬드/돌리/크레인) 지정.
- 재질(메탈/러프/서브서피스) 의 반응이 조명에 따라 명확히.`,
    en: `[Style: 3D Animation]
- Specify render look (cel-shaded / photoreal / stylized).
- Direct camera motion with intent (handheld / dolly / crane).
- Material responses (metal / rough / subsurface) must read under lighting.`,
  },
});

export const styleIllustration = defineBlock({
  id: "style.illustration",
  layer: "style",
  labelKo: "일러스트",
  labelEn: "Illustration",
  signals: ["illustration", "stylized"],
  promptFragments: {
    ko: `[스타일: 일러스트]
- 그림체 참고(수채화/디지털 페인팅/라인아트 등) 를 명시.
- 포즈/구도 위주 연출. 복잡한 카메라 이동은 지양.
- 광원과 그림자를 의도적으로 단순화.`,
    en: `[Style: Illustration]
- Reference illustration style (watercolor / digital paint / line-art).
- Pose / composition driven. Avoid complex camera moves.
- Deliberately simplify light sources and shadows.`,
  },
});

export const styleMotionGraphics = defineBlock({
  id: "style.motion-graphics",
  layer: "style",
  labelKo: "모션그래픽",
  labelEn: "Motion Graphics",
  signals: ["motion_graphics", "kinetic"],
  promptFragments: {
    ko: `[스타일: 모션그래픽]
- 타이포/도형/아이콘이 주인공. 씬마다 핵심 요소 1개에 시선이 집중되도록.
- 이징(ease-in/out) 과 딜레이로 리듬을 만든다.
- 색상 팔레트 4색 이내로 제한해 정보 전달력을 살린다.`,
    en: `[Style: Motion Graphics]
- Typography / shapes / icons are the subject. Focus attention on one hero element per scene.
- Create rhythm via easing and deliberate delays.
- Limit palette to 4 colors to preserve information clarity.`,
  },
  constraints: {
    paletteColorsMax: {
      max: 4,
      severity: SEVERITY.MEDIUM,
      labelKo: "모션그래픽 색상 상한",
      labelEn: "Motion graphics palette max",
    },
  },
});

export const styleInfographic = defineBlock({
  id: "style.infographic",
  layer: "style",
  labelKo: "인포그래픽",
  labelEn: "Infographic",
  signals: ["infographic", "data_visual"],
  promptFragments: {
    ko: `[스타일: 인포그래픽]
- 씬마다 명확한 데이터 한 가지(숫자/비율/흐름) 를 시각화.
- 차트/다이어그램 유형을 명시(막대/파이/플로우차트 등).
- 레이블과 수치는 반드시 화면에 보이도록.`,
    en: `[Style: Infographic]
- Each scene visualizes one clear data point (number / ratio / flow).
- Specify chart type (bar / pie / flowchart).
- Labels and figures must remain visible on screen.`,
  },
});

export const styleClay = defineBlock({
  id: "style.clay",
  layer: "style",
  labelKo: "클레이(스톱모션)",
  labelEn: "Clay / Stop-motion",
  signals: ["stop_motion", "tactile"],
  promptFragments: {
    ko: `[스타일: 클레이 / 스톱모션]
- 손의 흔적(지문/잔결) 이 질감에 남아 있어야 한다.
- 프레임 당 미세한 흔들림이 있는 자연스러운 스톱모션 리듬.
- 세트/소품은 단순하고 과장된 형태로.`,
    en: `[Style: Clay / Stop-motion]
- Traces of hand (fingerprints / residue) must remain in the texture.
- Organic stop-motion rhythm with slight frame-to-frame jitter.
- Keep sets / props simple with exaggerated silhouettes.`,
  },
});

export const styleSketch = defineBlock({
  id: "style.sketch",
  layer: "style",
  labelKo: "스케치",
  labelEn: "Sketch",
  signals: ["sketch", "linework"],
  promptFragments: {
    ko: `[스타일: 스케치]
- 연필/펜의 손맛을 살리고, 채색은 최소.
- 화면의 여백을 적극 활용한다.
- 주요 형태만 그리고 세부는 생략해 시선을 가이드.`,
    en: `[Style: Sketch]
- Preserve the hand feel of pencil / pen; minimize fill color.
- Use whitespace actively.
- Draw only primary forms; omit details to guide attention.`,
  },
});

export const styleCinematic = defineBlock({
  id: "style.cinematic",
  layer: "style",
  labelKo: "시네마틱",
  labelEn: "Cinematic",
  signals: ["cinematic", "film_grammar"],
  promptFragments: {
    ko: `[스타일: 시네마틱]
- 렌즈/애스펙트/컬러그레이딩 을 지정(예: 2.35:1, 쿨 섀도/웜 하이라이트).
- 영화적 조명(키/필/백 라이트) 구성을 가정하고 기술한다.
- 카메라 이동은 연출 의도를 드러내는 한 가지(돌리인/크레인/슬로우 팬) 로.`,
    en: `[Style: Cinematic]
- Specify lens / aspect / color grade (e.g. 2.35:1, cool shadows with warm highlights).
- Assume filmic lighting (key / fill / back) and describe accordingly.
- Each camera move reveals intent (dolly-in / crane / slow pan) — one per scene.`,
  },
});

export const STYLE_BLOCKS = Object.freeze({
  "실사":             styleLive,
  "애니메이션(2D)":   styleAnimation2D,
  "애니메이션(3D)":   styleAnimation3D,
  "일러스트":         styleIllustration,
  "모션그래픽":       styleMotionGraphics,
  "인포그래픽":       styleInfographic,
  "클레이(스톱모션)": styleClay,
  "스케치":           styleSketch,
  "시네마틱":         styleCinematic,
});

export function resolveStyleBlock(style) {
  if (!style || typeof style !== "string") return null;
  return STYLE_BLOCKS[style.trim()] || null;
}

export default { STYLE_BLOCKS, resolveStyleBlock };
