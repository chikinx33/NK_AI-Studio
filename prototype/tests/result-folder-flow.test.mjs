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
  assert.match(review, /return send\(\{ ok: true, job: updated, message, filed, regenerated \}/);
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
  // 검토 대기 카드에는 갈 폴더가 없어 늘 비활성이던 '폴더' 버튼을 두지 않는다
  assert.doesNotMatch(results, /disabled=\{!it\.workDateKey\}/);
  assert.match(results, /검토 승인하면 업무 파일에 정리돼요/);
  assert.match(results, /const r = openResultFolder\(item\);[\s\S]{0,120}setFolderHint\(r\.message\)/);
});

// 증상: 재검토 창(브라우저 prompt)에 내용을 적고 확인해도 아무 변화가 없었다.
// 원인: 서버는 상태만 '재검토'로 바꿨고, 클라이언트는 담당 직원 답 메시지를 버렸다.
test("재검토는 앱 안 모달로 받고, 이미지면 그 내용을 반영해 다시 만든다", () => {
  const results = read("ai-company-app/src/components/Results.tsx");
  assert.doesNotMatch(results, /window\.prompt\(/);
  assert.match(results, /function ReviseDialog/);
  // 재검토는 상태와 상관없이 반복할 수 있고, 검토 승인은 사용 확정 전까지만 보인다
  assert.match(results, /const approvable = item\.reviewStatus !== "approved"/);
  assert.doesNotMatch(results, /reviewable && </);
  const api = read("ai-company-app/src/lib/api.ts");
  const reviewFn = api.slice(api.indexOf("export async function reviewResult"), api.indexOf("export async function cancelResult"));
  assert.match(reviewFn, /return \{ ok: true, reviewStatus: d\.job\?\.review_status, message \}/);
  const review = read("prototype/functions/api/agent/review.ts");
  assert.match(review, /decision === "revise" && note && note\.trim\(\) && job\.type === "image"/);
  assert.match(review, /createJob\(sql, \{ userId: auth\.userId, type: "image", agentId: job\.agent_id, input, parentJobId: job\.id \}\)/);
  assert.match(review, /referenceKind: "continuity", subjectDescription: "previous result to revise"/);
});

// 증상: 업무 파일 날짜 폴더의 이미지 업무가 문서 아이콘으로 보이고, 열면 빈 소스 목록이었다.
test("업무 파일의 이미지 업무는 썸네일로 보이고 이미지 미리보기로 열린다", () => {
  const explorer = read("ai-company-app/src/components/WorkExplorer.tsx");
  assert.match(explorer, /function imageWorkObject\(work: CompanyWorkItem\)/);
  assert.match(explorer, /setImagePreview\(\{ source: "generated"/);
  assert.match(explorer, /<GeneratedFilePreview file=\{imagePreview\}/);
});

// 증상: 생성 이미지 '다운로드'가 새 창으로 이미지만 열었다(서명 URL CORS).
test("생성 파일 다운로드는 같은 오리진 미디어 프록시로 실제 파일을 받는다", () => {
  const preview = read("ai-company-app/src/components/ChatFileAttachments.tsx");
  assert.match(preview, /const sources = \[proxyUrl, url\]\.filter\(Boolean\)/);
  assert.doesNotMatch(preview, /anchor\.target = "_blank"/);
});

// 증상: 채팅 화면에서 보고 팝업의 '폴더 열기'를 눌러도 업무 파일 화면으로 넘어가지 않았다.
// 원인: 화면 전환(handleUiAction)은 채팅 서버가 보낸 명령에만 반응했고, 화면 안 버튼이 보낸 명령은 듣지 않았다.
test("화면 안 버튼이 보낸 폴더 열기 명령도 업무 파일 화면으로 전환한다", () => {
  const app = read("ai-company-app/src/App.tsx");
  assert.match(app, /window\.addEventListener\(UI_ACTION_EVENT, listener\)/);
  assert.match(app, /action\.action === "company_files\.view" \|\| action\.action === "work_explorer\.view"\) setCenterView\("works"\)/);
  // 서버 명령의 재방송은 두 번 처리하지 않는다
  assert.match(app, /routedUiActions\.current\.add\(action\)/);
});

test("업무 파일은 드래그로 파일·폴더를 폴더에 넣는다", () => {
  const explorer = read("ai-company-app/src/components/CompanyFileExplorer.tsx");
  assert.match(explorer, /const movable = \(entry: CompanyFileEntry\) => entry\.kind === "file" \|\| entry\.kind === "folder"/);
  // 자기 자신·하위 폴더·제자리로는 옮기지 않는다
  assert.match(explorer, /sourceParent !== targetPath && targetPath !== source && !targetPath\.startsWith\(`\$\{source\}\/`\)/);
  assert.match(explorer, /await moveCompanyFile\(source, joinPath\(targetPath, source\.split\("\/"\)\.pop\(\) \|\| source\)\)/);
});
