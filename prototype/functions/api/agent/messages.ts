// prototype/functions/api/agent/messages.ts
// GET /api/agent/messages?conversationId=main — 단톡방 메시지 폴링. ★ user_id 격리.
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, listMessages, sweepDanglingMessages } from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
    await ensureAgentSchema(sql);

    const conversationId = (new URL(request.url).searchParams.get("conversationId") || "main").trim() || "main";
    // 결과가 못 붙은 진행 안내("…조회 중이에요…")를 먼저 마무리 문구로 정리 — 히스토리가 미완으로 남지 않게.
    await sweepDanglingMessages(sql, auth.userId, conversationId).catch(() => 0);
    const items = await listMessages(sql, auth.userId, conversationId);
    return send({ ok: true, conversationId, items }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "메시지 조회 중 오류" }, 500, origin);
  }
};
