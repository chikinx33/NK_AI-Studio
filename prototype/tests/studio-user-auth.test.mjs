import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * 스튜디오의 AI 기능은 "사용자가 등록한" Claude 자격증명으로만 돌아야 한다.
 *
 * 예전에는 엔드포인트들이 env.ANTHROPIC_API_KEY 를 직접 읽었다. 그래서 /app 에
 * 인증 설정을 붙여도 화면만 바뀌고 실제 호출은 그대로 운영자 키를 썼을 것이다.
 * 게다가 대부분은 요청자가 누구인지조차 확인하지 않았다.
 */

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

/** Claude 를 호출하는 스튜디오 엔드포인트. 새로 만들면 여기에 추가할 것. */
const CLAUDE_ENDPOINTS = [
  "prototype/functions/api/draft-generate.js",
  "prototype/functions/api/hashtags.js",
  "prototype/functions/api/story-structure.js",
  "prototype/functions/api/overview-suggest.js",
  "prototype/functions/api/scenario.js",
  "prototype/functions/api/scenario-shots.js",
  "prototype/functions/api/scenario/locations.js",
];

test("Claude 엔드포인트가 운영자 env 키를 직접 읽지 않는다", () => {
  const offenders = CLAUDE_ENDPOINTS.filter((rel) => /env[?.\s]*\.?ANTHROPIC_API_KEY/.test(read(rel)));
  assert.deepEqual(offenders, [], `env 키를 직접 읽는다:\n${offenders.join("\n")}`);
});

