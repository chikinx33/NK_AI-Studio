// prototype/functions/api/agent/_knowledge-index.ts
// 회사 지식 색인·검색. 지식이 수십만 개가 돼도 AI에게는 관련된 몇 개만 보여주기 위한 구조다.
//
// 예전엔 직원이 말할 때마다 회사 지식 전체를 시스템 프롬프트에 붙였다. 수천 개면 메시지마다 수십만 토큰,
// 수만 개면 모델 한도를 넘어 대화 자체가 실패한다. 게시판 검색처럼 색인으로 후보를 좁힌다.
//
//   ① 범위 색인(B-tree)   user_id · project_id · type — 다른 작품의 같은 이름 캐릭터가 섞이지 않게
//   ② 단어 색인(GIN)      terms text[] — 한국어는 2글자 조각, 영문·숫자는 단어. 조사가 붙어도("마리의") 맞는다. 비용 0
//   ③ 의미 색인(pgvector) embedding — "여행 간 곳" ↔ "목적지: 제주도"처럼 단어가 달라도 뜻으로 찾는다
//
// ③은 Gemini 임베딩(무료 등급 있음, 유료도 100만 토큰당 $0.20)을 256차원으로 줄여 저장한다(행당 약 1KB).
// 임베딩을 못 만들면(키 없음·지역 차단·프록시 콜드스타트) ②만으로 동작하고, 대화 끝에 밀린 것을 다시 채운다.
import type { SqlFn } from "./_shared";
import { geminiBaseUrl, geminiProxyHeaders } from "../_shared/gemini-models.js";

export const KNOWLEDGE_EMBED_DIM = 256;
/** 이 개수 이하면 검색하지 않고 전부 넣는다(작을 땐 전부가 가장 정확하고 토큰도 적다). */
export const PROMPT_ALL_LIMIT = 150;
/** 호칭·말투처럼 항상 지켜야 하는 원칙은 질문과 무관하게 넣는다(최근·자주 쓰인 순 상한). */
const ALWAYS_RULES_LIMIT = 40;
/** 질문과 관련된 지식으로 넣는 개수. */
export const PROMPT_RETRIEVE_LIMIT = 20;

const DEFAULT_EMBED_MODEL = "gemini-embedding-2";
const EMBED_BATCH = 100;
const EMBED_BACKOFF_MS = 5 * 60_000;
let embedDownUntil = 0;

// 거의 모든 문장에 나오는 어미·조사 조각은 색인해도 후보만 늘리고 구분을 못 한다.
const STOP_TERMS = new Set([
  "니다", "습니", "합니", "입니", "했다", "한다", "했습", "있다", "있는", "있습", "하는", "하고", "해요", "어요", "에요",
  "에서", "으로", "이다", "이고", "이며", "것을", "것이", "것은", "그리", "리고", "또는", "그리고", "the", "and", "for", "with",
]);

/** 검색 단어 조각. 한글(섞인 토큰 포함)은 2글자 조각, 영문·숫자만인 토큰은 통째로. */
export function knowledgeTerms(text: string, max = 256): string[] {
  const tokens = String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^0-9a-zㄱ-ㆎ가-힣]+/)
    .filter(Boolean);
  const terms = new Set<string>();
  for (const token of tokens) {
    if (/^[0-9a-z]+$/.test(token)) {
      if (token.length >= 2 && !STOP_TERMS.has(token)) terms.add(token);
      continue;
    }
    if (token.length === 1) { terms.add(token); continue; }
    for (let i = 0; i < token.length - 1; i += 1) {
      const gram = token.slice(i, i + 2);
      if (!STOP_TERMS.has(gram)) terms.add(gram);
    }
    if (terms.size >= max) break;
  }
  return [...terms].slice(0, max);
}

/** "[캔버스 프로젝트 <id> …]" 로 시작하는 메시지면 그 프로젝트 id. */
export function projectIdFromMessage(message: string | undefined): string | undefined {
  const match = /^\s*\[캔버스 프로젝트\s+([^\s\]]+)/.exec(String(message || ""));
  return match ? match[1] : undefined;
}

