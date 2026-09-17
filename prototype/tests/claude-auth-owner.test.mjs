// 실제 인증·설정 API·대화·문서 호출을 실행해 인증 주체가 섞이지 않는지 확인합니다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "../..");
const read = (file) => readFileSync(resolve(root, "prototype/functions/api", file), "utf8").replace(/\r\n?/g, "\n");
const esbuild = createRequire(import.meta.url)(resolve(root, "ai-company-app/node_modules/esbuild"));
const env = { CLAUDE_AUTH_MODE: "api_key", ANTHROPIC_API_KEY: "MASTER_KEY", CLAUDE_CODE_OAUTH_TOKEN: "MASTER_OAUTH" };
function harness(initial = {}) {
  const rows = new Map(Object.entries(initial));
  const calls = [];
  let responseStatus = 200;
  const sql = async (query, args = []) => {
    if (query.startsWith("SELECT *")) return rows.has(args[0]) ? [rows.get(args[0])] : [];
    if (/INSERT INTO app_settings \(user_id, claude_auth_mode, claude_oauth_token/.test(query)) {
      rows.set(args[0], { claude_auth_mode: args[1], claude_oauth_token: args[2], claude_api_key: args[3] });
    }
    return [];
  };
  const ctx = vm.createContext({ console, Response, getSql: (e) => e.__sql,
    isCreditExhausted: () => false,
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      return new Response(JSON.stringify({ content: [{ text: '{"ok":true}' }], error: { message: "rejected" } }),
        { status: responseStatus, headers: { "content-type": "application/json", "x-request-id": "test" } });
    },
  });
  vm.runInContext(read("_shared/claude-auth.js").replace(/^import .*$/gm, "").replace(/^export /gm, "") +
    "\nglobalThis.auth = {resolveAuth, resolvedAuthHeaders, studioAuth, authStatus, authDiagnose, saveClaudeAuth, getSettingsRow, claudeFetch, buildClaudeSystem};", ctx);
  const auth = ctx.auth;
  const settingsSrc = read("agent/settings.ts").replace(/^import .*$/gm, "").replace(/^export /gm, "");
  const deps = { ...auth, authorizeRequest: async (request) => {
    const userId = request.headers.get("x-test-user");
    return userId ? { ok: true, userId } : { ok: false, error: "unauthorized", status: 401 };
  }, getSql: () => sql, send: (body, status) => new Response(JSON.stringify(body), { status }),
    corsHeaders: () => ({}), CLOUD_MODELS: {}, MODEL_CATALOG: {} };
  const settings = new Function(...Object.keys(deps), esbuild.transformSync(settingsSrc, { loader: "ts" }).code +
    "\nreturn {onRequestGet, onRequestPost};")(...Object.values(deps));
  const ownEnv = { ...env, __sql: sql };
  const request = (userId, body) => new Request("https://test/api/agent/settings", {
    method: body ? "POST" : "GET", headers: userId ? { "x-test-user": userId } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { auth, sql, calls, env: ownEnv, rows, status: (n) => { responseStatus = n; },
    get: (user) => settings.onRequestGet({ request: request(user), env: ownEnv }),
    post: (user, body) => settings.onRequestPost({ request: request(user, body), env: ownEnv }),
  };
}
const ownOAuth = { claude_auth_mode: "subscription", claude_oauth_token: "OWN_OAUTH" };
const ownKey = { claude_auth_mode: "api_key", claude_api_key: "OWN_KEY" };

test("미등록·모드만 저장한 계정은 마스터 인증을 사용한다", async () => {
  const h = harness({ modeOnly: { claude_auth_mode: "subscription", claude_oauth_token: "  " } });
  for (const user of ["new", "modeOnly"]) {
    const r = await h.auth.resolveAuth(h.sql, user, h.env);
    assert.equal(r.source, "master");
    assert.equal(r.userConfigured, false);
    assert.equal(r.mode, "api_key");
    const headers = await h.auth.studioAuth(h.env, user);
    assert.equal(headers.headers["x-api-key"], "MASTER_KEY");
  }
});

test("본인 구독 토큰에는 마스터 API 키를 예비 키로 붙이지 않는다", async () => {
  const h = harness({ u: ownOAuth });
  const r = await h.auth.resolveAuth(h.sql, "u", h.env);
  assert.equal(r.source, "user");
  assert.equal(r.apiKey, null);
  assert.equal((await h.auth.resolvedAuthHeaders(h.sql, "u", h.env)).fallback, null);
});

test("본인 API 키에는 마스터 구독 토큰을 섞지 않는다", async () => {
  const h = harness({ u: ownKey });
  const r = await h.auth.resolveAuth(h.sql, "u", h.env);
  assert.equal(r.oauthToken, null);
  assert.equal(r.apiKey, "OWN_KEY");
  assert.equal(r.source, "user");
});

test("본인 인증이 등록된 계정에서 선택한 자격증명이 없으면 마스터로 넘어가지 않는다", async () => {
  const h = harness({ u: { ...ownOAuth, claude_auth_mode: "api_key" } });
  await assert.rejects(() => h.auth.studioAuth(h.env, "u"), /claude_auth_required/);
  const r = await h.auth.authStatus(h.sql, "u", h.env);
  assert.equal(r.source, "user");
  assert.equal(r.userConfigured, true);
  assert.equal(r.configured, false);
  assert.equal(h.calls.length, 0);
});

test("설정 DB 장애·DB 미설정·사용자 미확인은 마스터 호출로 우회하지 않는다", async () => {
  const h = harness();
  await assert.rejects(() => h.auth.resolveAuth(async () => { throw new Error("DB down"); }, "u", h.env), /DB down/);
  await assert.rejects(() => h.auth.resolveAuth(null, "u", h.env), /settings_unavailable/);
  await assert.rejects(() => h.auth.resolveAuth(h.sql, null, h.env), /user_required/);
  assert.equal(h.calls.length, 0);
});

test("설정 API는 로그인 계정에만 저장하고 다른 계정 ID를 보낸 요청도 자기 계정에 저장한다", async () => {
  const h = harness();
  await h.post("alice", { kind: "claudeAuth", userId: "bob", authMode: "api_key", apiKey: "ALICE_KEY" });
  await h.post("bob", { kind: "claudeAuth", userId: "alice", authMode: "subscription", oauthToken: "BOB_OAUTH" });
  assert.equal(h.rows.get("alice").claude_api_key, "ALICE_KEY");
  assert.equal(h.rows.get("bob").claude_oauth_token, "BOB_OAUTH");
  for (const user of ["alice", "bob"]) {
    const data = await (await h.get(user)).json();
    assert.equal(data.claudeAuth.source, "user");
    assert.equal(data.claudeAuth.configured, true);
    assert.doesNotMatch(JSON.stringify(data), /ALICE_KEY|BOB_OAUTH|MASTER_KEY|MASTER_OAUTH/);
  }
  assert.equal((await h.get("new")).status, 200);
  assert.equal((await h.get(null)).status, 401);
  assert.equal((await h.post(null, { apiKey: "STOLEN" })).status, 401);
  assert.equal(h.rows.size, 2);
});

test("값 없이 인증 모드만 저장하는 것은 본인 인증 등록으로 취급하지 않는다", async () => {
  const h = harness();
  const data = await (await h.post("u", { kind: "claudeAuth", authMode: "subscription", oauthToken: "" })).json();
  assert.equal(data.status.source, "master");
  assert.equal(data.status.userConfigured, false);
});

test("서로 다른 계정의 동시 요청과 진단은 각자의 헤더로 호출한다", async () => {
  const h = harness({ alice: ownKey, bob: ownOAuth });
  await Promise.all(["alice", "bob", "new"].map(async (user) => {
    const a = await h.auth.studioAuth(h.env, user);
    await h.auth.claudeFetch(h.env, a, () => ({ messages: [{ role: "user", content: user }] }));
  }));
  const keys = h.calls.map((c) => c.headers["x-api-key"] || c.headers.Authorization);
  assert.deepEqual(keys.sort(), ["OWN_KEY", "Bearer OWN_OAUTH", "MASTER_KEY"].sort());
  h.calls.length = 0;
  const d = await h.auth.authDiagnose(h.sql, "bob", h.env);
  assert.equal(d.source, "user");
  assert.equal(h.calls[0].headers.Authorization, "Bearer OWN_OAUTH");
  assert.equal(h.calls[0].headers["x-api-key"], undefined);
  assert.doesNotMatch(JSON.stringify(d), /OWN_OAUTH|MASTER/);
});

test("본인 인증의 401·402·403·429는 마스터 인증으로 재시도하지 않는다", async () => {
  const h = harness({ u: ownOAuth });
  for (const status of [401, 402, 403, 429]) {
    h.calls.length = 0;
    h.status(status);
    const a = await h.auth.studioAuth(h.env, "u");
    const res = await h.auth.claudeFetch(h.env, a, () => ({}));
    assert.equal(res.status, status);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].headers.Authorization, "Bearer OWN_OAUTH");
  }
});

