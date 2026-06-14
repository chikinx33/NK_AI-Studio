// prototype/functions/api/agent/knowledge.ts
// GET    /api/agent/knowledge?id=<agentId>     — 직원 개인 지식 목록
// POST   /api/agent/knowledge { id, text, type } — 추가
// DELETE /api/agent/knowledge { id, text }       — 삭제
// ★ user_id 격리. 직원 발언 시 두뇌(speak)에 항상 주입됨.
import { authorizeRequest } from "../_shared/auth.js";
import {
  send, corsHeaders, getSql, ensureAgentSchema,
  listAgentKnowledge, addAgentKnowledgeRow, removeAgentKnowledgeRow,
} from "./_shared";
import { getAgent } from "./_orchestrator";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!getAgent(id)) return send([], 200, origin);
  const sql = getSql(env);
  if (!sql) return send([], 200, origin);
  await ensureAgentSchema(sql);
  const rows = await listAgentKnowledge(sql, auth.userId, id);
  // 라비오크 KnowledgeItem 계약: { text, source, type }
  return send(rows.map((r) => ({ text: r.text, source: "수동", type: r.type })), 200, origin);
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const body = await request.json().catch(() => ({} as any));
  const id = String(body?.id || "").trim();
  const text = String(body?.text || "").trim();
  const type = String(body?.type || "사실").trim();
  if (!getAgent(id) || !text) return send({ error: "id and text required" }, 400, origin);
  const sql = getSql(env);
  if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
  await ensureAgentSchema(sql);
  await addAgentKnowledgeRow(sql, auth.userId, id, text, type);
  return send({ ok: true }, 200, origin);
};

export const onRequestDelete: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const body = await request.json().catch(() => ({} as any));
  const id = String(body?.id || "").trim();
  const text = String(body?.text || "").trim();
  if (!getAgent(id) || !text) return send({ error: "id and text required" }, 400, origin);
  const sql = getSql(env);
  if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
  await ensureAgentSchema(sql);
  await removeAgentKnowledgeRow(sql, auth.userId, id, text);
  return send({ ok: true }, 200, origin);
};
