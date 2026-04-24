/**
 * scenario/rules/format.js
 *
 * Phase 0 Step 2 — 길이별 비트 템플릿 8종.
 *
 * 지금은 durationToScenes = {15:4, 30:7, 45:10, 60:12, 1800:120, 3600:240, 7200:480}
 * 이라는 평면 매핑만 있었다. 이 파일은 각 길이에 대해
 *   - 씬 개수 범위 + 권장값
 *   - 비트 시트 (Hook/Body/CTA 또는 AIDA, 3막 구조 등)
 *   - 컷 밀도 제약
 *   - 평균 샷 길이 권장치
 * 를 함께 제공한다.
 *
 * resolveFormatId(seconds) 로 입력 초수에 가장 가까운 프리셋을 고른다.
 */

import { defineBlock, SEVERITY } from "../schema.js";

// ---------- 6초 (숏폼 범퍼 / 로고 노출) ----------
export const format6s = defineBlock({
  id: "format.6s",
  layer: "format",
  labelKo: "6초 범퍼",
  labelEn: "6s Bumper",
  sceneCountMin: 1,
  sceneCountMax: 2,
  sceneCountPreferred: 2,
  beatStructure: [
    { name: "Hook",   sec: 2, goalKo: "즉각적 시선 장악", goalEn: "Instant attention hook", minCuts: 1, maxCuts: 2 },
    { name: "Payoff", sec: 4, goalKo: "핵심 메시지 단 한 문장", goalEn: "Core message in one line", minCuts: 2, maxCuts: 4 },
  ],
  constraints: {
    cutDensity: { min: 3, max: 6, severity: SEVERITY.HIGH, labelKo: "컷 밀도", labelEn: "Cut count" },
    shotLengthAvgSec: { min: 0.8, max: 2.0, severity: SEVERITY.HIGH, labelKo: "평균 샷 길이", labelEn: "Avg shot length" },
  },
  promptFragments: {
    ko: `[포맷: 6초 범퍼]
- 총 2씬, 컷 3~6개. 군더더기 하나 용납되지 않는다.
- 첫 1초 안에 시각적 훅이 반드시 있어야 한다.
- 마지막 씬에 메시지 또는 로고 1개만. 2개 이상의 정보 금지.`,
    en: `[Format: 6s Bumper]
- Total 2 scenes, 3~6 cuts. Zero filler.
- A visual hook must appear within the first 1 second.
- The final scene carries exactly one message or logo. No more than one info unit.`,
  },
});

// ---------- 15초 (숏폼 스토리 / 동요 한 토막 / 프리롤 광고) ----------
export const format15s = defineBlock({
  id: "format.15s",
  layer: "format",
  labelKo: "15초 숏폼",
  labelEn: "15s Short",
  sceneCountMin: 3,
  sceneCountMax: 5,
  sceneCountPreferred: 4,
  beatStructure: [
    { name: "Hook", sec: 3, goalKo: "주제 제시 + 시선 장악",           goalEn: "Topic reveal + hook",         minCuts: 2, maxCuts: 3 },
    { name: "Body", sec: 9, goalKo: "핵심 내용/학습/상황 전개",          goalEn: "Core content / learning",    minCuts: 4, maxCuts: 7 },
    { name: "CTA",  sec: 3, goalKo: "마무리 메시지 또는 다음 행동 유도", goalEn: "Wrap-up or call to action",   minCuts: 2, maxCuts: 3 },
  ],
  constraints: {
    cutDensity: { min: 8, max: 12, severity: SEVERITY.HIGH, labelKo: "컷 밀도", labelEn: "Cut count" },
    shotLengthAvgSec: { min: 1.2, max: 1.8, severity: SEVERITY.MEDIUM, labelKo: "평균 샷 길이", labelEn: "Avg shot length" },
  },
  promptFragments: {
    ko: `[포맷: 15초 숏폼]
- 3~4씬, 컷 8~12개. Hook(3초) → Body(9초) → CTA(3초) 구조.
- Hook 씬은 가장 짧고 강렬하게. Body 에 핵심 내용을 집중 배치.
- CTA 씬은 마지막 1~2문장으로 시청 후 행동·감정을 명확히 찍는다.`,
    en: `[Format: 15s Short]
- 3~4 scenes, 8~12 cuts. Hook(3s) → Body(9s) → CTA(3s) structure.
- Keep Hook short and striking. Concentrate core content in Body.
- CTA scene nails the post-view action or emotion in 1~2 final lines.`,
  },
});

