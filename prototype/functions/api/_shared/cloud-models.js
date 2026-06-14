// prototype/functions/api/_shared/cloud-models.js
// 에이전트별 Claude 모델 매핑 (라비오크 _shared/cloud_models.json 포팅).
// 설정 화면 "클라우드 모델 매핑" 표시 + 실제 callClaude 모델 선택에 공용으로 사용.
export const CLOUD_MODELS = {
  // 구독(OAuth) 인증에선 opus 접근이 막힐 수 있어 코어도 sonnet으로(진단 200 검증). API 키 모드면 opus로 올려도 됨.
  core: "claude-sonnet-4-6",    // 코어(오케스트레이터) — 최상위 판단
  edge: "claude-sonnet-4-6",
  radar: "claude-sonnet-4-6",
  maki: "claude-sonnet-4-6",
  plot: "claude-sonnet-4-6",
  ink: "claude-sonnet-4-6",
  pixel: "claude-sonnet-4-6",
  beat: "claude-sonnet-4-6",
  engi: "claude-sonnet-4-6",
  reach: "claude-sonnet-4-6",
  sync: "claude-haiku-4-5",     // 단순/저비용 작업
};

const DEFAULT_MODEL = "claude-sonnet-4-6";

export function modelFor(agentId) {
  const id = String(agentId || "").toLowerCase().trim();
  return CLOUD_MODELS[id] || DEFAULT_MODEL;
}
