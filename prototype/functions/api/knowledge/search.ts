// prototype/functions/api/knowledge/search.ts
// POST = 임베딩 기반 코사인 유사도 검색 (top-K 청크 반환).
// AI 문서 생성 시 자동 호출되어 프롬프트에 컨텍스트로 첨부됨.

import { authorizeRequest } from "../_shared/auth.js";
import {
  canUseCommonKnowledge,
  embedText,
  ensureSchema,
  getSql,
  isKnowledgeAccessRequired,
  json,
  ragEnabled,
  toVector,
} from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const body = await request.json().catch(() => ({} as any));
    const query = String(body?.query || "").slice(0, 8000).trim();
    const accessKey = String(body?.accessKey || "");
    const limit = clamp(Number(body?.limit) || 8, 1, 20);

    if (isKnowledgeAccessRequired(env) && !canUseCommonKnowledge(env, accessKey)) {
      return json({ error: "공통 사전 지식 사용 키가 올바르지 않습니다." }, 403);
    }

    if (!ragEnabled(env)) {
      return json({ configured: false, chunks: [], reason: "RAG 미설정 — 클라이언트 로컬 fallback 사용" });
    }
    if (!query) return json({ configured: true, chunks: [] });

    const sql = getSql(env);
    if (!sql) return json({ configured: false, chunks: [] });
    await ensureSchema(sql);

    const embedding = await embedText(env, query);
    const vec = toVector(embedding);
    const rows = await sql`
      SELECT source_name, chunk_index, content,
             1 - (embedding <=> ${vec}::vector) AS similarity
      FROM knowledge_chunks
      ORDER BY embedding <=> ${vec}::vector
      LIMIT ${limit}
    `;

    return json({
      configured: true,
      chunks: rows.map((r: any) => ({
        sourceName: r.source_name,
        chunkIndex: r.chunk_index,
        content: r.content,
        similarity: Number(r.similarity),
      })),
    });
  } catch (e: any) {
    return json({ error: e?.message || "지식 검색 중 오류가 발생했습니다." }, 500);
  }
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
