// 회사 업무 탐색기의 날짜 폴더 표시 이름을 관리한다.
// 실제 날짜 키와 GCS 경로는 그대로 두고 표시 이름만 분리해 안전하게 이름을 바꾼다.
import { authorizeRequest } from "../_shared/auth.js";
import { corsHeaders, ensureAgentSchema, getSql, send } from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

function validDateKey(value: unknown) {
  const dateKey = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : "";
}

function validTitle(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 60);
}

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
    await ensureAgentSchema(sql);
    const rows = await sql(
      "SELECT date_key, title, updated_at FROM company_work_folders WHERE user_id = $1 ORDER BY date_key DESC",
      [auth.userId],
    );
    return send({ folders: rows }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "업무 폴더 조회 실패") }, 500, origin);
  }
};

export const onRequestPatch: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const body: any = await request.json().catch(() => ({}));
    const dateKey = validDateKey(body?.dateKey);
    const title = validTitle(body?.title);
    if (!dateKey || !title) return send({ error: "날짜 폴더와 새 이름을 확인해 주세요." }, 400, origin);
    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
    await ensureAgentSchema(sql);
    const exists = await sql(
      "SELECT 1 FROM company_work_items WHERE user_id = $1 AND (created_at AT TIME ZONE 'Asia/Seoul')::date = $2::date LIMIT 1",
      [auth.userId, dateKey],
    );
    if (!exists.length) return send({ error: "이 날짜의 업무 폴더를 찾지 못했습니다." }, 404, origin);
    await sql(
      `INSERT INTO company_work_folders (user_id, date_key, title) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, date_key) DO UPDATE SET title = EXCLUDED.title, updated_at = now()`,
      [auth.userId, dateKey, title],
    );
    return send({ folder: { date_key: dateKey, title } }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "업무 폴더 이름 변경 실패") }, 500, origin);
  }
};

export const onRequestDelete: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const body: any = await request.json().catch(() => ({}));
    const dateKey = validDateKey(body?.dateKey);
    if (!dateKey) return send({ error: "삭제할 날짜 폴더를 확인해 주세요." }, 400, origin);
    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
    await ensureAgentSchema(sql);
    const rows = await sql(
      "DELETE FROM company_work_folders WHERE user_id = $1 AND date_key = $2 RETURNING date_key",
      [auth.userId, dateKey],
    );
    return send({ deletedCount: rows.length }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "업무 폴더 정보 삭제 실패") }, 500, origin);
  }
};
