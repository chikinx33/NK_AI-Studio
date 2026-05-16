/**
 * scenario/rebalancer.js
 *
 * Pass 1 결과(또는 Pass 2 결과)에 대해 LLM 무관 결정적 후처리.
 *
 * 책임 범위
 *  - splitUniformRuns(scenes): 동일 estSec 3개 이상 연속 발견 시 가장 긴 씬을 자동 분할
 *  - padScenesToBeatCount(scenes, beats): scenes.length < beats.length 면 빈 씬 슬롯 자동 삽입
 *  - diversifyShotCameraMoves(scenes): Pass 2 결과에서 인접 동일 cameraMove를 풀에서 자동 치환
 *
 * 모두 LLM 호출 없이 코드만으로 보장. 프롬프트가 실패해도 최종 출력 품질을 강제.
 */

// ---------------------------------------------------------------------------
// 1) Scene-level: uniformRun 분할
// ---------------------------------------------------------------------------

/**
 * 연속 동일 estSec 3개 이상 구간을 찾아 가장 긴 씬을 두 개로 분할.
 * - 분할은 한 번에 1개만 수행 (점진적). 호출 측에서 안정될 때까지 반복.
 * - 6초 씬 → 4초 + 2초, 4초 씬 → 2.5 + 1.5 등 차등.
 * - visual / action 텍스트는 원본을 part1·part2로 사인. 의미는 LLM이 채우지 않고 보존.
 *
 * @param {Array} scenes
 * @returns {{ scenes: Array, splitApplied: boolean, splitIndex: number|null }}
 */
export function splitOneUniformRun(scenes) {
  if (!Array.isArray(scenes) || scenes.length < 3) {
    return { scenes, splitApplied: false, splitIndex: null };
  }
  const secs = scenes.map((s) => Number(s?.estSec) || 0);

  // 연속 동일 길이 구간 찾기
  let bestStart = -1;
  let bestLen = 0;
  let bestValue = 0;
  let curStart = 0;
  let curLen = 1;
  for (let i = 1; i < secs.length; i++) {
    if (Math.abs(secs[i] - secs[curStart]) < 0.01 && secs[curStart] > 0) {
      curLen += 1;
    } else {
      if (curLen >= 3 && (curLen > bestLen || (curLen === bestLen && secs[curStart] > bestValue))) {
        bestStart = curStart;
        bestLen = curLen;
        bestValue = secs[curStart];
      }
      curStart = i;
      curLen = 1;
    }
  }
  if (curLen >= 3 && (curLen > bestLen || (curLen === bestLen && secs[curStart] > bestValue))) {
    bestStart = curStart;
    bestLen = curLen;
    bestValue = secs[curStart];
  }

  if (bestStart < 0) {
    return { scenes, splitApplied: false, splitIndex: null };
  }

  // 구간 내에서 분할할 씬 선정 — 중간 인덱스(가장자리 두 개는 인접 비균등 만들기 부적합)
  const targetIdx = bestStart + Math.floor(bestLen / 2);
  const original = scenes[targetIdx];
  const totalSec = Number(original?.estSec) || 0;
  if (totalSec < 4) {
    // 4초 미만은 더 쪼개도 의미 없음(최소 2초 보장).
    return { scenes, splitApplied: false, splitIndex: null };
  }

  // 비대칭 분할 — 균등(3+3)을 또 만들지 않기 위해
  // 6 → 4+2, 5 → 3+2, 4 → 2.5+1.5(소수 허용), 8 → 5+3 등
  let partA;
  let partB;
  if (totalSec >= 6) {
    partA = Math.round((totalSec * 0.65) * 10) / 10;
    partB = Math.round((totalSec - partA) * 10) / 10;
  } else if (totalSec >= 5) {
    partA = 3;
    partB = totalSec - 3;
  } else {
    // totalSec >= 4
    partA = 2.5;
    partB = totalSec - 2.5;
  }
  if (partA <= 0 || partB <= 0) {
    return { scenes, splitApplied: false, splitIndex: null };
  }

  const splitText = (text, suffixA, suffixB) => {
    const t = String(text || "").trim();
    if (!t) return ["", ""];
    // 첫 문장 / 나머지로 분리. 문장이 1개뿐이면 길이로 잘라 분할.
    const sentenceMatch = t.match(/^([^.!?\n。！？]+[.!?。！？]?)\s*(.*)$/u);
    if (sentenceMatch && sentenceMatch[2]) {
      return [`${sentenceMatch[1].trim()} ${suffixA}`.trim(), `${sentenceMatch[2].trim()} ${suffixB}`.trim()];
    }
    const half = Math.max(1, Math.floor(t.length / 2));
    return [`${t.slice(0, half).trim()} ${suffixA}`.trim(), `${t.slice(half).trim()} ${suffixB}`.trim()];
  };

  const [visA, visB] = splitText(original.visual, "(전반부)", "(후반부)");
  const [actA, actB] = splitText(original.action || original.sceneIntent || "", "— 시작 액션", "— 이어지는 반응");

  const sceneA = {
    ...original,
    estSec: partA,
    visual: visA || original.visual,
    action: actA || original.action,
    _splitOrigin: original.id ?? null,
    _splitPart: "A",
  };
  const sceneB = {
    ...original,
    id: undefined, // 호출 측에서 재인덱싱
    estSec: partB,
    visual: visB || original.visual,
    action: actB || original.action,
    _splitOrigin: original.id ?? null,
    _splitPart: "B",
  };

  const next = scenes.slice();
  next.splice(targetIdx, 1, sceneA, sceneB);
  return { scenes: next, splitApplied: true, splitIndex: targetIdx };
}

