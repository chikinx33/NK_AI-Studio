// prototype/functions/api/agent/conversation-title.ts
// POST /api/agent/conversation-title { conversationId, title } — 대화(날짜) 커스텀 제목 저장. ★ user_id 격리.
// 빈 title 이면 커스텀 제목 삭제(기본 날짜 제목으로 복귀).
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, setConversationTitle } from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const body = await request.json().catch(() => ({} as any));
  const conversationId = String(body?.conversationId || "").trim();
  const title = String(body?.title ?? "");
  if (!conversationId) return send({ error: "conversationId required" }, 400, origin);
  const sql = getSql(env);
  if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
  await ensureAgentSchema(sql);
  const ok = await setConversationTitle(sql, auth.userId, conversationId, title);
  return send({ ok, title: title.trim() || conversationId }, 200, origin);
};
