import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

// 회사 지식이 수십만 개가 돼도 AI에게는 관련된 것만 넣는 색인 구조. 모듈을 실제로 묶어 돌려 본다(DB·임베딩은 흉내).
async function loadIndex() {
  const esbuild = createRequire(import.meta.url)(resolve(root, "ai-company-app/node_modules/esbuild"));
  const js = esbuild.buildSync({
    entryPoints: [resolve(root, "prototype/functions/api/agent/_knowledge-index.ts")],
    bundle: true, write: false, format: "esm", platform: "neutral",
  }).outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

test("단어 조각: 조사·띄어쓰기가 달라도 같은 조각이 나오고, 흔한 어미 조각은 뺀다", async () => {
  const { knowledgeTerms } = await loadIndex();
  const doc = knowledgeTerms("마리의 수학 여행지는 제주도였습니다");
  const query = knowledgeTerms("마리가 수학여행 간 곳");
  for (const term of ["마리", "수학", "여행"]) {
    assert.ok(doc.includes(term), `문서에 ${term}`);
    assert.ok(query.includes(term), `질문에 ${term}`);
  }
  assert.ok(!doc.includes("니다") && !doc.includes("습니"));
  assert.deepEqual(knowledgeTerms("Series EP1 v2 a"), ["series", "ep1", "v2"]);
});

test("캔버스 대화 메시지에서 프로젝트 id 를 읽는다", async () => {
  const { projectIdFromMessage } = await loadIndex();
  assert.equal(projectIdFromMessage("[캔버스 프로젝트 mari-trip · 선택 컷 3] 마리는 어디 갔지?"), "mari-trip");
  assert.equal(projectIdFromMessage("마리는 어디 갔지?"), undefined);
});

function fakeDb({ total, recent = [], rules = [], keyword = [], semantic = [] }) {
  const calls = [];
  const sql = async (query, params) => {
    const q = query.replace(/\s+/g, " ").trim();
    calls.push({ q, params });
    // 개수·최신 목록·원칙 상위를 한 번에 받는 창 함수 쿼리
    if (q.includes("count(*) OVER () AS total")) {
      return [
        ...recent.map((r, i) => ({ ...r, total, recent_rank: i + 1, rule_rank: null })),
        ...rules.map((r, i) => ({ ...r, total, recent_rank: 1000 + i, rule_rank: i + 1 })),
      ];
    }
    if (q.includes("k.terms && $2::text[]")) return keyword;
    if (q.includes("ORDER BY k.embedding <=> $2::vector")) return semantic;
    if (q.startsWith("UPDATE company_knowledge SET use_count")) return [];
    throw new Error(`unexpected query: ${q}`);
  };
  return { sql, calls };
}

const row = (id, text, type = "사실") => ({ id: `00000000-0000-0000-0000-${String(id).padStart(12, "0")}`, text, type, created_at: "2026-09-01", project_id: null });

test("지식이 적으면 지금처럼 전부 넣고, 많으면 원칙 + 관련 지식만 넣는다(전체를 읽지 않음)", async () => {
  const { selectCompanyKnowledgeForPrompt, PROMPT_ALL_LIMIT } = await loadIndex();
  const small = fakeDb({ total: 2, recent: [row(9, "전부 모드"), row(8, "둘째")] });
  const picked = await selectCompanyKnowledgeForPrompt({}, small.sql, "u1", "마리 수학여행");
  assert.equal(picked.retrieved, false);
  assert.deepEqual(picked.lines, ["[사실] 전부 모드", "[사실] 둘째"]);
  assert.equal(small.calls.length, 1, "적을 땐 DB 쿼리 1번(예전 목록 조회와 같은 서브요청 수)");
  assert.ok(PROMPT_ALL_LIMIT >= 2);

  const big = fakeDb({
    total: 100000,
    rules: [row(1, "사용자를 엔케라고 부른다", "원칙")],
    keyword: [row(2, "마리 수학여행 목적지는 제주도"), row(3, "마리는 고양이를 좋아한다")],
  });
  const retrieved = await selectCompanyKnowledgeForPrompt({}, big.sql, "u1", "마리가 수학여행 간 곳", { projectId: "mari-trip" });
  assert.equal(retrieved.retrieved, true);
  assert.equal(retrieved.total, 100000);
  assert.deepEqual(retrieved.lines, ["[원칙] 사용자를 엔케라고 부른다", "[사실] 마리 수학여행 목적지는 제주도", "[사실] 마리는 고양이를 좋아한다"]);
  assert.match(big.calls[0].q, /WHERE recent_rank <= 151 OR rule_rank <= 40/, "전체 목록을 읽지 않는다");
  const keywordCall = big.calls.find((c) => c.q.includes("k.terms && $2::text[]"));
  assert.match(keywordCall.q, /k\.project_id IS NULL OR k\.project_id = \$4/);
  assert.equal(keywordCall.params[3], "mari-trip");
  assert.ok(big.calls.length <= 3, `많을 때도 DB 쿼리 3번 이하(개수·원칙 1 + 단어 1 + 의미 1): ${big.calls.length}`);
});

test("단어 검색과 의미 검색 결과를 순위 합산하고, 임베딩이 실패하면 단어 검색만으로 답한다", async () => {
  const { searchCompanyKnowledge } = await loadIndex();
  const jeju = row(2, "3화 배경: 제주도로 떠난 수학여행");
  const cat = row(3, "마리는 고양이를 좋아한다");
  const trip = row(4, "여행 목적지 확정: 제주도");
  const db = fakeDb({ total: 1000, keyword: [cat, jeju], semantic: [trip, jeju] });

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ embeddings: [{ values: Array.from({ length: 256 }, (_, i) => (i === 0 ? 1 : 0)) }] }), { status: 200 });
  try {
    const hits = await searchCompanyKnowledge({ GEMINI_API_KEY: "k" }, db.sql, "u1", "마리가 수학여행 간 곳", { limit: 3 });
    assert.equal(hits[0].id, jeju.id, "양쪽에 모두 나온 지식이 1위");
    assert.deepEqual(hits[0].via.sort(), ["keyword", "semantic"]);
    const vectorCall = db.calls.find((c) => c.q.includes("<=> $2::vector"));
    assert.match(vectorCall.params[1], /^\[1\.000000,0\.000000/);
  } finally {
    globalThis.fetch = realFetch;
  }

  const noKey = fakeDb({ total: 1000, keyword: [cat, jeju] });
  const keywordOnly = await searchCompanyKnowledge({}, noKey.sql, "u1", "마리 수학여행", { limit: 5 });
  assert.deepEqual(keywordOnly.map((h) => h.id), [cat.id, jeju.id]);
  assert.ok(!noKey.calls.some((c) => c.q.includes("<=>")), "키가 없으면 의미 검색을 시도하지 않는다");
});

