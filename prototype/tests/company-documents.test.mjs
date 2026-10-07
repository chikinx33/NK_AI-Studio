import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
const require = createRequire(import.meta.url);
const ts = require("../../ai-company-app/node_modules/typescript");
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
function compile(path, imports = {}, fetcher = globalThis.fetch) {
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", "fetch", "crypto", code)((name) => {
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  }, module, module.exports, fetcher, webcrypto);
  return module.exports;
}
const documents = compile("prototype/functions/api/agent/_company-documents.ts");
const make = (extra = {}) => documents.updateCompanyDocument(null, { action: "document_save", title: "회의록 한글", content: "원래 본문", ...extra }, "사용자", "2026-10-07T01:00:00Z");

test("문서 부분 갱신은 본문·댓글을 보존하고 이전 판을 복원한다", () => {
  const original = make();
  const commented = documents.updateCompanyDocument(original, { action: "document_comment", text: "확인했습니다" }, "에이전트 · ink");
  const edited = documents.updateCompanyDocument(commented, { action: "document_save", title: "새 제목", status: "검토 중", pinned: true }, "사용자");
  assert.equal(edited.content, original.content);
  assert.equal(edited.comments[0].author, "에이전트 · ink");
  assert.equal(edited.history.length, 1);
  assert.equal(original.comments.length, 0);
  const restored = documents.updateCompanyDocument(edited, { action: "document_restore", revision: 2 }, "사용자");
  assert.equal(restored.title, original.title);
  assert.equal(restored.comments.length, 1);
  assert.equal(restored.history.at(-1).title, "새 제목");
  assert.equal(restored.revision, 4);
});
test("문서 입력 한도·잘못된 상태·없는 복원 판을 거부한다", () => {
  for (const extra of [{ title: " " }, { content: "x".repeat(100001) }, { status: "invalid" }, { pinned: "true" }]) assert.throws(() => make(extra), documents.DocumentError);
  assert.throws(() => documents.updateCompanyDocument(make(), { action: "document_comment", text: " " }, "사용자"));
  assert.throws(() => documents.updateCompanyDocument(make(), { action: "document_restore", revision: 99 }, "사용자"));
});
test("수정 이력은 20개로 제한되며 현재 한글 내용은 보존된다", () => {
  let doc = make();
  for (let i = 0; i < 30; i++) doc = documents.updateCompanyDocument(doc, { action: "document_save", content: `수정 ${i}` }, "사용자");
  assert.equal(doc.history.length, 20);
  assert.equal(doc.content, "수정 29");
  assert.equal(doc.history[0].revision, 11);
});

