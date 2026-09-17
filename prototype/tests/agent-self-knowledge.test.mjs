// 실제 speak 흐름을 실행해 개인 규칙 저장·보정·위임이 중복되지 않는지 검증합니다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const esbuild = require(resolve(root, "ai-company-app/node_modules/esbuild"));
const source = readFileSync(resolve(root, "prototype/functions/api/agent/_orchestrator.ts"), "utf8").replace(/\r\n?/g, "\n");
const markers = source.slice(source.indexOf("const CALL_RE ="), source.indexOf("/** 한 에이전트가 단톡방에서"));
const speakSource = source.slice(source.indexOf("export async function speak("), source.indexOf("// ── 멘션 라우팅"));
const js = esbuild.transformSync((markers + speakSource).replace(/export /g, ""), { loader: "ts" }).code;

function harness(responses, failSave = false) {
  const writes = [];
  const deletes = [];
  let modelCalls = 0;
  const deps = {
    ROSTER: [{ id: "pixel", name: "픽셀" }, { id: "core", name: "코어" }],
    resolveAgentModel: () => ({}),
    buildAgentSystem: () => "",
    callClaude: async () => { modelCalls++; return responses.shift() || ""; },
    AGENT_TOOLS: {},
    toolOwnedBy: () => true,
    addAgentKnowledgeRow: async (_sql, userId, agentId, text, type) => {
      // await 사이에 다른 발언이 진행되어도 마커 순회가 섞이지 않아야 한다.
      await new Promise((resolve) => setImmediate(resolve));
      if (failSave) throw new Error("DB unavailable");
      writes.push({ userId, agentId, text, type });
      return 1;
    },
    removeAgentKnowledgeRow: async (_sql, userId, agentId, text) => { deletes.push({ userId, agentId, text }); },
  };
  const speak = new Function(...Object.keys(deps), `${js}\nreturn speak;`)(...Object.values(deps));
  const opts = { sql: async () => [], userId: "u1", modelSelections: {}, personaOverride: "", agentKnowledge: [], companyKnowledge: [], companySkills: [], companyProjects: [] };
  return { run: (agentId = "pixel") => speak({}, agentId, "제안한 캐릭터 시트 규칙을 저장해", "", opts), writes, deletes, modelCalls: () => modelCalls };
}

test("저장했어요 + SELF_KNOW는 모델 보정 없이 개인 규칙을 정확히 한 번 저장한다", async () => {
  const h = harness(["저장했어요! [[SELF_KNOW: add | 규칙 | 캐릭터 시트는 16:9, 텍스트 없이 정면·후면·얼굴 3컷으로 구성한다.]]"]);
  const result = await h.run();
  assert.equal(h.modelCalls(), 1);
  assert.deepEqual(h.writes, [{ userId: "u1", agentId: "pixel", type: "원칙", text: "캐릭터 시트는 16:9, 텍스트 없이 정면·후면·얼굴 3컷으로 구성한다." }]);
  assert.equal(result.text, "저장했어요!");
});

test("마커를 빠뜨린 저장 보고는 한 번 보정하여 한 번만 저장한다", async () => {
  const h = harness(["저장했어요!", "[[SELF_KNOW: add | 원칙 | 캐릭터 시트는 16:9]]"]);
  await h.run();
  assert.equal(h.modelCalls(), 2);
  assert.equal(h.writes.length, 1);
});

test("저장 여부를 묻는 제안에는 개인 규칙을 저장하지 않는다", async () => {
  const h = harness(["캐릭터 시트는 16:9로 구성합니다. 이 문구로 저장할까요?"]);
  await h.run();
  assert.equal(h.modelCalls(), 1);
  assert.equal(h.writes.length, 0);
});

test("코어의 저장 위임은 코어 자신의 규칙으로 보정 저장하지 않는다", async () => {
  const h = harness(["픽셀에게 전달하고 저장할게요. [[CALL: pixel | 캐릭터 시트 규칙을 저장해]]"]);
  const result = await h.run("core");
  assert.equal(h.modelCalls(), 1);
  assert.equal(h.writes.length, 0);
  assert.equal(result.calls[0].agentId, "pixel");
});

test("동시 발언의 여러 개인 규칙은 각 직원에게 빠짐없이 저장한다", async () => {
  const h = harness([
    "저장했어요 [[SELF_KNOW: add | 원칙 | 픽셀 규칙 1]] [[SELF_KNOW: add | 원칙 | 픽셀 규칙 2]]",
    "저장했어요 [[SELF_KNOW: add | 사실 | 코어 기억 1]] [[SELF_KNOW: add | 사실 | 코어 기억 2]]",
  ]);
  await Promise.all([h.run("pixel"), h.run("core")]);
  assert.deepEqual(h.writes.filter((row) => row.agentId === "pixel").map((row) => row.text), ["픽셀 규칙 1", "픽셀 규칙 2"]);
  assert.deepEqual(h.writes.filter((row) => row.agentId === "core").map((row) => row.text), ["코어 기억 1", "코어 기억 2"]);
  assert.equal(h.modelCalls(), 2);
});

test("개인 지식 삭제도 중복 보정 없이 정확한 본문으로 한 번 처리한다", async () => {
  const h = harness(["수정했어요 [[SELF_KNOW: del | 원칙 | 이전 규칙]]"]);
  await h.run();
  assert.equal(h.modelCalls(), 1);
  assert.deepEqual(h.deletes, [{ userId: "u1", agentId: "pixel", text: "이전 규칙" }]);
});

test("개인 규칙 저장 실패는 완료 보고에 실패 안내를 붙인다", async () => {
  const h = harness(["저장했어요 [[SELF_KNOW: add | 원칙 | 캐릭터 시트는 16:9]]"], true);
  const result = await h.run();
  assert.equal(h.modelCalls(), 1);
  assert.match(result.text, /⚠️ 개인 규칙·지식을 반영하지 못했어요/);
});
