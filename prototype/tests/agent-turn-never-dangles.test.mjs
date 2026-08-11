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

test("스트림이 done 없이 끊기면 사용자에게 알린다", () => {
  const src = api();
  assert.match(src, /let sawDone = false;/);
  assert.match(src, /else if \(event\.type === "done"\) \{\s*\n\s*sawDone = true;/);
  assert.match(src, /else if \(!sawDone && !opts\.signal\?\.aborted\)/);
  assert.match(src, /⚠️ 응답이 중간에 끊겼어요\$\{pending\}/);
  // 끊긴 지점(진행 안내로 끝난 경우)을 함께 알려준다
  assert.match(src, /\/\(중이에요…\?\|기다려주세요…\?\)\$\/\.test\(lastAgentText\.trim\(\)\)/);
});
