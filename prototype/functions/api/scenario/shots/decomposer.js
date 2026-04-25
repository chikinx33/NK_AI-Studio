/**
 * scenario/shots/decomposer.js
 *
 * Pass 2 — 단일 scene 을 받아 1~5개의 shot 으로 분해한다.
 *
 * 입력: scene { id, estSec, sceneIntent, sceneLocation, narration, dialogue, visual, ... }
 * 출력: shots [{ id, duration, shotType, cameraMove, composition, action }]
 *
 * 핵심 규칙
 * - Σ shots[].duration ≈ scene.estSec (±20% 허용)
 * - 각 shot duration ≤ 6초
 * - 1 scene 당 1~5 shots
 * - shotType / cameraMove 는 통제 어휘 내에서만
 *
 * 실패 fallback: scene.visual 을 통째로 1개 shot 으로 wrap.
 */

import {
  buildVocabPromptKo,
  buildVocabPromptEn,
  normalizeShotType,
  normalizeCameraMove,
} from "./vocab.js";

const MAX_SHOTS_PER_SCENE = 5;
const MIN_SHOTS_PER_SCENE = 1;
const MAX_SHOT_DURATION = 6;
const MIN_SHOT_DURATION = 0.5;
const DURATION_TOLERANCE = 0.2; // ±20%

/**
 * Pass 2 시스템 프롬프트.
 * 각 scene 을 콘티/스토리보드 단계로 쪼갠다.
 */
export function buildShotPromptKo() {
  return `너는 NK_Studio의 콘티/스토리보드 분해 엔진이다.
입력으로 시나리오 한 씬(scene) 을 받고, 그 씬을 실제 촬영 단위인 샷(shot) 으로 분해한다.
한 씬은 "행동·감정의 비트(beat)" 단위이고, 한 샷은 "한 카메라 셋업" 단위이다.

[분해 원칙]
1. 한 씬은 1~5 샷으로 분해. 정적 비트(독백 1마디, 인서트 단독)는 1샷도 OK.
2. 각 샷은 ≤ 6초 (영상 생성 모델의 안정 출력 한계).
3. 모든 샷의 duration 합 = 씬의 estSec (오차 ±20% 이내).
4. 같은 행동을 여러 앵글로 쪼갠다. 예: "전사가 칼을 뽑는다(4초)"
   → CU 얼굴(1초) + INSERT 손(1초) + MS 뒷모습 실루엣(2초)
5. composition: 프레임 안에 보이는 것을 명사 중심으로. "얼굴 클로즈업, 눈만 프레임" 처럼 구체적으로.
   - 씬의 sceneLocation 이 broad 일 때 (예: "우주선", "궁전") 컷별 sub-location 을
     composition 안에 자유롭게 명시하라. 예:
       cut1 composition: "우주선 외부 측면, 선체 표면이 프레임을 가로지름"
       cut2 composition: "에어록 내부, 닫히는 해치 너머로 스타필드 흐릿하게"
       cut3 composition: "함교, 콘솔 LED 클로즈업"
     모든 컷이 같은 sub-location 일 필요 없음. 한 비트 안에서 sub-location 이 진행될 수 있다.
6. action: 이 샷에서 일어나는 물리적 행동·움직임. 추상 표현 금지.
7. shotType, cameraMove 는 아래 어휘 안에서만 선택. 다른 단어 절대 금지.

${buildVocabPromptKo()}

[출력 형식 — JSON 만, 마크다운/설명 금지]
{"shots":[{"id":"<sceneId>.1","duration":<숫자>,"shotType":"<위 어휘>","cameraMove":"<위 어휘>","composition":"<프레임 설명>","action":"<물리 행동>"}, ...]}

응답 첫 글자는 { 마지막 글자는 } 여야 한다.`;
}