// ---------- 30초 (TV/온라인 광고 표준) ----------
export const format30s = defineBlock({
  id: "format.30s",
  layer: "format",
  labelKo: "30초 광고/예고",
  labelEn: "30s Ad/Trailer",
  sceneCountMin: 9,
  sceneCountMax: 12,
  sceneCountPreferred: 10,
  beatStructure: [
    { name: "Attention", sec: 3,  goalKo: "시각적 충격 또는 공감 진입점 (1~2씬)",  goalEn: "Visual hook or relatable entry (1-2 scenes)",  minCuts: 2, maxCuts: 4 },
    { name: "Interest",  sec: 6,  goalKo: "문제/상황/욕구 구체화 (2씬)",            goalEn: "Problem / situation / desire (2 scenes)",      minCuts: 3, maxCuts: 5 },
    { name: "Desire",    sec: 10, goalKo: "해결책/제품/주장의 구체 증거 (3~4씬)",   goalEn: "Solution / proof / evidence (3-4 scenes)",     minCuts: 5, maxCuts: 8 },
    { name: "Climax",    sec: 5,  goalKo: "감정 정점 또는 결정적 결과 샷 (1~2씬)",  goalEn: "Emotional climax or decisive payoff shot (1-2 scenes)", minCuts: 2, maxCuts: 4 },
    { name: "Action",    sec: 6,  goalKo: "타이틀 카드 + CTA 1가지 (1~2씬)",         goalEn: "Title card + one clear CTA (1-2 scenes)",      minCuts: 2, maxCuts: 4 },
  ],
  constraints: {
    cutDensity: { min: 15, max: 24, severity: SEVERITY.HIGH, labelKo: "컷 밀도", labelEn: "Cut count" },
    shotLengthAvgSec: { min: 1.3, max: 2.2, severity: SEVERITY.MEDIUM, labelKo: "평균 샷 길이", labelEn: "Avg shot length" },
  },
  promptFragments: {
    ko: `[포맷: 30초 광고]
- 9~12씬(권장 10씬), 컷 15~24개. 한 씬은 절대 6초 초과 금지(영상 생성 모델 한계). 평균 2.5~3초.
- 5단계 구조: Attention → Interest → Desire → Climax → Action.
- 첫 2초 안에 시각적 훅. Climax 비트에는 감정 절정 또는 변화의 결정적 결과 샷이 반드시 들어간다.
- 마지막 비트는 타이틀 카드(브랜드/슬로건 노출 1씬) + CTA 1씬으로 구성. CTA 는 단 하나의 행동만 요구.
- 제품/주장이 있다면 Desire 구간에 구체 증거(체험/수치/비교) 를 반드시 배치.`,
    en: `[Format: 30s Ad]
- 9-12 scenes (10 recommended), 15-24 cuts. No scene may exceed 6 seconds (AI video model limit). Average 2.5-3s per scene.
- 5-beat structure: Attention → Interest → Desire → Climax → Action.
- Visual shock within the first 2 seconds. The Climax beat must contain an emotional peak or a decisive payoff shot.
- The final beat = a title card scene (brand/slogan reveal) + one CTA scene. The CTA requests exactly one action.
- If a product/claim exists, place concrete evidence (demo/number/comparison) in the Desire block.`,
  },
});

