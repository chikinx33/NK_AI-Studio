import { authorizeRequest } from "../_shared/auth.js";
import { requireMaster } from "../_shared/admin-users.js";
import { adjustCredits, getCreditSummary, listAllCreditSummaries, listCreditTransactions } from "../_shared/credits";
import { sanitizeUserId } from "../_shared/storage.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const headers = (origin: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-NK-Idempotency-Key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
});
const send = (data: any, status: number, origin: string | null) => new Response(JSON.stringify(data), { status, headers: headers(origin) });

async function master(request: Request, env: any) {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return { error: send({ error: auth.error }, auth.status, request.headers.get("Origin")) };
  if (!requireMaster(env, auth.userId)) return { error: send({ error: "master_required" }, 403, request.headers.get("Origin")) };
  return { auth };
}

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const guard: any = await master(request, env);
  if (guard.error) return guard.error;
  const url = new URL(request.url);
  const rawUserId = String(url.searchParams.get("userId") || "").trim();
  try {
    if (!rawUserId) return send({ accounts: await listAllCreditSummaries(env) }, 200, origin);
    const userId = sanitizeUserId(rawUserId);
    return send({ summary: await getCreditSummary(env, userId), transactions: await listCreditTransactions(env, userId, 100) }, 200, origin);
  } catch (e: any) {
    return send({ error: "credit_service_unavailable", detail: String(e?.message || e) }, 503, origin);
  }
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const guard: any = await master(request, env);
  if (guard.error) return guard.error;
  const body: any = await request.json().catch(() => ({}));
  const rawUserId = String(body.userId || "").trim();
  if (!rawUserId) return send({ error: "user_id_required" }, 400, origin);
  const userId = sanitizeUserId(rawUserId);
  if (userId === "owner" && rawUserId.toLowerCase() !== "owner") return send({ error: "invalid_user_id" }, 400, origin);
  const amount = Math.trunc(Number(body.amount) || 0);
  const action = String(body.action || "grant").toLowerCase();
  const reason = String(body.reason || "").trim().slice(0, 240);
  if (action !== "grant" && action !== "revoke") return send({ error: "invalid_credit_action" }, 400, origin);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000000) return send({ error: "invalid_credit_amount" }, 400, origin);
  if (!reason) return send({ error: "credit_reason_required" }, 400, origin);
  const delta = action === "revoke" ? -amount : amount;
  try {
    const result = await adjustCredits(env, userId, guard.auth.userId, delta, reason);
    if (!result.ok) return send({ error: result.reason || "credit_adjust_failed", result }, 409, origin);
    return send({ ok: true, result, summary: await getCreditSummary(env, userId), transactions: await listCreditTransactions(env, userId, 100) }, 200, origin);
  } catch (e: any) {
    return send({ error: "credit_service_unavailable", detail: String(e?.message || e) }, 503, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) => new Response(null, { status: 204, headers: headers(request.headers.get("Origin")) });
