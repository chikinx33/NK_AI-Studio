import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * 구독(OAuth) 토큰이 거부됐을 때 API 키로 넘어가는 계약.
 *
 * 배경: 구독 인증은 Anthropic 이 Claude Code 제품용으로 여는 통로라, 정책이 바뀌면
 * 예고 없이 401/403 이 된다. 그때 사용자가 등록해 둔 API 키로 이어받게 하는 장치다.
 *
 * 이 테스트가 생긴 이유: 처음 구현할 때 "본문에 'Request not allowed' 가 있으면
 * Cloudflare 엣지 차단이니 API 키로 바꿔도 소용없다"고 단정하고 폴백을 건너뛰게 했다.
 * 검증하지 않은 가정이었다 — Anthropic 도 구독 토큰을 거부할 때 같은 문구를 쓴다.
 * 그 결과 API 키가 멀쩡히 있는데도 에이전트가 그냥 실패했다.
 * 이제는 '엣지가 낸 응답이 확실할 때만' 건너뛴다.
 */

const SRC = path.join(process.cwd(), "prototype/functions/api/_shared/claude-auth.js");

// vm 컨텍스트는 전역이 따로다. 테스트에서 globalThis.fetch 를 바꿔도 모듈은 그걸 못 본다.
// 그래서 컨텍스트에는 위임용 fetch 를 넣고, 훅 객체로 실제 구현을 갈아 끼운다.
const hooks = { fetch: null };

function loadAuthModule() {
  const src = fs
    .readFileSync(SRC, "utf8")
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];$/gm, "")
    .replace(/^export /gm, "");
  const ctx = vm.createContext({
    console: { log() {}, error() {} },
    Response,
    fetch: (...args) => hooks.fetch(...args),
    // import 를 걷어냈으므로 의존성은 직접 주입한다.
    getSql: () => null,
    isCreditExhausted: (text, status) => status === 402 || /credit balance/i.test(String(text)),
  });
  vm.runInContext(
    src + "\n;globalThis.__api = { claudeFetch, authHeadersFor, buildClaudeSystem, hasClaudeFallback };",
    ctx
  );
  return ctx.__api;
}

const api = loadAuthModule();
const ENV = {};
const buildBody = (sub) => ({ model: "m", system: api.buildClaudeSystem(sub, "SYS"), messages: [] });

const subAuth = () =>
  api.authHeadersFor({ mode: "subscription", oauthToken: "sk-ant-oat-x", apiKey: "sk-ant-api-y" });
const subOnly = () =>
  api.authHeadersFor({ mode: "subscription", oauthToken: "sk-ant-oat-x", apiKey: null });

/** fetch 스텁. 호출 기록과 순차 응답을 돌려준다. */
function stubFetch(responses) {
  const calls = [];
  let i = 0;
  hooks.fetch = async (url, init) => {
    calls.push({ headers: init.headers, body: JSON.parse(init.body) });
    const r = responses[Math.min(i++, responses.length - 1)];
    return new Response(r.body, { status: r.status, headers: r.headers || {} });
  };
  return calls;
}

const OK = { status: 200, body: '{"content":[{"text":"hi"}]}' };
const JSON_HEADERS = { "Content-Type": "application/json", "x-request-id": "req_123" };

test("성공은 그대로 통과하고 재시도하지 않는다", async () => {
  const calls = stubFetch([OK]);
  const res = await api.claudeFetch(ENV, subAuth(), buildBody);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].headers.Authorization, "구독은 Bearer 로 나가야 합니다");
  assert.ok(Array.isArray(calls[0].body.system), "구독은 system 이 블록 배열이어야 합니다");
});

test("구독 토큰이 401 이면 API 키로 넘어간다", async () => {
  const calls = stubFetch([
    { status: 401, body: '{"error":{"message":"invalid bearer"}}', headers: JSON_HEADERS },
    OK,
  ]);
  const res = await api.claudeFetch(ENV, subAuth(), buildBody);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers["x-api-key"], "sk-ant-api-y");
  assert.equal(typeof calls[1].body.system, "string", "API 키는 system 이 문자열이어야 합니다");
});

