import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("회사 지식 API는 생성 시각을 제공하고 최신순으로 조회한다", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  const api = read("ai-company-app/src/lib/api.ts");
  assert.match(shared, /SELECT text, source, type, created_at FROM company_knowledge WHERE user_id = \$1 ORDER BY created_at DESC/);
  assert.match(shared, /createdAt: row\.created_at \? String\(row\.created_at\) : ""/);
  assert.match(api, /export interface KnowledgeItem \{[\s\S]*createdAt\?: string;/);
});

test("회사 지식 화면의 기본 정렬은 생성 시각 기준 최신순이다", () => {
  const knowledge = read("ai-company-app/src/components/Knowledge.tsx");
  assert.match(knowledge, /useState<"asc" \| "desc">\("desc"\)/);
  assert.match(knowledge, /Date\.parse\(item\.createdAt \?\? ""\) \|\| 0/);
  assert.match(knowledge, /sortDir === "desc" \? b\.createdAt - a\.createdAt : a\.createdAt - b\.createdAt/);
  assert.doesNotMatch(knowledge, /sortDir === "desc" \? \[\.\.\.visible\]\.reverse\(\)/);
});
