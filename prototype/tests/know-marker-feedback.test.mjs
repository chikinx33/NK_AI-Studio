import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const orchestrator = read("prototype/functions/api/agent/_orchestrator.ts");
const shared = read("prototype/functions/api/agent/_shared.ts");

// applyKnows·knowFailureNote 를 실제로 돌린다(DB는 메모리 흉내). 예전엔 0건 반영이어도 조용히 넘어가 '완료' 거짓 보고가 됐다.
function loadKnowApply() {
  const esbuild = createRequire(import.meta.url)(resolve(root, "ai-company-app/node_modules/esbuild"));
  const start = orchestrator.indexOf("export interface KnowResult");
  const endMarker = orchestrator.indexOf("export async function knowFailureNote");
  const end = orchestrator.indexOf("\n}\n", endMarker) + 3;
  const js = esbuild.transformSync(orchestrator.slice(start, end).replace(/export /g, ""), { loader: "ts" }).code;
  return new Function("addCompanyKnowledge", "companyKnowledgeCounts", `${js}\nreturn { applyKnows, knowFailureNote };`);
}

function fakeDb(rows) {
  const sql = async (query, params) => {
    if (query.startsWith("SELECT id, text FROM company_knowledge")) return rows.map((row) => ({ ...row }));
    if (query.startsWith("DELETE FROM company_knowledge WHERE user_id = $1 AND id = $2")) {
      const index = rows.findIndex((row) => row.id === params[1]);
      return index < 0 ? [] : rows.splice(index, 1);
    }
    if (query.startsWith("UPDATE company_knowledge SET text = $3 WHERE user_id = $1 AND id = $2")) {
      const row = rows.find((candidate) => candidate.id === params[1]);
      if (!row) return [];
      row.text = params[2];
      return [row];
    }
    throw new Error(`unexpected query: ${query}`);
  };
  const add = async (_sql, _user, text) => {
    if (rows.some((row) => row.text === text)) return 0;
    rows.push({ id: `0000000${rows.length}-aaaa-bbbb-cccc-dddddddddddd`, text });
    return 1;
  };
  const counts = async () => ({ total: rows.length + 3, knowledgeOnly: rows.length, breakdown: { rules: 0, facts: rows.length, decisions: 0, skills: 3 } });
  return { sql, add, counts };
}

test("KNOW 반영은 항목별 실제 결과(ok/skipped/error, affected, id)를 돌려준다", async () => {
  const rows = [
    { id: "1a2b3c4d-0000-0000-0000-000000000001", text: "회의는 월요일마다 한다." },
    { id: "9f8e7d6c-0000-0000-0000-000000000002", text: "브랜드 색은 초록" },
  ];
  const db = fakeDb(rows);
  const { applyKnows, knowFailureNote } = loadKnowApply()(db.add, db.counts);
  const results = await applyKnows(db.sql, "u1", [
    { action: "del", text: "  회의는 월요일마다 한다  " },        // 공백·마침표 차이 → 정규화로 찾음
    { action: "edit", text: "id:9f8e7d6c", newText: "브랜드 색은 청록" }, // 짧은 id 로 지정
    { action: "del", text: "존재하지 않는 규칙" },
    { action: "add", text: "새 결정", type: "결정" },
    { action: "add", text: "새 결정", type: "결정" },
  ], "코어");
  assert.deepEqual(results.map((r) => [r.status, r.affected]), [["ok", 1], ["ok", 1], ["error", 0], ["ok", 1], ["skipped", 0]]);
  assert.equal(results[0].id, "id:1a2b3c4d");
  assert.match(results[2].reason, /item not found/);
  assert.equal(rows.find((row) => row.id.startsWith("9f8e7d6c")).text, "브랜드 색은 청록");

  const note = await knowFailureNote(db.sql, "u1", results);
  assert.match(note, /⚠️ 회사 지식 반영 실패 1건 \(성공 3건\)/);
  assert.match(note, /삭제 '존재하지 않는 규칙'/);
  assert.match(note, /현재 회사 지식 5개\(지식 2 · 스킬 3\)/);
  assert.equal(await knowFailureNote(db.sql, "u1", results.filter((r) => r.status !== "error")), "");
});

test("여러 항목과 일치하면 임의로 지우지 않는다", async () => {
  const rows = [
    { id: "aaaa0001-0000-0000-0000-000000000001", text: "중복 규칙" },
    { id: "aaaa0002-0000-0000-0000-000000000002", text: "중복 규칙 " },
  ];
  const db = fakeDb(rows);
  const { applyKnows } = loadKnowApply()(db.add, db.counts);
  const [result] = await applyKnows(db.sql, "u1", [{ action: "del", text: "중복 규칙." }], "코어");
  assert.equal(result.status, "error");
  assert.match(result.reason, /2개 항목과 일치/);
  assert.equal(rows.length, 2);
});

test("KNOW del/edit 에 분류를 끼워 써도 분류를 버리고 내용으로 찾는다", () => {
  assert.match(orchestrator, /parts\.length >= 3 && KNOW_TYPE_WORD\.test\(parts\[1\]\) \? parts\.slice\(2\) : parts\.slice\(1\)/);
  assert.match(orchestrator, /\^\(edit\|update\|mod\|modify\|수정\|변경\)\$/);
  assert.doesNotMatch(read("prototype/functions/api/agent/cancel-job.ts"), /KNOW: del \| 결정 \|/);
});

test("반영 실패는 발언에 붙거나 같은 직원 이름으로 즉시 알린다", () => {
  assert.match(orchestrator, /if \(knowNote\) res\.text = `\$\{res\.text\}\\n\\n\$\{knowNote\}`/);
  assert.match(orchestrator, /_applyKnows\(res2\.knows, meta\.name, agentId\)/);
  assert.match(orchestrator, /_applyKnows\(res\.knows, meta\.name, workerId\)/);
  assert.match(orchestrator, /_applyKnows\(wrap\.knows, "코어", "core"\)/);
  assert.match(orchestrator, /지식을 삭제·추가한 전후 비교는 반드시 knowledgeOnly/);
});

test("knowledge_audit 와 화면 '회사 지식 N'은 같은 기준(지식+스킬)을 쓰고 지식만 개수도 따로 준다", () => {
  assert.match(shared, /export async function companyKnowledgeCounts/);
  assert.match(shared, /total: knowledgeOnly \+ breakdown\.skills, knowledgeOnly, breakdown/);
  assert.match(shared, /total: counts\.total,\s*knowledgeOnly: counts\.knowledgeOnly,\s*breakdown: counts\.breakdown/);
  assert.match(shared, /nextOffset < counts\.knowledgeOnly/);
  assert.match(read("ai-company-app/src/components/Approvals.tsx"), /회사 지식 \(\{knowledge\.length \+ skills\.length\}\)/);
  assert.match(read("ai-company-app/src/components/Knowledge.tsx"), /회사 지식 \(\{items\.length \+ skills\.length\}\)/);
});
