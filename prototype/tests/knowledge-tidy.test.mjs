import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

// 예전 '중복 정리'는 글자까지 같은 항목만 지웠고, 추가 단계가 이미 같은 문장을 막아 사실상 할 일이 없었다.
// AI 정리안 해석·적용을 실제로 돌려 본다(DB는 메모리 흉내).
async function loadTidy() {
  const esbuild = createRequire(import.meta.url)(resolve(root, "ai-company-app/node_modules/esbuild"));
  // 색인 모듈(_knowledge-index)을 import 하므로 하나로 묶어서 불러온다.
  const js = esbuild.buildSync({
    entryPoints: [resolve(root, "prototype/functions/api/agent/_knowledge-tidy.ts")],
    bundle: true, write: false, format: "esm", platform: "neutral",
  }).outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const items = [
  { id: uuid(1), n: 1, type: "원칙", date: "2026-08-01", text: "회의는 월요일 10시" },
  { id: uuid(2), n: 2, type: "원칙", date: "2026-08-05", text: "주간 회의는 매주 월요일 오전 10시에 한다" },
  { id: uuid(3), n: 3, type: "사실", date: "2026-08-06", text: "테스트" },
  { id: uuid(4), n: 4, type: "사실", date: "2026-08-07", text: "X 기능이 추가됨" },
];

test("정리안 해석: 없는 번호·중복 사용·형식 오류는 버리고 번호를 실제 id 로 바꾼다", async () => {
  const { parseTidyPlan } = await loadTidy();
  const raw = "```json\n" + JSON.stringify({ ops: [
    { op: "merge", items: [1, 2], type: "규칙", text: "주간 회의는 매주 월요일 오전 10시", reason: "같은 회의 규칙 반복" },
    { op: "delete", items: [3, 99], reason: "의미 없음" },
    { op: "delete", items: [2], reason: "이미 병합에 쓴 번호" },
    { op: "merge", items: [4], text: "하나만 병합", reason: "형식 오류" },
    { op: "edit", items: [4], text: "X 기능을 쓴다", reason: "옛 소식 표현" },
    { op: "rename", items: [4], reason: "모르는 작업" },
  ] }) + "\n```";
  const ops = parseTidyPlan(raw, items);
  assert.deepEqual(ops.map((op) => [op.op, op.ids]), [["merge", [uuid(1), uuid(2)]], ["delete", [uuid(3)]], ["edit", [uuid(4)]]]);
  assert.equal(ops[0].type, "원칙");
  assert.equal(ops[0].before[1].text, "주간 회의는 매주 월요일 오전 10시에 한다");
  assert.equal(ops[1].text, undefined);
});

function fakeDb(rows) {
  const has = (ids) => rows.filter((row) => ids.includes(row.id));
  return async (query, params) => {
    if (query.startsWith("SELECT id, type, created_at FROM company_knowledge")) return has(params[1]).sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (query.startsWith("SELECT id FROM company_knowledge WHERE user_id = $1 AND text = $2")) return rows.filter((row) => row.text === params[1] && !params[2].includes(row.id));
    if (query.startsWith("DELETE FROM company_knowledge WHERE user_id = $1 AND id = ANY")) {
      const ids = params[1];
      for (let i = rows.length - 1; i >= 0; i -= 1) if (ids.includes(rows[i].id)) rows.splice(i, 1);
      return [];
    }
    if (query.startsWith("UPDATE company_knowledge SET text = $3, type = $4")) {
      const row = rows.find((candidate) => candidate.id === params[1]);
      Object.assign(row, { text: params[2], type: params[3] });
      return [];
    }
    throw new Error(`unexpected query: ${query}`);
  };
}

test("적용: 병합은 가장 오래된 항목에 남기고 나머지를 지우며, 그 사이 사라진 항목이 섞인 작업은 건너뛴다", async () => {
  const { applyTidyOps } = await loadTidy();
  const rows = items.map((item) => ({ id: item.id, type: item.type, text: item.text, created_at: item.date }));
  const result = await applyTidyOps(fakeDb(rows), "u1", [
    { op: "merge", ids: [uuid(2), uuid(1)], text: "주간 회의는 매주 월요일 오전 10시", type: "원칙" },
    { op: "delete", ids: [uuid(3)] },
    { op: "edit", ids: [uuid(4)], text: "X 기능을 쓴다" },
    { op: "delete", ids: [uuid(77)] },
    { op: "delete", ids: [uuid(1)] },
  ]);
  assert.deepEqual(result.applied, { merge: 1, delete: 1, edit: 1 });
  assert.deepEqual(result.skipped.map((s) => s.index), [3, 4]);
  assert.deepEqual(rows.map((row) => [row.id, row.text]), [
    [uuid(1), "주간 회의는 매주 월요일 오전 10시"],
    [uuid(4), "X 기능을 쓴다"],
  ]);
});

test("버튼은 AI 정리 확인 창을 열고, 서버는 정리안 생성과 선택 적용을 나눠 처리한다", () => {
  const knowledge = read("ai-company-app/src/components/Knowledge.tsx");
  const endpoint = read("prototype/functions/api/agent/company-knowledge.ts");
  assert.match(knowledge, /onClick=\{\(\) => setTidyOpen\(true\)\}/);
  assert.match(knowledge, /<KnowledgeTidyModal onClose=/);
  assert.doesNotMatch(knowledge, /consolidateDecisions/);
  assert.match(endpoint, /body\?\.action === "tidy_plan"[\s\S]+parseTidyPlan\(raw, items\)/);
  assert.match(endpoint, /body\?\.action === "tidy_apply"[\s\S]+applyTidyOps\(sql, auth\.userId, body\?\.ops\)/);
});
