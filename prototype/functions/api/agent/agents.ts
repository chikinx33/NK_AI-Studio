// prototype/functions/api/agent/agents.ts
// GET /api/agent/agents — 라비오크 AgentInfo[] 계약(11인 로스터). 사이드바·직원관리용.
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, AGENT_TOOLS, canUseRaviokHq } from "./_shared";
import { ROSTER } from "./_orchestrator";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  // 에이전트별 도구 = AGENT_TOOLS 레지스트리에서 소유한 것.
  // 게임 대시보드(raviok_hq)는 엔케 본인 계정에서만 보인다.
  const hqVisible = await canUseRaviokHq(env, auth.userId);
  const toolsByAgent: Record<string, string[]> = {};
  for (const [name, def] of Object.entries(AGENT_TOOLS)) {
    if (name === "raviok_hq" && !hqVisible) continue;
    (toolsByAgent[def.agentId] = toolsByAgent[def.agentId] || []).push(name);
  }
  const items = ROSTER.map((a) => ({
    id: a.id, emoji: a.emoji, name: a.name, role: a.role,
    hasTools: !!toolsByAgent[a.id], tools: toolsByAgent[a.id] || [],
  }));
  return send(items, 200, origin);
};
