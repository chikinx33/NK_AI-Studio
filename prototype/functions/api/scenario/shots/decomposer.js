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
// 영상 생성 모델의 최소 길이가 4초다(Kling 은 5초). 3초짜리 컷을 만들어도 4초로 생성해
// 잘라 써야 하므로, 4초를 못 채우는 비트는 쪼갤 이유 자체가 없다. 예전엔 2초였고,
// 그 탓에 "발만 보이다가 틸트업해 전신" 같은 하나의 연속 무브가 2초+3초 두 컷으로 갈렸다.
// 두 컷으로 갈리면 스틸컷이 따로 두 번 생성되고 둘 다 전신이 나와 연출이 사라진다.
const MIN_SHOT_DURATION = 4;
// 한 샷 안의 시간 비트. 스틸컷은 beats[0](t=0)이고, 영상은 이 표를 시간 분배로 받는다.
const MAX_BEATS_PER_SHOT = 4;
const DURATION_TOLERANCE = 0.2; // ±20%

/**
 * Pass 2 시스템 프롬프트.
 * 각 scene 을 콘티/스토리보드 단계로 쪼갠다.
 */
export function buildShotPromptKo() {
  return `너는 NK_Studio의 콘티/스토리보드 분해 엔진이다.
입력으로 시나리오 한 씬(scene) 을 받아, 실제 촬영 단위인 샷(shot) 으로 나눈다.
한 씬은 "행동·감정의 비트" 단위이고, 한 샷은 "한 카메라 셋업" 단위이다.

[채워야 할 필드 — 하나도 빠뜨리지 마라]
· duration    : 이 샷의 길이(초).
· shotType    : 아래 어휘에서만.
· cameraMove  : 아래 어휘에서만.
· composition : 프레임에 보이는 것. 정지 화면으로 설명되는 것만, 명사 중심으로 구체적으로.
· action      : 그 안에서 일어나는 물리적 움직임. 추상 표현 금지.
· beats       : 샷 안에서 보이는 것이 시간에 따라 달라질 때의 시간표.
                cameraMove 가 static 이 아니면 필수. 정적 샷이면 null.
· dialogue    : 대사. 없으면 null 을 명시한다(필드 자체를 빼지 마라).
세 서술 칸(composition·action·beats)은 서로 다른 것을 쓴다. 같은 문장을 두 칸에 반복하면
나눈 의미가 없다. composition 은 샷 전체를 한 줄로, 시간에 따른 변화는 beats 로만 쓴다.

[beats — 카메라가 움직이면 반드시 채운다]
빠뜨리면 스틸컷이 무브의 "끝 상태"로 만들어져, 가려졌다가 드러나는 연출이 통째로 사라진다.
  "beats": [{"at": 0, "what": "프레임 하단에 세 캐릭터의 발과 하체만 나란히"},
            {"at": 2.5, "what": "틸트업이 끝나 세 캐릭터 전신과 방 전체가 들어옴"}]
· at 은 샷 시작으로부터의 초. beats[0].at 은 반드시 0, 마지막 at 은 duration 보다 작다. 2~4개.
· beats[0].what 은 t=0 에 보이는 것만 쓴다. 이것이 스틸컷이 되는 첫 프레임이다.
  무브의 결과("…전신을 드러냄")를 여기 쓰지 마라 — 그건 다음 beat 다.
· 연속된 카메라 무브를 두 샷으로 쪼개지 마라. "발만 보이다가 틸트업해 전신이 보인다" 는
  한 샷 + beats 2개다. 두 샷으로 쪼개면 스틸컷이 따로 두 번 만들어져 둘 다 전신이 나온다.

[샷 나누기]
· 한 씬은 1~5 샷. 정적 비트(독백 한 마디, 인서트 단독)는 1샷도 좋다.
· 각 샷은 4초 이상, ≤ 6초. 영상 생성 모델이 4초 미만을 만들지 못한다(Kling 은 5초).
  4초를 못 채울 비트는 쪼개지 말고 인접 샷에 흡수한다.
· 모든 샷의 duration 합 = 씬의 estSec (오차 ±20% 이내).
· 쪼갤지 합칠지는 "카메라 셋업이 바뀌는가" 하나로 판단한다.
    쪼갠다 — (a) 앵글이 확 바뀐다(얼굴↔손) (b) 장소가 바뀐다(외부↔내부) (c) 피사체가 바뀐다
    합친다 — 같은 장소·같은 피사체에서 거리나 무브만 달라진다. cameraMove 로 표현한다.
             예: "창틀 위 인형 정지" + "인형 얼굴로 다가옴" → 1샷, cameraMove="push-in"
    같은 인물을 같은 장소에서 두 컷으로 나누면 컷마다 새로 그려져 실루엣·디테일이 흔들린다.
· 예: "전사가 칼을 뽑는다(10초)" → CU 얼굴(5초) + MS 뒷모습 실루엣(5초)

[카메라 어휘 다양성]
· 2샷 이상이면 shotType 을 2종 이상 쓴다. 모든 샷이 같은 shotType 이면 안 된다.
· 3샷 이상이면 cameraMove 도 2종 이상. 전부 static 은 금지 — 정적 비트라도 한 샷은 가벼운
  무브(slow-push, slow-pan)를 넣는다.
· 인접한 두 샷이 shotType·cameraMove 가 둘 다 같으면 안 된다. 하나는 변주한다.
· 클라이맥스 씬(sceneIntent 에 발견·페이오프·정점·반전·결과 같은 말이 있거나 마지막 씬)은
  ECU·CU 짧은 컷과 강한 무브(push-in, whip-pan, quick-pan)를 섞는다.
· 입력 씬의 visual 이 이미 샷 사이즈·앵글·프레이밍(로우앵글 와이드, ECU, 오프센터 등)을
  지정했다면 그 씬의 첫 샷은 그것을 따른다. 기본값(MS/아이레벨/정면)으로 평탄화하지 마라.
· sceneLocation 이 넓으면(예: "우주선", "궁전") 컷별 sub-location 을 composition 에 적어도 된다.
  예: "우주선 외부 측면, 선체가 프레임을 가로지름" → "에어록 내부, 닫히는 해치" → "함교, 콘솔 LED 클로즈업".
  한 비트 안에서 sub-location 이 진행돼도 된다.

[하지 말 것]
· 한 샷 안에 여러 컷을 서술하지 마라. 이런 말이 나오면 샷을 나눠야 한다는 뜻이다:
  "컷이 교차되며", "세 번 빠르게 전환", "마지막 프레임에서", "이어서 카메라가 …한 뒤 다시 …".
  입력 씬에 그런 다중 컷 연출이 적혀 있으면 실제로 여러 shot 으로 쪼갠다.
  한 샷의 action 에 몰아 넣으면 영상 생성에서 그 지시가 통째로 무시된다.
· action 에 대사("하나, 둘, 셋!", "와!")를 섞지 마라. 대사는 dialogue 에만 두고, action 에는
  입을 움직이는 물리 행동만 남긴다(예: '입을 크게 벌려 숫자를 외친다').
· 입력 scene 에 dialogue 가 있으면 알맞은 샷의 dialogue 로 그대로 옮긴다.

${buildVocabPromptKo()}

[출력 형식 — JSON 만, 마크다운/설명 금지]
{"shots":[{"id":"<sceneId>.1","duration":<숫자>,"shotType":"<위 어휘>","cameraMove":"<위 어휘>","composition":"<프레임 설명>","action":"<물리 행동, 대사 금지>","dialogue":null,"beats":[{"at":0,"what":"<t=0 에 보이는 것>"},{"at":<초>,"what":"<그때 보이는 것>"}]}, ...]}

cameraMove 가 static 이 아닌 샷에 beats 가 없으면 잘못된 응답이다. 내보내기 전에 확인하라.
응답 첫 글자는 { 마지막 글자는 } 여야 한다.`;
}

