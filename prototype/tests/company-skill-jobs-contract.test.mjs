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
  assert.match(schemas, /required: \["invocationMode", "request"\]/);
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

test("공통 SkillJob 저장소는 사용자 격리와 원자적 상태 전이를 강제한다", async () => {
  const store = await read("prototype/functions/api/agent/_skill-jobs.ts");

  assert.match(store, /ON CONFLICT \(user_id, idempotency_key\)[\s\S]*DO NOTHING/);
  assert.match(store, /WHERE id = \$1 AND user_id = \$2 LIMIT 1/);
  assert.match(store, /WHERE id = \$\$\{jobIdIndex\} AND user_id = \$\$\{userIdIndex\} AND status = \$\$\{currentStatusIndex\}/);
  assert.match(store, /CompanySkillJobTransitionError/);
  assert.match(store, /FOREIGN KEY \(job_id, user_id\)/);
  assert.match(store, /toCompanySkillJobDto/);
});

test("공통 SkillJob API는 생성·복원·취소·재시도·승인·산출물 조회 계약을 제공한다", async () => {
  const [create, get, cancel, retry, approve, artifacts, client] = await Promise.all([
    read("prototype/functions/api/agent/skills/[skillId]/jobs.ts"),
    read("prototype/functions/api/agent/skill-jobs/[jobId].ts"),
    read("prototype/functions/api/agent/skill-jobs/[jobId]/cancel.ts"),
    read("prototype/functions/api/agent/skill-jobs/[jobId]/retry.ts"),
    read("prototype/functions/api/agent/skill-jobs/[jobId]/approve.ts"),
    read("prototype/functions/api/agent/skill-jobs/[jobId]/artifacts.ts"),
    read("ai-company-app/src/lib/api.ts"),
  ]);

  for (const endpoint of [create, get, cancel, retry, approve, artifacts]) {
    assert.match(endpoint, /authorizeRequest/);
    assert.match(endpoint, /ensureAgentSchema/);
  }
  assert.match(create, /Idempotency-Key/);
  assert.match(create, /createCompanySkillJob/);
  assert.match(get, /getCompanySkillJob/);
  assert.match(cancel, /cancelCompanySkillJob/);
  assert.match(retry, /retryCompanySkillJob/);
  assert.match(approve, /setCompanySkillJobApproval/);
  assert.match(artifacts, /listCompanySkillArtifacts/);
  assert.match(client, /createCompanySkillJob/);
  assert.match(client, /getCompanySkillJob/);
  assert.match(client, /cancelCompanySkillJob/);
  assert.match(client, /retryCompanySkillJob/);
  assert.match(client, /approveCompanySkillJob/);
  assert.match(client, /listCompanySkillJobArtifacts/);
});