export function buildShotPromptEn() {
  return `You are NK_Studio's storyboard decomposition engine.
Given a single scenario scene, decompose it into actual shooting units called shots.
A scene is a beat (one unit of action/emotion). A shot is one camera setup.

[Decomposition Rules]
1. A scene decomposes into 1-5 shots. Static beats (one line of monologue, a solo insert) can be a single shot.
2. Each shot must be ≤ 6 seconds (AI video model stability limit).
3. Sum of shots[].duration must equal the scene's estSec (±20% tolerance).
4. Cut the same action across multiple angles. Example: "warrior draws sword (4s)"
   → CU face (1s) + INSERT hand on hilt (1s) + MS silhouette from behind (2s)
5. composition: noun-centric description of what is visible in frame. "Face close-up, only eyes in frame".
   - When sceneLocation is broad (e.g., "Spaceship", "Palace"), feel free to specify per-shot
     sub-locations inside composition. Example:
       cut1 composition: "Spaceship exterior side, hull surface filling the frame"
       cut2 composition: "Airlock interior, closing hatch with starfield blurred behind"
       cut3 composition: "Bridge, close-up of console LEDs"
     Shots within one beat may walk through different sub-locations.
6. action: the physical motion happening in this specific shot. No abstract phrasing.
7. shotType and cameraMove must be selected from the controlled vocabulary below — no other words allowed.

${buildVocabPromptEn()}

[Output format — JSON only, no markdown or explanation]
{"shots":[{"id":"<sceneId>.1","duration":<number>,"shotType":"<from vocab>","cameraMove":"<from vocab>","composition":"<frame description>","action":"<physical action>"}, ...]}

The first character must be { and the last must be }.`;
}

/**
 * 단일 scene → user 프롬프트 (Pass 2 호출용).
 */
export function buildShotUserPromptKo(scene) {
  const id = scene.id ?? "?";
  const estSec = Number(scene.estSec) || 4;
  const lines = [];
  lines.push(`[scene id] ${id}`);
  lines.push(`[scene estSec] ${estSec}초 — 모든 샷 duration 합이 이 값과 일치(±20%) 해야 함`);
  if (scene.sceneIntent)   lines.push(`[scene sceneIntent] ${scene.sceneIntent}`);
  if (scene.sceneLocation) lines.push(`[scene sceneLocation] ${scene.sceneLocation}`);
  if (scene.visual)        lines.push(`[scene visual / 비트 설명]\n${scene.visual}`);
  if (scene.narration)     lines.push(`[scene narration] ${scene.narration}`);
  if (Array.isArray(scene.dialogue) && scene.dialogue.length) {
    const dlg = scene.dialogue
      .map((d) => `${d.speaker || "?"}: ${d.line || ""}`)
      .join(" / ");
    lines.push(`[scene dialogue] ${dlg}`);
  }
  lines.push("");
  lines.push("위 한 씬을 콘티 단위 샷들로 분해해 JSON 만 반환하라. id 는 \"" + id + ".1\", \"" + id + ".2\" ... 형식.");
  return lines.join("\n");
}

export function buildShotUserPromptEn(scene) {
  const id = scene.id ?? "?";
  const estSec = Number(scene.estSec) || 4;
  const lines = [];
  lines.push(`[scene id] ${id}`);
  lines.push(`[scene estSec] ${estSec}s — all shot durations must sum to this value (±20%)`);
  if (scene.sceneIntent)   lines.push(`[scene sceneIntent] ${scene.sceneIntent}`);
  if (scene.sceneLocation) lines.push(`[scene sceneLocation] ${scene.sceneLocation}`);
  if (scene.visual)        lines.push(`[scene visual / beat description]\n${scene.visual}`);
  if (scene.narration)     lines.push(`[scene narration] ${scene.narration}`);
  if (Array.isArray(scene.dialogue) && scene.dialogue.length) {
    const dlg = scene.dialogue
      .map((d) => `${d.speaker || "?"}: ${d.line || ""}`)
      .join(" / ");
    lines.push(`[scene dialogue] ${dlg}`);
  }
  lines.push("");
  lines.push(`Decompose the scene above into storyboard shots and return JSON only. Use id format "${id}.1", "${id}.2", ...`);
  return lines.join("\n");
}