function toVectorLiteral(values: number[]): string | null {
  if (!Array.isArray(values) || values.length < KNOWLEDGE_EMBED_DIM) return null;
  const sliced = values.slice(0, KNOWLEDGE_EMBED_DIM).map((value) => Number(value) || 0);
  const norm = Math.sqrt(sliced.reduce((sum, value) => sum + value * value, 0)) || 1;
  return `[${sliced.map((value) => (value / norm).toFixed(6)).join(",")}]`;
}

/** Gemini 임베딩(256차원, 정규화). 키가 없거나 실패하면 null — 호출부는 단어 색인만으로 계속한다. */
export async function embedKnowledgeTexts(env: any, texts: string[], kind: "document" | "query", timeoutMs: number): Promise<string[] | null> {
  const apiKey = String(env?.GEMINI_API_KEY || env?.GOOGLE_API_KEY || "").trim();
  if (!apiKey || !texts.length || Date.now() < embedDownUntil) return null;
  const model = String(env?.GEMINI_EMBEDDING_MODEL || DEFAULT_EMBED_MODEL).trim();
  const deadline = Date.now() + timeoutMs;
  const out: string[] = [];
  try {
    for (let start = 0; start < texts.length; start += EMBED_BATCH) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("timeout");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), remaining);
      try {
        const response = await fetch(`${geminiBaseUrl(env)}/v1beta/models/${encodeURIComponent(model)}:batchEmbedContents`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey, ...geminiProxyHeaders(env) },
          body: JSON.stringify({
            requests: texts.slice(start, start + EMBED_BATCH).map((text) => ({
              model: `models/${model}`,
              // gemini-embedding-2 는 task_type 대신 본문 앞 지시문으로 검색용/문서용을 구분한다.
              content: { parts: [{ text: kind === "query" ? `task: search result | query: ${text.slice(0, 2000)}` : `title: none | text: ${text.slice(0, 4000)}` }] },
              outputDimensionality: KNOWLEDGE_EMBED_DIM,
            })),
          }),
          signal: controller.signal,
        });
        const data: any = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
        const embeddings = Array.isArray(data?.embeddings) ? data.embeddings : [];
        for (const embedding of embeddings) {
          const literal = toVectorLiteral(embedding?.values);
          if (!literal) throw new Error("embedding dimension mismatch");
          out.push(literal);
        }
      } finally {
        clearTimeout(timer);
      }
    }
    return out.length === texts.length ? out : null;
  } catch (error: any) {
    // 지역 차단·키 오류가 매 턴 반복되지 않게 잠시 쉬었다가 다시 시도한다.
    embedDownUntil = Date.now() + EMBED_BACKOFF_MS;
    console.log(`knowledge_embed_failed: ${String(error?.message || error).slice(0, 200)}`);
    return null;
  }
}

