// prototype/functions/api/agent/persona.ts
// PUT /api/agent/persona { id, prompt } — 직원 페르소나 편집(사용자별 오버라이드). ★ user_id 격리.
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, setAgentPersona } from "./_shared";
import { getAgent } from "./_orchestrator";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPut: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const body = await request.json().catch(() => ({} as any));
  const id = String(body?.id || "").trim();
  const prompt = String(body?.prompt || "");
  if (!getAgent(id)) return send({ error: "unknown agent" }, 400, origin);

  const sql = getSql(env);
  if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
  await ensureAgentSchema(sql);
  await setAgentPersona(sql, auth.userId, id, prompt);
  return send({ ok: true }, 200, origin);
};
