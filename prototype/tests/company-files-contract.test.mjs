import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("회사 파일 API는 사용자별 GCS 경로와 안전한 상대 경로를 사용한다", async () => {
  const source = await read("prototype/functions/api/agent/company-files.ts");
  assert.match(source, /authorizeRequest\(request, env\)/);
  assert.match(source, /buildAiVideoProjectPrefix\(basePrefix, userId, "ai-company"\)/);
  assert.match(source, /\/company-files\//);
  assert.match(source, /function normalizePath/);
  assert.match(source, /part === "\.\."/);
  assert.match(source, /MAX_UPLOAD_BYTES = 100 \* 1024 \* 1024/);
  assert.match(source, /MAX_TEXT_BYTES = 1024 \* 1024/);
  assert.match(source, /if \(uploadPath !== null\)/);
  assert.match(source, /listVirtualWorkFolders/);
  assert.match(source, /listVirtualWorkItems/);
  assert.match(source, /kind: "work-folder"/);
  assert.match(source, /unified: true/);
  assert.match(source, /function assertMutablePath/);
  assert.match(source, /WITH normalized_items AS/);
  assert.match(source, /COALESCE\(MAX\(folder\.title\), item\.date_key\)/);
  assert.match(source, /GROUP BY item\.date_key/);
  assert.doesNotMatch(source, /GROUP BY date_key, folder\.title/);
});

test("회사 파일 API는 폴더 생성·파일 작성·복사·이동·삭제를 제공한다", async () => {
  const source = await read("prototype/functions/api/agent/company-files.ts");
  assert.match(source, /action === "mkdir"/);
  assert.match(source, /action === "write"/);
  assert.match(source, /action === "copy" \|\| action === "move"/);
  assert.match(source, /copyObject/);
  assert.match(source, /rewriteToken/);
  assert.match(source, /payload\.done === true/);
  assert.match(source, /export const onRequestDelete/);
  assert.match(source, /폴더를 자기 하위 경로로 복사하거나 이동할 수 없습니다/);
  assert.match(source, /existing\.kind === "folder" && body\.existOk === true/);
  assert.match(source, /created: false/);
});

test("통합 업무 파일 화면은 생성 업무와 일반 파일을 한 루트에서 관리한다", async () => {
  const [explorer, workExplorer, api] = await Promise.all([
    read("ai-company-app/src/components/CompanyFileExplorer.tsx"),
    read("ai-company-app/src/components/WorkExplorer.tsx"),
    read("ai-company-app/src/lib/api.ts"),
  ]);
  assert.match(workExplorer, /CompanyFileExplorer/);
  assert.match(workExplorer, /if \(!date && !sourceWork\) return <CompanyFileExplorer/);
  assert.doesNotMatch(workExplorer, />내 파일<\/button>/);
  assert.match(explorer, />업무 파일<\/span>/);
  assert.match(explorer, /entry\.kind === "work-folder"/);
  assert.match(explorer, /onOpenWorkFolder/);
  assert.match(explorer, /type="file" multiple/);
  assert.match(explorer, />파일 추가<\/button>/);
  assert.match(explorer, /transfer\("copy"\)/);
  assert.match(explorer, /transfer\("move"\)/);
  assert.match(explorer, /function SelectionCheckbox/);
  assert.match(explorer, /className="peer sr-only"/);
  assert.match(explorer, /function duplicateSelected/);
  assert.match(explorer, /nextDuplicateDestination/);
  assert.match(explorer, />복제<\/button>/);
  assert.match(explorer, /renameSelected/);
  assert.match(explorer, /deleteCompanyFiles/);
  assert.match(api, /listCompanyFiles/);
  assert.match(api, /uploadCompanyFile/);
  assert.match(api, /createCompanyFolder/);
  assert.match(api, /copyCompanyFile/);
  assert.match(api, /moveCompanyFile/);
});

test("모든 에이전트는 회사 파일을 공유하고 폴더 생성은 즉시 검증하며 위험 변경은 승인받는다", async () => {
  const [shared, orchestrator, app, approvals] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
    read("ai-company-app/src/App.tsx"),
    read("ai-company-app/src/components/Approvals.tsx"),
  ]);
  assert.match(shared, /company_files_list:[^\n]+kind: "read"/);
  assert.match(shared, /company_files_read:[^\n]+kind: "read"/);
  assert.match(shared, /company_files_mkdir:[^\n]+kind: "local"/);
  assert.match(shared, /runCompanyFilesMkdirTool[\s\S]+existOk: true[\s\S]+verified: true/);
  for (const tool of ["company_files_write", "company_files_copy", "company_files_move", "company_files_delete"]) {
    assert.match(shared, new RegExp(`${tool}:[^\\n]+kind: "external", gate: true`));
    assert.match(orchestrator, new RegExp(`\\[\\[RUN: ${tool}`));
  }
  assert.match(orchestrator, /\[\[RUN: company_files_mkdir/);
  assert.match(orchestrator, /inferCompanyFolderCreateRun/);
  assert.match(orchestrator, /result\.runs\.push\(inferred\)/);
  assert.match(orchestrator, /await runTools\(res2\.runs, agentId, depth \+ 1, seenRuns\)/);
  assert.match(orchestrator, /if \(seenRuns\.has\(runKey\)\) continue/);
  assert.match(orchestrator, /company_files\.view[\s\S]+output\?\.parentPath/);
  assert.match(orchestrator, /"company_files\.view", "company_files\.refresh"/);
  assert.match(app, /name\.startsWith\("company_files\."\)/);
  assert.match(approvals, /dispatchUiAction\(\{ action: "company_files\.refresh" \}\)/);
});

test("업무 상태는 명세 생성부터 렌더·보관 완료까지 분리된다", async () => {
  const [create, browserArchive, serverArchive, explorer] = await Promise.all([
    read("prototype/functions/api/agent/agent-video.ts"),
    read("ai-company-app/src/contexts/AgentVideoWorkspaceContext.tsx"),
    read("prototype/functions/api/agent/skill-jobs/[jobId]/render-output.ts"),
    read("ai-company-app/src/components/WorkExplorer.tsx"),
  ]);
  assert.match(create, /'infographic', 'working'/);
  assert.match(browserArchive, /updateActiveWorkStatus\("completed"\)/);
  assert.match(browserArchive, /updateActiveWorkStatus\("error"\)/);
  assert.match(serverArchive, /company_work_items SET status = 'completed'/);
  assert.match(serverArchive, /company_work_items SET status = 'error'/);
  assert.match(explorer, /전체 상태/);
  assert.match(explorer, /진행 중/);
});

test("업무 삭제는 서버가 산출물과 SkillJob 정리를 함께 수행한다", async () => {
  const [endpoint, explorer, storage] = await Promise.all([
    read("prototype/functions/api/agent/work-items.ts"),
    read("ai-company-app/src/components/WorkExplorer.tsx"),
    read("prototype/functions/api/agent/agent-video-storage.ts"),
  ]);
  assert.match(endpoint, /agent-video-storage/);
  assert.match(endpoint, /DELETE FROM company_skill_jobs/);
  assert.match(endpoint, /DELETE FROM company_work_items/);
  assert.doesNotMatch(explorer, /async function removeWork[\s\S]{0,500}deleteAgentVideoStorageFiles/);
  assert.match(storage, /includeSignedUrl/);
});
