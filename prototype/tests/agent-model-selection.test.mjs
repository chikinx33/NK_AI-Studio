import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * 에이전트별 두뇌(제공사·모델) 선택 계약.
 *
 * 배경: 두뇌가 Claude 로 고정돼 있었고, 오케스트레이터 안에는 지연시간 대책으로
 * 박아둔 모델 이름("코어 위임은 Sonnet", "5명 이상 그룹은 Haiku")이 있었다.
 * 사용자가 직원마다 모델을 고를 수 있게 되면서, 그 하드코딩이 사용자의 선택을
 * 조용히 덮어쓰면 안 된다는 규칙이 새로 생겼다. 그걸 여기서 못 박는다.
 *
 * 소스를 정규식으로 훑는 대신 실제로 실행해 반환값·요청 형태를 검증한다.
 */

const API = path.join(process.cwd(), "prototype/functions/api");
const readSrc = (rel) => fs.readFileSync(path.join(API, rel), "utf8");

/** ESM 모듈에서 import/export 키워드만 걷어내고 vm 에서 평가한다. */
function evalModule(src, sandbox = {}, tail = "") {
  const stripped = src
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];$/gm, "")
    .replace(/^export default .*$/m, "")
    .replace(/^export /gm, "");
  const ctx = vm.createContext({ console, setTimeout, Response, fetch: undefined, ...sandbox });
  vm.runInContext(stripped + "\n" + tail, ctx);
  return ctx;
}

const models = evalModule(
  readSrc("_shared/cloud-models.js"),
  {},
  `globalThis.__api = { resolveAgentModel, sanitizeModelSelections, normalizeModelChoice,
     normalizeProvider, isAnthropicProvider, MODEL_CATALOG, CLOUD_MODELS };`
).__api;

// ── 해석 우선순위 ───────────────────────────────────────────────────────────
test("설정이 없으면 기존 CLOUD_MODELS 기본값을 그대로 쓴다", () => {
  assert.equal(
    JSON.stringify(models.resolveAgentModel("core", {})),
    '{"provider":"anthropic","model":"claude-opus-4-8"}'
  );
  assert.equal(models.resolveAgentModel("sync", {}).model, "claude-haiku-4-5");
});

test("사용자가 고른 두뇌가 성능 힌트를 이긴다 (하드코딩이 선택을 덮지 않는다)", () => {
  const selections = { ink: { provider: "atlas", model: "openai/gpt-5.6-luna" } };
  // 대규모 그룹일 때 오케스트레이터가 넘기는 Haiku 힌트
  const got = models.resolveAgentModel("ink", selections, undefined, "claude-haiku-4-5-20251001");
  assert.equal(got.provider, "atlas");
  assert.equal(got.model, "openai/gpt-5.6-luna");
});

test("고르지 않은 직원에게는 성능 힌트가 그대로 적용된다", () => {
  const selections = { ink: { provider: "atlas", model: "openai/gpt-5.6-luna" } };
  const got = models.resolveAgentModel("beat", selections, undefined, "claude-haiku-4-5-20251001");
  assert.equal(got.model, "claude-haiku-4-5-20251001");
});

test("코드가 강제한 모델(override)은 사용자 선택보다도 우선한다", () => {
  const selections = { ink: { provider: "atlas", model: "openai/gpt-5.6-luna" } };
  assert.equal(models.resolveAgentModel("ink", selections, "claude-opus-4-8").model, "claude-opus-4-8");
});

test("옛 저장 형식(모델 이름 문자열)은 anthropic 으로 읽힌다", () => {
  assert.equal(
    JSON.stringify(models.normalizeModelChoice("claude-sonnet-4-6")),
    '{"provider":"anthropic","model":"claude-sonnet-4-6"}'
  );
  assert.equal(models.resolveAgentModel("ink", { ink: "claude-opus-4-8" }).provider, "anthropic");
});

// ── 저장 전 검증 ────────────────────────────────────────────────────────────
test("카탈로그에 없는 조합과 모르는 직원은 저장되지 않는다", () => {
  const empty = (v) => assert.equal(Object.keys(models.sanitizeModelSelections(v)).length, 0);
  empty({ ink: { provider: "anthropic", model: "gpt-9" } });
  empty({ nobody: { provider: "atlas", model: "openai/gpt-5.5" } });
  empty({ ink: { provider: "hacker", model: "openai/gpt-5.5" } });
});