export function buildShotPromptEn() {
  return `You are NK_Studio's storyboard decomposition engine.
Given a single scenario scene, break it into actual shooting units called shots.
A scene is a beat (one unit of action/emotion). A shot is one camera setup.

[Fields you must fill — never omit one]
· duration    : length of this shot in seconds.
· shotType    : from the vocabulary below only.
· cameraMove  : from the vocabulary below only.
· composition : what is visible in frame. Only what a still could show; noun-centric and specific.
· action      : the physical motion happening inside it. No abstract phrasing.
· beats       : the timeline inside the shot, for when what is visible changes over time.
                REQUIRED whenever cameraMove is not "static". null for a truly static shot.
· dialogue    : the spoken line, or null when there is none (never drop the field).
The three descriptive fields (composition / action / beats) must say different things. Repeating the
same sentence in two of them defeats the split. Keep composition to one line for the whole shot and
put every change over time in beats.

[beats — mandatory whenever the camera moves]
Without them the still image is generated from the END state of the move, and the reveal disappears.
  "beats": [{"at": 0, "what": "only the three characters' feet and lower legs along the bottom of frame"},
            {"at": 2.5, "what": "the tilt-up completes: full bodies and the whole room are in frame"}]
· "at" is seconds from the start of the shot. beats[0].at MUST be 0, the last "at" must be < duration. 2-4 beats.
· beats[0].what describes ONLY what is visible at t=0. It becomes the still image (the first frame).
  Never write the result of the move ("...revealing the full bodies") there — that belongs to the next beat.
· NEVER split one continuous camera move into two shots. "feet only, then tilt up to full bodies" is ONE
  shot with two beats. Splitting it produces two separate stills, both showing the full bodies.

[Splitting into shots]
· A scene becomes 1-5 shots. A static beat (one line of monologue, a solo insert) can be a single shot.
· Each shot is at least 4 seconds and ≤ 6 seconds. Video models cannot render less than 4s (Kling: 5s).
  A beat that cannot fill 4s must be absorbed into an adjacent shot instead of split off.
· The sum of all durations must equal the scene's estSec (±20% tolerance).
· Split or merge based on one question: does the camera setup change?
    Split  — (a) the angle changes clearly (face ↔ hand) (b) the location changes (exterior ↔ interior)
             (c) the subject itself changes.
    Merge  — same location, same subject, only the distance or movement differs. Express it with cameraMove.
             e.g. "doll sitting on the sill" + "camera pushes in to its face" → 1 shot, cameraMove="push-in".
    Splitting one subject in the same location across shots makes it re-generated each time, so its
    silhouette and details drift.
· e.g. "the warrior draws his sword (10s)" → CU face (5s) + MS silhouette from behind (5s).

[Camera variety]
· With 2+ shots use at least 2 different shotTypes. Never make them all the same.
· With 3+ shots also use at least 2 different cameraMoves. All-static is forbidden — even for a calm beat,
  give one shot a gentle move (slow-push, slow-pan).
· Two adjacent shots must not share the same shotType AND the same cameraMove. Vary at least one.
· Climax scenes (sceneIntent containing "discovery / payoff / peak / twist / result", or the final scene)
  mix short ECU/CU cuts with strong moves (push-in, whip-pan, quick-pan).
· If the input scene's visual already specifies a shot size / angle / framing (low-angle wide, ECU,
  off-center...), the scene's first shot MUST honor it. Do not flatten it to a default (MS / eye-level / centered).
· When sceneLocation is broad ("Spaceship", "Palace"), per-shot sub-locations may be written into composition.
  e.g. "spaceship exterior, hull crossing the frame" → "airlock interior, hatch closing" → "bridge, console LEDs".
  Shots within one beat may walk through different sub-locations.

[Never do this]
· Never describe multiple cuts inside one shot. If you need phrasing like "cuts intercut", "three quick
  cuts", "in the final frame", "then the camera ... and back to ...", that means you must split it into
  more shots. Cramming it into one action field makes the direction silently disappear in video generation.
· Never mix dialogue text ("one, two, three!", "wow!") into action. Dialogue lives only in the dialogue
  field; action keeps only the physical mouth motion (e.g. 'opens mouth wide and shouts the count').
· If the input scene contains dialogue, copy it exactly into the appropriate shot's dialogue field.

${buildVocabPromptEn()}

[Output format — JSON only, no markdown or explanation]
{"shots":[{"id":"<sceneId>.1","duration":<number>,"shotType":"<from vocab>","cameraMove":"<from vocab>","composition":"<frame description>","action":"<physical action, no dialogue>","dialogue":null,"beats":[{"at":0,"what":"<visible at t=0>"},{"at":<seconds>,"what":"<visible then>"}]}, ...]}

A shot whose cameraMove is not "static" and has no beats is an invalid response. Check before you emit.
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
    const dialogue = normalizeShotDialogue(raw.dialogue);
    const beats = normalizeBeats(raw.beats, duration);
    out.push({ id, duration, shotType, cameraMove, composition, action, dialogue, beats });
  });

  if (!out.length) return null;
  if (out.length > MAX_SHOTS_PER_SCENE) out.length = MAX_SHOTS_PER_SCENE;
  return out;
}

/**
 * 카메라가 움직이는데 시간표가 없는 샷을 찾는다.
 *
 * 무브가 있다는 것은 "보이는 것이 시간에 따라 달라진다"는 뜻이고, 그러면 beats 가 있어야
 * 스틸컷을 시작 프레임으로 만들고 영상에 시간 분배를 줄 수 있다. 모델이 규칙을 지키지
 * 않고 beats 를 빼먹는 일이 잦아, 코드가 직접 확인하고 한 번 더 요청한다.
 */
export function shotsMissingBeats(shots) {
  return (Array.isArray(shots) ? shots : []).filter((shot) => {
    const move = String(shot?.cameraMove || "static").trim().toLowerCase();
    if (!move || move === "static") return false;
    return !(Array.isArray(shot?.beats) && shot.beats.length >= 2);
  });
}

/** 빠진 샷만 짚어 다시 채우게 하는 보정 지시문. */
export function buildBeatsRepairPrompt(missing, lang = "ko") {
  const ids = (Array.isArray(missing) ? missing : []).map((s) => s?.id).filter(Boolean).join(", ");
  if (lang === "en") {
    return `The shots [${ids}] have a camera move but no "beats". A moving shot MUST have beats — otherwise the still image is generated from the end state of the move and the reveal disappears. Return the SAME JSON again, unchanged except that those shots now carry beats: [{"at":0,"what":"<what is visible at the very start>"},{"at":<seconds>,"what":"<what is visible after the move>"}]. beats[0].at must be 0 and the last "at" must be smaller than that shot's duration. Do not change anything else.`;
  }
  return `샷 [${ids}] 은 카메라가 움직이는데 "beats" 가 없다. 움직이는 샷에는 beats 가 반드시 있어야 한다 — 없으면 스틸컷이 무브의 끝 상태로 만들어져 드러나는 연출이 사라진다. 같은 JSON 을 그대로 다시 내되, 그 샷들에만 beats 를 채워라: [{"at":0,"what":"<맨 처음 프레임에 보이는 것>"},{"at":<초>,"what":"<무브가 끝난 뒤 보이는 것>"}]. beats[0].at 은 반드시 0 이고, 마지막 at 은 그 샷의 duration 보다 작아야 한다. 다른 것은 하나도 바꾸지 마라.`;
}

