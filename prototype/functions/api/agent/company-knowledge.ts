// prototype/functions/api/agent/company-knowledge.ts
// 회사 지식 CRUD. 라비오크 /api/knowledge 계약(NK RAG와 충돌 회피). ★ user_id 격리.
// GET → KnowledgeItem[] / POST {text,type} / PUT {oldText,newText} / DELETE {text}
import { authorizeRequest } from "../_shared/auth.js";
import {
  send, corsHeaders, getSql, ensureAgentSchema, perfTimer, pollCached,
  listCompanyKnowledge, addCompanyKnowledge, updateCompanyKnowledge, deleteCompanyKnowledge,
  dedupeCompanyKnowledge, companyKnowledgeCounts,
} from "./_shared";
import { callClaude } from "./_orchestrator";
import { TIDY_SYSTEM, loadTidyItems, buildTidyRequest, parseTidyPlan, applyTidyOps } from "./_knowledge-tidy";
import { getAgentModelSelections } from "../_shared/claude-auth.js";
import { resolveAgentModel } from "../_shared/cloud-models.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const perf = perfTimer("GET company-knowledge");
  const auth = await authorizeRequest(request, env);
  perf.mark("auth");
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const sql = getSql(env);
  if (!sql) return send([], 200, origin);
  await ensureAgentSchema(sql);
  perf.mark("schema");
  const items = await pollCached(sql, "knowledge", `knowledge:${auth.userId}`, [auth.userId], () => listCompanyKnowledge(sql, auth.userId));
  perf.mark("db");
  return perf.send(items, 200, origin);
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const body = await request.json().catch(() => ({} as any));
  const sql = getSql(env);
  if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
  await ensureAgentSchema(sql);

  // AI 정리안: 전체 지식을 읽혀 병합·삭제·수정 제안만 만든다(DB는 건드리지 않음).
  if (body?.action === "tidy_plan") {
    try {
      const { items, truncated } = await loadTidyItems(sql, auth.userId);
      if (items.length < 2) return send({ ok: true, ops: [], itemCount: items.length, truncated }, 200, origin);
      const selections = await getAgentModelSelections(sql, auth.userId).catch(() => ({}));
      const raw = await callClaude(env, TIDY_SYSTEM, [{ role: "user", content: buildTidyRequest(items) }], {
        sql, userId: auth.userId, maxTokens: 8000,
        modelChoice: resolveAgentModel("core", selections, undefined, "claude-sonnet-4-6"),
      });
      return send({ ok: true, ops: parseTidyPlan(raw, items), itemCount: items.length, truncated }, 200, origin);
    } catch (error: any) {
      return send({ error: `정리안을 만들지 못했어요: ${String(error?.message || error)}` }, 500, origin);
    }
  }

  // 사람이 고른 정리안만 적용하고 전후 개수를 돌려준다.
  if (body?.action === "tidy_apply") {
    const before = await companyKnowledgeCounts(sql, auth.userId);
    const result = await applyTidyOps(sql, auth.userId, body?.ops);
    const after = await companyKnowledgeCounts(sql, auth.userId);
    return send({ ok: true, ...result, before, after }, 200, origin);
  }

  // 중복 정리(구버전): 같은 내용 1개만 남기고 제거
  if (body?.action === "dedupe") {
    const removed = await dedupeCompanyKnowledge(sql, auth.userId);
    return send({ ok: true, removed }, 200, origin);
  }

  const text = String(body?.text || "").trim();
  const type = String(body?.type || "사실").trim();
  if (!text) return send({ error: "text required" }, 400, origin);
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