test("본인 구독의 인증 오류에는 본인 예비 키만 사용하고 한도 초과에는 키를 바꾸지 않는다", async () => {
  const h = harness({ u: { ...ownOAuth, claude_api_key: "OWN_BACKUP" } });
  const a = await h.auth.studioAuth(h.env, "u");
  h.status(401);
  await h.auth.claudeFetch(h.env, a, () => ({}));
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].headers["x-api-key"], "OWN_BACKUP");
  h.calls.length = 0;
  h.status(429);
  await h.auth.claudeFetch(h.env, a, () => ({}));
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].headers.Authorization, "Bearer OWN_OAUTH");
});

test("AI 기업 대화 호출은 SQL 인자를 생략해도 로그인 계정의 인증을 조회한다", async () => {
  const h = harness({ u: ownKey });
  const src = read("agent/_orchestrator.ts");
  const js = esbuild.transformSync(src.slice(src.indexOf("export async function callClaude("), src.indexOf("export interface KnowOp")).replace(/^export /gm, ""), { loader: "ts" }).code;
  const deps = { getSql: () => h.sql, resolvedAuthHeaders: h.auth.resolvedAuthHeaders,
    normalizeModelChoice: () => null, isAnthropicProvider: () => true, stripThink: (s) => s,
    callLLM: async (_env, opts) => { h.calls.push(opts); return "ok"; } };
  const call = new Function(...Object.keys(deps), js + "\nreturn callClaude;")(...Object.values(deps));
  assert.equal(await call(h.env, "system", [], { userId: "u" }), "ok");
  assert.equal(h.calls[0].auth.headers["x-api-key"], "OWN_KEY");
  await assert.rejects(() => call(h.env, "system", []), /user_required/);
  assert.equal(h.calls.length, 1);
});

