// /api/agent/motion-examples — 인포그래픽 영상 "실례로 저장"(감독이 다음 영상에서 참고)
//   GET              → { examples: [{ id, title, aspectRatio, createdAt, size }] }
//   POST { workId, title, html } → { example }
//   DELETE ?id=      → { ok }
import { authorizeRequest } from "../_shared/auth.js";
import { corsHeaders, getSql, send } from "./_shared";
import { MOTION_EXAMPLE_MAX_CHARS, ensureMotionExamplesSchema, listMotionExamples } from "./_motion-examples";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

const toDto = (row: any) => ({
  id: String(row.id), workId: row.work_id || null, title: String(row.title || ""),
  aspectRatio: row.aspect_ratio || null, createdAt: row.created_at, size: Number(row.size || 0),
});

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const who = await authorizeRequest(request, env);
  if (!who.ok) return send({ error: who.error }, who.status, origin);
  const sql = getSql(env);
  if (!sql) return send({ error: "DB를 사용할 수 없습니다." }, 503, origin);
  return send({ examples: (await listMotionExamples(sql, who.userId)).map(toDto) }, 200, origin);
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const who = await authorizeRequest(request, env);
  if (!who.ok) return send({ error: who.error }, who.status, origin);
  const body: any = await request.json().catch(() => ({}));
  const workId = String(body?.workId || "");
  const html = String(body?.html || "");
  if (!/^[0-9a-f-]{36}$/i.test(workId)) return send({ error: "workId가 필요합니다." }, 400, origin);
  if (!html || html.length > MOTION_EXAMPLE_MAX_CHARS || !/async\s+function\s+seek\s*\(/.test(html)) {
    return send({ error: "저장할 장면 코드가 올바르지 않습니다." }, 400, origin);
  }
  const sql = getSql(env);
  if (!sql) return send({ error: "DB를 사용할 수 없습니다." }, 503, origin);
  const work = await sql("SELECT metadata FROM company_work_items WHERE id = $1 AND user_id = $2 LIMIT 1", [workId, who.userId]);
  if (!work[0]) return send({ error: "회사 업무를 찾지 못했습니다." }, 404, origin);
  await ensureMotionExamplesSchema(sql);
  const title = String(body?.title || work[0]?.metadata?.spec?.title || "").slice(0, 120);
  const aspectRatio = String(work[0]?.metadata?.input?.aspectRatio || "").slice(0, 8) || null;
  const rows = await sql(
    `INSERT INTO motion_examples (user_id, work_id, title, aspect_ratio, html) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, work_id, title, aspect_ratio, created_at, length(html) AS size`,
    [who.userId, workId, title, aspectRatio, html],
  );
  return send({ example: toDto(rows[0]) }, 200, origin);
};

export const onRequestDelete: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const who = await authorizeRequest(request, env);
  if (!who.ok) return send({ error: who.error }, who.status, origin);
  const id = String(new URL(request.url).searchParams.get("id") || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return send({ error: "id가 필요합니다." }, 400, origin);
  const sql = getSql(env);
  if (!sql) return send({ error: "DB를 사용할 수 없습니다." }, 503, origin);
  await ensureMotionExamplesSchema(sql);
  await sql("DELETE FROM motion_examples WHERE id = $1 AND user_id = $2", [id, who.userId]);
  return send({ ok: true }, 200, origin);
};