// ---------- 60초 (1분 스토리 / 심화 광고 / 브랜드 필름) ----------
export const format60s = defineBlock({
  id: "format.60s",
  layer: "format",
  labelKo: "60초 브랜드 필름",
  labelEn: "60s Brand Film",
  sceneCountMin: 11,
  sceneCountMax: 14,
  sceneCountPreferred: 12,
  beatStructure: [
    { name: "Exposition",  sec: 10, goalKo: "세계/인물 제시",             goalEn: "Establish world / character",    minCuts: 3, maxCuts: 5 },
    { name: "Incident",    sec: 10, goalKo: "사건/변화의 트리거",          goalEn: "Triggering incident",            minCuts: 4, maxCuts: 6 },
    { name: "Rising",      sec: 20, goalKo: "긴장·몰입 상승",              goalEn: "Rising tension / engagement",     minCuts: 8, maxCuts: 14 },
    { name: "Climax",      sec: 12, goalKo: "감정/메시지 정점",            goalEn: "Emotional / message climax",      minCuts: 5, maxCuts: 10 },
    { name: "Resolution",  sec: 8,  goalKo: "여운과 마무리 메시지",         goalEn: "Aftertaste + wrap-up",            minCuts: 3, maxCuts: 5 },
  ],
  constraints: {
    cutDensity: { min: 30, max: 45, severity: SEVERITY.HIGH, labelKo: "컷 밀도", labelEn: "Cut count" },
    shotLengthAvgSec: { min: 1.4, max: 2.5, severity: SEVERITY.MEDIUM, labelKo: "평균 샷 길이", labelEn: "Avg shot length" },
  },
  promptFragments: {
    ko: `[포맷: 60초 브랜드 필름]
- 11~14씬(권장 12씬), 컷 30~45개. 한 씬은 절대 6초 초과 금지. Freytag 5막 간략 구조.
- Exposition 은 빠르게, Rising 과 Climax 에 시간을 투자한다.
- 한 편의 미니 스토리가 되어야 한다. 단순 정보 나열 금지.`,
    en: `[Format: 60s Brand Film]
- 11-14 scenes (12 recommended), 30-45 cuts. No scene may exceed 6 seconds. Simplified Freytag 5-act structure.
- Move through Exposition quickly; invest time in Rising and Climax.
- Must read as one mini-story. No flat info list.`,
  },
});

// ---------- 3분 (소셜 스토리 / 단편 / 설명 영상) ----------
export const format180s = defineBlock({
  id: "format.3min",
  layer: "format",
  labelKo: "3분 단편",
  labelEn: "3-min Short",
  sceneCountMin: 15,
  sceneCountMax: 25,
  sceneCountPreferred: 20,
  beatStructure: [
    { name: "Setup",         sec: 40,  goalKo: "세계/문제 제시",            goalEn: "World & problem setup",         minCuts: 8,  maxCuts: 14 },
    { name: "Confrontation", sec: 100, goalKo: "갈등·전개·증거",            goalEn: "Conflict / development / proof", minCuts: 20, maxCuts: 35 },
    { name: "Resolution",    sec: 40,  goalKo: "해결·통찰·메시지",          goalEn: "Resolution / insight / message", minCuts: 8,  maxCuts: 14 },
  ],
  constraints: {
    cutDensity: { min: 40, max: 65, severity: SEVERITY.MEDIUM, labelKo: "컷 밀도", labelEn: "Cut count" },
    shotLengthAvgSec: { min: 2.5, max: 4.5, severity: SEVERITY.MEDIUM, labelKo: "평균 샷 길이", labelEn: "Avg shot length" },
  },
  promptFragments: {
    ko: `[포맷: 3분 단편]
- 15~25씬. 고전적 3막 구조 (Setup / Confrontation / Resolution).
- Confrontation 에 전체 시간의 절반 이상 배정. 긴장 곡선을 유지한다.
- 각 막의 마지막 씬은 다음 막으로 넘어갈 추진력을 남긴다.`,
    en: `[Format: 3-min Short]
- 15~25 scenes. Classic 3-act structure (Setup / Confrontation / Resolution).
- Allocate over half the total time to Confrontation. Maintain tension curve.
- Each act's final scene must carry momentum into the next.`,
  },
});