test("PPT·PDF·문서 양식의 직접 Claude 호출도 도구 실행자의 인증을 사용한다", async () => {
  const h = harness({ u: ownOAuth });
  const src = read("agent/_shared.ts");
  const start = src.indexOf("async function callClaudeForJson(");
  const end = src.indexOf("\n}", start) + 2;
  const js = esbuild.transformSync(src.slice(start, end), { loader: "ts" }).code;
  const deps = { getSql: () => h.sql, ...h.auth };
  const call = new Function(...Object.keys(deps), js + "\nreturn callClaudeForJson;")(...Object.values(deps));
  assert.deepEqual(await call({ env: h.env, userId: "u" }, "system", "document"), { ok: true });
  assert.equal(h.calls[0].headers.Authorization, "Bearer OWN_OAUTH");
  assert.equal(h.calls[0].headers["x-api-key"], undefined);
  assert.equal((src.match(/await callClaudeForJson\(ctx,/g) || []).length, 3);
  assert.doesNotMatch(src, /callClaudeForJson\(ctx\.env,/);
});

test("AI 기업 상태는 마스터 키 유무 대신 실제 선택된 계정 인증을 보고한다", async () => {
  const h = harness({ u: ownOAuth, broken: { ...ownKey, claude_auth_mode: "subscription" } });
  const js = esbuild.transformSync(read("agent/status.ts").replace(/^import .*$/gm, "").replace(/^export /gm, ""), { loader: "ts" }).code;
  const deps = { getSql: () => h.sql, authStatus: h.auth.authStatus,
    authorizeRequest: async (r) => ({ ok: true, userId: r.headers.get("x-test-user") }),
    hasPagePermission: async () => true, ensureAgentSchema: async () => {},
    getRuntime: async () => ({ workMode: "on", autonomous: false }),
    send: (body, status) => new Response(JSON.stringify(body), { status }), corsHeaders: () => ({}), ROSTER: [], CLOUD_MODELS: {} };
  const get = new Function(...Object.keys(deps), js + "\nreturn onRequestGet;")(...Object.values(deps));
  for (const [user, source, configured] of [["u", "user", true], ["new", "master", true], ["broken", "user", false]]) {
    const data = await (await get({ request: new Request("https://test/status", { headers: { "x-test-user": user } }), env: h.env })).json();
    assert.deepEqual(data.cloud, { authSource: source, configured });
    assert.doesNotMatch(JSON.stringify(data), /OWN_KEY|OWN_OAUTH|MASTER_KEY|MASTER_OAUTH/);
  }
});

function launcherHarness(agentSettings) {
  let user = "alice";
  const states = [];
  const script = readFileSync(resolve(root, "prototype/script.js"), "utf8");
  const start = script.indexOf("    const loadApiSettings = async () => {");
  const end = script.indexOf("    const saveApiSettings = async () => {", start);
  const deps = { canUseApiSettingsUI: () => true, NK: { auth: { isAuthed: () => !!user, getUser: () => user }, api: { agentSettings } },
    setApiSettingsState: (text, kind) => states.push({ text, kind }), renderApiAuthMode: () => {}, translateUiText: (s) => s };
  const run = new Function(...Object.keys(deps), "let apiAuthRequestSeq = 0, apiAuthMode, apiAuthLoaded;\n" +
    script.slice(start, end) + "\nreturn loadApiSettings;")(...Object.values(deps));
  return { run, states, switchUser: (next) => { user = next; } };
}

test("랜딩 설정 상태는 마스터 인증과 본인 인증을 구분하고 선택한 본인 키가 없음을 안내한다", async () => {
  for (const [source, set, expected] of [["master", true, "마스터 인증 사용 중"], ["user", true, "본인 인증 사용 중"], ["user", false, "선택한 본인 인증이 없습니다"]]) {
    const h = launcherHarness(async () => ({ claudeAuth: { source, mode: "api_key", apiKeySet: set } }));
    await h.run();
    assert.ok(h.states.at(-1).text.startsWith(expected));
    assert.equal(h.states.at(-1).kind, set ? "ok" : "error");
  }
});

test("계정 변경 전에 시작한 설정 조회는 새 계정의 인증 상태를 덮어쓰지 않는다", async () => {
  let finish;
  const h = launcherHarness(() => new Promise((resolve) => { finish = resolve; }));
  const pending = h.run();
  h.switchUser("bob");
  finish({ claudeAuth: { source: "user", mode: "api_key", apiKeySet: true } });
  await pending;
  assert.equal(h.states.length, 1);
  assert.equal(h.states[0].text, "불러오는 중…");
});