test("Claude 엔드포인트는 요청자를 확인한다", () => {
  const offenders = CLAUDE_ENDPOINTS.filter((rel) => !/authorizeRequest\(/.test(read(rel)));
  assert.deepEqual(offenders, [], `요청자를 확인하지 않는다:\n${offenders.join("\n")}`);
});

test("Claude 엔드포인트는 사용자별 인증(studioAuth)으로 헤더를 만든다", () => {
  const offenders = CLAUDE_ENDPOINTS.filter((rel) => !/studioAuth\(/.test(read(rel)));
  assert.deepEqual(offenders, [], `studioAuth 를 쓰지 않는다:\n${offenders.join("\n")}`);
});

test("클라이언트가 AI 호출에 인증 토큰을 싣는다", () => {
  const src = read("prototype/api.js");
  for (const endpoint of [
    "/api/scenario'",
    "/api/scenario/locations'",
    "/api/scenario-shots'",
    "/api/story-structure'",
    "/api/overview-suggest'",
    "/api/hashtags'",
    "/api/draft-generate'",
  ]) {
    const at = src.indexOf(endpoint);
    assert.ok(at > 0, `${endpoint} 호출부를 찾지 못했다`);
    const after = src.slice(at, at + 240);
    assert.ok(
      /headers: buildAuthHeaders\(/.test(after),
      `${endpoint} 가 인증 헤더 없이 호출된다 — 서버가 사용자를 식별할 수 없다`
    );
  }
});

// ── resolveAuth 를 실제로 실행해 동작을 검증한다 (소스 정규식 매칭 아님) ──

function loadClaudeAuth() {
  const src = read("prototype/functions/api/_shared/claude-auth.js")
    .replace(/^import\s+.*$/gm, "") // getSql 은 아래에서 가짜로 주입
    .replace(/^export default .*$/m, "")
    .replace(/^export /gm, "");
  const ctx = vm.createContext({ console, fetch: async () => ({ ok: true, json: async () => ({}) }) });
  vm.runInContext(
    "const getSql = (env) => (env && env.__sql) || null;\n" +
      src +
      "\n;globalThis.__m = { resolveAuth, authHeadersFor, isClaudeAuthRequired, studioAuth, buildClaudeSystem };",
    ctx
  );
  return ctx.__m;
}

const M = loadClaudeAuth();

/** app_settings 한 줄을 돌려주는 가짜 sql. null 이면 미설정 사용자. */
const fakeSql = (row) => {
  const fn = async () => (row ? [row] : []);
  return fn;
};
const ENV_WITH_ADMIN_KEY = { ANTHROPIC_API_KEY: "sk-ant-api-ADMIN", CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-ADMIN" };

test("미설정 사용자는 운영자 키로 넘어가지 않고 차단된다", async () => {
  const env = { ...ENV_WITH_ADMIN_KEY, __sql: fakeSql(null) };
  await assert.rejects(
    () => M.resolveAuth(env.__sql, "nobody", env, { allowEnvFallback: false }),
    (err) => M.isClaudeAuthRequired(err),
    "미설정인데도 통과했다 — 운영자 크레딧이 조용히 쓰인다"
  );
});

test("자격증명을 등록한 사용자는 자기 것으로 호출한다", async () => {
  const env = {
    ...ENV_WITH_ADMIN_KEY,
    __sql: fakeSql({ claude_auth_mode: "api_key", claude_api_key: "sk-ant-api-MINE", claude_oauth_token: null }),
  };
  const auth = await M.studioAuth(env, "someone");
  assert.equal(auth.subscription, false);
  assert.equal(auth.headers["x-api-key"], "sk-ant-api-MINE");
  assert.ok(!auth.headers.Authorization, "API 키 모드인데 Bearer 가 붙었다");
});

test("구독 모드는 Bearer + OAuth 베타 헤더로 나간다", async () => {
  const env = {
    ...ENV_WITH_ADMIN_KEY,
    __sql: fakeSql({ claude_auth_mode: "subscription", claude_oauth_token: "sk-ant-oat-MINE", claude_api_key: null }),
  };
  const auth = await M.studioAuth(env, "someone");
  assert.equal(auth.subscription, true);
  assert.equal(auth.headers.Authorization, "Bearer sk-ant-oat-MINE");
  assert.equal(auth.headers["anthropic-beta"], "oauth-2025-04-20");
  assert.ok(!auth.headers["x-api-key"], "구독 모드인데 x-api-key 가 붙었다");
});

test("모드는 등록됐지만 값이 비면 차단한다", async () => {
  const env = {
    ...ENV_WITH_ADMIN_KEY,
    // API 키 모드인데 키가 없다. 구독 토큰이 있어도 넘어가면 안 된다.
    __sql: fakeSql({ claude_auth_mode: "api_key", claude_api_key: "", claude_oauth_token: "sk-ant-oat-MINE" }),
  };
  await assert.rejects(() => M.studioAuth(env, "someone"), (err) => M.isClaudeAuthRequired(err));
});

test("AI 기업 콘솔 경로는 기존대로 env 폴백을 유지한다", async () => {
  // 운영자 본인 도구라 동작을 바꾸지 않았다. 폴백이 사라지면 이 테스트가 알려준다.
  const env = { ...ENV_WITH_ADMIN_KEY, __sql: fakeSql(null) };
  const r = await M.resolveAuth(env.__sql, "nobody", env);
  assert.equal(r.apiKey, "sk-ant-api-ADMIN");
  assert.equal(r.oauthToken, "sk-ant-oat-ADMIN");
});

test("구독 모드는 system 첫 블록에 Claude Code 정체성을 넣는다", () => {
  const blocks = M.buildClaudeSystem(true, "real system");
  assert.ok(Array.isArray(blocks) && blocks.length === 2, "구독인데 블록 배열이 아니다");
  assert.match(blocks[0].text, /Claude Code/);
  assert.equal(blocks[1].text, "real system");
  assert.equal(M.buildClaudeSystem(false, "real system"), "real system");
});

// ── 화면 배선 ──

test("/app 에 API 설정 위젯이 있고 기존 위젯과 같은 접기 구조를 쓴다", () => {
  const html = read("prototype/app.html");
  assert.match(html, /id="api-settings-widget"/);
  assert.match(html, /class="user-widget api-settings-widget is-collapsed hidden"/);
  assert.match(html, /id="api-settings-toggle"/);
  for (const mode of ["subscription", "api_key"]) {
    assert.ok(html.includes(`data-auth-mode="${mode}"`), `${mode} 선택 버튼이 없다`);
  }
  // 적용 범위를 화면에 적어 두지 않으면 "왜 이미지 생성은 그대로냐"가 반드시 나온다
  assert.match(html, /적용 범위/);
  assert.match(html, /적용 안 됨/);
});

test("인증 미설정 응답이 사용자 안내로 이어진다", () => {
  const api = read("prototype/api.js");
  assert.match(api, /claude_auth_required/, "api.js 가 인증 미설정 응답을 식별하지 않는다");
  assert.match(api, /authRequired = true/);

  const bs = read("prototype/js/ui/brand-studio.js");
  assert.match(bs, /alertAuthRequired/, "브랜드 스튜디오에 인증 안내 문구가 없다");
  const at = bs.indexOf("function describeGenError");
  assert.ok(at > 0);
  const body = bs.slice(at, at + 500);
  assert.match(body, /authRequired/, "인증 미설정이 일반 오류로 뭉뚱그려진다");
});
