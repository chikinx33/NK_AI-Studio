import { authorizeRequest } from "./auth.js";
import { getSql, type SqlFn } from "../knowledge/_shared";
import { quoteCredits } from "./credit-rates.js";
import { ensureSchemaOnce } from "./schema-marks.js";
import { dataUrlVideoSeconds, mp4DurationSeconds } from "./motion-control.js";
import { videoInputSourcesFor, creditsForUsd } from "./video-pricing.ts";
import { audioDurationSeconds, createCostMeter, withCostMeter, type CostMeter } from "./usage-cost.ts";
import { getGoogleAccessToken, parseGcsUri } from "./gcs.js";


export type CreditSummary = {
  userId: string;
  available: number;
  reserved: number;
  total: number;
  lifetimeGranted: number;
  lifetimeSpent: number;
  lifetimeRefunded: number;
  lifetimeRevoked: number;
};

function asInt(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

function operationId(): string {
  try { return crypto.randomUUID(); } catch (_) {
    return `cr_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  }
}

function json(data: any, status = 200, origin?: string | null): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(data), { status, headers });
}

// 크레딧 테이블·함수. 이 함수의 소스가 바뀐 배포에서만 한 번 돈다(schema-marks.js).
async function runCreditSchemaDdl(sql: SqlFn): Promise<void> {
  await sql(`
    CREATE TABLE IF NOT EXISTS credit_accounts (
      user_id text PRIMARY KEY,
      available_credits bigint NOT NULL DEFAULT 0 CHECK (available_credits >= 0),
      reserved_credits bigint NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
      lifetime_granted bigint NOT NULL DEFAULT 0,
      lifetime_spent bigint NOT NULL DEFAULT 0,
      lifetime_refunded bigint NOT NULL DEFAULT 0,
      lifetime_revoked bigint NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql(`
    CREATE TABLE IF NOT EXISTS credit_operations (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      idempotency_key text NOT NULL,
      feature text NOT NULL,
      provider text NOT NULL DEFAULT '',
      model text NOT NULL DEFAULT '',
      credit_cost bigint NOT NULL CHECK (credit_cost > 0),
      status text NOT NULL CHECK (status IN ('reserved','committed','released')),
      provider_job_id text NOT NULL DEFAULT '',
      rate_card text NOT NULL DEFAULT '',
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, idempotency_key)
    )
  `);
  await sql(`
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id bigserial PRIMARY KEY,
      user_id text NOT NULL,
      operation_id text,
      kind text NOT NULL,
      delta_available bigint NOT NULL DEFAULT 0,
      delta_reserved bigint NOT NULL DEFAULT 0,
      balance_after bigint NOT NULL DEFAULT 0,
      reserved_after bigint NOT NULL DEFAULT 0,
      actor_user_id text NOT NULL DEFAULT '',
      reason text NOT NULL DEFAULT '',
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql("CREATE INDEX IF NOT EXISTS credit_transactions_user_created_idx ON credit_transactions (user_id, created_at DESC)");
  await sql("CREATE INDEX IF NOT EXISTS credit_operations_user_created_idx ON credit_operations (user_id, created_at DESC)");
  await sql("CREATE INDEX IF NOT EXISTS credit_operations_provider_job_idx ON credit_operations (user_id, provider_job_id) WHERE provider_job_id <> ''");
  // 실제 사용량 정산: 예약(최대치) 중 실제로 쓴 크레딧. NULL 이면 예약액 그대로 확정된 옛 방식.
  await sql("ALTER TABLE credit_operations ADD COLUMN IF NOT EXISTS actual_cost bigint");

  await sql(`
    CREATE OR REPLACE FUNCTION nk_credit_reserve(
      p_user_id text, p_operation_id text, p_idempotency_key text,
      p_feature text, p_provider text, p_model text, p_cost bigint,
      p_rate_card text, p_metadata jsonb
    ) RETURNS TABLE(ok boolean, reason text, operation_id text, available bigint, reserved bigint, required bigint, operation_status text)
    LANGUAGE plpgsql AS $$
    DECLARE a credit_accounts%ROWTYPE; o credit_operations%ROWTYPE;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext(p_user_id));
      INSERT INTO credit_accounts(user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;
      SELECT * INTO o FROM credit_operations WHERE user_id=p_user_id AND idempotency_key=p_idempotency_key LIMIT 1;
      IF FOUND THEN
        SELECT * INTO a FROM credit_accounts WHERE user_id=p_user_id;
        RETURN QUERY SELECT false, CASE WHEN o.credit_cost=p_cost THEN 'duplicate_' || o.status ELSE 'idempotency_cost_mismatch' END,
          o.id, a.available_credits, a.reserved_credits, p_cost, o.status;
        RETURN;
      END IF;
      UPDATE credit_accounts SET available_credits=available_credits-p_cost,
        reserved_credits=reserved_credits+p_cost, updated_at=now()
        WHERE user_id=p_user_id AND available_credits >= p_cost RETURNING * INTO a;
      IF NOT FOUND THEN
        SELECT * INTO a FROM credit_accounts WHERE user_id=p_user_id;
        RETURN QUERY SELECT false, 'insufficient', p_operation_id, a.available_credits, a.reserved_credits, p_cost, 'rejected';
        RETURN;
      END IF;
      INSERT INTO credit_operations(id,user_id,idempotency_key,feature,provider,model,credit_cost,status,rate_card,metadata)
        VALUES(p_operation_id,p_user_id,p_idempotency_key,p_feature,COALESCE(p_provider,''),COALESCE(p_model,''),p_cost,'reserved',COALESCE(p_rate_card,''),COALESCE(p_metadata,'{}'::jsonb));
      INSERT INTO credit_transactions(user_id,operation_id,kind,delta_available,delta_reserved,balance_after,reserved_after,metadata)
        VALUES(p_user_id,p_operation_id,'reserve',-p_cost,p_cost,a.available_credits,a.reserved_credits,COALESCE(p_metadata,'{}'::jsonb));
      RETURN QUERY SELECT true, 'reserved', p_operation_id, a.available_credits, a.reserved_credits, p_cost, 'reserved';
    END $$
  `);
  await sql(`
    CREATE OR REPLACE FUNCTION nk_credit_settle(p_user_id text, p_operation_id text, p_action text, p_provider_job_id text DEFAULT '')
    RETURNS TABLE(ok boolean, reason text, available bigint, reserved bigint, operation_status text)
    LANGUAGE plpgsql AS $$
    DECLARE a credit_accounts%ROWTYPE; o credit_operations%ROWTYPE; action_name text;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext(p_user_id));
      SELECT * INTO o FROM credit_operations WHERE id=p_operation_id AND user_id=p_user_id LIMIT 1;
      IF NOT FOUND THEN RETURN QUERY SELECT false,'operation_not_found',0::bigint,0::bigint,'missing'; RETURN; END IF;
      IF o.status <> 'reserved' THEN
        SELECT * INTO a FROM credit_accounts WHERE user_id=p_user_id;
        RETURN QUERY SELECT true,'already_settled',a.available_credits,a.reserved_credits,o.status; RETURN;
      END IF;
      action_name := CASE WHEN p_action='release' THEN 'release' ELSE 'commit' END;
      IF action_name='release' THEN
        UPDATE credit_accounts SET available_credits=available_credits+o.credit_cost,
          reserved_credits=reserved_credits-o.credit_cost, lifetime_refunded=lifetime_refunded+o.credit_cost, updated_at=now()
          WHERE user_id=p_user_id RETURNING * INTO a;
        UPDATE credit_operations SET status='released', provider_job_id=COALESCE(NULLIF(p_provider_job_id,''),provider_job_id), updated_at=now() WHERE id=o.id;
        INSERT INTO credit_transactions(user_id,operation_id,kind,delta_available,delta_reserved,balance_after,reserved_after,metadata)
          VALUES(p_user_id,o.id,'refund',o.credit_cost,-o.credit_cost,a.available_credits,a.reserved_credits,o.metadata);
        RETURN QUERY SELECT true,'released',a.available_credits,a.reserved_credits,'released';
      ELSE
        UPDATE credit_accounts SET reserved_credits=reserved_credits-o.credit_cost,
          lifetime_spent=lifetime_spent+o.credit_cost, updated_at=now()
          WHERE user_id=p_user_id RETURNING * INTO a;
        UPDATE credit_operations SET status='committed', provider_job_id=COALESCE(NULLIF(p_provider_job_id,''),provider_job_id), updated_at=now() WHERE id=o.id;
        INSERT INTO credit_transactions(user_id,operation_id,kind,delta_available,delta_reserved,balance_after,reserved_after,metadata)
          VALUES(p_user_id,o.id,'spend',0,-o.credit_cost,a.available_credits,a.reserved_credits,o.metadata);
        RETURN QUERY SELECT true,'committed',a.available_credits,a.reserved_credits,'committed';
      END IF;
    END $$
  `);
  // 실제 사용량 정산: 예약액 안에서 실제 크레딧만 차감(spend)하고 나머지는 돌려준다(refund).
  // 실제가 예약보다 크면 예약액까지만 받는다 — 생성 전에 보여 준 금액을 넘겨 받지 않는다.
  await sql(`
    CREATE OR REPLACE FUNCTION nk_credit_settle_actual(p_user_id text, p_operation_id text, p_actual bigint, p_provider_job_id text DEFAULT '', p_usage jsonb DEFAULT '{}'::jsonb)
    RETURNS TABLE(ok boolean, reason text, available bigint, reserved bigint, operation_status text, spent bigint, refunded bigint)
    LANGUAGE plpgsql AS $$
    DECLARE a credit_accounts%ROWTYPE; o credit_operations%ROWTYPE; used bigint; back bigint; meta jsonb;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext(p_user_id));
      SELECT * INTO o FROM credit_operations WHERE id=p_operation_id AND user_id=p_user_id LIMIT 1;
      IF NOT FOUND THEN RETURN QUERY SELECT false,'operation_not_found',0::bigint,0::bigint,'missing',0::bigint,0::bigint; RETURN; END IF;
      IF o.status <> 'reserved' THEN
        SELECT * INTO a FROM credit_accounts WHERE user_id=p_user_id;
        RETURN QUERY SELECT true,'already_settled',a.available_credits,a.reserved_credits,o.status,0::bigint,0::bigint; RETURN;
      END IF;
      used := LEAST(GREATEST(COALESCE(p_actual,0),0), o.credit_cost);
      back := o.credit_cost - used;
      meta := o.metadata || jsonb_build_object('usage', COALESCE(p_usage,'{}'::jsonb), 'reservedCredits', o.credit_cost, 'actualCredits', used);
      UPDATE credit_accounts SET reserved_credits=reserved_credits-o.credit_cost, available_credits=available_credits+back,
        lifetime_spent=lifetime_spent+used, lifetime_refunded=lifetime_refunded+back, updated_at=now()
        WHERE user_id=p_user_id RETURNING * INTO a;
      UPDATE credit_operations SET status=CASE WHEN used>0 THEN 'committed' ELSE 'released' END, actual_cost=used, metadata=meta,
        provider_job_id=COALESCE(NULLIF(p_provider_job_id,''),provider_job_id), updated_at=now() WHERE id=o.id;
      IF used>0 THEN
        INSERT INTO credit_transactions(user_id,operation_id,kind,delta_available,delta_reserved,balance_after,reserved_after,metadata)
          VALUES(p_user_id,o.id,'spend',0,-used,a.available_credits,a.reserved_credits+back,meta);
      END IF;
      IF back>0 THEN
        INSERT INTO credit_transactions(user_id,operation_id,kind,delta_available,delta_reserved,balance_after,reserved_after,metadata)
          VALUES(p_user_id,o.id,'refund',back,-back,a.available_credits,a.reserved_credits,meta);
      END IF;
      RETURN QUERY SELECT true,'settled_actual',a.available_credits,a.reserved_credits,CASE WHEN used>0 THEN 'committed' ELSE 'released' END,used,back;
    END $$
  `);
  // 비동기 작업(립싱크 등): 접수 때 공급자 가격이 확정되면 예약액을 그만큼으로 줄이고 차액은 바로 돌려준다.
  // 작업이 끝나면 줄어든 예약액을 확정(commit)하거나 전액 환불(release)한다.
  await sql(`
    CREATE OR REPLACE FUNCTION nk_credit_reduce_reservation(p_user_id text, p_operation_id text, p_new_cost bigint, p_usage jsonb DEFAULT '{}'::jsonb)
    RETURNS TABLE(ok boolean, reason text, available bigint, reserved bigint, refunded bigint)
    LANGUAGE plpgsql AS $$
    DECLARE a credit_accounts%ROWTYPE; o credit_operations%ROWTYPE; newc bigint; back bigint; meta jsonb;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext(p_user_id));
      SELECT * INTO o FROM credit_operations WHERE id=p_operation_id AND user_id=p_user_id LIMIT 1;
      IF NOT FOUND THEN RETURN QUERY SELECT false,'operation_not_found',0::bigint,0::bigint,0::bigint; RETURN; END IF;
      SELECT * INTO a FROM credit_accounts WHERE user_id=p_user_id;
      IF o.status <> 'reserved' THEN RETURN QUERY SELECT true,'already_settled',a.available_credits,a.reserved_credits,0::bigint; RETURN; END IF;
      newc := LEAST(GREATEST(COALESCE(p_new_cost,0),1), o.credit_cost);
      back := o.credit_cost - newc;
      IF back <= 0 THEN RETURN QUERY SELECT true,'unchanged',a.available_credits,a.reserved_credits,0::bigint; RETURN; END IF;
      meta := o.metadata || jsonb_build_object('usage', COALESCE(p_usage,'{}'::jsonb), 'reservedCredits', o.credit_cost, 'actualCredits', newc);
      UPDATE credit_accounts SET available_credits=available_credits+back, reserved_credits=reserved_credits-back,
        lifetime_refunded=lifetime_refunded+back, updated_at=now() WHERE user_id=p_user_id RETURNING * INTO a;
      UPDATE credit_operations SET credit_cost=newc, actual_cost=newc, metadata=meta, updated_at=now() WHERE id=o.id;
      INSERT INTO credit_transactions(user_id,operation_id,kind,delta_available,delta_reserved,balance_after,reserved_after,metadata)
        VALUES(p_user_id,o.id,'refund',back,-back,a.available_credits,a.reserved_credits,meta);
      RETURN QUERY SELECT true,'reduced',a.available_credits,a.reserved_credits,back;
    END $$
  `);
  await sql(`
    CREATE OR REPLACE FUNCTION nk_credit_adjust(p_user_id text, p_actor text, p_delta bigint, p_reason text, p_metadata jsonb)
    RETURNS TABLE(ok boolean, reason text, available bigint, reserved bigint)
    LANGUAGE plpgsql AS $$
    DECLARE a credit_accounts%ROWTYPE; kind_name text;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext(p_user_id));
      INSERT INTO credit_accounts(user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;
      UPDATE credit_accounts SET available_credits=available_credits+p_delta,
        lifetime_granted=lifetime_granted+CASE WHEN p_delta>0 THEN p_delta ELSE 0 END,
        lifetime_revoked=lifetime_revoked+CASE WHEN p_delta<0 THEN -p_delta ELSE 0 END,
        updated_at=now()
        WHERE user_id=p_user_id AND available_credits+p_delta >= 0 RETURNING * INTO a;
      IF NOT FOUND THEN
        SELECT * INTO a FROM credit_accounts WHERE user_id=p_user_id;
        RETURN QUERY SELECT false,'insufficient_available',a.available_credits,a.reserved_credits; RETURN;
      END IF;
      kind_name := CASE WHEN p_delta >= 0 THEN 'admin_grant' ELSE 'admin_revoke' END;
      INSERT INTO credit_transactions(user_id,kind,delta_available,balance_after,reserved_after,actor_user_id,reason,metadata)
        VALUES(p_user_id,kind_name,p_delta,a.available_credits,a.reserved_credits,COALESCE(p_actor,''),COALESCE(p_reason,''),COALESCE(p_metadata,'{}'::jsonb));
      RETURN QUERY SELECT true,kind_name,a.available_credits,a.reserved_credits;
    END $$
  `);
}

export async function ensureCreditSchema(sql: SqlFn): Promise<void> {
  return ensureSchemaOnce(sql, "credits", runCreditSchemaDdl);
}

function requireSql(env: any): SqlFn {
  const sql = getSql(env);
  if (!sql) throw new Error("credit_database_unavailable");
  return sql;
}

export async function getCreditSummary(env: any, userId: string): Promise<CreditSummary> {
  const sql = requireSql(env);
  await ensureCreditSchema(sql);
  await sql("INSERT INTO credit_accounts(user_id) VALUES($1) ON CONFLICT (user_id) DO NOTHING", [userId]);
  const rows = await sql("SELECT * FROM credit_accounts WHERE user_id=$1 LIMIT 1", [userId]);
  const row: any = rows[0] || {};
  const available = asInt(row.available_credits);
  const reserved = asInt(row.reserved_credits);
  return {
    userId,
    available,
    reserved,
    total: available + reserved,
    lifetimeGranted: asInt(row.lifetime_granted),
    lifetimeSpent: asInt(row.lifetime_spent),
    lifetimeRefunded: asInt(row.lifetime_refunded),
    lifetimeRevoked: asInt(row.lifetime_revoked),
  };
}

export async function listCreditTransactions(env: any, userId: string, limit = 30): Promise<any[]> {
  const sql = requireSql(env);
  await ensureCreditSchema(sql);
  return sql(`SELECT id,operation_id,kind,delta_available,delta_reserved,balance_after,reserved_after,actor_user_id,reason,metadata,created_at
              FROM credit_transactions WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2`, [userId, Math.min(200, Math.max(1, limit))]);
}

export async function listAllCreditSummaries(env: any): Promise<CreditSummary[]> {
  const sql = requireSql(env);
  await ensureCreditSchema(sql);
  const rows = await sql("SELECT * FROM credit_accounts ORDER BY user_id");
  return rows.map((row: any) => {
    const available = asInt(row.available_credits);
    const reserved = asInt(row.reserved_credits);
    return {
      userId: String(row.user_id || ""),
      available,
      reserved,
      total: available + reserved,
      lifetimeGranted: asInt(row.lifetime_granted),
      lifetimeSpent: asInt(row.lifetime_spent),
      lifetimeRefunded: asInt(row.lifetime_refunded),
      lifetimeRevoked: asInt(row.lifetime_revoked),
    };
  });
}

export async function adjustCredits(env: any, userId: string, actor: string, delta: number, reason: string): Promise<any> {
  const sql = requireSql(env);
  await ensureCreditSchema(sql);
  const rows = await sql("SELECT * FROM nk_credit_adjust($1,$2,$3,$4,$5::jsonb)", [userId, actor, Math.trunc(delta), reason, JSON.stringify({ source: "admin" })]);
  return rows[0] || { ok: false, reason: "adjust_failed" };
}

async function reserveCredits(env: any, userId: string, quote: any, body: any, request: Request): Promise<any> {
  const sql = requireSql(env);
  await ensureCreditSchema(sql);
  const opId = operationId();
  const headerKey = String(request.headers.get("X-NK-Idempotency-Key") || "").trim();
  const bodyKey = String(body && body.creditIdempotencyKey || "").trim();
  const idem = (headerKey || bodyKey || opId).slice(0, 160);
  const provider = String(body && body.provider || "").slice(0, 80);
  const model = String(body && (body.videoModel || body.model) || "").slice(0, 120);
  const metadata = { basis: quote.basis || {}, testRate: !!quote.testRate };
  const rows = await sql("SELECT * FROM nk_credit_reserve($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)", [
    userId, opId, idem, quote.feature, provider, model, quote.credits, quote.rateCard || "", JSON.stringify(metadata),
  ]);
  return rows[0] || { ok: false, reason: "reserve_failed", operation_id: opId, required: quote.credits };
}

export async function settleCreditOperation(env: any, userId: string, operationIdValue: string, action: "commit" | "release", providerJobId = ""): Promise<any> {
  const sql = requireSql(env);
  await ensureCreditSchema(sql);
  const rows = await sql("SELECT * FROM nk_credit_settle($1,$2,$3,$4)", [userId, operationIdValue, action, providerJobId]);
  return rows[0] || { ok: false, reason: "settle_failed" };
}

export async function settleCreditOperationActual(env: any, userId: string, operationIdValue: string, actualCredits: number, usage: any = {}, providerJobId = ""): Promise<any> {
  const sql = requireSql(env);
  await ensureCreditSchema(sql);
  const rows = await sql("SELECT * FROM nk_credit_settle_actual($1,$2,$3,$4,$5::jsonb)", [userId, operationIdValue, Math.max(0, Math.trunc(actualCredits)), providerJobId, JSON.stringify(usage || {})]);
  return rows[0] || { ok: false, reason: "settle_failed" };
}

/**
 * 핸들러가 공급자 응답에서 읽은 실제 원가(USD)를 크레딧 래퍼에 알려 준다(실제 사용량 정산).
 * 래퍼는 이 헤더를 읽고 지운 뒤 예약액 안에서 실제 크레딧만 차감한다. 헤더가 없으면 예약액 그대로 확정(옛 방식).
 */
export const PROVIDER_COST_HEADER = "X-NK-Provider-Cost";
export async function reduceCreditReservation(env: any, userId: string, operationIdValue: string, newCredits: number, usage: any = {}): Promise<any> {
  const sql = requireSql(env);
  await ensureCreditSchema(sql);
  const rows = await sql("SELECT * FROM nk_credit_reduce_reservation($1,$2,$3,$4::jsonb)", [userId, operationIdValue, Math.max(1, Math.trunc(newCredits)), JSON.stringify(usage || {})]);
  return rows[0] || { ok: false, reason: "reduce_failed" };
}

export function withProviderCost(response: Response, usd: number, usage: Record<string, unknown> = {}): Response {
  const headers = new Headers(response.headers);
  headers.set(PROVIDER_COST_HEADER, JSON.stringify({ usd: Math.max(0, Number(usd) || 0), usage }));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function readProviderCost(response: Response): { usd: number; usage: any } | null {
  const raw = response.headers.get(PROVIDER_COST_HEADER);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    const usd = Number(v && v.usd);
    return Number.isFinite(usd) && usd >= 0 ? { usd, usage: v.usage || {} } : null;
  } catch (_) { return null; }
}

function stripProviderCost(response: Response): Response {
  if (!response.headers.has(PROVIDER_COST_HEADER)) return response;
  const headers = new Headers(response.headers);
  headers.delete(PROVIDER_COST_HEADER);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function attachProviderJob(env: any, userId: string, operationIdValue: string, providerJobId: string): Promise<void> {
  const sql = requireSql(env);
  await ensureCreditSchema(sql);
  await sql("UPDATE credit_operations SET provider_job_id=$3,updated_at=now() WHERE id=$1 AND user_id=$2 AND status='reserved'", [operationIdValue, userId, providerJobId]);
}

async function settleByProviderJob(env: any, userId: string, providerJobId: string, action: "commit" | "release"): Promise<void> {
  const sql = requireSql(env);
  await ensureCreditSchema(sql);
  const rows = await sql("SELECT id FROM credit_operations WHERE user_id=$1 AND provider_job_id=$2 AND status='reserved' ORDER BY created_at DESC LIMIT 1", [userId, providerJobId]);
  if (rows[0]?.id) {
    const r = await settleCreditOperation(env, userId, String(rows[0].id), action, providerJobId);
    if (!r?.ok) console.error('[credit] settle_rejected', providerJobId, action, r?.reason);
  } else {
    // 이미 정산됐거나 작업 번호가 붙지 않은 예약이다. 후자는 reconcile 이 시간이 지나면 환불한다.
    console.log('[credit] no_reserved_operation_for_job', providerJobId, action);
  }
}

function withCreditHeaders(response: Response, operation: any): Response {
  const headers = new Headers(response.headers);
  headers.set("X-NK-Credit-Operation", String(operation.operation_id || operation.operationId || ""));
  headers.set("X-NK-Credits-Remaining", String(operation.available || 0));
  headers.set("X-NK-Credits-Reserved", String(operation.reserved || 0));
  // 실제 사용량으로 정산했으면 실제 차감 크레딧(예약액과 다를 수 있다).
  if (operation.charged !== undefined) headers.set("X-NK-Credits-Charged", String(operation.charged));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// 입력 영상 1개를 받아 길이를 잰다(요금이 입력 길이에 달린 모델: 모션 컨트롤·Grok 연장·Seedance/MiniMax 참조 영상).
// 공급자에게 보낼 바로 그 파일이다. 못 재면 0 을 돌려 요금 계산이 과금·생성을 막게 한다(싸게 잡지 않는다).
const MAX_MEASURE_BYTES = 80 * 1024 * 1024;
// 입력 미디어(data:·gs://·https) 바이트를 받는다. 너무 크거나 못 받으면 null.
async function fetchMediaBytes(src: string, env: any): Promise<Uint8Array | null> {
  const s = String(src || "").trim();
  if (!s) return null;
  if (s.startsWith("data:")) {
    const comma = s.indexOf(",");
    if (comma < 0) return null;
    const bin = atob(s.slice(comma + 1));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  let url = s;
  const headers: Record<string, string> = {};
  if (s.startsWith("gs://")) {
    const parsed = parseGcsUri(s);
    if (!parsed) return null;
    const token = await getGoogleAccessToken({ clientEmail: env.GOOGLE_CLIENT_EMAIL, privateKeyPem: env.GOOGLE_PRIVATE_KEY, scope: "https://www.googleapis.com/auth/devstorage.read_only" });
    url = `https://storage.googleapis.com/download/storage/v1/b/${encodeURIComponent(parsed.bucket)}/o/${encodeURIComponent(parsed.object)}?alt=media`;
    headers.Authorization = `Bearer ${token}`;
  } else if (!/^https:\/\//i.test(s)) {
    return null;
  }
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return null;
  const size = Number(res.headers.get("content-length") || 0);
  if (size > MAX_MEASURE_BYTES) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytes.byteLength > MAX_MEASURE_BYTES ? null : bytes;
}

