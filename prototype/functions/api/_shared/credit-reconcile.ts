// prototype/functions/api/_shared/credit-reconcile.ts
//
// 크레딧 예약의 서버 정산.
// 생성은 접수 때 크레딧을 '예약'하고, 결과가 확정되면 확정(commit)·환불(release)한다.
// 예전에는 이 확정이 브라우저의 상태 조회(/api/video/status)에서만 일어나서, 조회가 끊기거나(페이지 닫기·
// 조회 오류·다른 기기) 실패 응답을 못 읽으면 예약이 영원히 남아 사용 가능 잔액에서 빠진 채였다(2026-09-28).
// 여기서는 서버가 예약 목록을 직접 훑어 공급자(Atlas)에 작업 결과를 묻고 정산한다.
//  - 공급자 완료 → 확정(공급자가 실제로 생성·과금했다)
//  - 공급자 실패·취소 → 환불
//  - 아직 진행 중·조회 불가 → 그대로 둔다(다음 정산에서 다시 본다)
//  - 공급자 작업 번호가 끝내 붙지 않은 예약(접수 도중 끊김) → 일정 시간 뒤 환불

import { getSql } from "../knowledge/_shared";
import { ensureCreditSchema, settleCreditOperation } from "./credits";
import { atlasKeyFor } from "./generation-auth";
import { atlasPredictionIdOf, classifyAtlasPrediction } from "./atlas-prediction.js";

type ReconcileAction = "commit" | "release" | "pending";

export interface ReconcileItem {
  operationId: string;
  userId: string;
  providerJobId: string;
  credits: number;
  createdAt: string;
  action: ReconcileAction;
  providerStatus: string;
  reason: string;
}

async function fetchAtlasPrediction(key: string, predictionId: string): Promise<{ httpStatus: number; body: any }> {
  const res = await fetch(`https://api.atlascloud.ai/api/v1/model/prediction/${encodeURIComponent(predictionId)}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch (_) { body = null; }
  return { httpStatus: res.status, body };
}

/**
 * 예약된 작업을 정산한다. Worker 서브요청 50번 한도 때문에 한 번에 limit 건까지만 보고, 나머지는 다음 실행이 이어서 본다.
 * @param opts.userId 비우면 전체 회원(정기 실행)
 * @param opts.minAgeSec 막 접수된 작업은 건너뛴다(접수 응답이 아직 작업 번호를 붙이는 중일 수 있다)
 * @param opts.orphanAgeSec 작업 번호 없이 이만큼 지난 예약은 접수가 끊긴 것으로 보고 환불한다
 */
export async function reconcileReservedCredits(env: any, opts: { userId?: string; limit?: number; minAgeSec?: number; orphanAgeSec?: number } = {}): Promise<{ checked: number; committed: number; released: number; pending: number; items: ReconcileItem[] }> {
  const sql = getSql(env);
  if (!sql) throw new Error("credit_database_unavailable");
  await ensureCreditSchema(sql);
  const limit = Math.max(1, Math.min(20, Math.trunc(Number(opts.limit) || 8)));
  const minAgeSec = Math.max(0, Math.trunc(Number(opts.minAgeSec ?? 60)));
  const orphanAgeSec = Math.max(60, Math.trunc(Number(opts.orphanAgeSec ?? 1800)));
  const params: any[] = [minAgeSec, limit];
  let where = "status='reserved' AND created_at < now() - make_interval(secs => $1)";
  if (opts.userId) { params.push(opts.userId); where += ` AND user_id=$${params.length}`; }
  const rows = await sql(
    `SELECT id, user_id, provider_job_id, credit_cost, created_at, EXTRACT(EPOCH FROM (now() - created_at))::bigint AS age_sec
       FROM credit_operations WHERE ${where} ORDER BY created_at ASC LIMIT $2`,
    params,
  );

  const keyCache = new Map<string, string>();
  const master = String(env?.ATLASCLOUD_API_KEY || "").trim();
  const items: ReconcileItem[] = [];
  for (const row of rows) {
    const item: ReconcileItem = {
      operationId: String(row.id),
      userId: String(row.user_id),
      providerJobId: String(row.provider_job_id || ""),
      credits: Number(row.credit_cost) || 0,
      createdAt: String(row.created_at),
      action: "pending",
      providerStatus: "",
      reason: "",
    };
    try {
      if (!item.providerJobId) {
        if (Number(row.age_sec) >= orphanAgeSec) {
          item.action = "release";
          item.reason = "no_provider_job";
        } else {
          item.reason = "waiting_for_provider_job";
        }
      } else {
        const predictionId = atlasPredictionIdOf(item.providerJobId);
        if (!predictionId) {
          item.reason = "not_atlas_job";
        } else {
          // 생성 때 쓴 키(회원 등록 키가 있으면 그것)로 먼저 묻고, 안 되면 마스터 키로.
          if (!keyCache.has(item.userId)) keyCache.set(item.userId, (await atlasKeyFor(env, item.userId)).key || master);
          const keys = [keyCache.get(item.userId) || "", master].filter((k, i, arr) => k && arr.indexOf(k) === i);
          let found: { action: ReconcileAction; status: string } | null = null;
          let lastHttp = 0;
          for (const key of keys) {
            const r = await fetchAtlasPrediction(key, predictionId);
            lastHttp = r.httpStatus;
            const c = classifyAtlasPrediction(r.body);
            if (c.status !== "unknown") { found = c; break; }
          }
          if (found) {
            item.action = found.action;
            item.providerStatus = found.status;
          } else {
            item.reason = `provider_lookup_failed_http_${lastHttp}`;
          }
        }
      }
      if (item.action !== "pending") {
        const settled = await settleCreditOperation(env, item.userId, item.operationId, item.action, item.providerJobId);
        if (!settled?.ok) { item.reason = `settle_${settled?.reason || "failed"}`; item.action = "pending"; }
      }
    } catch (e: any) {
      item.action = "pending";
      item.reason = `error: ${String(e?.message || e).slice(0, 200)}`;
    }
    items.push(item);
  }
  return {
    checked: items.length,
    committed: items.filter((x) => x.action === "commit").length,
    released: items.filter((x) => x.action === "release").length,
    pending: items.filter((x) => x.action === "pending").length,
    items,
  };
}
