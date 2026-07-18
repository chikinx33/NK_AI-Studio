import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("available 회사 Skill은 실행 계약과 입력 스키마를 가진다", async () => {
  const [registry, schemas] = await Promise.all([
    read("ai-company-app/src/lib/companySkills.ts"),
    read("ai-company-app/src/lib/companySkillSchemas.ts"),
  ]);

  assert.match(registry, /status: "available"[\s\S]*inputSchema: "company-skill\/infographic\/v1"/);
  assert.match(registry, /executorId: "infographic-adapter-v1"/);
  assert.match(registry, /artifactTypes: \["source", "preview", "final", "manifest", "report"\]/);
  assert.match(registry, /qualityGateIds:/);
  assert.match(schemas, /"company-skill\/infographic\/v1"/);
  assert.match(schemas, /required: \["invocationMode", "request", "options"\]/);
  assert.match(schemas, /idempotencyKey/);
});

test("SkillJob 계약은 전체 상태와 허용 전이를 명시한다", async () => {
  const [client, server] = await Promise.all([
    read("ai-company-app/src/lib/skillJobs.ts"),
    read("prototype/functions/api/agent/_skill-jobs.ts"),
  ]);

  for (const status of ["draft", "validating", "planning", "running", "reviewing", "revision", "completed", "failed", "cancelled"]) {
    assert.match(client, new RegExp(`"${status}"`));
    assert.match(server, new RegExp(`"${status}"`));
  }
  assert.match(client, /reviewing: \["revision", "completed", "failed", "cancelled"\]/);
  assert.match(client, /completed: \[\]/);
  assert.match(client, /cancelled: \[\]/);
  assert.match(server, /canTransitionCompanySkillJob/);
});

test("SkillJob 영속 모델은 사용자 격리, 중복 방지, 산출물 계보를 보존한다", async () => {
  const [schema, shared] = await Promise.all([
    read("prototype/functions/api/agent/_skill-jobs.ts"),
    read("prototype/functions/api/agent/_shared.ts"),
  ]);

  assert.match(schema, /CREATE TABLE IF NOT EXISTS company_skill_jobs/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS company_skill_artifacts/);
  assert.match(schema, /user_id text NOT NULL/);
  assert.match(schema, /company_skill_jobs_user_status_idx[\s\S]*\(user_id, status, updated_at DESC\)/);
  assert.match(schema, /company_skill_jobs_user_idempotency_idx[\s\S]*\(user_id, idempotency_key\)/);
  assert.match(schema, /FOREIGN KEY \(job_id, user_id\) REFERENCES company_skill_jobs\(id, user_id\) ON DELETE CASCADE/);
  assert.match(schema, /kind IN \('source', 'preview', 'final', 'manifest', 'report'\)/);
  assert.match(shared, /await ensureCompanySkillJobSchema\(sql\)/);
});
