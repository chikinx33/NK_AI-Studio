// prototype/functions/api/knowledge/stats.ts
// GET = RAG 활성화 상태 + 로그인 회원 본인의 문서/청크 수 + 관리자/접근 키 필요 여부

import { authorizeRequest } from "../_shared/auth.js";
import {
  ensureSchema,
  getSql,
  isKnowledgeAccessRequired,
  isKnowledgeAdminRequired,
  json,
  knowledgeOwnerClause,
  ragEnabled,
} from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    const adminRequired = isKnowledgeAdminRequired(env);
    const accessRequired = isKnowledgeAccessRequired(env);

    if (!ragEnabled(env)) {
      return json({
        configured: false,
        documents: 0,
        chunks: 0,
        adminRequired,
        accessRequired,
        reason: "DATABASE_URL 또는 OPENAI_API_KEY가 없어 RAG 미설정 상태입니다.",
      });
    }

    const sql = getSql(env);
    if (!sql) return json({ configured: false, documents: 0, chunks: 0, adminRequired, accessRequired });
    await ensureSchema(sql);
    const owner = knowledgeOwnerClause(env, auth.userId, "d", 1);
    const rows = await sql(
      `SELECT (SELECT count(*)::int FROM knowledge_documents d WHERE ${owner.clause}) AS documents,
              (SELECT count(*)::int FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id WHERE ${owner.clause}) AS chunks`,
      owner.params
    );

    return json({
      configured: true,
      documents: Number(rows[0]?.documents || 0),
      chunks: Number(rows[0]?.chunks || 0),
      adminRequired,
      accessRequired,
    });
  } catch (e: any) {
    return json({
      configured: false,
      documents: 0,
      chunks: 0,
      adminRequired: isKnowledgeAdminRequired(env),
      accessRequired: isKnowledgeAccessRequired(env),
      error: e?.message || "지식파일 상태 확인 실패",
    }, 500);
  }
};
