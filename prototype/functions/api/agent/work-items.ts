// 회사 업무 라이브러리. 모든 업무 유형을 같은 레코드로 탐색한다.
import { authorizeRequest } from "../_shared/auth.js";
import { corsHeaders, ensureAgentSchema, getSql, send } from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
    await ensureAgentSchema(sql);
    const id = new URL(request.url).searchParams.get("id")?.trim();
    const rows = id
      ? await sql("SELECT * FROM company_work_items WHERE user_id = $1 AND id = $2 LIMIT 1", [auth.userId, id])
      : await sql("SELECT * FROM company_work_items WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500", [auth.userId]);
    return send({ items: rows }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "업무 목록 조회 실패") }, 500, origin);
  }
};

export const onRequestDelete: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const body: any = await request.json().catch(() => ({}));
    const ids = (Array.isArray(body?.ids) ? body.ids : [body?.id]).map((v: any) => String(v || "").trim()).filter(Boolean).slice(0, 100);
    if (!ids.length) return send({ error: "삭제할 업무를 선택해 주세요." }, 400, origin);
    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
    await ensureAgentSchema(sql);
    const rows = await sql("DELETE FROM company_work_items WHERE user_id = $1 AND id = ANY($2::uuid[]) RETURNING id", [auth.userId, ids]);
    return send({ deletedCount: rows.length }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "업무 삭제 실패") }, 500, origin);
  }
};
