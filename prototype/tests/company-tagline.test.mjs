// 실제 브랜드 API를 실행해 문구 저장과 기존 로고·제목 보존을 확인합니다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const esbuild = require(resolve(root, "ai-company-app/node_modules/esbuild"));
const source = readFileSync(resolve(root, "prototype/functions/api/userdata/brand.ts"), "utf8");
const js = esbuild.transformSync(source.replace(/^import .*;\s*$/gm, "").replace(/export /g, ""), { loader: "ts" }).code;

function harness(initial = {}, authorized = true) {
  let stored = structuredClone(initial);
  const writes = [];
  const deps = {
    authorizeRequest: async () => authorized ? { ok: true, userId: "office-user" } : { ok: false, error: "unauthorized", status: 401 },
    resolveGcsEnv: () => ({ basePrefix: "test" }),
    sanitizeUserId: (id) => id,
    buildUserDataObject: (prefix, userId, file) => `${prefix}/${userId}/${file}`,
    readGcsJson: async () => ({ found: true, data: stored }),
    writeGcsJson: async (_env, key, data) => { writes.push(key); stored = structuredClone(data); },
  };
  const handlers = new Function(...Object.keys(deps), `${js}\nreturn { onRequestGet, onRequestPost };`)(...Object.values(deps));
  return {
    writes,
    get: () => handlers.onRequestGet({ request: new Request("https://test/api/userdata/brand"), env: {} }),
    post: (body) => handlers.onRequestPost({ request: new Request("https://test/api/userdata/brand", { method: "POST", body: JSON.stringify(body) }), env: {} }),
  };
}

test("회사 문구는 계정별로 저장되고 다시 읽어도 유지되며 제목·로고를 보존한다", async () => {
  const h = harness({ title: "NK 스튜디오", iconDataUrl: "data:image/png;base64,AAAA" });
  const response = await h.post({ companyTagline: "  함께 만드는 AI 기업  " });
  assert.equal(response.status, 200);
  const expected = { title: "NK 스튜디오", iconDataUrl: "data:image/png;base64,AAAA", companyTagline: "함께 만드는 AI 기업" };
  assert.deepEqual((await response.json()).data, expected);
  assert.deepEqual((await (await h.get()).json()).data, expected);
  assert.deepEqual(h.writes, ["test/office-user/studio-brand.json"]);
});

test("기존 계정의 기본 문구를 지원하고 로그인 카드의 제목·로고 수정은 회사 문구를 보존한다", async () => {
  const h = harness({ title: "기존 제목" });
  assert.equal((await (await h.get()).json()).data.companyTagline, "");
  await h.post({ companyTagline: "새 문구" });
  await h.post({ title: "새 제목", iconDataUrl: "data:image/webp;base64,AAAA" });
  assert.deepEqual((await (await h.get()).json()).data, { title: "새 제목", iconDataUrl: "data:image/webp;base64,AAAA", companyTagline: "새 문구" });
});

test("빈 문구·80자 초과·잘못된 자료형은 저장하지 않고 기존 문구를 유지한다", async () => {
  const h = harness({ companyTagline: "기존 문구" });
  for (const value of ["", "   ", "가".repeat(81), null, 123, {}]) {
    assert.equal((await h.post({ companyTagline: value })).status, 400);
  }
  assert.equal(h.writes.length, 0);
  assert.equal((await (await h.get()).json()).data.companyTagline, "기존 문구");
  assert.equal((await h.post({ companyTagline: "가".repeat(80) })).status, 200);
});

test("인증되지 않은 요청은 회사 문구를 읽거나 변경할 수 없다", async () => {
  const h = harness({ companyTagline: "비공개 문구" }, false);
  assert.equal((await h.get()).status, 401);
  assert.equal((await h.post({ companyTagline: "변경" })).status, 401);
  assert.equal(h.writes.length, 0);
});
