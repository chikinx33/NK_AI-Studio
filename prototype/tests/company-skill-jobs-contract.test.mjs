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

test("이미지 제작 예정 Skill은 PRD·와이어프레임·v1 입력 계약을 가진다", async () => {
  const [registry, schemas, prd] = await Promise.all([
    read("ai-company-app/src/lib/companySkills.ts"),
    read("ai-company-app/src/lib/companySkillSchemas.ts"),
    read("docs/ai-company-image-skill-prd.md"),
  ]);
  assert.match(registry, /id: "image"[\s\S]*inputSchema: "company-skill\/image\/v1"/);
  assert.match(registry, /executorId: "image-adapter-v1"/);
  assert.match(schemas, /"company-skill\/image\/v1"/);
  for (const mode of ["create", "edit", "variation", "background-remove", "background-replace", "resize-extend"]) assert.match(schemas, new RegExp(`"${mode}"`));
  assert.match(schemas, /candidateCount:[\s\S]*minimum: 1, maximum: 4/);
  assert.match(schemas, /role:[\s\S]*"source"[\s\S]*"mask"/);
  assert.match(prd, /공통 3열 와이어프레임/);
  assert.match(prd, /## 9\. 완료 정의/);
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
  assert.match(schema, /CREATE TABLE IF NOT EXISTS company_skill_job_events/);
  assert.match(schema, /user_id text NOT NULL/);
  assert.match(schema, /company_skill_jobs_user_status_idx[\s\S]*\(user_id, status, updated_at DESC\)/);
  assert.match(schema, /company_skill_jobs_user_idempotency_idx[\s\S]*\(user_id, idempotency_key\)/);
  assert.match(schema, /FOREIGN KEY \(job_id, user_id\) REFERENCES company_skill_jobs\(id, user_id\) ON DELETE CASCADE/);
  assert.match(schema, /company_skill_job_events_job_user_fk/);
  assert.match(schema, /kind IN \('source', 'preview', 'final', 'manifest', 'report'\)/);
  assert.match(shared, /await ensureCompanySkillJobSchema\(sql\)/);
});

test("에이전트 업무 보고는 단계·판단·품질·오류·산출물 이벤트로 누적되고 복원된다", async () => {
  const [store, executor, get, artifacts, approve, cancel, retry, client] = await Promise.all([
    read("prototype/functions/api/agent/_skill-jobs.ts"),
    read("prototype/functions/api/agent/_company-skill-executors.ts"),
    read("prototype/functions/api/agent/skill-jobs/[jobId].ts"),
    read("prototype/functions/api/agent/skill-jobs/[jobId]/artifacts.ts"),
    read("prototype/functions/api/agent/skill-jobs/[jobId]/approve.ts"),
    read("prototype/functions/api/agent/skill-jobs/[jobId]/cancel.ts"),
    read("prototype/functions/api/agent/skill-jobs/[jobId]/retry.ts"),
    read("ai-company-app/src/lib/skillJobs.ts"),
  ]);

  assert.match(store, /export async function appendCompanySkillJobEvent/);
  assert.match(store, /ON CONFLICT \(job_id, event_key\)[\s\S]*DO NOTHING/);
  assert.match(store, /export async function listCompanySkillJobEvents/);
  assert.match(store, /ORDER BY event\.created_at ASC, event\.id ASC/);
  for (const eventType of ["stage", "agent-report", "quality", "error"]) {
    assert.match(executor, new RegExp(`eventType: "${eventType}"`));
  }
  assert.match(get, /listCompanySkillJobEvents/);
  assert.match(get, /toCompanySkillJobDto\(job, events\)/);
  assert.match(artifacts, /eventType: "artifact"/);
  assert.match(approve, /eventType: "approval"/);
  assert.match(cancel, /stage: "cancelled"/);
  assert.match(retry, /실패한 SkillJob을 다시 시작했습니다/);
  assert.match(client, /export interface SkillJobEvent/);
  assert.match(client, /events: SkillJobEvent\[\]/);
});

test("공통 SkillJob 저장소는 사용자 격리와 원자적 상태 전이를 강제한다", async () => {
  const store = await read("prototype/functions/api/agent/_skill-jobs.ts");

  assert.match(store, /ON CONFLICT \(user_id, idempotency_key\)[\s\S]*DO NOTHING/);
  assert.match(store, /WHERE id = \$1 AND user_id = \$2 LIMIT 1/);
  assert.match(store, /let where = `id = \$\$\{jobIdIndex\} AND user_id = \$\$\{userIdIndex\} AND status = \$\$\{currentStatusIndex\}`/);
  assert.match(store, /CompanySkillJobTransitionError/);
  assert.match(store, /expectedExecutionToken/);
  assert.match(store, /execution_token = \$3[\s\S]*execution_started_at = now\(\)/);
  assert.match(store, /execution_started_at < now\(\) - interval '30 minutes'/);
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
  assert.match(artifacts, /onRequestPost/);
  assert.match(artifacts, /registerCompanySkillArtifact/);
  assert.match(artifacts, /allowedPrefix/);
  assert.match(artifacts, /objectPath\.includes\(`\/\$\{workItemId\}\/`\)/);
  assert.match(client, /createCompanySkillJob/);
  assert.match(client, /getCompanySkillJob/);
  assert.match(client, /cancelCompanySkillJob/);
  assert.match(client, /retryCompanySkillJob/);
  assert.match(client, /approveCompanySkillJob/);
  assert.match(client, /listCompanySkillJobArtifacts/);
  assert.match(client, /registerCompanySkillJobArtifacts/);
});

test("산출물 등록은 SkillJob 사용자·업무·경로에 묶이고 버전과 계보 manifest를 보존한다", async () => {
  const [store, endpoint, workspace] = await Promise.all([
    read("prototype/functions/api/agent/_skill-jobs.ts"),
    read("prototype/functions/api/agent/skill-jobs/[jobId]/artifacts.ts"),
    read("ai-company-app/src/contexts/AgentVideoWorkspaceContext.tsx"),
  ]);

  assert.match(store, /export async function registerCompanySkillArtifact/);
  assert.match(store, /WHERE job\.id = \$1 AND job\.user_id = \$2/);
  assert.match(store, /job\.work_item_id = \$3::uuid/);
  assert.match(store, /ON CONFLICT \(job_id, object_path\) DO UPDATE/);
  assert.match(endpoint, /buildAiVideoProjectPrefix\(storage\.basePrefix, auth\.userId, "ai-company"\)/);
  assert.match(workspace, /sha256Hex/);
  assert.match(workspace, /"source\.json"/);
  assert.match(workspace, /"report\.json"/);
  assert.match(workspace, /"manifest\.json"/);
  assert.match(workspace, /lineage: job\?\.lineage \|\| \[\]/);
  assert.match(workspace, /registerCompanySkillJobArtifacts\(skillJobId/);
});

test("공통 실행기는 인포그래픽 어댑터를 통해 상태·보고·품질 결과를 완결한다", async () => {
  const [executor, create, retry] = await Promise.all([
    read("prototype/functions/api/agent/_company-skill-executors.ts"),
    read("prototype/functions/api/agent/skills/[skillId]/jobs.ts"),
    read("prototype/functions/api/agent/skill-jobs/[jobId]/retry.ts"),
  ]);

  assert.match(executor, /id: "infographic-adapter-v1"/);
  assert.match(executor, /"\/api\/agent\/agent-video"/);
  assert.match(executor, /claimCompanySkillJobExecution/);
  for (const status of ["planning", "running", "reviewing", "completed", "failed"]) {
    assert.match(executor, new RegExp(`transitionCompanySkillJob\\([\\s\\S]*?"${status}"`));
  }
  assert.match(executor, /agentReports: result\.agentReports/);
  assert.match(executor, /qualityResults: result\.qualityResults/);
  assert.match(executor, /workItemId: result\.workItemId/);
  assert.match(create, /runCompanySkillJob/);
  assert.match(create, /waitUntil\(execution\.then/);
  assert.match(create, /searchParams\.get\("wait"\) === "1"/);
  assert.match(retry, /waitUntil\(runCompanySkillJob/);
});

test("채팅과 직접 실행은 공통 SkillJob API를 사용하고 진행 중 업무를 복원한다", async () => {
  const [shared, workspace, client, legacyEndpoint] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("ai-company-app/src/contexts/AgentVideoWorkspaceContext.tsx"),
    read("ai-company-app/src/lib/api.ts"),
    read("prototype/functions/api/agent/agent-video.ts"),
  ]);

  assert.match(shared, /\/api\/agent\/skills\/infographic\/jobs\?wait=1/);
  assert.match(shared, /invocationMode: "agent"/);
  assert.match(workspace, /createCompanySkillJob\("infographic"/);
  assert.match(workspace, /invocationMode: "manual"/);
  assert.match(workspace, /SKILL_JOB_STORAGE_KEY/);
  assert.match(workspace, /waitForCompanySkillJob/);
  assert.match(workspace, /localStorage\.getItem\(SKILL_JOB_STORAGE_KEY\)/);
  assert.match(client, /export async function waitForCompanySkillJob/);
  assert.match(legacyEndpoint, /skillJobId:[^\n]*body\?\.skillJobId/);
});

test("공통 비용 게이트는 구독 포함·API 단가 예측·상한·승인 대기와 재개를 강제한다", async () => {
  const [costs, executor, approve, client, workspace, schema] = await Promise.all([
    read("prototype/functions/api/agent/_company-skill-costs.ts"),
    read("prototype/functions/api/agent/_company-skill-executors.ts"),
    read("prototype/functions/api/agent/skill-jobs/[jobId]/approve.ts"),
    read("ai-company-app/src/lib/api.ts"),
    read("ai-company-app/src/contexts/AgentVideoWorkspaceContext.tsx"),
    read("ai-company-app/src/lib/companySkillSchemas.ts"),
  ]);

  assert.match(costs, /auth\.mode === "subscription"/);
  assert.match(costs, /costPolicy === "no-external-cost"/);
  assert.match(costs, /category: "included"/);
  assert.match(costs, /COMPANY_SKILL_ANTHROPIC_INPUT_USD_PER_MTOK/);
  assert.match(costs, /COMPANY_SKILL_ANTHROPIC_OUTPUT_USD_PER_MTOK/);
  assert.match(costs, /amount == null \|\| amount > maxAmountUsd/);
  assert.match(costs, /rateSource:[\s\S]*"not-configured"/);
  assert.match(executor, /currentStage: "awaiting-approval"/);
  assert.match(executor, /status: "pending"/);
  assert.match(executor, /hasMatchingCostApproval/);
  assert.match(executor, /actualCost: buildActualCompanySkillCost/);
  assert.match(approve, /currentApproval\.status !== "pending"/);
  assert.match(approve, /waitUntil\(runCompanySkillJob/);
  assert.match(approve, /cancelCompanySkillJob/);
  assert.match(client, /approvalState\?\.status === "pending"/);
  assert.match(workspace, /pendingApproval/);
  assert.match(workspace, /decideCostApproval/);
  assert.match(workspace, /actualCost: job\?\.actualCost/);
  assert.match(schema, /maxAmountUsd/);
});

test("SkillJob 실제 PostgreSQL 통합 검증은 격리 컨테이너에서 핵심 복구 계약을 실행한다", async () => {
  const [integration, packageJson] = await Promise.all([
    read("prototype/tests/company-skill-jobs-db.integration.mjs"),
    read("package.json"),
  ]);

  assert.match(packageJson, /"test:skill-db": "node prototype\/tests\/company-skill-jobs-db\.integration\.mjs"/);
  assert.match(integration, /postgres:16-alpine/);
  assert.match(integration, /createCompanySkillJob/);
  assert.match(integration, /integration-user-a/);
  assert.match(integration, /integration-user-b/);
  assert.match(integration, /duplicate\.created, false/);
  assert.match(integration, /claimCompanySkillJobExecution/);
  assert.match(integration, /retryCompanySkillJob/);
  assert.match(integration, /cancelCompanySkillJob/);
  assert.match(integration, /listCompanySkillJobEvents/);
  assert.match(integration, /docker", \["rm", "--force", containerName\]/);
});

test("채팅과 직접 실행의 서버 렌더는 인증 큐·콜백·최종 산출물 완료 계약을 공유한다", async () => {
  const [renderer, executor, callback, storage, server, shared, orchestrator, app, workspace] = await Promise.all([
    read("prototype/functions/api/agent/_company-skill-renderer.ts"),
    read("prototype/functions/api/agent/_company-skill-executors.ts"),
    read("prototype/functions/api/agent/skill-jobs/[jobId]/render-output.ts"),
    read("prototype/functions/api/agent/_company-skill-artifact-storage.ts"),
    read("server.js"),
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
    read("ai-company-app/src/App.tsx"),
    read("ai-company-app/src/contexts/AgentVideoWorkspaceContext.tsx"),
  ]);

  assert.match(renderer, /COMPANY_SKILL_RENDERER_URL/);
  assert.match(renderer, /COMPANY_SKILL_RENDERER_TOKEN/);
  assert.match(renderer, /Idempotency-Key/);
  assert.match(renderer, /render-output/);
  assert.match(executor, /dispatchCompanySkillRender/);
  assert.match(executor, /currentStage: "rendering"/);
  assert.match(executor, /renderMode: resolveCompanySkillRenderer/);
  assert.match(callback, /matchesCompanySkillRendererToken/);
  assert.match(callback, /"final"/);
  assert.match(callback, /"source"/);
  assert.match(callback, /"report"/);
  assert.match(callback, /"manifest"/);
  assert.match(callback, /transitionCompanySkillJob\(sql, job\.user_id, job\.id, "completed"/);
  assert.match(storage, /buildAiVideoProjectPrefix\(ctx\.basePrefix, args\.userId, "ai-company"\)/);
  assert.match(server, /\/company-skill-render/);
  assert.match(server, /postCompanySkillRenderCallback/);
  assert.match(server, /crypto\.timingSafeEqual/);
  assert.match(shared, /renderMode: job\?\.providerUsage\?\.renderMode/);
  assert.match(orchestrator, /renderMode: output\?\.renderMode/);
  assert.match(app, /data\.payload\.renderMode !== "server"/);
  assert.match(workspace, /job\.providerUsage\?\.renderMode !== "server"/);
});