test("★회귀: Anthropic 이 낸 403 'Request not allowed' 는 폴백해야 한다", async () => {
  // 예전엔 이 문구만 보고 엣지 차단으로 단정해 폴백을 건너뛰었다.
  // x-request-id 가 있으면 Anthropic 까지 도달한 응답이므로 API 키가 통할 수 있다.
  const calls = stubFetch([
    {
      status: 403,
      body: '{"type":"error","error":{"type":"forbidden","message":"Request not allowed"}}',
      headers: JSON_HEADERS,
    },
    OK,
  ]);
  const res = await api.claudeFetch(ENV, subAuth(), buildBody);
  assert.equal(res.status, 200, "API 키로 살아났어야 합니다");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers["x-api-key"], "sk-ant-api-y");
});

test("본문이 JSON 이면 request-id 가 없어도 폴백한다 (애매하면 시도)", async () => {
  const calls = stubFetch([
    { status: 403, body: '{"error":{"message":"Request not allowed"}}', headers: {} },
    OK,
  ]);
  const res = await api.claudeFetch(ENV, subAuth(), buildBody);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
});

test("Cloudflare 엣지가 낸 HTML 차단은 폴백하지 않는다 (키를 바꿔도 같은 자리)", async () => {
  const calls = stubFetch([
    {
      status: 403,
      body: "<!DOCTYPE html><html><body>error code: 1020 Request not allowed</body></html>",
      headers: { "Content-Type": "text/html" },
    },
  ]);
  const res = await api.claudeFetch(ENV, subAuth(), buildBody);
  assert.equal(calls.length, 1, "엣지 차단에는 재시도가 낭비입니다");
  assert.equal(res.status, 403);
  assert.match(await res.text(), /Request not allowed/, "본문을 다시 읽을 수 있어야 합니다");
});

test("잔액 부족은 폴백하지 않고 그대로 올린다", async () => {
  const calls = stubFetch([
    {
      status: 403,
      body: '{"error":{"message":"Your credit balance is too low to access the Anthropic API."}}',
      headers: JSON_HEADERS,
    },
  ]);
  const res = await api.claudeFetch(ENV, subAuth(), buildBody);
  assert.equal(calls.length, 1);
  assert.equal(res.status, 403);
  assert.match(await res.text(), /credit balance/);
});

test("429 레이트리밋은 폴백하지 않는다 (유료 크레딧 보호)", async () => {
  const calls = stubFetch([{ status: 429, body: '{"error":{"message":"rate limit"}}', headers: JSON_HEADERS }]);
  const res = await api.claudeFetch(ENV, subAuth(), buildBody);
  assert.equal(calls.length, 1);
  assert.equal(res.status, 429);
});

test("예비 키가 없으면 폴백을 시도하지 않는다", async () => {
  assert.equal(api.hasClaudeFallback(subOnly()), false);
  const calls = stubFetch([{ status: 403, body: '{"error":{"message":"nope"}}', headers: JSON_HEADERS }]);
  const res = await api.claudeFetch(ENV, subOnly(), buildBody);
  assert.equal(calls.length, 1);
  assert.equal(res.status, 403);
});

test("폴백도 실패하면 마지막 응답을 올린다", async () => {
  const calls = stubFetch([
    { status: 403, body: '{"error":{"message":"Request not allowed"}}', headers: JSON_HEADERS },
    { status: 401, body: '{"error":{"message":"key also dead"}}', headers: JSON_HEADERS },
  ]);
  const res = await api.claudeFetch(ENV, subAuth(), buildBody);
  assert.equal(calls.length, 2);
  assert.equal(res.status, 401);
  assert.match(await res.text(), /key also dead/);
});