/**
 * splitOneUniformRun 을 안정될 때까지 반복 적용.
 * 무한 루프 방지를 위해 최대 6회 제한.
 *
 * @param {Array} scenes
 * @returns {{ scenes: Array, splits: number }}
 */
export function splitUniformRuns(scenes) {
  let current = Array.isArray(scenes) ? scenes : [];
  let splits = 0;
  for (let i = 0; i < 6; i++) {
    const res = splitOneUniformRun(current);
    if (!res.splitApplied) break;
    current = res.scenes;
    splits += 1;
  }
  // id 재부여 (1부터 순차)
  current = current.map((s, idx) => ({ ...s, id: idx + 1, title: s.title || `Scene ${idx + 1}` }));
  return { scenes: current, splits };
}

// ---------------------------------------------------------------------------
// 2) Scene-level: beats.length 보다 적으면 빈 슬롯 삽입
// ---------------------------------------------------------------------------

/**
 * scenes.length < beats.length 면, 매핑되지 않은 비트마다 빈 씬 슬롯을 추가.
 * 빈 슬롯은 placeholder 로 표시되어 사용자/후속 단계가 이를 알 수 있게 한다.
 *
 * @param {Array} scenes
 * @param {Array<{id?:string, action:string, isClimax?:boolean, intensity?:string}>} beats
 * @returns {{ scenes: Array, padded: number }}
 */
