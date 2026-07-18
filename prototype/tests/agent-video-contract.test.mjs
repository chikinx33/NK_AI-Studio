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
  assert.match(workspace, /onClose: \(\) => void/);
  assert.match(workspace, /업무 폴더로 돌아가기/);
  assert.doesNotMatch(workspace, /AI Cinema와 분리된 독립 제작/);
  assert.match(app, /workFolderDate/);
  assert.match(app, /initialDate=\{workFolderDate\}/);
  assert.match(app, /<AgentVideoWorkspace onClose=\{\(\) => setCenterView\("works"\)\}/);
  assert.match(server, /\/local-agent-video\/render/);
  assert.match(server, /render-agent-video\.mjs/);
});

test("Agent Video 세로형 프리뷰는 화면 높이에 맞고 장면 카드는 우측 레일에 배치된다", async () => {
  const workspace = await read("ai-company-app/src/components/AgentVideoWorkspace.tsx");
  assert.match(workspace, /isPortraitPreview = dimensions\.height > dimensions\.width/);
  assert.match(workspace, /previewWidth = `min\(100%, max\(240px, calc\(/);
  assert.match(workspace, /sm:grid-cols-\[minmax\(0,1fr\)_220px\]/);
  assert.match(workspace, /max-h-\[calc\(100dvh-190px\)\]/);
  assert.match(workspace, /style=\{\{ width: previewWidth \}\}/);
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
  const [explorer, rightMenu, markdown, orchestrator, shared, workApi, folderApi, clientApi] = await Promise.all([
    read("ai-company-app/src/components/WorkExplorer.tsx"),
    read("ai-company-app/src/components/RightMenu.tsx"),
    read("ai-company-app/src/components/Markdown.tsx"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/work-items.ts"),
    read("prototype/functions/api/agent/work-folders.ts"),
    read("ai-company-app/src/lib/api.ts"),
  ]);
  assert.match(rightMenu, /회사 업무 탐색기/);
  assert.match(rightMenu, /FolderIcon/);
  assert.doesNotMatch(rightMenu, /VideoIcon/);
  assert.doesNotMatch(explorer, /onDoubleClick/);
  assert.match(explorer, /onClick=\{\(\) => openDateFolder\(folderDate\)\}/);
  assert.match(explorer, /onClick=\{\(\) => onOpenWork\(work\)\}/);
  assert.match(explorer, /WorkLibraryIcon className="h-10 w-10"/);
  assert.doesNotMatch(explorer, /Company Work Library/);
  assert.match(explorer, /소스 보기/);
  assert.match(explorer, /다운로드/);
  assert.match(explorer, /삭제/);
  assert.doesNotMatch(explorer, /더블클릭하여 열기/);
  assert.match(explorer, /ViewModeControl/);
  assert.match(explorer, /목록 보기/);
  assert.match(explorer, /카드 보기/);
  assert.match(explorer, /value="title"/);
  assert.match(explorer, /value="content"/);
  assert.match(explorer, /value="all"/);
  assert.match(explorer, /제목\+내용/);
  assert.match(explorer, /value="newest"/);
  assert.match(explorer, /value="oldest"/);
  assert.match(explorer, /value="name-asc"/);
  assert.match(explorer, /value="name-desc"/);
  assert.match(explorer, /workMatches/);
  assert.match(explorer, /visibleDatedItems/);
  assert.match(explorer, /visibleSources/);
  assert.match(explorer, /생성일 \{folderDate\}/);
  assert.match(explorer, /function VideoWorkIcon/);
  assert.match(explorer, /work\.work_type === "infographic" \? <VideoWorkIcon/);
  assert.match(explorer, /DocumentIcon/);
  assert.match(explorer, /data-item-menu/);
  assert.match(explorer, /documentMenu/);
  assert.match(explorer, /beginRenameDocument/);
  assert.doesNotMatch(explorer, /status === "completed" \? "완료"/);
  assert.match(explorer, /이름 변경/);
  assert.match(explorer, /removeDateFolder/);
  assert.match(markdown, /raviok-open-work/);
  assert.match(orchestrator, /\[확인\]\(#raviok-work-/);
  assert.match(shared, /infographic: \{ agentId: "core"/);
  assert.match(shared, /company_work_folders/);
  assert.match(workApi, /company_work_items/);
  assert.match(workApi, /onRequestPatch/);
  assert.match(folderApi, /onRequestPatch/);
  assert.match(folderApi, /date_key/);
  assert.match(clientApi, /renameCompanyWorkFolder/);
  assert.match(clientApi, /renameCompanyWorkItem/);
  assert.match(clientApi, /deleteCompanyWorkFolderMeta/);
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

test("Agent Video는 주제별 아트 디렉션·데이터 차트·최근 결과 중복 방지를 적용한다", async () => {
  const [component, spec, endpoint] = await Promise.all([
    read("ai-company-app/src/remotion/AgentVideo.tsx"),
    read("ai-company-app/src/remotion/spec.ts"),
    read("prototype/functions/api/agent/agent-video.ts"),
  ]);
  for (const visual of ["DonutVisual", "GaugeVisual", "ComparisonVisual", "FlowVisual", "EcosystemVisual", "CountersVisual", "AreaVisual"]) {
    assert.match(component, new RegExp(`function ${visual}`));
  }
  assert.match(component, /scene\.visualData\.values/);
  assert.match(component, /scene\.visualData\.labels/);
  assert.match(component, /spec\.backgroundStyle === "organic"/);
  assert.match(spec, /AgentVideoTheme/);
  assert.match(spec, /AgentVideoLayout/);
  assert.match(spec, /visualData: AgentVideoVisualData/);
  assert.match(endpoint, /THEME_VISUALS/);
  assert.match(endpoint, /inferTheme/);
  assert.match(endpoint, /rotateDuplicateVisuals/);
  assert.match(endpoint, /recentSignatures\.has\(visualSignature\(spec\)\)/);
});

test("Agent Video 품질 엔진은 화면비·텍스트 실측·색상 대비를 렌더 단계에서 강제한다", async () => {
  const [component, endpoint, packageJson] = await Promise.all([
    read("ai-company-app/src/remotion/AgentVideo.tsx"),
    read("prototype/functions/api/agent/agent-video.ts"),
    read("ai-company-app/package.json"),
  ]);
  assert.match(packageJson, /"@remotion\/layout-utils"/);
  assert.match(component, /import \{ fitText \} from "@remotion\/layout-utils"/);
  assert.match(component, /fitMultilineText/);
  assert.match(component, /contrastRatio/);
  assert.match(component, /accessibleAccent/);
  assert.match(component, /const vertical = portrait \|\| square/);
  assert.match(component, /square[\s\S]*minmax\(0, \.84fr\) minmax\(0, 1\.16fr\)/);
  assert.match(component, /maxHeight: titleSize \* 2\.15/);
  assert.match(component, /wordBreak: "keep-all"/);
  assert.match(component, /background: tokens\.surface/);
  assert.match(endpoint, /FORMAT_LAYOUTS/);
  assert.match(endpoint, /compactCopy/);
  assert.match(endpoint, /1:1은 상·하 정보 계층과 중앙 집중 구성/);
});

test("수동 제작 어린이 안전 교육 영상은 30초·9:16 전용 장면과 효과음을 제공한다", async () => {
  const [root, video] = await Promise.all([
    read("ai-company-app/src/remotion/Root.tsx"),
    read("ai-company-app/src/remotion/ChildSafetyVertical.tsx"),
  ]);
  assert.match(root, /id="ChildSafetyVertical"/);
  assert.match(video, /width: 1080, height: 1920, fps: FPS, durationInFrames: TOTAL_FRAMES/);
  assert.match(video, /SCENE_FRAMES = \[120, 180, 180, 180, 150, 90\]/);
  assert.match(video, /횡단보도 안전/);
  assert.match(video, /화재 대피/);
  assert.match(video, /낯선 사람 대처/);
  assert.match(video, /긴급 신고/);
  assert.match(video, /@remotion\/sfx/);
  assert.match(video, /<Audio src=\{sounds\[index\]\}/);
});
