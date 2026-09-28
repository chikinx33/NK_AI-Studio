// prototype/functions/api/_shared/atlas-prediction.js
//
// Atlas 작업 조회 해석(의존성 없음 — credit-reconcile.ts 와 테스트가 함께 쓴다).
// 앱의 공급자 작업 번호는 `{접두}:{Atlas prediction id}` 형식이다(video.ts 가 붙인다).

// Atlas 를 거치지 않는 옛 작업(직접 xAI). 공급자 조회 대상이 아니다.
const NON_ATLAS_PREFIXES = ["grok:", "grok-extend:"];

/** `{접두}:{Atlas prediction id}` 에서 Atlas 작업 ID 를 꺼낸다. Atlas 작업이 아니면 빈 문자열. */
export function atlasPredictionIdOf(providerJobId) {
  const s = String(providerJobId || "").trim();
  if (!s || NON_ATLAS_PREFIXES.some((p) => s.startsWith(p))) return "";
  const i = s.indexOf(":");
  const id = i >= 0 ? s.slice(i + 1) : s;
  return /^[A-Za-z0-9_-]{8,128}$/.test(id) ? id : "";
}

/** Atlas 작업 조회 본문 → 정산 동작. 실패 작업은 HTTP 500 이어도 본문에 status='failed' 가 온다. */
export function classifyAtlasPrediction(body) {
  const status = String(body?.data?.status || body?.status || "").toLowerCase();
  if (["completed", "succeeded", "success"].includes(status)) return { action: "commit", status };
  if (["failed", "error", "cancelled", "canceled"].includes(status)) return { action: "release", status };
  return { action: "pending", status: status || "unknown" };
}
