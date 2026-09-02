// prototype/functions/api/knowledge/index.ts
// POST = 지식파일 인덱싱 (텍스트 → 청크 → 임베딩 → Neon 저장)
// DELETE = 인덱싱된 지식파일 삭제

import { authorizeRequest } from "../_shared/auth.js";
import { withCreditCharge } from "../_shared/credits";
import {
  canManageCommonKnowledge,
  chunkText,
  embedText,
  ensureSchema,
  getSql,
  json,
  ragEnabled,
  sha256Hex,
  toVector,
} from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const handlePost: PagesFunction = async ({ request, env }) => {
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const body = await request.json().catch(() => ({} as any));
    const name = String(body?.name || "knowledge-file").slice(0, 200);
    const text = String(body?.text || "");
    const adminKey = String(body?.adminKey || "");

    if (!canManageCommonKnowledge(env, adminKey, auth.ok)) {
      return json({ error: "지식파일 등록 권한 키가 올바르지 않습니다." }, 403);
    }
    if (!text.trim()) {
      return json({ error: "인덱싱할 텍스트가 없습니다." }, 400);
    }

    if (!ragEnabled(env)) {
      return json({
        configured: false,
        indexed: false,
        chunks: 0,
        reason: "DATABASE_URL 또는 OPENAI_API_KEY 환경변수가 없습니다. Neon RAG가 비활성화 상태이며, 클라이언트는 로컬 fallback으로 동작합니다.",
      });
    }

    const sql = getSql(env);
    if (!sql) return json({ configured: false, indexed: false, chunks: 0, reason: "DATABASE_URL이 없습니다." });

    await ensureSchema(sql);

    const chunks = chunkText(text, name);
    if (chunks.length === 0) {
      return json({ configured: true, indexed: false, chunks: 0, reason: "유효한 청크가 없습니다." });
    }

    const contentHash = await sha256Hex(`${name}:${text}`);
    const docRows = await sql(
      "INSERT INTO knowledge_documents (name, content_hash, user_id) VALUES ($1, $2, $3) ON CONFLICT (user_id, content_hash) DO UPDATE SET name = EXCLUDED.name RETURNING id",
      [name, contentHash, auth.userId || ""]
    );
    const documentId = docRows[0]?.id as string;
    if (!documentId) return json({ configured: true, indexed: false, chunks: 0, reason: "문서 행을 만들 수 없습니다." });

    await sql("DELETE FROM knowledge_chunks WHERE document_id = $1", [documentId]);

    let inserted = 0;
    for (const chunk of chunks) {
      const embedding = await embedText(env, chunk.content);
      await sql(
        "INSERT INTO knowledge_chunks (document_id, source_name, chunk_index, content, embedding) VALUES ($1, $2, $3, $4, $5::vector)",
        [documentId, chunk.sourceName, chunk.chunkIndex, chunk.content, toVector(embedding)]
      );
      inserted += 1;
    }

    return json({
      configured: true,
      indexed: true,
      chunks: inserted,
      documentId,
    });
  } catch (e: any) {
    return json({ error: e?.message || "지식파일 인덱싱 중 오류가 발생했습니다." }, 500);
  }
};

export const onRequestPost: PagesFunction = async (context) =>
  withCreditCharge(context, { feature: "knowledge_index" }, handlePost);

export const onRequestDelete: PagesFunction = async ({ request, env }) => {
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const body = await request.json().catch(() => ({} as any));
    const documentId = String(body?.documentId || "");
    const adminKey = String(body?.adminKey || "");

    if (!canManageCommonKnowledge(env, adminKey, auth.ok)) {
      return json({ error: "지식파일 삭제 권한 키가 올바르지 않습니다." }, 403);
    }
    if (!documentId) return json({ deleted: false, reason: "documentId가 없습니다." });

    if (!ragEnabled(env)) {
      return json({ deleted: false, reason: "RAG가 설정되지 않아 서버에서 삭제할 항목이 없습니다." });
    }

    const sql = getSql(env);
    if (!sql) return json({ deleted: false, reason: "DATABASE_URL 없음" });
    await ensureSchema(sql);
    const rows = await sql(
      "DELETE FROM knowledge_documents WHERE id = $1 RETURNING id",
      [documentId]
    );
    return json({ deleted: rows.length > 0 });
  } catch (e: any) {
    return json({ error: e?.message || "지식파일 삭제 중 오류가 발생했습니다." }, 500);
  }
};