/** 내용이 바뀌었거나 아직 색인이 없는 지식을 채운다(단어 조각은 항상, 의미 벡터는 가능할 때). */
export async function indexStaleCompanyKnowledge(
  env: any, sql: SqlFn, userId: string, opts: { limit?: number; timeoutMs?: number } = {},
): Promise<{ terms: number; embedded: number }> {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
  let termsDone = 0;
  let embedded = 0;
  // 쓰기 경로(추가·수정·정리)는 terms 와 terms_hash(=md5(text))를 함께 저장한다. 그래서 매 턴 전체 행의 md5 를
  // 다시 계산하지 않고, 해시가 비어 있는 행(색인 도입 전 지식)과 벡터 해시가 어긋난 행만 채운다.
  const staleTerms = await sql(
    "SELECT id, text, md5(text) AS hash FROM company_knowledge WHERE user_id = $1 AND terms_hash IS NULL LIMIT $2",
    [userId, limit],
  ) as any[];
  if (staleTerms.length) {
    await sql(
      `UPDATE company_knowledge k
          SET terms = ARRAY(SELECT jsonb_array_elements_text(r.terms)), terms_hash = r.hash
         FROM jsonb_to_recordset($2::jsonb) AS r(id uuid, terms jsonb, hash text)
        WHERE k.user_id = $1 AND k.id = r.id AND md5(k.text) = r.hash`,
      [userId, JSON.stringify(staleTerms.map((row) => ({ id: row.id, terms: knowledgeTerms(row.text), hash: row.hash })))],
    );
    termsDone = staleTerms.length;
  }
  // 임베딩을 만들 수 없는 상태(키 없음·실패 후 휴식 중)면 밀린 행을 읽어 오지도 않는다(매 턴 헛전송 방지).
  if (!String(env?.GEMINI_API_KEY || env?.GOOGLE_API_KEY || "").trim() || Date.now() < embedDownUntil) {
    return { terms: termsDone, embedded };
  }
  try {
    const staleVectors = await sql(
      "SELECT id, text, terms_hash AS hash FROM company_knowledge WHERE user_id = $1 AND terms_hash IS NOT NULL AND embedding_hash IS DISTINCT FROM terms_hash LIMIT $2",
      [userId, limit],
    ) as any[];
    if (staleVectors.length) {
      const vectors = await embedKnowledgeTexts(env, staleVectors.map((row) => String(row.text)), "document", opts.timeoutMs ?? 8000);
      if (vectors) {
        await sql(
          `UPDATE company_knowledge k
              SET embedding = r.emb::vector, embedding_hash = r.hash
             FROM jsonb_to_recordset($2::jsonb) AS r(id uuid, emb text, hash text)
            WHERE k.user_id = $1 AND k.id = r.id AND k.terms_hash = r.hash`,
          [userId, JSON.stringify(staleVectors.map((row, index) => ({ id: row.id, emb: vectors[index], hash: row.hash })))],
        );
        embedded = staleVectors.length;
      }
    }
  } catch (error: any) {
    // pgvector 가 없는 DB 에서는 의미 색인만 건너뛴다.
    console.log(`knowledge_vector_index_skipped: ${String(error?.message || error).slice(0, 200)}`);
  }
  return { terms: termsDone, embedded };
}

export interface KnowledgeHit { id: string; text: string; type: string; createdAt: string; projectId: string | null; score: number; via: string[] }

function scopeClause(projectId: string | undefined, param: number) {
  return projectId ? `AND (k.project_id IS NULL OR k.project_id = $${param})` : "";
}

/**
 * 관련 지식 검색: 단어 색인과 의미 색인 결과를 순위 합산(RRF)한다.
 * 프로젝트가 주어지면 그 프로젝트 + 공통 지식만 본다. 벡터는 DB 밖으로 가져오지 않는다(전송량 최소).
 */
