// prototype/tests/agent-doc-synthesis-budget.test.mjs
// 직원이 PDF 를 읽고 구조화 MD 를 쓰다 끊기던 문제(2026-09-25).
//  - 출력 토큰 기본 상한 1500 → MD 가 중간에 잘림
//  - 파일 읽기 뒤 정리 단계 30초 한도 → "결과 정리가 지연돼 원문으로 대신" 폴백
//  - 3분 동안 이벤트가 없으면 스트림이 끊길 수 있음 → ping 하트비트
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

test("출력 토큰 기본 상한은 6000 이고 Anthropic·OpenAI 호환 경로 모두 같은 값을 쓴다", async () => {
  const llm = await read("prototype/functions/api/_shared/llm.js");
  assert.match(llm, /const DEFAULT_MAX_TOKENS = 6000;/);
  assert.match(llm, /max_tokens: opts\.maxTokens \|\| DEFAULT_MAX_TOKENS,/);
  assert.match(llm, /body\[tokenField\] = opts\.maxTokens \|\| DEFAULT_MAX_TOKENS;/);
  assert.doesNotMatch(llm, /\|\| 1500/);
});

test("회사 파일 읽기 뒤 정리는 3분·12000토큰까지 허용하고, 문서 작업 규칙(전문 보존·끝까지)을 지시한다", async () => {
  const orch = await read("prototype/functions/api/agent/_orchestrator.ts");
  assert.match(orch, /const DOC_SYNTH_TIMEOUT_MS = 180000;/);
  assert.match(orch, /const DOC_SYNTH_MAX_TOKENS = 12000;/);
  assert.match(orch, /const DOC_READ_TOOLS = new Set\(\["company_files_read"\]\);/);
  assert.match(orch, /const isDocRead = DOC_READ_TOOLS\.has\(r\.tool\);/);
  assert.match(orch, /\.\.\.\(isDocRead \? \{ maxTokens: DOC_SYNTH_MAX_TOKENS \} : \{\}\) \}\),\s*isDocRead \? DOC_SYNTH_TIMEOUT_MS : SYNTH_TIMEOUT_MS,/);
  assert.match(orch, /요약하지 말고 원문 정보를 최대한 보존해 한 번에 끝까지 쓰세요/);
  assert.match(orch, /hasMore=true 가 있으면 먼저 같은 도구를 \{"offset": nextOffset\} 로 이어서 읽어/);
  // speak 는 maxTokens 를 그대로 모델 호출에 넘긴다
  assert.match(orch, /maxTokens: opts\.maxTokens, images: opts\.images/);
});

test("채팅 스트림은 15초마다 ping 을 보내고 끝나면 멈춘다; 클라이언트는 모르는 type 을 무시한다", async () => {
  const [chat, api] = await Promise.all([read("prototype/functions/api/agent/chat.ts"), read("ai-company-app/src/lib/api.ts")]);
  assert.match(chat, /const heartbeat = setInterval\(\(\) => \{ void sse\(\{ type: "ping", t: Date\.now\(\) \}\); \}, 15000\);/);
  assert.match(chat, /\} finally \{\s*clearInterval\(heartbeat\);\s*try \{ writer\.close\(\); \} catch \{\}/);
  const parser = api.slice(api.indexOf('event.type === "msg"'), api.indexOf('event.type === "done"') + 400);
  assert.doesNotMatch(parser, /else \{\s*throw/, "알 수 없는 이벤트는 조용히 지나간다");
});
