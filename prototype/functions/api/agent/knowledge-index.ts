// prototype/functions/api/agent/knowledge-index.ts
// POST /api/agent/knowledge-index — 밀린 회사 지식 색인(단어 조각·의미 벡터)을 채운다. ★ user_id 격리.
// 대화(chat.ts)가 응답을 끝낸 뒤 호출 1번으로 넘긴다. 대화 요청 안에서 직접 채우면 DB·임베딩 호출이
// 대화의 Worker 서브요청 한도(무료 플랜 요청당 50번)를 함께 깎기 때문에 별도 요청으로 뗐다.
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema } from "./_shared";
import { indexStaleCompanyKnowledge } from "./_knowledge-index";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const sql = getSql(env);
  if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
  try {
    await ensureAgentSchema(sql);
    const result = await indexStaleCompanyKnowledge(env, sql, auth.userId, { limit: 100, timeoutMs: 8000 });
    return send({ ok: true, ...result }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "지식 색인 실패") }, 500, origin);
  }
};