test("색인 스키마·쓰기 경로·대화 끝 색인 채우기·검색 도구가 연결돼 있다", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  const orchestrator = read("prototype/functions/api/agent/_orchestrator.ts");
  const chat = read("prototype/functions/api/agent/chat.ts");
  const tidy = read("prototype/functions/api/agent/_knowledge-tidy.ts");
  assert.match(shared, /ADD COLUMN IF NOT EXISTS terms text\[\] NOT NULL DEFAULT '\{\}'::text\[\];/);
  assert.match(shared, /company_knowledge_terms_idx ON company_knowledge USING gin \(terms\)/);
  assert.match(shared, /ADD COLUMN IF NOT EXISTS embedding vector\(\$\{KNOWLEDGE_EMBED_DIM\}\);/);
  assert.match(shared, /INSERT INTO company_knowledge \(user_id, text, type, source, project_id, terms, terms_hash\)/);
  assert.match(shared, /company_knowledge_search: \{[^\n]+kind: "read", synthesize: true/);
  assert.match(orchestrator, /\[\[RUN: company_knowledge_search/);
  assert.match(orchestrator, /selectCompanyKnowledgeForPrompt\(env, sql, userId,/);
  assert.doesNotMatch(orchestrator, /listCompanyKnowledge\(/, "대화마다 회사 지식 전체를 읽지 않는다");
  assert.doesNotMatch(orchestrator, /SELECT id, text FROM company_knowledge WHERE user_id = \$1"/, "대상 찾기도 전체를 읽지 않는다");
  assert.match(orchestrator, /terms = \$4::text\[\], terms_hash = md5\(\$3\)/);
  assert.match(tidy, /terms = \$5::text\[\], terms_hash = md5\(\$3\)/);
  assert.match(tidy, /ORDER BY created_at ASC, id ASC LIMIT \$2/);
  // 색인 채우기는 대화 요청의 서브요청 한도를 깎지 않게 별도 요청으로 넘긴다
  assert.match(chat, /new URL\("\/api\/agent\/knowledge-index", request\.url\)/);
  assert.doesNotMatch(chat, /indexStaleCompanyKnowledge\(/);
  assert.match(read("prototype/functions/api/agent/knowledge-index.ts"), /indexStaleCompanyKnowledge\(env, sql, auth\.userId/);
});

test("스키마 준비의 DB 호출 수가 Worker 서브요청 한도(무료 플랜 50번) 안에 여유 있게 들어간다", () => {
  // 2026-09-17 v3.1765: 색인 DDL 을 문장마다 따로 보내 43→53번이 되자, 준비 단계에서 한도를 넘어 완료 표시를 못 남기고
  // 모든 AI 회사 요청이 "Too many subrequests" 로 실패했다. DB 쿼리 1번 = 서브요청 1번이다.
  const shared = read("prototype/functions/api/agent/_shared.ts");
  const skill = read("prototype/functions/api/agent/_skill-jobs.ts");
  const body = (src, header) => {
    const start = src.indexOf(header);
    assert.ok(start >= 0, `${header} 를 찾지 못했다`);
    const end = src.indexOf("\n}\n", start);
    return src.slice(start, end);
  };
  const ddl = (body(shared, "async function runAgentSchemaDdl").match(/await sql\(/g) || []).length;
  const skillDdl = (body(skill, "export async function ensureCompanySkillJobSchema").match(/sql\(/g) || []).length;
  const marks = 3; // 지문 조회 · 표시 테이블 · 지문 저장
  const total = ddl + skillDdl + marks;
  assert.ok(total <= 44, `스키마 준비 DB 호출 ${total}번 — 새 DDL 은 기존 DO 블록에 합칠 것(요청 자체 쿼리 몫을 남겨야 한다)`);
});
