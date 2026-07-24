import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("고정 PC 세션은 90일 수명과 갱신 가능한 persistent 클레임을 가진다", async () => {
  const authModule = await import("../functions/api/_shared/auth.js");
  const ttl = authModule.resolveSessionTtlSec(true);
  assert.equal(ttl, 60 * 60 * 24 * 90);
  assert.equal(authModule.resolveSessionTtlSec(false), 60 * 60 * 12);

  const before = Math.floor(Date.now() / 1000);
  const issued = await authModule.issueSessionToken(
    "fixed-pc-user",
    { AUTH_SESSION_SECRET: "test-session-secret" },
    ttl,
    { persistent: true },
  );
  const payload = await authModule.verifySessionToken(
    issued.token,
    { AUTH_SESSION_SECRET: "test-session-secret" },
  );

  assert.equal(payload.sub, "fixed-pc-user");
  assert.equal(payload.v, 2);
  assert.equal(payload.persistent, true);
  assert.ok(payload.exp >= before + ttl - 2);
});

test("로그인 유지 선택은 비밀번호와 구글 로그인 양쪽 세션 발급에 반영된다", async () => {
  const [login, googleStart, googleCallback, api, html] = await Promise.all([
    read("prototype/functions/api/login.ts"),
    read("prototype/functions/api/auth/google/start.ts"),
    read("prototype/functions/auth/google/callback.ts"),
    read("prototype/api.js"),
    read("prototype/app.html"),
  ]);

  assert.match(login, /const rememberDevice = body\.rememberDevice !== false/);
  assert.match(login, /resolveSessionTtlSec\(rememberDevice\)/);
  assert.match(googleStart, /rememberDevice/);
  assert.match(googleCallback, /resolveSessionTtlSec\(rememberDevice\)/);
  assert.match(api, /JSON\.stringify\(\{ id, pw, rememberDevice:/);
  assert.match(html, /id="opt-remember-device" checked/);
});

test("유효한 장기 세션은 만료 전에 회전 갱신되고 일시 장애 때 삭제되지 않는다", async () => {
  const [client, endpoint] = await Promise.all([
    read("prototype/js/auth.js"),
    read("prototype/functions/api/session/refresh.ts"),
  ]);

  assert.match(client, /REFRESH_BEFORE_SEC = 60 \* 60 \* 24 \* 14/);
  assert.match(client, /legacyPersistentMigration/);
  assert.match(client, /document\.visibilityState === 'visible'/);
  assert.match(client, /err\.status === 401 \|\| err\.status === 403/);
  assert.doesNotMatch(client, /\.catch\(function \(err\) \{\s*auth\.setAuthed\(false\)/);
  assert.match(endpoint, /authorizeRequest\(request, env\)/);
  assert.match(endpoint, /user\.active === false/);
  assert.match(endpoint, /issueSessionToken\(/);
});
