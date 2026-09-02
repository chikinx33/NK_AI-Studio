import { authorizeRequest } from "./auth.js";
import { getSql, type SqlFn } from "../knowledge/_shared";
import { quoteCredits } from "./credit-rates.js";

let schemaReady = false;
let schemaPromise: Promise<void> | null = null;

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

export async function ensureCreditSchema(sql: SqlFn): Promise<void> {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
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
    schemaReady = true;
  })().finally(() => { schemaPromise = null; });
  return schemaPromise;
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

async function attachProviderJob(env: any, userId: string, operationIdValue: string, providerJobId: string): Promise<void> {
  const sql = requireSql(env);
  await ensureCreditSchema(sql);
  await sql("UPDATE credit_operations SET provider_job_id=$3,updated_at=now() WHERE id=$1 AND user_id=$2 AND status='reserved'", [operationIdValue, userId, providerJobId]);
}

async function settleByProviderJob(env: any, userId: string, providerJobId: string, action: "commit" | "release"): Promise<void> {
  const sql = requireSql(env);
  await ensureCreditSchema(sql);
  const rows = await sql("SELECT id FROM credit_operations WHERE user_id=$1 AND provider_job_id=$2 AND status='reserved' ORDER BY created_at DESC LIMIT 1", [userId, providerJobId]);
  if (rows[0]?.id) await settleCreditOperation(env, userId, String(rows[0].id), action, providerJobId);
}

function withCreditHeaders(response: Response, operation: any): Response {
  const headers = new Headers(response.headers);
  headers.set("X-NK-Credit-Operation", String(operation.operation_id || operation.operationId || ""));
  headers.set("X-NK-Credits-Remaining", String(operation.available || 0));
  headers.set("X-NK-Credits-Reserved", String(operation.reserved || 0));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function withCreditCharge(
  context: any,
  options: { feature: string; deferAccepted?: boolean },
  handler: (context: any) => Promise<Response>,
): Promise<Response> {
  const { request, env } = context;
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return handler(context);
  let body: any = {};
  try { body = await request.clone().json(); } catch (_) {}
  const quote = quoteCredits(options.feature, body, env);
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
  try {
    const response = await handler(context);
    if (response.ok && options.deferAccepted) {
      let providerJobId = "";
      try {
        const data: any = await response.clone().json();
        providerJobId = String(data?.jobId || data?.job_id || data?.id || data?.operationName || "");
      } catch (_) {}
      if (providerJobId) await attachProviderJob(env, auth.userId, String(reservation.operation_id), providerJobId);
      else await settleCreditOperation(env, auth.userId, String(reservation.operation_id), "commit");
    } else {
      await settleCreditOperation(env, auth.userId, String(reservation.operation_id), response.ok ? "commit" : "release");
    }
    return withCreditHeaders(response, reservation);
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
