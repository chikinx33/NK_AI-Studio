// prototype/functions/api/agent/detail.ts
// GET /api/agent/detail?id=<agentId> — 라비오크 AgentBrain 계약(직원 관리 화면).
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, getAgentPersona, listAgentKnowledge } from "./_shared";
import { getAgent, AGENT_PERSONAS } from "./_orchestrator";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const id = new URL(request.url).searchParams.get("id") || "";
  const meta = getAgent(id);
  if (!meta) return send({ error: "not_found" }, 404, origin);

  const sql = getSql(env);
  let prompt = AGENT_PERSONAS[id] || "";
  let memory = "";
  if (sql) {
    await ensureAgentSchema(sql);
    prompt = (await getAgentPersona(sql, auth.userId, id)) || prompt;
    const k = await listAgentKnowledge(sql, auth.userId, id);
    memory = k.map((x) => `- ${x.text}`).join("\n");
  }
  return send({ meta, prompt, memory, goal: "" }, 200, origin);
};
