import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Agent Video는 AI Cinema와 분리된 에이전트 협업 API를 제공한다", async () => {
  const source = await read("prototype/functions/api/agent/agent-video.ts");
  assert.match(source, /speak\(\s*env,\s*"plot"/);
  assert.match(source, /speak\(\s*env,\s*"ink"/);
  // 2026-10-21: 템플릿 칸(도표·효과음)만 고르던 픽셀·비트는 뺐다. 플롯·잉크·코어가 콘티 초안을 만든다
  assert.doesNotMatch(source, /"pixel"|"beat"/);
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
  // 옛 템플릿 미리보기(Remotion Player)는 뺐다 — 완성 영상 전에는 자리만 보여 준다
  assert.doesNotMatch(workspace, /<Player/);
  assert.match(workspace, /motionText\.previewPlaceholder/);
  assert.match(workspaceContext, /createCompanySkillJob/);
  assert.match(workspaceContext, /waitForCompanySkillJob/);
  // 2026-10-22: 렌더는 클라우드 렌더러(Cloud Run Jobs)가 한다 — 화면은 시작하고 상태만 읽는다(PC를 꺼도 된다)
  assert.match(workspaceContext, /startMotionCloud\(body\)/);
  assert.match(workspaceContext, /getMotionCloudRun\(\{ runId: cloudRun\.id \}\)/);
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

test("Agent Video 작업 패널은 내부 스크롤 없이 화면 높이에 맞고 세로·정사각 프리뷰 카드를 우측에 배치한다", async () => {
  const [workspace, commonLayout] = await Promise.all([
    read("ai-company-app/src/components/AgentVideoWorkspace.tsx"),
    read("ai-company-app/src/components/CompanySkillThreeColumnLayout.tsx"),
  ]);
  assert.match(workspace, /isTallPreview = dimensions\.height >= dimensions\.width/);
  assert.match(workspace, /calc\(\(100dvh - 300px\)/);
  assert.match(workspace, /sm:grid-cols-\[minmax\(0,1fr\)_190px\]/);
  assert.match(workspace, /gridTemplateRows: `repeat\(/);
  assert.match(commonLayout, /xl:grid-cols-\[320px_minmax\(0,1fr\)_290px\] xl:overflow-hidden/);
  assert.match(commonLayout, /xl:overflow-hidden xl:border-b-0 xl:border-r/);
  assert.doesNotMatch(commonLayout, /xl:overflow-y-auto/);
  assert.match(workspace, /style=\{\{ width: previewWidth, aspectRatio:/);
});

test("Agent Video 회의는 탭 전환 상태를 유지하고 중복 시작을 차단한다", async () => {
  const [workspace, workspaceContext, main] = await Promise.all([
    read("ai-company-app/src/components/AgentVideoWorkspace.tsx"),
    read("ai-company-app/src/contexts/AgentVideoWorkspaceContext.tsx"),
    read("ai-company-app/src/main.tsx"),
  ]);
  assert.match(main, /<AgentVideoWorkspaceProvider>[\s\S]*<App \/>/);
  assert.match(workspace, /meetingStartDisabled = meetingInProgress \|\| meetingStatus === "awaiting-approval"/);
  assert.match(workspace, /disabled=\{meetingStartDisabled\}/);
  assert.match(workspace, /meetingInProgress \? "작업 중\.\.\." : "작업 시작"/);
  assert.match(workspaceContext, /if \(meetingLockedRef\.current\) return/);
  assert.match(workspaceContext, /setMeetingStatus\("running"\)/);
  assert.match(workspaceContext, /setMeetingStatus\("done"\)/);
  assert.match(workspaceContext, /setMeetingStatus\("error"\)/);
  // 창을 다시 열면 진행 중인 클라우드 작업을 이어 읽는다(예전 기획 회의 작업 복원도 남겨 둔다)
  assert.match(workspaceContext, /writeUserStorage\(CLOUD_RUN_STORAGE_KEY, run\.id\)/);
  assert.match(workspaceContext, /readUserStorage\(CLOUD_RUN_STORAGE_KEY\)/);
  assert.match(workspaceContext, /readUserStorage\(SKILL_JOB_STORAGE_KEY\)/);
  assert.match(workspaceContext, /restoreSkillJob/);
});

test("Agent Video 업무 화면은 간결한 미리보기·업무 보고·다운로드 동작을 제공한다", async () => {
  const workspace = await read("ai-company-app/src/components/AgentVideoWorkspace.tsx");
  assert.match(workspace, />미리보기<\/h2>/);
  assert.match(workspace, />업무 보고<\/h2>/);
  assert.match(workspace, />\s*대기중\s*</);
  assert.match(workspace, /async function downloadVideo\(\)/);
  assert.match(workspace, /link\.download = "agent-video\.mp4"/);
  assert.match(workspace, />\s*다운로드\s*<\/button>/);
  assert.doesNotMatch(workspace, /item\.emoji|협업 보고서|자동 렌더·클라우드 저장|Remotion MP4 · GCS 소스 보관|로컬 MP4 다운로드/);
});

test("Agent Video 프리뷰는 자동 렌더 후 사용자별 날짜·업무 폴더에 보관된다", async () => {
  // 보관은 클라우드 렌더 작업이 사이트 저장 API로 한다(브라우저를 닫아도 된다)
  const [workspaceContext, storageApi, cloudJob] = await Promise.all([
    read("ai-company-app/src/contexts/AgentVideoWorkspaceContext.tsx"),
    read("prototype/functions/api/agent/agent-video-storage.ts"),
    read("ai-company-app/scripts/motion-cloud-job.mjs"),
  ]);
  assert.match(workspaceContext, /if \(autoRender\) \{\n\s+await beginRender\(\);/);
  assert.match(cloudJob, /\/api\/agent\/agent-video-storage\?filename=/);
  assert.match(cloudJob, /"agent-video\.mp4"/);
  assert.match(cloudJob, /"source\.json"/);
  assert.match(cloudJob, /"report\.json"/);
  assert.match(cloudJob, /"manifest\.json"/);
  assert.match(cloudJob, /\/api\/agent\/skill-jobs\/\$\{encodeURIComponent\(skillJobId\)\}\/artifacts/);
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
  assert.match(
    rightMenu,
    /title=\{t\.chat\}[\s\S]*title=\{t\.home\}[\s\S]*title=\{t\.works\}[\s\S]*title=\{t\.knowledge\}/,
  );
  assert.doesNotMatch(explorer, /onDoubleClick/);
  assert.match(explorer, /onClick=\{\(\) => openDateFolder\(folderDate\)\}/);
  assert.match(explorer, /onClick=\{\(\) => openWorkItem\(work\)\}/);
  assert.match(explorer, /if \(work\.work_type === "infographic"\) onOpenWork\(work\)/);
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
  // 완료 판정은 isDone() 으로 모았다 — 예전 코드가 넣어 둔 'done' 행도 완료로 읽어야 하기 때문.
  assert.match(explorer, /isDone\(work\.status\) \? "완료"/);
  assert.match(explorer, /status === "completed" \|\| status === "done"/);
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
  for (const visual of ["SymbolIcon", "HeroArtwork", "StepArtwork", "JourneyArtwork", "MetricArtwork", "NetworkArtwork"]) {
    assert.match(component, new RegExp(`function ${visual}`));
  }
  assert.match(component, /scene\.visualData\.values/);
  assert.match(component, /scene\.visualData\.labels/);
  assert.match(component, /spec\.backgroundStyle === "organic"/);
  assert.match(spec, /AgentVideoTheme/);
  assert.match(spec, /AgentVideoLayout/);
  assert.match(spec, /AgentVideoSymbol/);
  assert.match(spec, /inferAgentVideoSymbol/);
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
  assert.match(component, /fitTitle/);
  assert.match(component, /contrastRatio/);
  assert.match(component, /ensureContrast/);
  assert.match(component, /const format = height > width \? "portrait"/);
  assert.match(component, /titleMin = format === "portrait" \? 66/);
  assert.match(component, /fontSize: 38/);
  assert.match(component, /wordBreak: "keep-all"/);
  assert.match(component, /background: tokens\.surface/);
  assert.doesNotMatch(component, /left: -47/);
  assert.doesNotMatch(component, /spec\.motif/);
  assert.match(endpoint, /FORMAT_LAYOUTS/);
  assert.match(endpoint, /compactCopy/);
  assert.match(endpoint, /enforceSpecQuality/);
  assert.match(endpoint, /semanticLayout/);
  assert.match(endpoint, /dataMode/);
  // 2026-10-21: 콘티 초안은 확인된 수치(facts, 원래 단위)만, 자리 표시 글·요청 글 반복 금지
  assert.match(endpoint, /facts 에는 요청·자료에 실제로 있는 수치만/);
  assert.match(endpoint, /자리 표시 글\(\[채널 로고 \/ 브랜드명\], 항목 2, OOO, TBD 등\)을 절대 쓰지 않는다/);
  assert.match(endpoint, /body 에 요청 글을 그대로 반복하지 않는다/);
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