export async function searchCompanyKnowledge(
  env: any, sql: SqlFn, userId: string, query: string,
  opts: { projectId?: string; types?: string[]; limit?: number; excludeIds?: string[]; embedTimeoutMs?: number } = {},
): Promise<KnowledgeHit[]> {
  const limit = Math.max(1, Math.min(100, opts.limit ?? PROMPT_RETRIEVE_LIMIT));
  const pool = Math.max(limit * 2, 30);
  const types = (opts.types || []).filter(Boolean);
  const exclude = opts.excludeIds || [];
  const merged = new Map<string, KnowledgeHit>();
  const add = (rows: any[], via: string) => rows.forEach((row, rank) => {
    const id = String(row.id);
    const hit = merged.get(id) || {
      id, text: String(row.text || ""), type: String(row.type || "사실"), createdAt: String(row.created_at || ""),
      projectId: row.project_id ?? null, score: 0, via: [],
    };
    hit.score += 1 / (60 + rank + 1);
    hit.via.push(via);
    merged.set(id, hit);
  });

  const baseParams = (extra: any[]) => [userId, ...extra];
  const filters = (start: number) => {
    const params: any[] = [];
    let clause = "";
    if (opts.projectId) { params.push(opts.projectId); clause += ` ${scopeClause(opts.projectId, start + params.length - 1)}`; }
    if (types.length) { params.push(types); clause += ` AND k.type = ANY($${start + params.length - 1}::text[])`; }
    if (exclude.length) { params.push(exclude); clause += ` AND NOT (k.id = ANY($${start + params.length - 1}::uuid[]))`; }
    return { clause, params };
  };

  const terms = knowledgeTerms(query, 64);
  const searches: Promise<void>[] = [];
  if (terms.length) {
    const f = filters(4);
    searches.push(sql(
      `SELECT k.id, k.text, k.type, k.created_at, k.project_id,
              (SELECT count(*) FROM unnest(k.terms) AS t(term) WHERE t.term = ANY($2::text[]))::int AS hits
         FROM company_knowledge k
        WHERE k.user_id = $1 AND k.terms && $2::text[] ${f.clause}
        ORDER BY hits DESC, k.created_at DESC
        LIMIT $3`,
      [...baseParams([terms, pool]), ...f.params],
    ).then((rows) => add(rows as any[], "keyword")).catch((error) => {
      console.log(`knowledge_keyword_search_failed: ${String(error?.message || error).slice(0, 200)}`);
    }));
  }
  searches.push((async () => {
    const vectors = await embedKnowledgeTexts(env, [query], "query", opts.embedTimeoutMs ?? 2500);
    if (!vectors) return;
    const f = filters(4);
    // 사용자별 정확 탐색(user_id 색인으로 좁힌 뒤 거리 계산). 근사 색인(HNSW)은 여러 사용자 행이 섞이면
    // 필터 뒤 결과가 모자랄 수 있어, 사용자당 수백만 개가 되기 전까진 쓰지 않는다.
    const rows = await sql(
      `SELECT k.id, k.text, k.type, k.created_at, k.project_id
         FROM company_knowledge k
        WHERE k.user_id = $1 AND k.embedding IS NOT NULL ${f.clause}
        ORDER BY k.embedding <=> $2::vector
        LIMIT $3`,
      [...baseParams([vectors[0], pool]), ...f.params],
    ) as any[];
    add(rows, "semantic");
  })().catch((error) => {
    console.log(`knowledge_semantic_search_failed: ${String(error?.message || error).slice(0, 200)}`);
  }));
  await Promise.all(searches);
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/** 검색으로 쓰인 지식의 사용 기록(나중에 '오래 안 쓰인 지식' 정리 후보를 계산으로 고르는 근거). */
export async function markKnowledgeUsed(sql: SqlFn, userId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await sql(
    "UPDATE company_knowledge SET use_count = use_count + 1, last_used_at = now() WHERE user_id = $1 AND id = ANY($2::uuid[])",
    [userId, ids],
  );
}

export const shortKnowledgeId = (id: string) => `id:${String(id || "").replace(/-/g, "").slice(0, 8)}`;

/**
 * 시스템 프롬프트에 넣을 회사 지식 고르기.
 * - 전체가 PROMPT_ALL_LIMIT 이하: 전부(지금까지와 같음)
 * - 넘으면: 항상 지킬 원칙(상한) + 이번 질문과 관련된 지식 PROMPT_RETRIEVE_LIMIT 개
 */
export async function selectCompanyKnowledgeForPrompt(
  env: any, sql: SqlFn, userId: string, query: string, opts: { projectId?: string } = {},
): Promise<{ lines: string[]; total: number; retrieved: boolean }> {
  const scope = opts.projectId ? "AND (project_id IS NULL OR project_id = $2)" : "";
  const scopeParams = opts.projectId ? [opts.projectId] : [];
  const counted = await sql(`SELECT count(*)::int AS total FROM company_knowledge WHERE user_id = $1 ${scope}`, [userId, ...scopeParams]) as any[];
  const total = Number(counted[0]?.total || 0);
  const format = (row: { type?: string; text?: string }) => `[${row.type || "사실"}] ${row.text}`;
  if (total <= PROMPT_ALL_LIMIT) {
    const rows = await sql(
      `SELECT text, type FROM company_knowledge WHERE user_id = $1 ${scope} ORDER BY created_at DESC`,
      [userId, ...scopeParams],
    ) as any[];
    return { lines: rows.map(format), total, retrieved: false };
  }
  const rules = await sql(
    `SELECT id, text, type FROM company_knowledge WHERE user_id = $1 ${scope} AND type = '원칙'
      ORDER BY use_count DESC, created_at DESC LIMIT ${ALWAYS_RULES_LIMIT}`,
    [userId, ...scopeParams],
  ) as any[];
  const hits = query.trim()
    ? await searchCompanyKnowledge(env, sql, userId, query, { projectId: opts.projectId, excludeIds: rules.map((row) => String(row.id)) })
    : [];
  await markKnowledgeUsed(sql, userId, hits.map((hit) => hit.id)).catch(() => {});
  return { lines: [...rules.map(format), ...hits.map(format)], total, retrieved: true };
}