test("정상 조합은 통과하고, 직접 입력은 OpenAI 직접 호출에서만 허용된다", () => {
  assert.equal(
    JSON.stringify(models.sanitizeModelSelections({ ink: { provider: "atlas", model: "openai/gpt-5.5" } })),
    '{"ink":{"provider":"atlas","model":"openai/gpt-5.5"}}'
  );
  assert.equal(models.sanitizeModelSelections({ ink: { provider: "openai", model: "gpt-6-x" } }).ink.model, "gpt-6-x");
});

test("직접 입력 모델 ID 에 공백·개행을 끼워 넣을 수 없다 (헤더 주입 차단)", () => {
  const out = models.sanitizeModelSelections({ ink: { provider: "openai", model: "a b\nHost: evil" } });
  assert.equal(Object.keys(out).length, 0);
});

// ── 제공사별 호출 형태 ──────────────────────────────────────────────────────
function loadLlm(stubs) {
  return evalModule(
    readSrc("_shared/llm.js"),
    {
      buildClaudeSystem: (sub, s) => (sub ? [{ type: "text", text: s }] : s),
      claudeFetch: stubs.claudeFetch || (async () => new Response("{}", { status: 200 })),
      isAnthropicProvider: models.isAnthropicProvider,
      normalizeProvider: models.normalizeProvider,
      isCreditExhausted: (t, s) => s === 402 || /credit balance/i.test(String(t)),
      fetch: stubs.fetch,
    },
    "globalThis.__callLLM = callLLM;"
  ).__callLLM;
}

const OK_CHAT = JSON.stringify({ choices: [{ message: { content: "안녕하세요" } }] });

test("Atlas 경유 GPT 는 OpenAI 규격으로 api.atlascloud.ai 에 간다", async () => {
  const seen = [];
  const callLLM = loadLlm({
    fetch: async (url, init) => {
      seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return new Response(OK_CHAT, { status: 200 });
    },
  });
  const out = await callLLM(
    { ATLASCLOUD_API_KEY: "atlas-key" },
    { provider: "atlas", model: "openai/gpt-5.6-luna", system: "SYS", messages: [{ role: "user", content: "안녕" }], maxTokens: 500 }
  );
  assert.equal(out, "안녕하세요");
  assert.equal(seen[0].url, "https://api.atlascloud.ai/v1/chat/completions");
  assert.equal(seen[0].headers.Authorization, "Bearer atlas-key");
  // Anthropic 과 달리 system 은 별도 필드가 아니라 messages 의 첫 항목이다.
  assert.equal(seen[0].body.messages[0].role, "system");
  assert.equal(seen[0].body.messages[0].content, "SYS");
  assert.equal(seen[0].body.model, "openai/gpt-5.6-luna");
});

