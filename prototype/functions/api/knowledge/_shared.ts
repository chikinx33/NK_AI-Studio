// prototype/functions/api/knowledge/_shared.ts
// AI 문서 RAG (Retrieval-Augmented Generation) 공유 헬퍼.
// Neon Postgres + pgvector + OpenAI Embeddings 기반.

import { neon } from "@neondatabase/serverless";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const CHUNK_SIZE = 1400;
const CHUNK_OVERLAP = 220;
const MAX_CHUNKS_PER_DOC = 80;

let schemaReady = false;

export function ragEnabled(env: any): boolean {
  return Boolean(env && env.DATABASE_URL && env.OPENAI_API_KEY);
}

export function getSql(env: any) {
  const url = String(env && env.DATABASE_URL || "").trim();
  if (!url) return null;
  return neon(url);
}

export function isKnowledgeAdminRequired(env: any): boolean {
  return Boolean(String(env && env.KNOWLEDGE_ADMIN_KEY || "").trim());
}

export function canManageCommonKnowledge(env: any, inputKey: string): boolean {
  const adminKey = String(env && env.KNOWLEDGE_ADMIN_KEY || "").trim();
  if (!adminKey) return true;
  return adminKey === String(inputKey || "").trim();
}

export function isKnowledgeAccessRequired(env: any): boolean {
  return parseKeys(env && (env.KNOWLEDGE_ACCESS_KEYS || env.KNOWLEDGE_ACCESS_KEY)).length > 0;
}

export function canUseCommonKnowledge(env: any, inputKey: string): boolean {
  const keys = parseKeys(env && (env.KNOWLEDGE_ACCESS_KEYS || env.KNOWLEDGE_ACCESS_KEY));
  if (keys.length === 0) return true;
  const normalized = String(inputKey || "").trim();
  if (!normalized) return false;
  return keys.includes(normalized);
}

function parseKeys(value: any): string[] {
  return String(value || "")
    .split(/[\n,]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

export async function ensureSchema(sql: any) {
  if (schemaReady) return;
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await sql`
    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      content_hash text NOT NULL UNIQUE,
      user_id text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id uuid NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
      source_name text NOT NULL,
      chunk_index integer NOT NULL,
      content text NOT NULL,
      embedding vector(1536) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
    ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS knowledge_chunks_document_id_idx
    ON knowledge_chunks (document_id)
  `;
  schemaReady = true;
}

export async function embedText(env: any, input: string): Promise<number[]> {
  const apiKey = String(env && env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  const text = String(input || "").slice(0, 8000);
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    let detail: any = body;
    try { detail = JSON.parse(body); } catch (_) {}
    const msg = detail && detail.error && detail.error.message ? detail.error.message : `OpenAI Embeddings 호출 실패 (${res.status})`;
    throw new Error(msg);
  }
  const data = JSON.parse(body);
  const embedding = data && data.data && data.data[0] && data.data[0].embedding;
  if (!Array.isArray(embedding)) throw new Error("Embedding 응답이 비어 있습니다.");
  return embedding as number[];
}

export type KnowledgeChunkInput = {
  content: string;
  sourceName: string;
  chunkIndex: number;
};

export function chunkText(text: string, sourceName: string): KnowledgeChunkInput[] {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const chunks: KnowledgeChunkInput[] = [];
  for (let start = 0; start < normalized.length; start += CHUNK_SIZE - CHUNK_OVERLAP) {
    const content = normalized.slice(start, start + CHUNK_SIZE).trim();
    if (content.length < 120) continue;
    chunks.push({ content, sourceName, chunkIndex: chunks.length });
    if (chunks.length >= MAX_CHUNKS_PER_DOC) break;
  }
  return chunks;
}

export function toVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(input || "")));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