/**
 * 인접한 두 샷을 하나로 합친다.
 *
 * 합쳐진 샷은 "하나의 카메라 셋업 안에서 시간에 따라 변하는" 샷이 되므로,
 * 두 샷의 화면을 beats(시간표)로 잇는다. 뒤 샷의 비트는 앞 샷 길이만큼 밀린다.
 * 이게 "발만 보이다가(0s) 틸트업해 전신(2s)" 을 만들어 내는 실제 경로다.
 */
function mergeTwoShots(a, b) {
  const durationA = Number(a.duration) || MIN_SHOT_DURATION;
  const durationB = Number(b.duration) || MIN_SHOT_DURATION;
  const beatsA = Array.isArray(a.beats) && a.beats.length
    ? a.beats
    : [{ at: 0, what: a.composition || a.action || "" }];
  const beatsB = Array.isArray(b.beats) && b.beats.length
    ? b.beats
    : [{ at: 0, what: b.composition || b.action || "" }];
  const shifted = beatsB.map((beat) => ({
    at: (Number(beat.at) || 0) + durationA,
    what: beat.what,
  }));
  const merged = beatsA.concat(shifted).filter((beat) => String(beat.what || "").trim());
  const duration = Math.round((durationA + durationB) * 10) / 10;
  return {
    id: a.id,
    duration,
    shotType: a.shotType,
    // 정적 샷과 움직이는 샷을 합치면 움직임이 있는 쪽이 이 샷의 성격이다.
    cameraMove: (a.cameraMove && a.cameraMove !== "static") ? a.cameraMove : (b.cameraMove || a.cameraMove),
    composition: a.composition || b.composition,
    action: [a.action, b.action].map((v) => String(v || "").trim()).filter(Boolean).join(" 이어서 "),
    dialogue: a.dialogue || b.dialogue || null,
    beats: normalizeBeats(merged, duration),
  };
}

