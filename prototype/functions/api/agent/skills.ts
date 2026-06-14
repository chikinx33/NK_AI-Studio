// prototype/functions/api/agent/skills.ts
// 헤르메스 스킬 조회·관리 UI 백엔드. ★ user_id 격리.
//   GET  /api/agent/skills                 → { active:[...], archived:[...] }
//   GET  /api/agent/skills?name=NAME       → { skill: {name,category,description,content,...} }
//   POST /api/agent/skills { action:"delete"|"pin"|"unpin"|"restore", name }
import { authorizeRequest } from "../_shared/auth.js";
import {
  send, corsHeaders, getSql, ensureAgentSchema,
  listSkills, getSkill, deleteSkill, setPinSkill, restoreSkill, listArchivedSkills,
} from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const sql = getSql(env);
  if (!sql) return send({ active: [], archived: [] }, 200, origin);
  await ensureAgentSchema(sql);
  const name = new URL(request.url).searchParams.get("name");
  if (name) {
    const skill = await getSkill(sql, auth.userId, name);
    return send({ skill }, 200, origin);
  }
  const [active, archived] = await Promise.all([
    listSkills(sql, auth.userId),
    listArchivedSkills(sql, auth.userId),
  ]);
  return send({ active, archived }, 200, origin);
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const sql = getSql(env);
  if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
  await ensureAgentSchema(sql);
  const body = await request.json().catch(() => ({} as any));
  const action = String(body?.action || "").trim();
  const name = String(body?.name || "").trim();
  if (!name) return send({ error: "name required" }, 400, origin);
  if (action === "delete") await deleteSkill(sql, auth.userId, name);
  else if (action === "pin") await setPinSkill(sql, auth.userId, name, true);
  else if (action === "unpin") await setPinSkill(sql, auth.userId, name, false);
  else if (action === "restore") await restoreSkill(sql, auth.userId, name);
  else return send({ error: "unknown action" }, 400, origin);
  return send({ ok: true }, 200, origin);
};
