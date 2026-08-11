import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// 증상: 산출물 팝업의 '폴더 열기'를 눌러도 아무 반응이 없고, 업무 파일에 폴더도 안 생겼다.
// 원인: openResultFolder 가 항상 실패만 반환하는 껍데기였고, 업무 파일의 날짜 폴더는
// company_work_items 를 비추는데 이미지·영상 산출물은 그 표에 등록되지 않았다.

test("승인된 산출물은 회사 업무로 등록된다", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  assert.match(shared, /export async function fileJobAsWorkItem/);
  assert.match(shared, /INSERT INTO company_work_items/);
  // 같은 잡을 두 번 승인해도 폴더가 두 개 생기지 않는다
  assert.match(shared, /WHERE user_id = \$1 AND metadata->>'jobId' = \$2/);
  // dataUrl 같은 큰 값을 metadata 에 담지 않는다
  const fn = shared.slice(shared.indexOf("export async function fileJobAsWorkItem"), shared.indexOf("/** 진행 안내 해제"));
  assert.doesNotMatch(fn, /dataUrl/);
});

test("검수 승인 시 등록하고 위치를 잡에 남긴다", () => {
  const review = read("prototype/functions/api/agent/review.ts");
  assert.match(review, /filed = await fileJobAsWorkItem\(sql, auth\.userId, job, executedOutput\)/);
  // 새로고침 후에도 폴더 열기가 되도록 output 에 위치를 심는다
  assert.match(review, /workItemId: filed\.workId, workDateKey: filed\.dateKey/);
  assert.match(review, /return send\(\{ ok: true, job: updated, message, filed \}/);
});

test("폴더 열기는 실제로 업무 파일 폴더를 연다", () => {
  const api = read("ai-company-app/src/lib/api.ts");
  // 예전엔 무조건 ok:false 만 반환했다
  assert.doesNotMatch(api, /클라우드에서는 폴더 열기를 지원하지 않아요/);
  assert.match(api, /dispatchUiAction\(\{ action: "company_files\.view", dateKey \}\)/);
  assert.match(api, /workDateKey\?: string/);
  assert.match(api, /workDateKey: out\.workDateKey \|\| ""/);
});

test("탐색기가 지정된 날짜 폴더를 연다", () => {
  const explorer = read("ai-company-app/src/components/WorkExplorer.tsx");
  assert.match(explorer, /const dateKey = actionString\(action, "dateKey"\)/);
  assert.match(explorer, /setDate\(\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(dateKey\) \? dateKey : ""\)/);
});

test("승인 전에는 버튼이 이유를 알려준다", () => {
  const results = read("ai-company-app/src/components/Results.tsx");
  // 조용한 무반응 대신 비활성 + 안내
  assert.match(results, /disabled=\{!item\.workDateKey\}/);
  assert.match(results, /disabled=\{!it\.workDateKey\}/);
  assert.match(results, /검토 승인하면 업무 파일에 정리돼요/);
  assert.match(results, /const r = openResultFolder\(item\);[\s\S]{0,120}setFolderHint\(r\.message\)/);
});