/**
 * 씬 길이가 허용하는 컷 수까지 줄인다.
 *
 * 최소 컷 길이가 4초(영상 모델 바닥)이므로 4초 씬에 2컷은 애초에 불가능하다.
 * 예전에는 그런 경우에도 컷을 그대로 두고 길이만 늘려, 씬 길이가 부풀거나
 * 모델이 못 만드는 2~3초 컷이 남았다. 이제는 컷을 합쳐서 시간표로 잇는다.
 * 합칠 쌍은 "합쳐도 가장 짧은 쌍" — 긴 컷들을 함부로 붙이지 않는다.
 */
export function fitShotCount(shots, targetSec) {
  const target = Number(targetSec) || 0;
  if (!Array.isArray(shots) || shots.length < 2 || !target) return shots;
  const maxShots = Math.max(1, Math.floor(target / MIN_SHOT_DURATION));
  let list = shots.slice();
  while (list.length > maxShots) {
    let bestIndex = 0;
    let bestSum = Infinity;
    for (let i = 0; i < list.length - 1; i++) {
      const sum = (Number(list[i].duration) || 0) + (Number(list[i + 1].duration) || 0);
      if (sum < bestSum) { bestSum = sum; bestIndex = i; }
    }
    const merged = mergeTwoShots(list[bestIndex], list[bestIndex + 1]);
    list = list.slice(0, bestIndex).concat([merged], list.slice(bestIndex + 2));
  }
  return list;
}

