// prototype/functions/api/agent/conversations.ts
// GET /api/agent/conversations → 대화(날짜) 목록 [{id,title,count,createdAt,updatedAt}]. ★ user_id 격리.
// 홈 대시보드 캘린더 점·리스트용.
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, listConversations } from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const sql = getSql(env);
  if (!sql) return send([], 200, origin);
  await ensureAgentSchema(sql);
  return send(await listConversations(sql, auth.userId), 200, origin);
};
