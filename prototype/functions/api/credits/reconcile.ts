// POST /api/credits/reconcile — 예약된 크레딧을 공급자 결과로 정산한다(_shared/credit-reconcile.ts).
//  - 로그인 회원: 자기 예약만. 결과 상세를 돌려준다(AI 영상 페이지가 열릴 때 부른다).
//  - 정기 실행(GitHub Actions, ACCOUNT_CLEANUP_TOKEN): 전체 회원. 공개 저장소의 실행 로그에 남으므로 건수만 돌려준다.
import { authorizeRequest } from "../_shared/auth.js";
import { getCreditSummary } from "../_shared/credits";
import { reconcileReservedCredits } from "../_shared/credit-reconcile";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const headers = (origin: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const send = (data: any, status: number, origin: string | null) => new Response(JSON.stringify(data), { status, headers: headers(origin) });

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const bearer = String(request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  const cronToken = String(env.ACCOUNT_CLEANUP_TOKEN || "").trim();
  try {
    if (cronToken && bearer && (await sha256(bearer)) === (await sha256(cronToken))) {
      const r = await reconcileReservedCredits(env, { limit: 12 });
      return send({ ok: true, scope: "all", checked: r.checked, committed: r.committed, released: r.released, pending: r.pending }, 200, origin);
    }
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const r = await reconcileReservedCredits(env, { userId: auth.userId, limit: 8 });
    return send({ ok: true, scope: "self", ...r, summary: await getCreditSummary(env, auth.userId) }, 200, origin);
  } catch (e: any) {
    // 처리 안 된 예외는 Cloudflare 1101(본문 없음)이 된다. 항상 JSON 으로 이유를 돌려준다.
    return send({ error: "credit_reconcile_failed", detail: String(e?.message || e).slice(0, 300) }, 503, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) => new Response(null, { status: 204, headers: headers(request.headers.get("Origin")) });