/**
 * shots 배열의 duration 합이 scene.estSec 와 일치하도록 ±20% 허용 안에서 보정.
 * 합이 너무 어긋나면 비례 스케일링.
 *
 * 스케일링 전에 컷 수부터 씬 길이에 맞춘다. 최소 4초 바닥이 있으므로 컷이 너무 많으면
 * 아무리 줄여도 합이 목표를 넘는다 — 그때는 길이가 아니라 컷 수가 틀린 것이다.
 */
export function reconcileDurations(shots, scene) {
  if (!Array.isArray(shots) || !shots.length) return shots;
  const target = Number(scene?.estSec) || 0;
  if (!target) return shots;
  shots = fitShotCount(shots, target);
  const sum = shots.reduce((acc, s) => acc + (Number(s.duration) || 0), 0);
  if (!sum) return shots;
  const ratio = sum / target;
  if (ratio >= 1 - DURATION_TOLERANCE && ratio <= 1 + DURATION_TOLERANCE) return shots;

  const scale = target / sum;
  return shots.map((s) => {
    let d = Math.round(Number(s.duration) * scale * 10) / 10;
    if (d < MIN_SHOT_DURATION) d = MIN_SHOT_DURATION;
    if (d > MAX_SHOT_DURATION) d = MAX_SHOT_DURATION;
    // 길이가 바뀌면 비트 시각도 같은 비율로 따라가야 한다.
    // (여기서 시각을 그대로 두면 뒤쪽 비트가 샷 밖으로 밀려나 통째로 사라진다)
    const beatScale = (Number(s.duration) || 0) > 0 ? d / Number(s.duration) : 1;
    return { ...s, duration: d, beats: normalizeBeats(scaleBeats(s.beats, beatScale), d) };
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
  const dialogue = normalizeShotDialogue(
    Array.isArray(scene?.dialogue) ? scene.dialogue[0] : scene?.dialogue
  );
  return [{
    id: `${id}.1`,
    duration,
    shotType: "MS",
    cameraMove: "static",
    composition: visual.split(/[\n.]/)[0] || "프레임 중앙에 주요 피사체",
    action: visual || "씬 비트 그대로 진행",
    dialogue,
    beats: null,
  }];
}

/**
 * dialogue 필드 정규화.
 * 수용 형태: null | undefined | "string" | {speaker, line} | {line} | [무시]
 * 출력 형태: null | "string" | {speaker, line}
 */
/**
 * 한 샷 안의 시간 비트.
 *
 * 스틸컷은 beats[0](t=0)로 만들고, 영상은 이 표를 시간 분배 프롬프트로 받는다.
 * 그래서 두 가지를 보장해야 한다.
 *   - 첫 비트는 반드시 t=0 (스틸컷이 샷의 시작이어야 한다)
 *   - at 은 증가하고 duration 안에 있어야 한다 (영상 시간표가 뒤엉키지 않게)
 * 하나뿐인 비트는 의미가 없으므로(=변화 없음) 버린다.
 */
/** 샷 길이가 바뀔 때 비트 시각을 같은 비율로 옮긴다. */
export function scaleBeats(beats, scale) {
  if (!Array.isArray(beats) || !beats.length) return beats;
  const factor = Number(scale);
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return beats;
  return beats.map((beat) => ({
    ...beat,
    at: Math.round((Number(beat.at) || 0) * factor * 10) / 10,
  }));
}

export function normalizeBeats(raw, duration) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const total = Number(duration) || MIN_SHOT_DURATION;
  const out = [];
  let prevAt = -1;
  raw.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const what = String(item.what || item.text || "").trim();
    if (!what) return;
    let at = Number(item.at);
    if (!Number.isFinite(at) || at < 0) at = 0;
    if (out.length === 0) at = 0; // 첫 비트는 언제나 샷의 시작
    at = Math.round(at * 10) / 10;
    if (at <= prevAt) at = Math.round((prevAt + 0.5) * 10) / 10;
    if (at >= total) return; // 샷 밖의 비트는 버린다
    prevAt = at;
    out.push({ at, what });
  });
  if (out.length < 2) return null; // 변화가 없으면 비트를 둘 이유가 없다
  if (out.length > MAX_BEATS_PER_SHOT) out.length = MAX_BEATS_PER_SHOT;
  return out;
}

export function normalizeShotDialogue(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const t = raw.trim();
    return t ? t : null;
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const speaker = String(raw.speaker || "").trim();
    const line = String(raw.line || raw.text || "").trim();
    if (!line) return null;
    return speaker ? { speaker, line } : line;
  }
  return null;
}

export const __testables = {
  MAX_SHOTS_PER_SCENE,
  MIN_SHOTS_PER_SCENE,
  MAX_SHOT_DURATION,
  MIN_SHOT_DURATION,
  MAX_BEATS_PER_SHOT,
  DURATION_TOLERANCE,
};
