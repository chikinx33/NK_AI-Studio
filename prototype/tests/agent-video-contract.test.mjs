import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Agent Video는 AI Cinema와 분리된 에이전트 협업 API를 제공한다", async () => {
  const source = await read("prototype/functions/api/agent/agent-video.ts");
  assert.match(source, /speak\(\s*env,\s*"plot"/);
  assert.match(source, /Promise\.all\(\[/);
  assert.match(source, /"ink"/);
  assert.match(source, /"pixel"/);
  assert.match(source, /"beat"/);
  assert.match(source, /callClaude\(env, synthesisSystem/);
  assert.doesNotMatch(source, /postprod\/transcode|buildTimelineModel|postTimelineEdits/);
});

test("Agent Video 화면은 Remotion Player와 로컬 MP4 렌더를 연결한다", async () => {
  const [workspace, workspaceContext, app, main, server] = await Promise.all([
    read("ai-company-app/src/components/AgentVideoWorkspace.tsx"),
    read("ai-company-app/src/contexts/AgentVideoWorkspaceContext.tsx"),
    read("ai-company-app/src/App.tsx"),
    read("ai-company-app/src/main.tsx"),
    read("server.js"),
  ]);
  assert.match(workspace, /<Player/);
  assert.match(workspaceContext, /createAgentVideo/);
  assert.match(workspaceContext, /startLocalAgentVideoRender/);
  assert.match(main, /<AgentVideoWorkspaceProvider>/);
  assert.match(app, /centerView === "video"/);
  assert.match(server, /\/local-agent-video\/render/);
  assert.match(server, /render-agent-video\.mjs/);
});

test("Agent Video 회의는 탭 전환 상태를 유지하고 중복 시작을 차단한다", async () => {
  const [workspace, workspaceContext, main] = await Promise.all([
    read("ai-company-app/src/components/AgentVideoWorkspace.tsx"),
    read("ai-company-app/src/contexts/AgentVideoWorkspaceContext.tsx"),
    read("ai-company-app/src/main.tsx"),
  ]);
  assert.match(main, /<AgentVideoWorkspaceProvider>[\s\S]*<App \/>/);
  assert.match(workspace, /disabled=\{meetingInProgress\}/);
  assert.match(workspace, /meetingInProgress \? "회의 중\.\.\."/);
  assert.match(workspaceContext, /if \(meetingLockedRef\.current\) return/);
  assert.match(workspaceContext, /setMeetingStatus\("running"\)/);
  assert.match(workspaceContext, /setMeetingStatus\("done"\)/);
  assert.match(workspaceContext, /setMeetingStatus\("error"\)/);
});

test("Agent Video 프리뷰는 자동 렌더 후 사용자별 날짜·업무 폴더에 보관된다", async () => {
  const [workspaceContext, storageApi] = await Promise.all([
    read("ai-company-app/src/contexts/AgentVideoWorkspaceContext.tsx"),
    read("prototype/functions/api/agent/agent-video-storage.ts"),
  ]);
  assert.match(workspaceContext, /await beginRender\(nextSpec\)/);
  assert.match(workspaceContext, /uploadAgentVideoStorageFile/);
  assert.match(workspaceContext, /raviok-agent-video\.mp4/);
  assert.match(workspaceContext, /raviok-agent-video-source\.json/);
  assert.match(storageApi, /authorizeRequest\(request, env\)/);
  assert.match(storageApi, /buildAiVideoProjectPrefix\(basePrefix, userId, "ai-company"\)/);
  assert.match(storageApi, /\/work-library\//);
  assert.match(storageApi, /\$\{dateFolder\}\/\$\{workId\}\//);
  assert.match(storageApi, /koreaDate\(\)/);
  assert.match(storageApi, /name=\$\{encodeURIComponent\(objectName\)\}/);
});

test("회사 업무 탐색기는 날짜·업무·소스 계층과 확인 링크를 제공한다", async () => {
  const [explorer, rightMenu, markdown, orchestrator, shared, workApi] = await Promise.all([
    read("ai-company-app/src/components/WorkExplorer.tsx"),
    read("ai-company-app/src/components/RightMenu.tsx"),
    read("ai-company-app/src/components/Markdown.tsx"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/work-items.ts"),
  ]);
  assert.match(rightMenu, /회사 업무 탐색기/);
  assert.match(rightMenu, /FolderIcon/);
  assert.doesNotMatch(rightMenu, /VideoIcon/);
  assert.match(explorer, /onDoubleClick/);
  assert.match(explorer, /WorkLibraryIcon className="h-10 w-10"/);
  assert.doesNotMatch(explorer, /Company Work Library/);
  assert.match(explorer, /소스 보기/);
  assert.match(explorer, /다운로드/);
  assert.match(explorer, /삭제/);
  assert.match(markdown, /raviok-open-work/);
  assert.match(orchestrator, /\[확인\]\(#raviok-work-/);
  assert.match(shared, /infographic: \{ agentId: "core"/);
  assert.match(workApi, /company_work_items/);
});

test("Agent Video 저장소 모달은 소스 목록·선택 다운로드·삭제를 지원한다", async () => {
  const [workspace, modal, api] = await Promise.all([
    read("ai-company-app/src/components/AgentVideoWorkspace.tsx"),
    read("ai-company-app/src/components/AgentVideoStorageModal.tsx"),
    read("ai-company-app/src/lib/api.ts"),
  ]);
  assert.match(workspace, /AgentVideoStorageModal/);
  assert.match(workspace, /☁ 저장소/);
  assert.match(modal, /전체 선택/);
  assert.match(modal, /선택 다운로드/);
  assert.match(modal, /선택 삭제/);
  assert.match(api, /listAgentVideoStorage/);
  assert.match(api, /downloadAgentVideoStorageFile/);
  assert.match(api, /deleteAgentVideoStorageFiles/);
});

test("Remotion 렌더러는 동적 명세·효과음·Windows 안전 인코딩을 지원한다", async () => {
  const [component, root, script] = await Promise.all([
    read("ai-company-app/src/remotion/AgentVideo.tsx"),
    read("ai-company-app/src/remotion/Root.tsx"),
    read("ai-company-app/scripts/render-agent-video.mjs"),
  ]);
  assert.match(component, /@remotion\/sfx/);
  assert.match(component, /<Sequence/);
  assert.match(root, /calculateMetadata/);
  assert.match(root, /id="AgentVideo"/);
  assert.match(script, /"--sequence"/);
  assert.match(script, /libx264/);
  assert.match(script, /amix=inputs=/);
});
