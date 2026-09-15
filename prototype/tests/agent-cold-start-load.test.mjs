import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

// AI 기업 화면(지식·그래프·검수 등) 첫 로딩 지연 회귀 방지.
test("agent schema setup is shared across concurrent requests and skipped when unchanged", () => {
  const src = read("prototype/functions/api/agent/_shared.ts");
  assert.match(src, /let agentSchemaPromise: Promise<void> \| null = null;/);
  assert.match(src, /if \(!agentSchemaPromise\) \{\s*agentSchemaPromise = prepareAgentSchema\(sql\)/);
  assert.match(src, /String\(runAgentSchemaDdl\) \+ String\(ensureCompanySkillJobSchema\)/);
  assert.match(src, /SELECT fingerprint FROM nk_schema_marks WHERE name = \$1/);
});

test("Google service account token is reused within an isolate", () => {
  const src = read("prototype/functions/api/_shared/gcs.js");
  assert.match(src, /const accessTokenCache = new Map\(\);/);
  assert.match(src, /cached\.expiresAtMs - Date\.now\(\) > 5 \* 60 \* 1000/);
});

test("identical in-flight polling GETs share one request in the AI company app", () => {
  const src = read("ai-company-app/src/main.tsx");
  assert.match(src, /const SHARED_GET = \/\^\\\/api\\\/agent\\\/\(jobs\|company-knowledge\|knowledge-graph\|skills\|projects\)/);
  assert.match(src, /return \(await pending\)\.clone\(\);/);
});
