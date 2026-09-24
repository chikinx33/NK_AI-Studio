// Neon 오류를 사람이 읽는 문구(+코드)로 바꾼다. "Neon SQL 오류 520: error code: 520" 이 그대로 뜨던 것(2026-09-24).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const root = process.cwd();
const esbuild = createRequire(import.meta.url)("../../ai-company-app/node_modules/esbuild");
function loadHelper() {
  const src = fs.readFileSync(path.join(root, "prototype/functions/api/_shared/neon-error.ts"), "utf8");
  const js = esbuild.transformSync(src, { loader: "ts", format: "cjs" }).code;
  const sandbox = { exports: {}, module: { exports: {} } };
  vm.runInNewContext(js, sandbox);
  return { ...sandbox.exports, ...sandbox.module.exports };
}

test("520 은 일시 오류 문구 + 코드, 한도 초과·인증·429 는 각자 문구", () => {
  const { describeNeonError } = loadHelper();
  const t = describeNeonError(520, "error code: 520");
  assert.equal(t.kind, "transient");
  assert.match(t.message, /데이터베이스가 잠시 응답하지 않았어요 \(Neon 일시 오류 · 코드 520\)/);
  assert.ok(!t.message.includes("error code: 520"), "무의미한 원문은 반복하지 않는다");
  const q = describeNeonError(402, JSON.stringify({ message: "Your project has exceeded the compute time quota" }));
  assert.equal(q.kind, "quota");
  assert.match(q.message, /사용량 한도를 넘겼어요 \(Neon 코드 402\) — Your project has exceeded the compute time quota/);
  const a = describeNeonError(401, JSON.stringify({ message: "password authentication failed" }));
  assert.equal(a.kind, "auth");
  assert.match(a.message, /DATABASE_URL/);
  const r = describeNeonError(429, "");
  assert.match(r.message, /너무 잦아/);
  const b = describeNeonError(400, JSON.stringify({ message: "syntax error at or near \"SELEC\"" }));
  assert.match(b.message, /요청이 잘못됐어요 \(Neon 코드 400\) — syntax error/);
});

test("Neon 호출부 두 곳이 같은 변환기를 쓰고 5xx 를 한 번 재시도한다", () => {
  for (const f of ["prototype/functions/api/knowledge/_shared.ts", "prototype/functions/api/sound/_shared.ts"]) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    assert.match(src, /import \{ describeNeonError \} from "\.\.\/_shared\/neon-error";/, f);
    assert.match(src, /const info = describeNeonError\(res\.status, body\);/, f);
    assert.match(src, /if \(res\.status >= 500 && res\.status !== 500\) \{/, `${f} 5xx 재시도`);
    assert.doesNotMatch(src, /Neon SQL 오류 \$\{res\.status\}/, `${f} 옛 문구`);
  }
});
