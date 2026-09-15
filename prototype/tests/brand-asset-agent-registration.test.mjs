import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

/**
 * AI 기업 에이전트가 브랜드 허브(IP 라이브러리)에 캐릭터 자산을 등록하는 경로.
 * ① 도구가 허브 규칙대로 저장하고(브랜드 해석·토큰 규칙·시트 한도·목록 필드·영속 경로)
 * ② 허브 화면이 예전 사본으로 저장해도 그 등록분을 지우지 않아야 한다.
 */

function loadBrandService(apiStub) {
  const store = new Map();
  const sandbox = {
    console, Date, JSON, Map, Set, Promise,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  sandbox.window = sandbox;
  sandbox.NK = { api: apiStub || null, service: {}, store: null, config: {} };
  vm.createContext(sandbox);
  vm.runInContext(read("prototype/js/service/brand.js"), sandbox);
  return sandbox.NK.service.brand;
}

const sheet = (token, ids) => ({
  displayName: token.replace(/^@/, ""),
  token,
  items: ids.map((id, i) => ({ sheetId: id, imageDataUrl: `gs://b/brands/x/ip/${id}.png`, isPrimary: i === 0 })),
});
const tokensOf = (b) => [...(b.characterSheets || []).map((c) => c.token)];
const idsOf = (b, token) => [...((b.characterSheets || []).find((c) => c.token === token)?.items || []).map((i) => i.sheetId)];

test("stale hub save keeps a character the agent registered on the server", async () => {
  let sent = null;
  const brand = loadBrandService({
    brandGet: async () => ({ data: { brand: {
      brandId: "b1", brandTitle: "네모",
      characterSheets: [sheet("@네모", ["s1"]), sheet("@전략가", ["a1"])],
      knowledgeCharacters: [{ displayName: "네모", token: "@네모" }, { displayName: "전략가", token: "@전략가" }],
    } } }),
    brandSave: async (id, payload) => { sent = payload; return { brand: payload }; },
  });
  brand.create({ brandId: "b1", brandTitle: "네모", characterSheets: [sheet("@네모", ["s1"])] });

  const saved = await brand.persistShared("b1", { brandTitle: "네모 시즌2" });
  assert.deepEqual(tokensOf(sent).sort(), ["@네모", "@전략가"]);
  assert.ok((sent.knowledgeCharacters || []).some((k) => k.token === "@전략가"));
  assert.equal(saved.brandTitle, "네모 시즌2");
});

test("sheet the agent added to an existing character survives a hub sheet edit", async () => {
  let sent = null;
  const brand = loadBrandService({
    brandGet: async () => ({ data: { brand: { brandId: "b1", characterSheets: [sheet("@네모", ["s1", "s2", "agent1"])] } } }),
    brandSave: async (id, payload) => { sent = payload; return { brand: payload }; },
  });
  brand.create({ brandId: "b1", characterSheets: [sheet("@네모", ["s1", "s2"])] });

  // 허브에서 s1 을 지우고 저장
  await brand.persistShared("b1", { characterSheets: [sheet("@네모", ["s2"])] });
  assert.deepEqual(idsOf(sent, "@네모"), ["s2", "agent1"], "지운 s1 은 되살리지 않고, 에이전트가 올린 agent1 은 남긴다");
});

test("character deleted in the hub is not revived from the server copy", async () => {
  let sent = null;
  const brand = loadBrandService({
    brandGet: async () => ({ data: { brand: { brandId: "b1", characterSheets: [sheet("@네모", ["s1"]), sheet("@세모", ["t1"])] } } }),
    brandSave: async (id, payload) => { sent = payload; return { brand: payload }; },
  });
  brand.create({ brandId: "b1", characterSheets: [sheet("@네모", ["s1"]), sheet("@세모", ["t1"])] });

  await brand.persistShared("b1", { characterSheets: [sheet("@네모", ["s1"])] });
  assert.deepEqual(tokensOf(sent), ["@네모"]);
});

test("brand_asset tool resolves the brand, never saves after a failed read, and follows hub rules", () => {
  const src = read("prototype/functions/api/agent/_shared.ts");
  const start = src.indexOf("async function runBrandSaveTool(");
  const end = src.indexOf("/** 이미지 역분석: /api/imagen-describe.");
  const block = src.slice(start, end);
  // 조회 실패를 신규 브랜드로 삼키지 않는다(통째 교체 저장이 기존 시트를 지움)
  assert.doesNotMatch(block, /runBrandGetTool\([^)]*\)\.catch\(/);
  assert.doesNotMatch(block, /catch \{ \/\* 신규 브랜드면/);
  assert.match(block, /await resolveBrandId\(givenBrand, ctx\)/);
  assert.match(block, /를 찾지 못했어요/);
  // 허브 토큰 규칙·한도
  assert.match(block, /\.replace\(\/\[\^0-9A-Za-z가-힣_\]\/g, ""\)\s*\n\s*\.slice\(0, 24\)/);
  assert.match(block, /const BRAND_SHEETS_PER_CHARACTER = 4;/);
  assert.match(block, /const BRAND_ENVIRONMENT_ASSET_LIMIT = 16;/);
  // 대소문자 무시 매칭, 허브 목록 필드 동시 갱신
  assert.match(block, /toLowerCase\(\) === token\.toLowerCase\(\)/);
  assert.match(block, /brand\.knowledgeCharacters = knowledge;/);
  assert.match(block, /brand\.brandCharacters = profiles;/);
  // 서명 URL 은 gs:// 로
  assert.match(block, /export function brandAssetImageRef\(/);
  assert.match(block, /parsed\.hostname === "storage\.googleapis\.com"/);
  // 이미지는 선택: 캐릭터(이름·설명)만 먼저 등록할 수 있고, 지정하지 않은 이미지를 짐작해 붙이지 않는다
  assert.doesNotMatch(block, /등록할 이미지를 찾지 못했어요/);
  assert.doesNotMatch(block, /ORDER BY created_at DESC LIMIT 60/);
  assert.match(block, /if \(jobId\) next\.objectName = await imageJobObjectName\(ctx, jobId\);/);
  assert.match(block, /if \(!imageRef \|\| items\.some\(/);
  // 이미 있는 캐릭터면 준 칸만 갱신, 바뀐 게 없으면 저장하지 않음
  assert.match(block, /if \(description !== null && description !== String\(profile\.description \|\| ""\)\)/);
  assert.match(block, /if \(!changed\) return \{ \.\.\.result, saved: false, alreadyRegistered: true \};/);
});

test("brand_asset prompt says character registration does not need an image", () => {
  const orch = read("prototype/functions/api/agent/_orchestrator.ts");
  assert.match(orch, /이미지는 선택이다: 캐릭터 등록만 요청받으면 이미지 없이 이름·설명만 등록한다/);
  assert.match(orch, /지정하지 않은 이미지를 짐작해 붙이지 않는다/);
});

test("gated brand_asset resolves its image before the approval card is created", () => {
  const src = read("prototype/functions/api/agent/_shared.ts");
  assert.match(src, /brand_asset: \{ agentId: "pixel", agentIds: \["core"\], kind: "external", gate: true, prepare: prepareBrandAssetInput, run: runBrandAssetTool \}/);
  assert.match(src, /if \(tool\.prepare\) \{\s*const prepared = await tool\.prepare\(input, \{ \.\.\.ctx, jobId \}\);/);
  assert.match(src, /UPDATE agent_jobs SET input = \$1::jsonb, updated_at = now\(\) WHERE id = \$2 AND user_id = \$3/);
  // 코어도 이미지 보관함에서 objectName 을 찾을 수 있다
  assert.match(src, /image_library: \{ agentId: "pixel", agentIds: \["plot", "reach", "core"\]/);
});

test("agents can point brand_asset at a generated image by jobId", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  assert.match(shared, /\[산출물: \$\{refs\.join\(", "\)\}\]/);
  const orch = read("prototype/functions/api/agent/_orchestrator.ts");
  assert.ok(orch.includes('{"jobId": "그 이미지의 jobId(대화의 [산출물: … jobId=…])"}'));
});

test("brand save keeps environment asset descriptions", () => {
  const save = read("prototype/functions/api/brand/save.ts");
  assert.match(save, /description: normalizeText\(raw\.description \|\| raw\.personality \|\| raw\.note \|\| ""\),/);
});
