/**
 * _shared/motion-words.js — "인물이 실제로 자리를 옮긴다"는 서술을 알아보는 단일 원천.
 *
 * 쓰는 곳
 *  - scenario/rebalancer.js enforceSequenceContinuity: 이동 서술이 없는데 좌표가 바뀌면 앵커로 되돌린다.
 *  - scenario/shots/decomposer.js shotsMissingBeats: 인물이 옮겨 가는 샷에도 beats(출발→도착)를 요구한다.
 *  - 브라우저 ui/pipeline-image.js MOVE_RE: 같은 순간 판정(카메라 재구성). 리터럴이 같아야 한다 — 테스트가 비교한다.
 *
 * 함정(2026-09-13 실제 생성 결과에서 확인):
 *  - "내려다보다/올려다보다" 는 시선이지 이동이 아니다 → 내려(?!다보), 올려(?!다보).
 *  - "내밀다/내밀며" 는 고개·팔을 내미는 몸짓이지 이동이 아니다 → (?<!내)밀.
 */
export const MOVE_RE = /(걸어|걷|뛰|달리|달려|이동|다가|물러|들어오|들어가|나가|나오|돌아서|돌아보|일어[나서난선]|앉|눕|넘어|올라(?!다보)|내려(?!다보)|건너|따라가|옮기|(?<!내)밀|당기|피하|쓰러|점프|뛰어|자리를|위치를|\bwalk|\brun|\bmove|\bstep|\bapproach|\benter|\bleave|\bexit|\bturn(?:s|ed|ing)?\s+(?:around|away|to)|\bstand(?:s)?\s+up|\bsit(?:s)?\s+down|\brise|\bjump|\bcross|\bclimb|\bback(?:s)?\s+away|\bdash|\brush|\bfall)/i;

export function hasCharacterMovement(text) {
  return MOVE_RE.test(String(text || ""));
}