/**
 * Anthropic 응답 텍스트(JSON) 를 파싱하여 검증된 shots 배열로 변환.
 * 실패 시 null. 실패한 항목은 sanitize 후 살릴 수 있는 만큼 살림.
 */
export function parseShotResponse(text, scene) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (_) {
    // JSON repair: 코드펜스 제거 후 재시도
    const cleaned = trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
    try { parsed = JSON.parse(cleaned); } catch (_e) { return null; }
  }
  if (!parsed || !Array.isArray(parsed.shots)) return null;

  const sceneId = scene?.id ?? "x";
  const out = [];
  parsed.shots.forEach((raw, idx) => {
    if (!raw || typeof raw !== "object") return;
    const shotType = normalizeShotType(raw.shotType) || "MS";
    const cameraMove = normalizeCameraMove(raw.cameraMove) || "static";
    let duration = Number(raw.duration);
    if (!Number.isFinite(duration) || duration < MIN_SHOT_DURATION) duration = MIN_SHOT_DURATION;
    if (duration > MAX_SHOT_DURATION) duration = MAX_SHOT_DURATION;
    const composition = String(raw.composition || "").trim();
    const action = String(raw.action || "").trim();
    if (!composition && !action) return; // 둘 다 비면 의미 없는 샷
    const id = String(raw.id || `${sceneId}.${idx + 1}`).trim() || `${sceneId}.${idx + 1}`;
    out.push({ id, duration, shotType, cameraMove, composition, action });
  });

  if (!out.length) return null;
  if (out.length > MAX_SHOTS_PER_SCENE) out.length = MAX_SHOTS_PER_SCENE;
  return out;
}

/**
 * shots 배열의 duration 합이 scene.estSec 와 일치하도록 ±20% 허용 안에서 보정.
 * 합이 너무 어긋나면 비례 스케일링.
 */
export function reconcileDurations(shots, scene) {
  if (!Array.isArray(shots) || !shots.length) return shots;
  const target = Number(scene?.estSec) || 0;
  if (!target) return shots;
  const sum = shots.reduce((acc, s) => acc + (Number(s.duration) || 0), 0);
  if (!sum) return shots;
  const ratio = sum / target;
  if (ratio >= 1 - DURATION_TOLERANCE && ratio <= 1 + DURATION_TOLERANCE) return shots;

  const scale = target / sum;
  return shots.map((s) => {
    let d = Math.round(Number(s.duration) * scale * 10) / 10;
    if (d < MIN_SHOT_DURATION) d = MIN_SHOT_DURATION;
    if (d > MAX_SHOT_DURATION) d = MAX_SHOT_DURATION;
    return { ...s, duration: d };
  });
}

/**
 * Fallback: scene.visual 을 통째로 1개 shot 으로 wrap.
 * Pass 2 가 실패했을 때, 최소한 데이터 모양은 유지.
 */
export function fallbackSingleShot(scene) {
  const id = scene?.id ?? "x";
  const estSec = Number(scene?.estSec) || 4;
  const duration = Math.min(MAX_SHOT_DURATION, Math.max(MIN_SHOT_DURATION, estSec));
  const visual = String(scene?.visual || "").trim();
  return [{
    id: `${id}.1`,
    duration,
    shotType: "MS",
    cameraMove: "static",
    composition: visual.split(/[\n.]/)[0] || "프레임 중앙에 주요 피사체",
    action: visual || "씬 비트 그대로 진행",
  }];
}

export const __testables = {
  MAX_SHOTS_PER_SCENE,
  MIN_SHOTS_PER_SCENE,
  MAX_SHOT_DURATION,
  MIN_SHOT_DURATION,
  DURATION_TOLERANCE,
};
