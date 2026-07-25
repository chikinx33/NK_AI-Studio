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

export const onRequestPatch: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const body: any = await request.json().catch(() => ({}));
    const id = String(body?.id || "").trim();
    const title = String(body?.title || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const status = ["working", "completed", "error"].includes(String(body?.status || "")) ? String(body.status) : "";
    if (!/^[0-9a-f-]{36}$/i.test(id) || (!title && !status)) return send({ error: "변경할 업무 정보가 필요합니다." }, 400, origin);
    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
    await ensureAgentSchema(sql);
    const rows = title && status
      ? await sql("UPDATE company_work_items SET title = $3, status = $4, completed_at = CASE WHEN $4 = 'completed' THEN COALESCE(completed_at, now()) ELSE completed_at END, updated_at = now() WHERE user_id = $1 AND id = $2 RETURNING *", [auth.userId, id, title, status])
      : title
        ? await sql("UPDATE company_work_items SET title = $3, updated_at = now() WHERE user_id = $1 AND id = $2 RETURNING *", [auth.userId, id, title])
        : await sql("UPDATE company_work_items SET status = $3, completed_at = CASE WHEN $3 = 'completed' THEN COALESCE(completed_at, now()) ELSE completed_at END, updated_at = now() WHERE user_id = $1 AND id = $2 RETURNING *", [auth.userId, id, status]);
    if (!rows.length) return send({ error: "업무 문서를 찾지 못했습니다." }, 404, origin);
    return send({ item: rows[0] }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "업무 이름 변경 실패") }, 500, origin);
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
    const targets = await sql(
      "SELECT id, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS date_key FROM company_work_items WHERE user_id = $1 AND id = ANY($2::uuid[])",
      [auth.userId, ids],
    );
    const authHeader = String(request.headers.get("Authorization") || "");
    const cookie = String(request.headers.get("Cookie") || "");
    const headers: Record<string, string> = { ...(authHeader ? { Authorization: authHeader } : {}), ...(cookie ? { Cookie: cookie } : {}) };
    for (const target of targets) {
      const query = new URLSearchParams({ date: String(target.date_key || ""), workId: String(target.id), sign: "0" });
      const listResponse = await fetch(new URL(`/api/agent/agent-video-storage?${query}`, request.url), { headers });
      const listData: any = await listResponse.json().catch(() => ({}));
      if (!listResponse.ok) throw new Error(listData?.error || "업무 저장 파일을 조회하지 못했습니다.");
      const names = (Array.isArray(listData?.items) ? listData.items : []).map((item: any) => String(item?.objectName || "")).filter(Boolean);
      for (let index = 0; index < names.length; index += 100) {
        const deleteResponse = await fetch(new URL("/api/agent/agent-video-storage", request.url), {
          method: "DELETE",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ objectNames: names.slice(index, index + 100) }),
        });
        const deleteData: any = await deleteResponse.json().catch(() => ({}));
        if (!deleteResponse.ok) throw new Error(deleteData?.error || "업무 저장 파일을 삭제하지 못했습니다.");
      }
    }
    await sql("DELETE FROM company_skill_jobs WHERE user_id = $1 AND work_item_id = ANY($2::uuid[])", [auth.userId, ids]);
    const rows = await sql("DELETE FROM company_work_items WHERE user_id = $1 AND id = ANY($2::uuid[]) RETURNING id", [auth.userId, ids]);
    await sql(`DELETE FROM company_work_folders folder WHERE folder.user_id = $1 AND NOT EXISTS (
      SELECT 1 FROM company_work_items item WHERE item.user_id = folder.user_id AND (item.created_at AT TIME ZONE 'Asia/Seoul')::date = folder.date_key::date
    )`, [auth.userId]);
    return send({ deletedCount: rows.length }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "업무 삭제 실패") }, 500, origin);
  }
};
