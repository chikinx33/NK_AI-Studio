import { authorizeRequest } from "../_shared/auth.js";
import { quoteCredits, publicCreditRates } from "../_shared/credit-rates.js";
import { getCreditSummary } from "../_shared/credits";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const responseHeaders = (origin: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: responseHeaders(origin) });
  const body: any = await request.json().catch(() => ({}));
  const quote = quoteCredits(String(body.feature || ""), body.input || {}, env);
  try {
    const summary = await getCreditSummary(env, auth.userId);
    return new Response(JSON.stringify({ quote, summary, rateCard: publicCreditRates(env) }), { status: 200, headers: responseHeaders(origin) });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: "credit_service_unavailable", detail: String(e?.message || e) }), { status: 503, headers: responseHeaders(origin) });
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) => new Response(null, { status: 204, headers: responseHeaders(request.headers.get("Origin")) });