export function padScenesToBeatCount(scenes, beats) {
  const list = Array.isArray(scenes) ? scenes.slice() : [];
  const beatList = Array.isArray(beats) ? beats : [];
  if (!beatList.length) return { scenes: list, padded: 0 };
  if (list.length >= beatList.length) return { scenes: list, padded: 0 };

  const needed = beatList.length - list.length;
  // 누락된 비트는 보통 후반부(클라이맥스) 쪽이므로 끝에 추가.
  // 끝에 추가하되 직전 씬의 estSec 평균 기준으로 짧게 배치.
  const avg = list.length
    ? list.reduce((acc, s) => acc + (Number(s?.estSec) || 0), 0) / list.length
    : 3;
  const fillSec = Math.max(2, Math.min(4, Math.round(avg * 0.8 * 10) / 10));

  // 가장 마지막 비트부터 역순으로 채워, 클라이맥스가 진짜 마지막 씬에 매핑되게.
  const startBeatIdx = list.length; // 0-based
  for (let i = 0; i < needed; i++) {
    const beat = beatList[startBeatIdx + i] || beatList[beatList.length - 1];
    const action = beat?.action || "";
    list.push({
      id: list.length + 1,
      title: `Scene ${list.length + 1}`,
      estSec: fillSec,
      sceneIntent: action,
      sceneLocation: "",
      visual: `[자동 보충 슬롯] ${action}`,
      narration: "",
      dialogue: [],
      action,
      coversBeats: beat?.id ? [beat.id] : [],
      _autoPadded: true,
    });
  }
  return { scenes: list, padded: needed };
}

// ---------------------------------------------------------------------------
// 3) Shot-level: 인접 동일 cameraMove 자동 치환
// ---------------------------------------------------------------------------

const CAMERA_POOL = [
  "push-in",
  "pull-out",
  "pan-left",
  "pan-right",
  "tilt-up",
  "tilt-down",
  "tracking",
  "handheld",
  "static",
];

const CAMERA_MOVE_DESCRIPTION_KO = {
  "push-in":   "카메라가 피사체를 향해 천천히 다가간다",
  "pull-out":  "카메라가 피사체에서 천천히 멀어진다",
  "pan-left":  "카메라가 왼쪽으로 부드럽게 팬한다",
  "pan-right": "카메라가 오른쪽으로 부드럽게 팬한다",
  "tilt-up":   "카메라가 아래에서 위로 천천히 틸트한다",
  "tilt-down": "카메라가 위에서 아래로 천천히 틸트한다",
  "tracking":  "카메라가 피사체와 평행 이동하며 따라간다",
  "handheld":  "핸드헬드 미세 흔들림으로 현장감을 더한다",
  "static":    "카메라는 고정",
};

/**
 * 인접 샷이 같은 cameraMove면 풀에서 다른 무브로 치환.
 * scenes.shots 구조를 기대 (Pass 2 출력 또는 fallback).
 *
 * @param {Array} scenes
 * @returns {{ scenes: Array, swaps: number }}
 */
export function diversifyShotCameraMoves(scenes) {
  if (!Array.isArray(scenes) || !scenes.length) return { scenes, swaps: 0 };
  let swaps = 0;
  const next = scenes.map((scene) => {
    const shots = Array.isArray(scene?.shots) ? scene.shots : null;
    if (!shots || shots.length < 2) return scene;

    let prevMove = null;
    const newShots = shots.map((shot, idx) => {
      const currMove = String(shot?.cameraMove || "").trim();
      if (!currMove) {
        prevMove = currMove;
        return shot;
      }
      if (idx === 0) {
        prevMove = currMove;
        return shot;
      }
      if (currMove !== prevMove) {
        prevMove = currMove;
        return shot;
      }
      // 인접 동일 — 풀에서 prevMove와 다른 무브를 라운드로빈으로 선택
      const candidates = CAMERA_POOL.filter((m) => m !== prevMove);
      const replacement = candidates[(idx + swaps) % candidates.length] || "pan-right";
      swaps += 1;
      const desc = CAMERA_MOVE_DESCRIPTION_KO[replacement];
      const newAction = desc
        ? `${shot.action || ""} ${shot.action ? "—" : ""} ${desc}`.replace(/\s+/g, " ").trim()
        : shot.action;
      prevMove = replacement;
      return {
        ...shot,
        cameraMove: replacement,
        action: newAction,
        _autoCameraSwap: true,
      };
    });
    return { ...scene, shots: newShots };
  });
  return { scenes: next, swaps };
}

export default {
  splitOneUniformRun,
  splitUniformRuns,
  padScenesToBeatCount,
  diversifyShotCameraMoves,
};