// ---------- 10분 (튜토리얼 / 심화 리뷰 / 해설) ----------
export const format600s = defineBlock({
  id: "format.10min",
  layer: "format",
  labelKo: "10분 튜토리얼/해설",
  labelEn: "10-min Tutorial/Explainer",
  sceneCountMin: 30,
  sceneCountMax: 55,
  sceneCountPreferred: 40,
  beatStructure: [
    { name: "Hook",     sec: 30,  goalKo: "이걸 왜 봐야 하는가",           goalEn: "Why watch this",             minCuts: 4, maxCuts: 8 },
    { name: "Overview", sec: 60,  goalKo: "오늘 다룰 내용 요약",            goalEn: "What we'll cover today",       minCuts: 6, maxCuts: 10 },
    { name: "Steps",    sec: 420, goalKo: "단계별 핵심 내용 (3~5개 챕터)", goalEn: "Step-by-step body (3~5 chapters)", minCuts: 16, maxCuts: 30 },
    { name: "Summary",  sec: 60,  goalKo: "요약과 다음 단계",              goalEn: "Recap + next step",           minCuts: 3, maxCuts: 6 },
    { name: "CTA",      sec: 30,  goalKo: "구독/저장/다음 영상 유도",       goalEn: "Subscribe/save/next",         minCuts: 2, maxCuts: 4 },
  ],
  constraints: {
    cutDensity: { min: 35, max: 65, severity: SEVERITY.MEDIUM, labelKo: "컷 밀도", labelEn: "Cut count" },
    shotLengthAvgSec: { min: 9.0, max: 18.0, severity: SEVERITY.MEDIUM, labelKo: "평균 샷 길이", labelEn: "Avg shot length" },
  },
  promptFragments: {
    ko: `[포맷: 10분 튜토리얼/해설]
- Steps 를 3~5개 챕터로 쪼개 각 챕터 안에 '도입 → 핵심 → 예시/실습' 구조를 반복한다.
- 매 챕터 끝에 1문장 요약을 배치해 이탈률을 낮춘다.
- Hook 은 30초 이내에 '이걸 보면 무엇을 얻는가' 를 분명히 말한다.`,
    en: `[Format: 10-min Tutorial/Explainer]
- Split Steps into 3~5 chapters, each with 'intro → core → example/practice'.
- Place a one-sentence recap at the end of every chapter to reduce drop-off.
- Hook must state "what you'll gain" within the first 30 seconds.`,
  },
});

// ---------- 30분 (에피소드 / 미니 다큐 / 방송 회차) ----------
export const format1800s = defineBlock({
  id: "format.30min",
  layer: "format",
  labelKo: "30분 에피소드",
  labelEn: "30-min Episode",
  sceneCountMin: 60,
  sceneCountMax: 140,
  sceneCountPreferred: 100,
  beatStructure: [
    { name: "Teaser",   sec: 60,  goalKo: "이 회차의 훅 (엔딩 뒤집기, 의문 제시 등)", goalEn: "Episode hook",                minCuts: 6,  maxCuts: 12 },
    { name: "Act1",     sec: 420, goalKo: "설정·문제 제시",                           goalEn: "Setup / inciting problem",     minCuts: 20, maxCuts: 40 },
    { name: "Act2",     sec: 780, goalKo: "갈등·시도·실패·전환",                       goalEn: "Conflict / attempts / shift",  minCuts: 30, maxCuts: 60 },
    { name: "Act3",     sec: 420, goalKo: "해결·의미·회차 마무리",                     goalEn: "Resolution / meaning",         minCuts: 20, maxCuts: 35 },
    { name: "Tag",      sec: 120, goalKo: "여운 + 다음 회차 연결 훅",                   goalEn: "Aftertaste + next-episode tease", minCuts: 4,  maxCuts: 8  },
  ],
  constraints: {
    cutDensity: { min: 80, max: 160, severity: SEVERITY.MEDIUM, labelKo: "컷 밀도", labelEn: "Cut count" },
  },
  promptFragments: {
    ko: `[포맷: 30분 에피소드]
- Teaser → Act1 → Act2 → Act3 → Tag 구조.
- Act2 가 가장 길다. 이 안에 최소 2번의 'Try → Fail' 루프를 넣는다.
- Tag 는 다음 회차를 보게 만드는 미끼를 남긴다.`,
    en: `[Format: 30-min Episode]
- Teaser → Act1 → Act2 → Act3 → Tag structure.
- Act2 is the longest. Embed at least two 'Try → Fail' loops inside.
- Tag leaves a hook that pulls the viewer to the next episode.`,
  },
});

