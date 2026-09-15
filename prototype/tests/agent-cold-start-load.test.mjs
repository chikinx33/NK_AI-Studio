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

test("polled list endpoints return a remembered result when the DB fingerprint is unchanged", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  assert.match(shared, /export async function pollCached<T>\(/);
  assert.match(shared, /if \(hit && current && hit\.marker === current && Date\.now\(\) - hit\.at < POLL_CACHE_MAX_AGE_MS\) return hit\.value as T;/);
  for (const [rel, kind] of [["jobs.ts", "jobs"], ["company-knowledge.ts", "knowledge"], ["knowledge-graph.ts", "knowledge"], ["projects.ts", "projects"], ["skills.ts", "skills"]]) {
    const src = read(`prototype/functions/api/agent/${rel}`);
    assert.ok(src.includes(`pollCached(sql, "${kind}"`), rel);
  }
});

test("hidden AI company tabs do not poll the DB", () => {
  const src = read("ai-company-app/src/main.tsx");
  assert.match(src, /if \(last && document\.visibilityState === "hidden"\) return last\.clone\(\);/);
});
