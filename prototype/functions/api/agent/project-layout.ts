// POST /api/agent/project-layout — 프로젝트 카드 접힘·순서 UI 상태 저장. ★ user_id 격리.
import { authorizeRequest } from "../_shared/auth.js";
import {
  send,
  corsHeaders,
  getSql,
  ensureAgentSchema,
  listProjects,
  reorderProjectsByIds,
  setProjectCollapsedById,
} from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const body = await request.json().catch(() => ({} as any));
  const action = String(body?.action || "").trim();
  const sql = getSql(env);
  if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
  await ensureAgentSchema(sql);

  if (action === "collapse") {
    const projectId = String(body?.projectId || "").trim();
    if (!projectId || typeof body?.collapsed !== "boolean") {
      return send({ error: "projectId and collapsed required" }, 400, origin);
    }
    const ok = await setProjectCollapsedById(sql, auth.userId, projectId, body.collapsed);
    return send({ ok, projects: await listProjects(sql, auth.userId) }, ok ? 200 : 404, origin);
  }

  if (action === "reorder") {
    const projectIds = Array.isArray(body?.projectIds)
      ? body.projectIds.map((id: unknown) => String(id).trim()).filter(Boolean)
      : [];
    if (!projectIds.length) return send({ error: "projectIds required" }, 400, origin);
    const ok = await reorderProjectsByIds(sql, auth.userId, projectIds);
    return send({ ok, projects: await listProjects(sql, auth.userId) }, ok ? 200 : 400, origin);
  }

  return send({ error: "unsupported action" }, 400, origin);
};
