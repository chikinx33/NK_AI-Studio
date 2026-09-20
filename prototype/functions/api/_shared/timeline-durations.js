/** 프로젝트의 최종 컷 시간축을 생성 모델이 지원하는 4~6초 범위 안에서 정확히 맞춘다. */

function scaleBeats(beats, scale, duration) {
  if (!Array.isArray(beats) || !beats.length) return beats;
  return beats.map((beat, index) => ({
    ...beat,
    at: index === 0 ? 0 : Math.min(Math.round((Number(beat?.at) || 0) * scale * 10) / 10, Math.max(0, duration - 0.1)),
  }));
}

export function fitFlatTimelineDurations(scenes, targetDurationSec) {
  const list = Array.isArray(scenes) ? scenes : [];
  const target = Math.round(Number(targetDurationSec) || 0);
  const before = list.reduce((sum, scene) => sum + (Number(scene?.estSec) || 0), 0);
  if (!list.length || !target) return { scenes: list, before, after: before, adjusted: 0, feasible: true };
  const minTotal = list.length * 4;
  const maxTotal = list.length * 6;
  if (target < minTotal || target > maxTotal) {
    return { scenes: list, before, after: before, adjusted: 0, feasible: false };
  }
  const sourceTotal = before > 0 ? before : list.length;
  const desired = list.map((scene) => Math.max(4, Math.min(6, ((Number(scene?.estSec) || 1) / sourceTotal) * target)));
  const durations = desired.map((value) => Math.floor(value));
  let remainder = target - durations.reduce((sum, value) => sum + value, 0);
  const addOrder = desired.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  let guard = 0;
  while (remainder > 0 && guard < 1000) {
    const entry = addOrder[guard % addOrder.length];
    if (durations[entry.index] < 6) { durations[entry.index] += 1; remainder -= 1; }
    guard += 1;
  }
  guard = 0;
  while (remainder < 0 && guard < 1000) {
    const index = durations.length - 1 - (guard % durations.length);
    if (durations[index] > 4) { durations[index] -= 1; remainder += 1; }
    guard += 1;
  }
  const fitted = list.map((scene, index) => {
    const previous = Number(scene?.estSec) || durations[index];
    const duration = durations[index];
    return {
      ...scene,
      estSec: duration,
      beats: scaleBeats(scene?.beats, previous > 0 ? duration / previous : 1, duration),
    };
  });
  const after = fitted.reduce((sum, scene) => sum + (Number(scene?.estSec) || 0), 0);
  return { scenes: fitted, before, after, adjusted: fitted.filter((scene, index) => Number(scene.estSec) !== Number(list[index]?.estSec)).length, feasible: after === target };
}

