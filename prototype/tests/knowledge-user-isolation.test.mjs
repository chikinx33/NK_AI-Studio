import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

// 지식 문서(RAG)는 회원별이다. 다른 계정의 AI 기업이 내 문서를 검색·삭제·집계하면 안 된다.
test("knowledge search, delete and stats are scoped to the caller's documents", () => {
  const shared = read("prototype/functions/api/knowledge/_shared.ts");
  assert.match(shared, /export function knowledgeOwnerClause\(/);
  // 사용자 분리 이전 행(user_id 비어 있음)은 1차 관리자 소유
  assert.match(shared, /userId === primaryAdminId\(env\)/);

  const search = read("prototype/functions/api/knowledge/search.ts");
  assert.match(search, /JOIN knowledge_documents d ON d\.id = c\.document_id/);
  assert.match(search, /knowledgeOwnerClause\(env, auth\.userId, "d", 3\)/);
  assert.doesNotMatch(search, /FROM knowledge_chunks ORDER BY/);

  const index = read("prototype/functions/api/knowledge/index.ts");
  assert.match(index, /DELETE FROM knowledge_documents WHERE id = \$1 AND \$\{owner\.clause\}/);

  const stats = read("prototype/functions/api/knowledge/stats.ts");
  assert.match(stats, /authorizeRequest\(request, env\)/);
  assert.match(stats, /knowledgeOwnerClause\(env, auth\.userId, "d", 1\)/);
});

test("operator GitHub token is only attached for the primary admin", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  assert.match(shared, /const token = requireMaster\(ctx\.env, ctx\.userId\) \?/);
});

test("agent prompts carry no owner brand examples", () => {
  for (const rel of ["prototype/functions/api/agent/_orchestrator.ts", "prototype/functions/api/agent/integrations.ts", "prototype/functions/api/agent/agent-video.ts"]) {
    const src = read(rel);
    assert.doesNotMatch(src, /elidus|ELIDUS|memoment|엘리더스|라비오크 총괄/, rel);
  }
});

test("user cleanup escapes LIKE wildcards in the user id", () => {
  const src = read("prototype/functions/api/_shared/user-cleanup.ts");
  assert.match(src, /const likeId = userId\.replace\(/);
  assert.doesNotMatch(src, /`%\/users\/\$\{userId\}\/%`/);
});
