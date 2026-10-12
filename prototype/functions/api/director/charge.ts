// POST /api/director/charge — 디렉터 대화(Claude Managed Agents) 사용량을 크레딧으로 정산.
// body: { sessionId, cumulativeCents } — 세션 누적 원가(센트). 늘어난 만큼만 한 번 차감한다.
import { chargeDirectorUsage, getCreditSummary } from "../_shared/credits";
import { directorAuth, onOptions, send, type PagesFunction } from "./_shared";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await directorAuth(request, env, true);
  if (!auth.ok) return auth.response;
  const body: any = await request.json().catch(() => ({}));
  try {
    const result = await chargeDirectorUsage(env, auth.userId, String(body?.sessionId || ""), Number(body?.cumulativeCents));
    if (!result.ok) {
      const insufficient = result.reason === "insufficient";
      return send({ error: insufficient ? "credit_insufficient" : "credit_charge_failed", ...result }, insufficient ? 402 : 409, origin);
    }
    const summary = result.owner ? null : await getCreditSummary(env, auth.userId).catch(() => null);
    return send({ ...result, summary }, 200, origin);
  } catch (e: any) {
    return send({ error: "credit_service_unavailable", detail: String(e?.message || e) }, 503, origin);
  }
};

export const onRequestOptions = onOptions;
