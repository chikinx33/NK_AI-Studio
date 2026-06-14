// prototype/functions/api/agent/knowledge-graph.ts
// GET /api/agent/knowledge-graph — 회사 지식을 그래프 노드로. ★ user_id 격리.
// (Phase 3: edges=임베딩 유사도는 후속. 지금은 노드만, edges 빈.)
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, listCompanyKnowledge } from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const sql = getSql(env);
  if (!sql) return send({ nodes: [], edges: [] }, 200, origin);
  await ensureAgentSchema(sql);
  const items = await listCompanyKnowledge(sql, auth.userId);
  const nodes = items.map((k, i) => ({ id: i, text: k.text, origin: k.source, type: k.type, degree: 0 }));
  return send({ nodes, edges: [] }, 200, origin);
};
