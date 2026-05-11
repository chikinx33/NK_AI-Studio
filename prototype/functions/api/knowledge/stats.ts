// prototype/functions/api/knowledge/stats.ts
// GET = RAG 활성화 상태 + 등록 문서/청크 수 + 관리자/접근 키 필요 여부

import {
  ensureSchema,
  getSql,
  isKnowledgeAccessRequired,
  isKnowledgeAdminRequired,
  json,
  ragEnabled,
} from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestGet: PagesFunction = async ({ env }) => {
  try {
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
    const rows = await sql`
      SELECT
        (SELECT count(*)::int FROM knowledge_documents) AS documents,
        (SELECT count(*)::int FROM knowledge_chunks) AS chunks
    `;

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
