import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const orch = () => read("prototype/functions/api/agent/_orchestrator.ts");
const api = () => read("ai-company-app/src/lib/api.ts");

test("조회 도구와 결과 정리에 시간 상한이 있다", () => {
  const src = orch();
  assert.match(src, /function withTimeout<T>\(p: Promise<T>, ms: number, label: string\)/);
  // 도구 실행
  assert.match(src, /withTimeout\(tool\.run\(parsedInput, toolCtx\), runBudget, `\$\{r\.tool\} 조회`\)/);
  // 결과 재추론(speak)
  assert.match(src, /withTimeout\(\s*\n?\s*speak\(env, agentId, synth, t2/);
  // 상한 초과는 ⏱️ 안내로 끝난다 — 조용히 사라지지 않는다
  assert.match(src, /timedOut[\s\S]{0,120}⏱️ \$\{r\.tool\} 조회가 오래 걸려서 멈췄어요/);
});

test("결과 정리가 지연되면 조회 원문이라도 내보낸다", () => {
  const src = orch();
  assert.match(src, /formatReadResult\(r\.tool, output\)\}\\n\\n⚠️ 결과 정리가 지연돼/);
  // 정리 성공했을 때만 원래 경로(마커 적용·후속 RUN)를 태운다
  assert.match(src, /let res2: SpeakResult \| null = null/);
  assert.match(src, /if \(res2\) \{/);
});

test("턴 예산이 부족하면 조회를 시작하지 않고 다음 턴으로 미룬다", () => {
  const src = orch();
  assert.match(src, /const remainingMs = \(\) => TURN_BUDGET_MS - \(Date\.now\(\) - turnStartedAt\)/);
  assert.match(src, /if \(remainingMs\(\) < RUN_MIN_MS\) \{/);
  assert.match(src, /⏸️ \$\{r\.tool\} 조회는 이번 턴에 시간이 부족해 시작하지 않았어요/);
  // '조회 중' 안내는 예산 확인을 통과한 뒤에만 나간다
  const budgetAt = src.indexOf("if (remainingMs() < RUN_MIN_MS)");
  const noticeAt = src.indexOf("${r.tool} 조회 중이에요…");
  assert.ok(budgetAt > 0 && noticeAt > budgetAt, "예산 확인이 '조회 중' 안내보다 앞에 있어야 합니다");
});

test("진행 안내는 pending 으로 표시되고 결과가 붙으면 해제된다", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  assert.match(shared, /ALTER TABLE agent_messages ADD COLUMN IF NOT EXISTS pending boolean NOT NULL DEFAULT false/);
  assert.match(shared, /INSERT INTO agent_messages \(user_id, conversation_id, role, agent_id, name, text, files, pending\)/);
  assert.match(shared, /export async function resolvePendingMessage/);
  const src = orch();
  assert.match(src, /const notice = await emit\(\{[\s\S]{0,260}pending: true,/);
  // 성공·실패 어느 경로로 끝나도 해제된다(finally)
  assert.match(src, /\} finally \{[\s\S]{0,200}resolvePendingMessage\(sql, String\(\(notice as any\)\?\.id \|\| ""\)\)/);
});

test("끊긴 진행 안내는 폴링·다음 턴에서 마무리 문구로 정리된다", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  assert.match(shared, /export async function sweepDanglingMessages/);
  // 무응답 시간을 남겨 진단에 쓸 수 있게 한다
  assert.match(shared, /⚠️ 여기서 끊겼어요\(' \|\|\s*\n\s*ROUND\(EXTRACT\(EPOCH FROM \(now\(\) - created_at\)\)\)::text/);
  assert.match(shared, /AND created_at < now\(\) - make_interval\(secs => \$3::int\)/);
  // 메시지 폴링과 새 턴 시작 양쪽에서 정리한다
  assert.match(read("prototype/functions/api/agent/messages.ts"), /await sweepDanglingMessages\(sql, auth\.userId, conversationId\)/);
  assert.match(orch(), /await sweepDanglingMessages\(sql, userId, conversationId\)/);
});

test("스트림이 done 없이 끊기면 사용자에게 알린다", () => {
  const src = api();
  assert.match(src, /let sawDone = false;/);
  assert.match(src, /else if \(event\.type === "done"\) \{\s*\n\s*sawDone = true;/);
  assert.match(src, /else if \(!sawDone && !opts\.signal\?\.aborted\)/);
  assert.match(src, /⚠️ 응답이 중간에 끊겼어요\$\{pending\}/);
  // 끊긴 지점(진행 안내로 끝난 경우)을 함께 알려준다
  assert.match(src, /\/\(중이에요…\?\|기다려주세요…\?\)\$\/\.test\(lastAgentText\.trim\(\)\)/);
});
