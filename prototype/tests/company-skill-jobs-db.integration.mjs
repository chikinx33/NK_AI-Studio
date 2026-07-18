import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const containerName = `nk-studio-skilljob-test-${process.pid}`;
const databaseName = "skilljob_test";
let tempDirectory = "";
let containerStarted = false;

function docker(args, input) {
  return execFileSync("docker", args, {
    cwd: repositoryRoot,
    input,
    encoding: "utf8",
    stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
  });
}

function sqlLiteral(value) {
  if (value == null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function expandParameters(query, params = []) {
  return query.replace(/\$(\d+)\b/g, (_, rawIndex) => sqlLiteral(params[Number(rawIndex) - 1]));
}

async function sql(query, params = []) {
  const expanded = expandParameters(String(query).trim().replace(/;\s*$/, ""), params);
  const returnsRows = /^(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(expanded);
  const command = returnsRows
    ? `WITH result_rows AS (${expanded}) SELECT COALESCE(json_agg(row_to_json(result_rows)), '[]'::json) FROM result_rows;`
    : `${expanded};`;
  const output = docker(["exec", "-i", containerName, "psql", "-X", "-q", "-t", "-A", "-U", "postgres", "-d", databaseName], command);
  if (!returnsRows) return [];
  return JSON.parse(output.trim() || "[]");
}

async function waitForPostgres() {
  let consecutiveReadyChecks = 0;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = spawnSync("docker", ["exec", containerName, "pg_isready", "-U", "postgres", "-d", databaseName], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    if (result.status === 0) {
      consecutiveReadyChecks += 1;
      if (consecutiveReadyChecks >= 3) return;
    } else {
      consecutiveReadyChecks = 0;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error("임시 PostgreSQL이 30초 안에 준비되지 않았습니다.");
}

async function loadStoreModule() {
  tempDirectory = await mkdtemp(resolve(tmpdir(), "nk-skilljob-db-"));
  const outputFile = resolve(tempDirectory, "skill-jobs.mjs");
  const esbuildCli = resolve(repositoryRoot, "ai-company-app/node_modules/esbuild/bin/esbuild");
  execFileSync(process.execPath, [
    esbuildCli,
    resolve(repositoryRoot, "prototype/functions/api/agent/_skill-jobs.ts"),
    "--bundle",
    "--platform=node",
    "--format=esm",
    `--outfile=${outputFile}`,
  ], { cwd: repositoryRoot, stdio: "pipe" });
  return import(`${pathToFileURL(outputFile).href}?run=${Date.now()}`);
}

async function main() {
  docker(["info", "--format", "{{.ServerVersion}}"]);
  docker([
    "run", "--rm", "--detach", "--name", containerName,
    "--env", "POSTGRES_PASSWORD=skilljob-test-only",
    "--env", `POSTGRES_DB=${databaseName}`,
    "postgres:16-alpine",
  ]);
  containerStarted = true;
  await waitForPostgres();

  const store = await loadStoreModule();
  await store.ensureCompanySkillJobSchema(sql);
  const base = {
    conversationId: "integration",
    companyId: null,
    categoryId: "design-content",
    skillId: "infographic",
    invocationMode: "manual",
    title: "통합 테스트",
    originalTitle: "통합 테스트 원본 제목",
    input: { request: "실제 PostgreSQL 계약 검증", options: {} },
    warnings: [],
    idempotencyKey: "integration-shared-key",
  };

  const first = await store.createCompanySkillJob(sql, { ...base, userId: "integration-user-a" });
  const duplicate = await store.createCompanySkillJob(sql, { ...base, userId: "integration-user-a" });
  const otherUser = await store.createCompanySkillJob(sql, { ...base, userId: "integration-user-b" });
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.job.id, first.job.id);
  assert.notEqual(otherUser.job.id, first.job.id);
  assert.equal(await store.getCompanySkillJob(sql, "integration-user-b", first.job.id), null);

  const planning = await store.transitionCompanySkillJob(sql, "integration-user-a", first.job.id, "planning", { progress: 10 });
  assert.equal(planning.status, "planning");
  const lease = await store.claimCompanySkillJobExecution(sql, "integration-user-a", first.job.id, "lease-a");
  assert.equal(lease.execution_token, "lease-a");
  assert.equal(await store.claimCompanySkillJobExecution(sql, "integration-user-a", first.job.id, "lease-b"), null);

  const failed = await store.transitionCompanySkillJob(sql, "integration-user-a", first.job.id, "failed", {
    currentStage: "planning",
    error: { code: "INTEGRATION_FAILURE", message: "의도한 실패", retryable: true, stage: "planning" },
    resetExecutionLease: true,
    expectedExecutionToken: "lease-a",
  });
  assert.equal(failed.status, "failed");
  const retried = await store.retryCompanySkillJob(sql, "integration-user-a", first.job.id);
  assert.equal(retried.status, "planning");
  assert.equal(retried.error, null);

  const cancelled = await store.cancelCompanySkillJob(sql, "integration-user-b", otherUser.job.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(await store.getCompanySkillJob(sql, "integration-user-a", otherUser.job.id), null);

  await store.appendCompanySkillJobEvent(sql, {
    jobId: first.job.id,
    userId: "integration-user-a",
    eventType: "stage",
    stage: "planning",
    status: "working",
    summary: "복원 이벤트",
    eventKey: "integration-restore-event",
  });
  await store.appendCompanySkillJobEvent(sql, {
    jobId: first.job.id,
    userId: "integration-user-a",
    eventType: "stage",
    stage: "planning",
    status: "working",
    summary: "중복 이벤트",
    eventKey: "integration-restore-event",
  });
  const events = await store.listCompanySkillJobEvents(sql, "integration-user-a", first.job.id);
  assert.equal(events.filter((event) => event.event_key === "integration-restore-event").length, 1);
  const restored = store.toCompanySkillJobDto(await store.getCompanySkillJob(sql, "integration-user-a", first.job.id), events);
  assert.equal(restored.status, "planning");
  assert.equal(restored.events.length, 1);

  console.log("SkillJob PostgreSQL integration: PASS (user isolation, idempotency, lease, failure/retry, cancel, restore)");
}

try {
  await main();
} finally {
  if (containerStarted) spawnSync("docker", ["rm", "--force", containerName], { cwd: repositoryRoot, stdio: "ignore" });
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
}
