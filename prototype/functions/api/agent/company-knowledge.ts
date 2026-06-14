// prototype/functions/api/agent/company-knowledge.ts
// 회사 지식 CRUD. 라비오크 /api/knowledge 계약(NK RAG와 충돌 회피). ★ user_id 격리.
// GET → KnowledgeItem[] / POST {text,type} / PUT {oldText,newText} / DELETE {text}
import { authorizeRequest } from "../_shared/auth.js";
import {
  send, corsHeaders, getSql, ensureAgentSchema,
  listCompanyKnowledge, addCompanyKnowledge, updateCompanyKnowledge, deleteCompanyKnowledge,
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
  if (!sql) return send([], 200, origin);
  await ensureAgentSchema(sql);
  return send(await listCompanyKnowledge(sql, auth.userId), 200, origin);
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const body = await request.json().catch(() => ({} as any));
  const text = String(body?.text || "").trim();
  const type = String(body?.type || "사실").trim();
  if (!text) return send({ error: "text required" }, 400, origin);
  const sql = getSql(env);
  if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
  await ensureAgentSchema(sql);
  await addCompanyKnowledge(sql, auth.userId, text, type);
  return send({ ok: true }, 200, origin);
};

export const onRequestPut: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const body = await request.json().catch(() => ({} as any));
  const oldText = String(body?.oldText || "").trim();
  const newText = String(body?.newText || "").trim();
  if (!oldText || !newText) return send({ error: "oldText and newText required" }, 400, origin);
  const sql = getSql(env);
  if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
  await ensureAgentSchema(sql);
  await updateCompanyKnowledge(sql, auth.userId, oldText, newText);
  return send({ ok: true }, 200, origin);
};

export const onRequestDelete: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const body = await request.json().catch(() => ({} as any));
  const text = String(body?.text || "").trim();
  if (!text) return send({ error: "text required" }, 400, origin);
  const sql = getSql(env);
  if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
  await ensureAgentSchema(sql);
  await deleteCompanyKnowledge(sql, auth.userId, text);
  return send({ ok: true }, 200, origin);
};
