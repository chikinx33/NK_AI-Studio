import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const orchestrator = read("prototype/functions/api/agent/_orchestrator.ts");
const shared = read("prototype/functions/api/agent/_shared.ts");

// 합성 프롬프트에 결과를 4500자로 잘라 넣어 지식 23번 근처 이후가 사라졌다 → 페이지 수집 함수를 실제로 돌려 본다.
function loadCollectPagedOutput() {
  const esbuild = createRequire(import.meta.url)(resolve(root, "ai-company-app/node_modules/esbuild"));
  const start = orchestrator.indexOf("const PAGED_MAX_PAGES");
  const end = orchestrator.indexOf("\n}\n", orchestrator.indexOf("export async function collectPagedOutput")) + 3;
  const js = esbuild.transformSync(orchestrator.slice(start, end).replace("export async function", "async function"), { loader: "ts" }).code;
  return new Function(`${js}\nreturn collectPagedOutput;`)();
}

const knowledge = Array.from({ length: 57 }, (_, i) => ({ n: i + 1, type: "사실", source: "", date: "2026-09-17", text: `지식 ${i + 1} `.repeat(20) }));
const page = (offset, limit = 20) => {
  const items = knowledge.slice(offset, offset + limit);
  return { kind: "knowledge_audit", total: knowledge.length, offset, limit, items, hasMore: offset + items.length < knowledge.length, nextOffset: offset + items.length };
};

test("knowledge_audit 는 offset/limit 페이지와 hasMore·nextOffset 을 돌려준다", () => {
  assert.match(shared, /async function runKnowledgeAuditTool\(input: any/);
  assert.match(shared, /LIMIT \$2 OFFSET \$3/);
  assert.match(shared, /items,\s*hasMore,\s*nextOffset/);
  assert.match(orchestrator, /PAGED_READ_TOOLS = new Set\(\["knowledge_audit"\]\)/);
  assert.match(orchestrator, /output = await collectPagedOutput\(output/);
});

test("남은 페이지를 끝까지 모아 전 항목을 합친다", async () => {
  const collect = loadCollectPagedOutput();
  const merged = await collect(page(0), async (offset) => page(offset), () => true, 1_000_000);
  assert.equal(merged.items.length, 57);
  assert.deepEqual(merged.items.map((item) => item.n), knowledge.map((item) => item.n));
  assert.equal(merged.hasMore, false);
});

test("합성 한도를 넘으면 항목 경계에서 자르고 이어볼 offset 을 남긴다", async () => {
  const collect = loadCollectPagedOutput();
  const merged = await collect(page(0), async (offset) => page(offset), () => true, 6000);
  assert.ok(JSON.stringify(merged).length <= 6000);
  assert.ok(merged.items.length > 0 && merged.items.length < 57);
  assert.equal(merged.hasMore, true);
  assert.equal(merged.nextOffset, merged.items.length);
  assert.equal(merged.items.at(-1).n, merged.items.length);
});

test("시간이 부족하면 수집을 멈추고 이어볼 위치를 남긴다", async () => {
  const collect = loadCollectPagedOutput();
  const merged = await collect(page(0), async (offset) => page(offset), () => false, 1_000_000);
  assert.equal(merged.items.length, 20);
  assert.equal(merged.hasMore, true);
  assert.equal(merged.nextOffset, 20);
});

test("실행 예고만 하고 RUN 마커가 없으면 같은 턴에 마커를 다시 받고, 못 받으면 솔직히 알린다", () => {
  assert.match(orchestrator, /\*\*실행 예고 = 같은 턴의 마커\.\*\*/);
  assert.match(orchestrator, /promisedRun && !companyFileMutationIntent && result\.runs\.length === 0/);
  assert.match(orchestrator, /방금 말씀드린 실행은 이번 턴에 시작되지 않았어요/);
});
