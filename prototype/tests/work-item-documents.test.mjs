// 만든 문서를 어디서 확인하나 — 업무 탐색기 회귀 방지(2026-08-13 실측).
//
// 그때 화면: 업무 세 건이 모두 '진행 중' 으로 보였고, 열어 보면
// "이 업무에 저장된 소스가 없습니다." 만 떴다. 정작 문서는 회사 파일 업무/<날짜>/ 에 있었다.
// 원인 ① 상태를 'done' 으로 저장했는데 화면은 'completed' 만 완료로 봄
//      ② 업무 상세가 영상 소스 보관함만 보고, 서식 문서(metadata.paths)는 안 봄
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");
const shared = read("prototype/functions/api/agent/_shared.ts");
const explorer = read("ai-company-app/src/components/WorkExplorer.tsx");

test("★업무는 완료 상태로 저장한다 ('done' 은 화면이 진행 중으로 읽는다)", () => {
  assert.doesNotMatch(shared, /VALUES \([^)]*'done'/, "아직 'done' 으로 저장하는 자리가 있다");
  const inserts = shared.match(/INSERT INTO company_work_items[\s\S]{0,220}?VALUES \([^)]*\)/g) || [];
  assert.ok(inserts.length >= 2, "업무 등록 자리를 찾지 못했다");
  for (const insert of inserts) assert.match(insert, /'completed'/);
});

test("서버가 쓰는 상태 어휘는 work-items API 가 받는 것과 같다", () => {
  const api = read("prototype/functions/api/agent/work-items.ts");
  assert.match(api, /\["working", "completed", "error"\]/);
});

test("옛 'done' 행도 완료로 보여준다 (이미 저장된 것을 고칠 수 없다)", () => {
  assert.match(explorer, /function isDone\(status: string\): boolean/);
  assert.match(explorer, /status === "completed" \|\| status === "done"/);
  assert.match(explorer, /isDone\(work\.status\) \? "완료"/);
});

test("★업무 상세가 '이 업무가 만든 문서'를 보여준다", () => {
  assert.match(explorer, /function WorkDocumentFiles/);
  assert.match(explorer, /이 업무가 만든 문서/);
  // 서버가 남긴 회사 파일 경로에서 읽는다
  assert.match(explorer, /\(work\.metadata as any\)\?\.paths/);
  assert.match(explorer, /downloadCompanyFile/);
  // 소스 화면 맨 위에 붙는다
  assert.match(explorer, /\{sourceWork && <WorkDocumentFiles work=\{sourceWork\} \/>\}/);
});

test("서버가 만든 파일 경로를 업무에 실어 둔다", () => {
  const register = shared.slice(shared.indexOf("async function registerFormWorkItem"), shared.indexOf("/** 잉크 서식 목록 도구"));
  assert.match(register, /paths: args\.files\.map\(\(file\) => file\.path\)/);
});

test("소스가 없을 때 문구가 사실대로 말한다", () => {
  assert.match(explorer, /영상·이미지 소스는 없어요\. 만든 문서는 위에 있어요\./);
  assert.doesNotMatch(explorer, /이 업무에 저장된 소스가 없습니다/);
});