test("OpenAI 직접 호출은 OPENAI_API_KEY 로 api.openai.com 에 간다", async () => {
  const seen = [];
  const callLLM = loadLlm({
    fetch: async (url, init) => {
      seen.push({ url, headers: init.headers });
      return new Response(OK_CHAT, { status: 200 });
    },
  });
  await callLLM({ OPENAI_API_KEY: "sk-x" }, { provider: "openai", model: "gpt-5.6-terra", system: "S", messages: [] });
  assert.equal(seen[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(seen[0].headers.Authorization, "Bearer sk-x");
});

test("max_tokens 를 거부하는 모델에는 max_completion_tokens 로 한 번 바꿔 재시도한다", async () => {
  const seen = [];
  let n = 0;
  const callLLM = loadLlm({
    fetch: async (_url, init) => {
      seen.push(JSON.parse(init.body));
      return n++ === 0
        ? new Response('{"error":{"message":"Unsupported parameter: max_tokens"}}', { status: 400 })
        : new Response(OK_CHAT, { status: 200 });
    },
  });
  const out = await callLLM(
    { OPENAI_API_KEY: "sk-x" },
    { provider: "openai", model: "gpt-5.6-sol", messages: [], maxTokens: 300 }
  );
  assert.equal(out, "안녕하세요");
  assert.equal(seen.length, 2);
  assert.equal(seen[0].max_tokens, 300);
  assert.equal(seen[1].max_completion_tokens, 300);
  assert.equal(seen[1].max_tokens, undefined);
});

test("이미지는 OpenAI 규격 data URL 로, PDF 는 아예 보내지 않는다", async () => {
  const seen = [];
  const callLLM = loadLlm({
    fetch: async (_u, init) => {
      seen.push(JSON.parse(init.body));
      return new Response(OK_CHAT, { status: 200 });
    },
  });
  const env = { ATLASCLOUD_API_KEY: "k" };
  const base = { provider: "atlas", model: "openai/gpt-5.5", messages: [{ role: "user", content: "이거" }] };

  await callLLM(env, { ...base, images: [{ base64: "AAA", mimeType: "image/png" }] });
  const withImg = seen[0].messages.at(-1).content;
  assert.ok(Array.isArray(withImg));
  assert.equal(withImg[0].image_url.url, "data:image/png;base64,AAA");
  assert.equal(withImg[1].text, "이거");

  // chat/completions 는 PDF 를 이미지처럼 받지 않는다 — 400 을 맞느니 텍스트만 살린다.
  await callLLM(env, { ...base, images: [{ base64: "P", mimeType: "application/pdf" }] });
  assert.equal(seen[1].messages.at(-1).content, "이거");
});

test("키가 없으면 어떤 환경변수가 비었는지 알려준다", async () => {
  const callLLM = loadLlm({ fetch: async () => new Response("{}", { status: 200 }) });
  await assert.rejects(
    () => callLLM({}, { provider: "atlas", model: "openai/gpt-5.5", messages: [] }),
    /ATLASCLOUD_API_KEY/
  );
  await assert.rejects(
    () => callLLM({}, { provider: "openai", model: "gpt-5.5", messages: [] }),
    /OPENAI_API_KEY/
  );
});

test("OpenAI 쪽 잔액 부족도 CREDIT_EXHAUSTED 로 통일된다", async () => {
  const callLLM = loadLlm({
    fetch: async () => new Response('{"error":{"message":"credit balance too low"}}', { status: 402 }),
  });
  await assert.rejects(
    () => callLLM({ ATLASCLOUD_API_KEY: "k" }, { provider: "atlas", model: "openai/gpt-5.5", messages: [] }),
    (e) => e.code === "CREDIT_EXHAUSTED"
  );
});

// ── 배선 계약 (소스 수준) ───────────────────────────────────────────────────
test("오케스트레이터의 지연시간 대책은 강제(model)가 아니라 힌트(modelHint)로 넘어간다", () => {
  const src = readSrc("agent/_orchestrator.ts");
  assert.match(src, /modelHint: canDelegate \? "claude-sonnet-4-6" : undefined/);
  assert.match(src, /modelHint: workerModel/);
  // 사용자 선택을 무시하고 모델을 박아 넣는 경로가 남아 있으면 안 된다.
  assert.doesNotMatch(src, /model: opts\.model \|\| modelFor\(/);
});

test("비 Anthropic 제공사를 고르면 Claude 인증을 해석하지 않는다", () => {
  const src = readSrc("agent/_orchestrator.ts");
  // Claude 자격증명이 없어도 GPT 만으로 돌아가야 한다.
  assert.match(src, /if \(isAnthropicProvider\(choice\.provider\)\) \{[\s\S]*?resolvedAuthHeaders/);
});

test("그룹 대화는 두뇌 선택을 한 번만 읽어 전 직원이 공유한다", () => {
  const src = readSrc("agent/_orchestrator.ts");
  assert.match(src, /cachedModelSelections = await getAgentModelSelections/);
  assert.match(src, /modelSelections: cachedModelSelections/);
});

test("설정 API 가 카탈로그를 내려주고 선택을 검증해 저장한다", () => {
  const src = readSrc("agent/settings.ts");
  assert.match(src, /modelCatalog: MODEL_CATALOG/);
  assert.match(src, /kind === "agentModel"/);
  assert.match(src, /sanitizeModelSelections\(body\.selections\)/);
});

test("설정 화면이 직원별 제공사·모델 선택 UI 를 제공한다", () => {
  const ui = fs.readFileSync(
    path.join(process.cwd(), "ai-company-app/src/components/Settings.tsx"),
    "utf8"
  );
  assert.match(ui, /에이전트별 두뇌/);
  assert.match(ui, /changeProvider/);
  assert.match(ui, /changeModel/);
  assert.match(ui, /saveAgentModels/);
  assert.match(ui, /resetAgentModels/);
});