async function measureVideoSeconds(src: string, env: any): Promise<number> {
  const s = String(src || "").trim();
  if (s.startsWith("data:")) return dataUrlVideoSeconds(s);
  const bytes = await fetchMediaBytes(s, env);
  return bytes ? mp4DurationSeconds(bytes) : 0;
}

/**
 * 과금용 본문: 견적 화면이 보낸 보조 값(개수·길이)을 지우고, video.ts 가 실제로 보낼 입력 영상의 길이를 서버가 재서 채운다.
 * 클라이언트가 적은 길이는 믿지 않는다.
 */
export async function withMeasuredVideoInputs(feature: string, body: any, env: any): Promise<any> {
  if (!body || typeof body !== "object") return body;
  if (String(feature || "") === "video_lipsync") {
    // 립싱크는 음성 길이로 과금된다(Atlas). 오디오 방식이면 올라온 음성 파일 길이를 서버가 잰다.
    const { inputAudioSeconds: _x, ...cleanLip } = body;
    const audioSrc = String(cleanLip.audioDataUrl || cleanLip.audioUrl || "").trim();
    if (String(cleanLip.mode || "") === "text2video" || !audioSrc) return cleanLip;
    const bytes = await fetchMediaBytes(audioSrc, env).catch(() => null);
    return { ...cleanLip, inputAudioSeconds: bytes ? audioDurationSeconds(bytes) : 0 };
  }
  if (String(feature || "") !== "video") return body;
  const { inputVideoSeconds: _s, referenceVideoCount: _c, hasStartImage: _a, hasEndImage: _b, hasAudio: _d, ...clean } = body;
  const sources = videoInputSourcesFor(clean);
  if (!sources.length) return clean;
  let total = 0;
  for (const src of sources) {
    const seconds = await measureVideoSeconds(src, env).catch(() => 0);
    if (!(seconds > 0)) return { ...clean, inputVideoSeconds: 0 };
    total += seconds;
  }
  return { ...clean, inputVideoSeconds: total };
}