// ---------- 60분+ (장편 / 1시간 다큐 / 특집) ----------
export const format3600sPlus = defineBlock({
  id: "format.60min+",
  layer: "format",
  labelKo: "60분 이상 장편",
  labelEn: "60-min+ Feature",
  sceneCountMin: 120,
  sceneCountMax: 480,
  sceneCountPreferred: 240,
  beatStructure: [
    { name: "Prologue",    sec: 180,  goalKo: "세계 도입·주제 선언",        goalEn: "World open / thesis",              minCuts: 10, maxCuts: 20 },
    { name: "Sequence1",   sec: 900,  goalKo: "1부: 인물과 맥락",            goalEn: "Part1: characters & context",       minCuts: 40, maxCuts: 80 },
    { name: "Sequence2",   sec: 1200, goalKo: "2부: 핵심 사건·심화",         goalEn: "Part2: core events / depth",        minCuts: 50, maxCuts: 110 },
    { name: "Sequence3",   sec: 900,  goalKo: "3부: 전환·의미화",            goalEn: "Part3: turn / meaning",            minCuts: 40, maxCuts: 80 },
    { name: "Epilogue",    sec: 420,  goalKo: "여운·통찰·엔딩",              goalEn: "Aftertaste / insight / ending",     minCuts: 15, maxCuts: 30 },
  ],
  constraints: {
    cutDensity: { min: 160, max: 480, severity: SEVERITY.MEDIUM, labelKo: "컷 밀도", labelEn: "Cut count" },
  },
  promptFragments: {
    ko: `[포맷: 60분 이상 장편]
- 시퀀스 기반 구조. 각 시퀀스는 자체 소주제·긴장 곡선을 가진다.
- 시퀀스 간 전환점에는 시각적 모티프 또는 반복 오브젝트로 연결 고리를 만든다.
- Epilogue 는 thesis 의 반복이 아니라 확장·반전으로 마무리.`,
    en: `[Format: 60-min+ Feature]
- Sequence-based. Each sequence has its own sub-theme and tension curve.
- Between sequences, use a visual motif or repeating object as a bridge.
- The Epilogue should expand or reverse the thesis, not merely restate it.`,
  },
});

/**
 * 프리셋 맵. resolveFormatId() 에서 근사 매칭에 사용.
 * [초수, 블록] 배열. 초수는 프리셋 중심값.
 */
const FORMAT_PRESETS = [
  [6,    format6s],
  [15,   format15s],
  [30,   format30s],
  [60,   format60s],
  [180,  format180s],
  [600,  format600s],
  [1800, format1800s],
  [3600, format3600sPlus],
];

/**
 * 입력 초수에 대해 가장 가까운 Format 블록을 반환한다.
 * 7200초(2시간) 같은 더 긴 값은 60min+ 블록을 그대로 사용한다.
 * @param {number} seconds
 */
export function resolveFormatBlock(seconds) {
  const sec = Number(seconds);
  if (!Number.isFinite(sec) || sec <= 0) return format15s;
  if (sec >= 3600) return format3600sPlus;

  let best = FORMAT_PRESETS[0];
  let bestDist = Math.abs(FORMAT_PRESETS[0][0] - sec);
  for (const entry of FORMAT_PRESETS) {
    const dist = Math.abs(entry[0] - sec);
    if (dist < bestDist) {
      best = entry;
      bestDist = dist;
    }
  }
  return best[1];
}

/**
 * 같은 블록의 sceneCountPreferred 를 반환하되, 입력 초수가 프리셋 중심에서
 * 크게 벗어나면 선형 보간한다. 기존 durationToScenes 의 후속.
 */
export function resolveSceneCount(seconds) {
  const block = resolveFormatBlock(seconds);
  const sec = Number(seconds);
  if (!Number.isFinite(sec) || sec <= 0) return block.sceneCountPreferred;

  // 프리셋 중심 초수 찾기
  const presetCenter = FORMAT_PRESETS.find((p) => p[1] === block)?.[0] ?? sec;
  if (presetCenter === sec) return block.sceneCountPreferred;

  // 선형 보간: 블록의 min/max 범위 안에서 초 비율로 스케일
  const ratio = sec / presetCenter;
  const scaled = Math.round((block.sceneCountPreferred || 4) * ratio);
  return Math.max(block.sceneCountMin, Math.min(block.sceneCountMax, scaled));
}

export const ALL_FORMAT_BLOCKS = [
  format6s, format15s, format30s, format60s,
  format180s, format600s, format1800s, format3600sPlus,
];
