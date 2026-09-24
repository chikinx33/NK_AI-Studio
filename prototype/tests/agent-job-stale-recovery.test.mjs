import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

test("오래된 queued 일반 작업은 실패로 닫혀 아바타를 영구 점등하지 않는다", async () => {
  const [shared, jobs, api] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/jobs.ts"),
    read("ai-company-app/src/lib/api.ts"),
  ]);

  assert.match(shared, /export async function expireStaleQueuedAgentJobs/);
  assert.match(shared, /status = 'queued'[\s\S]*interval '5 minutes'/);
  assert.match(shared, /status = 'error'/);
  // 만료 정비는 폴링마다가 아니라 runJobMaintenance(사용자별 20초) 안에서 돈다.
  assert.match(shared, /await expireStaleQueuedAgentJobs\(sql, ctx\.userId\)\.catch/);
  assert.match(jobs, /await runJobMaintenance\(pollCtx, sql/);
  assert.match(api, /const isActiveAgentJob = \(job: any\): boolean/);
  assert.match(api, /Date\.now\(\) - createdAt < 5 \* 60 \* 1000/);
  assert.match(api, /\.filter\(isActiveAgentJob\)/);
});

test("일반 작업과 SkillJob 취소 도구를 구분하고 짧은 일반 작업 ID도 안전하게 해석한다", async () => {
  const [shared, orchestrator] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);

  assert.match(shared, /async function runAgentJobCancelTool/);
  assert.match(shared, /id::text LIKE \$2/);
  assert.match(shared, /rows\.length > 1/);
  assert.match(shared, /jobKind: "agent_job"/);
  assert.match(shared, /cancelTool: \["queued", "working", "review_pending", "revise"\]/);
  assert.match(shared, /job_cancel: \{[^\n]*run: runAgentJobCancelTool/);
  assert.match(orchestrator, /jobKind가 agent_job이고 cancelTool이 job_cancel/);
  assert.match(orchestrator, /skill_job_cancel은 UUID형 제작 파이프라인에만 쓴다/);
});