export async function withCreditCharge(
  context: any,
  // metered: 이 기능은 공급자가 알려 준 실제 사용량으로 정산한다(usage-cost.ts 계량기). 예약액은 최대치.
  options: { feature: string; deferAccepted?: boolean; metered?: boolean },
  handler: (context: any) => Promise<Response>,
): Promise<Response> {
  const { request, env } = context;
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return handler(context);
  let body: any = {};
  try { body = await request.clone().json(); } catch (_) {}
  const quote: any = quoteCredits(options.feature, await withMeasuredVideoInputs(options.feature, body, env), env);
  // 요금을 정확히 낼 수 없는 요청(모르는 모델·해상도, 재지 못한 입력 영상)은 무료로 통과시키지 않고 막는다.
  if (quote.error) {
    return json({ error: quote.error, message: quote.message || "요금을 계산할 수 없어 생성을 시작하지 않았습니다.", credits: { quote } }, 400, origin);
  }
  if (!quote.credits) return handler(context);
  let reservation: any;
  try {
    reservation = await reserveCredits(env, auth.userId, quote, body, request);
  } catch (e: any) {
    return json({ error: "credit_service_unavailable", message: "크레딧 서비스를 확인할 수 없어 생성을 시작하지 않았습니다.", detail: String(e?.message || e) }, 503, origin);
  }
  if (!reservation.ok) {
    const insufficient = reservation.reason === "insufficient";
    const duplicate = String(reservation.reason || "").startsWith("duplicate_");
    return json({
      error: insufficient ? "credit_insufficient" : duplicate ? "credit_duplicate_request" : "credit_reservation_rejected",
      message: insufficient
        ? `이 작업은 ${quote.credits} C가 필요하지만 현재 ${asInt(reservation.available)} C를 사용할 수 있습니다.`
        : duplicate
          ? "이미 처리 중이거나 처리 완료된 동일 요청입니다. 중복 생성을 시작하지 않았습니다."
          : "크레딧 예약을 완료할 수 없어 생성을 시작하지 않았습니다.",
      credits: { required: quote.credits, available: asInt(reservation.available), reserved: asInt(reservation.reserved), quote },
    }, insufficient ? 429 : 409, origin);
  }
  // 실제 사용량 계량기: 핸들러와 그 아래 공급자 호출 함수가 env 로 받아 원가를 기록한다.
  const meter: CostMeter | null = options.metered ? createCostMeter() : null;
  try {
    const response = await handler(meter ? { ...context, env: withCostMeter(env, meter) } : context);
    if (response.ok && options.deferAccepted) {
      let providerJobId = "";
      try {
        const data: any = await response.clone().json();
        providerJobId = String(data?.jobId || data?.job_id || data?.id || data?.operationName || "");
      } catch (_) {}
      // 작업 번호가 없으면 공급자에 과금될 작업이 없다(접수 실패·검열 거부 포함) → 확정하지 않고 환불한다.
      if (providerJobId) {
        await attachProviderJob(env, auth.userId, String(reservation.operation_id), providerJobId);
        // 계량하는 비동기 작업: 접수 때 공급자 가격이 확정됐으면 예약액을 그만큼으로 줄인다(차액 즉시 환불).
        // 작업 완료 시 줄어든 금액이 확정되고, 실패하면 전액 환불된다(상태 조회·서버 정산).
        if (meter && !meter.unpriced && meter.usd > 0) {
          const actual = creditsForUsd(meter.usd);
          const reduced = await reduceCreditReservation(env, auth.userId, String(reservation.operation_id), actual, { calls: meter.items, providerUsd: meter.usd });
          reservation = { ...reservation, available: reduced?.available ?? reservation.available, reserved: reduced?.reserved ?? reservation.reserved, charged: actual };
        }
      } else {
        await settleCreditOperation(env, auth.userId, String(reservation.operation_id), "release");
      }
    } else if (!response.ok) {
      await settleCreditOperation(env, auth.userId, String(reservation.operation_id), "release");
    } else {
      // 공급자가 알려 준 실제 사용량이 있으면 그 원가로 정산(차액 환불), 없으면 예약액 그대로 확정.
      // 계량 기능은 공급자 호출이 하나도 성공하지 않았으면 0원 → 전액 환불(200 으로 오류를 돌려주는 경로 포함).
      // 단가를 확인하지 못한 유료 호출이 섞였으면 추측하지 않고 예약액 그대로 확정한다.
      const cost = meter && !meter.unpriced ? { usd: meter.usd, usage: { calls: meter.items } } : (meter ? null : readProviderCost(response));
      if (meter && meter.unpriced) console.log('[credit] metered_unpriced_commit_reserved', options.feature, JSON.stringify(meter.items).slice(0, 500));
      if (cost) {
        const actual = creditsForUsd(cost.usd);
        const settled = await settleCreditOperationActual(env, auth.userId, String(reservation.operation_id), actual, { ...cost.usage, providerUsd: cost.usd });
        reservation = { ...reservation, available: settled?.available ?? reservation.available, reserved: settled?.reserved ?? reservation.reserved, charged: actual };
      } else {
        await settleCreditOperation(env, auth.userId, String(reservation.operation_id), "commit");
      }
    }
    return withCreditHeaders(stripProviderCost(response), reservation);
  } catch (e) {
    await settleCreditOperation(env, auth.userId, String(reservation.operation_id), "release").catch(() => null);
    throw e;
  }
}

export async function settleDeferredCreditFromResponse(env: any, userId: string, providerJobId: string, response: Response): Promise<void> {
  if (!providerJobId || !response.ok) return;
  let data: any = null;
  try { data = await response.clone().json(); } catch (_) { return; }
  const status = String(data?.status || data?.state || "").toLowerCase();
  const failed = status === "error" || status === "failed" || status === "cancelled" || status === "canceled" || !!(data?.done && data?.error);
  const done = data?.done === true || ["done", "completed", "succeeded", "success", "ready", "done_no_output"].includes(status);
  if (failed) await settleByProviderJob(env, userId, providerJobId, "release");
  else if (done) await settleByProviderJob(env, userId, providerJobId, "commit");
}
