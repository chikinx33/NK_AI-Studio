// 인포그래픽 영상(기획 회의·감독) Claude 인증 — 비용 0원 정책(2026-10-21 엔케).
// Claude 구독(OAuth)일 때만 쓰고, 구독이 거부돼도 API 키로 다시 시도하지 않는다(예비 자격증명 제거).
// API 키(본인·마스터) 경로는 쓰지 않는다.
import { authHeadersFor, resolveAuth } from "../_shared/claude-auth.js";
import type { SqlFn } from "../knowledge/_shared";

export const MOTION_SUBSCRIPTION_REQUIRED = "motion_subscription_required";
export const MOTION_PLANNING_MODEL = "claude-sonnet-4-6";

export async function motionSubscriptionAuth(sql: SqlFn, userId: string, env: any): Promise<any | null> {
  const resolved: any = await resolveAuth(sql, userId, env, { allowMissing: true });
  if (resolved?.mode !== "subscription" || !resolved?.oauthToken) return null;
  return { ...authHeadersFor(resolved), fallback: null };
}