function harness() {
  const objects = new Map(); let serial = 0; let conflictNext = false;
  const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const fetcher = async (url, init = {}) => {
    const target = new URL(url);
    if (target.pathname.includes("/upload/")) {
      const generation = target.searchParams.get("ifGenerationMatch");
      const boundary = init.headers["Content-Type"].split("boundary=")[1];
      const parts = init.body.split(`--${boundary}`);
      const parse = (part) => JSON.parse(part.split("\r\n\r\n").slice(1).join("\r\n\r\n").trim());
      const meta = parse(parts[1]), body = parse(parts[2]);
      const previous = objects.get(meta.name);
      if (conflictNext || generation !== String(previous?.generation || "0")) { conflictNext = false; return response({}, 412); }
      const stored = { ...meta, generation: String(++serial), size: new TextEncoder().encode(JSON.stringify(body)).length, updated: "2026-10-07T02:00:00Z", body };
      objects.set(meta.name, stored); return response(stored);
    }
    const name = decodeURIComponent(target.pathname.split("/o/")[1] || "");
    if (!name) {
      const prefix = target.searchParams.get("prefix") || "";
      return response({ items: [...objects.entries()].filter(([key]) => key.startsWith(prefix)).map(([, item]) => item), prefixes: [] });
    }
    const object = objects.get(name);
    if (!object) return response({}, 404);
    const generation = target.searchParams.get("generation");
    if (generation && generation !== object.generation) return response({}, 404);
    return response(target.searchParams.get("alt") === "media" ? object.body : object);
  };
  const api = compile("prototype/functions/api/agent/company-files.ts", {
    "../_shared/auth.js": { authorizeRequest: async (request) => {
      const userId = request.headers.get("Authorization");
      return userId ? { ok: true, userId } : { ok: false, status: 401, error: "auth_required" };
    } },
    "../_shared/gcs.js": { getGoogleAccessToken: async () => "fake", resolveGcsEnv: () => ({ bucket: "test", basePrefix: "workspace" }) },
    "../_shared/storage": { buildAiVideoProjectPrefix: (prefix, userId) => `${prefix}/${userId}/ai-company` },
    "./_shared": { getSql: () => null, ensureAgentSchema: async () => {} },
    "./_doc-text": { DOCUMENT_EXTENSIONS: /\.(docx|xlsx)$/, extractDocumentText: async () => null },
    "./_company-documents": documents,
  }, fetcher);
  const post = async (body, user = "alice") => {
    const headers = { "Content-Type": "application/json", ...(user ? { Authorization: user } : {}) };
    const result = await api.onRequestPost({ request: new Request("https://test/api/agent/company-files", { method: "POST", headers, body: JSON.stringify(body) }), env: {} });
    return { status: result.status, ...(await result.json()) };
  };
  return { post, api, objects, race: () => { conflictNext = true; } };
}
const create = { action: "document_save", path: "Account/회의록.nkdoc.json", generation: "0", title: "회의록", content: "업무 내용" };
test("API 생성→읽기→수정→댓글→복원과 게시판 목록이 같은 문서를 사용한다", async () => {
  const h = harness();
  const first = await h.post(create); assert.equal(first.status, 200);
  const read = await h.post({ action: "document_read", path: create.path }); assert.equal(read.document.title, "회의록");
  const second = await h.post({ action: "document_save", path: create.path, generation: read.generation, content: "수정된 내용", pinned: true });
  assert.equal(second.document.history[0].content, "업무 내용");
  const comment = await h.post({ action: "document_comment", path: create.path, generation: second.generation, text: "댓글" });
  const restored = await h.post({ action: "document_restore", path: create.path, generation: comment.generation, revision: 1 });
  assert.equal(restored.document.content, "업무 내용"); assert.equal(restored.document.comments.length, 1);
  const listing = await h.api.onRequestGet({ request: new Request("https://test/api/agent/company-files?path=Account", { headers: { Authorization: "alice" } }), env: {} });
  const entries = (await listing.json()).entries;
  assert.equal(entries[0].document.title, "회의록"); assert.equal(entries[0].document.commentCount, 1);
});
test("중복 생성·오래된 generation·읽은 직후 경쟁 저장은 모두 409로 막는다", async () => {
  const h = harness(); const first = await h.post(create);
  assert.equal((await h.post(create)).status, 409);
  assert.equal((await h.post({ ...create, generation: "999" })).status, 409);
  h.race(); assert.equal((await h.post({ ...create, generation: first.generation, content: "경쟁" })).status, 409);
  assert.equal((await h.post({ action: "document_read", path: create.path })).document.content, "업무 내용");
});
test("문서 검색은 현재 제목·본문을 찾고 폐기한 이력 본문은 제외한다", async () => {
  const h = harness(); const first = await h.post({ ...create, content: "옛날전용문구" });
  await h.post({ ...create, generation: first.generation, title: "바뀐제목", content: "현재전용문구" });
  const search = async (term) => {
    const result = await h.api.onRequestGet({ request: new Request(`https://test/api/agent/company-files?search=${encodeURIComponent(term)}&content=1`, { headers: { Authorization: "alice" } }), env: {} });
    return result.json();
  };
  assert.equal((await search("바뀐제목")).matchCount, 1);
  assert.equal((await search("현재전용문구")).matchCount, 1);
  assert.equal((await search("옛날전용문구")).matchCount, 0);
});
test("날짜 폴더 경로는 같은 실제 문서로 연결된다", async () => {
  const h = harness();
  const first = await h.post({ ...create, path: "@work/2026-10-07/회의록.nkdoc.json" });
  assert.equal(first.status, 200);
  assert.equal(first.path, ".work-files/2026-10-07/회의록.nkdoc.json");
  const actual = await h.post({ action: "document_read", path: first.path });
  assert.equal(actual.generation, first.generation);
});
test("인증·계정 격리·경로 검증·일반 파일 도구 덮어쓰기 방지", async () => {
  const h = harness(); await h.post(create);
  assert.equal((await h.post(create, "")).status, 401);
  assert.equal((await h.post({ action: "document_read", path: create.path }, "bob")).status, 404);
  assert.equal((await h.post(create, "bob")).status, 200);
  assert.notEqual((await h.post({ ...create, path: "../escape.nkdoc.json" })).status, 200);
  assert.equal((await h.post({ action: "write", path: create.path, content: "덮어쓰기" })).status, 400);
  assert.equal((await h.post({ action: "edit", path: create.path, find: "업무", replace: "수정" })).status, 400);
});
test("모든 직원에게 문서 도구와 실행 지침이 연결되고 쓰기는 기존 승인 절차를 따른다", () => {
  const source = read("prototype/functions/api/agent/_shared.ts"), prompt = read("prototype/functions/api/agent/_orchestrator.ts");
  for (const action of ["read", "save", "comment", "restore"]) {
    const name = `company_files_document_${action}`;
    const line = source.split("\n").find((line) => line.includes(`${name}:`));
    for (const agent of ["sync", "core", "edge", "radar", "maki", "plot", "ink", "pixel", "beat", "engi", "reach"]) assert.ok(line.includes(`"${agent}"`));
    assert.ok(prompt.includes(`[[RUN: ${name}`));
    assert.ok(line.includes(action === "read" ? 'kind: "read"' : 'gate: true'));
  }
});
