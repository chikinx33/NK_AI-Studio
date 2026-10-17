import { authorizeRequest } from "../_shared/auth.js";
import { getCreditSummary, listCreditTransactions } from "../_shared/credits";
import { resourceOwnerId } from "../_shared/admin-users";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const headers = (origin: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
});

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: headers(origin) });
  try {
    // 마스터 자원 공유 계정은 마스터 잔액을 보여 준다. summary.userId 는 디렉터가 신원으로 쓰므로 본인 ID 로 둔다.
    const owner = await resourceOwnerId(env, auth.userId);
    const summary = { ...await getCreditSummary(env, owner), userId: auth.userId };
    const transactions = await listCreditTransactions(env, owner, 30);
    return new Response(JSON.stringify({ configured: true, summary, transactions }), { status: 200, headers: headers(origin) });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: "credit_service_unavailable", detail: String(e?.message || e) }), { status: 503, headers: headers(origin) });
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) => new Response(null, { status: 204, headers: headers(request.headers.get("Origin")) });
