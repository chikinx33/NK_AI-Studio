import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

/**
 * 에이전트 모드 + 제작 캔버스(노드 UI) 계약.
 *
 * 시장의 에이전트 모드(Runway Agent · Higgsfield Supercomputer · Google Flow Agent)가 공통으로 갖는 순서는
 * "계획 → 비용 → 승인 → 실행 → 부분 재실행" 이다. 우리 구현이 그 순서를 지키는지, 그리고 캔버스가
 * 두 번째 저장 경로가 되지 않고(변경은 전부 도구를 통해) 서버 단일 조립 프롬프트를 보여주는지 못박는다.
 */

test("★영상 파이프라인 스킬은 서버·클라이언트 레지스트리와 입력 스키마에 함께 등록된다", () => {
  const server = read("prototype/functions/api/agent/_company-skill-registry.ts");
  const client = read("ai-company-app/src/lib/companySkills.ts");
  const schemas = read("ai-company-app/src/lib/companySkillSchemas.ts");
  assert.match(server, /video_pipeline: \{[\s\S]*executorId: "video-pipeline-adapter-v1"/);
  assert.match(server, /inputSchema: "company-skill\/video-pipeline\/v1"/);
  assert.match(server, /if \(skillId === "video_pipeline"\)/);
  assert.match(server, /projectId\(프로젝트\)가 필요합니다/);
  assert.match(client, /id: "video_pipeline"[\s\S]*status: "available"[\s\S]*executorId: "video-pipeline-adapter-v1"/);
  assert.match(schemas, /"company-skill\/video-pipeline\/v1"/);
  assert.match(schemas, /required: \["projectId"\]/);
});

test("★계획 → 비용 승인 → 배치 실행 → 이어가기 순서를 실행기가 강제한다", () => {
  const executor = read("prototype/functions/api/agent/_company-skill-executors.ts");
  const pipeline = read("prototype/functions/api/agent/_video-pipeline-executor.ts");
  const costs = read("prototype/functions/api/agent/_company-skill-costs.ts");
  const cont = read("prototype/functions/api/agent/skill-jobs/[jobId]/continue.ts");
  // 계획이 비용 게이트보다 먼저다(어느 컷이 비었는지 알아야 크레딧을 셈한다).
  const planIdx = executor.indexOf("prepareVideoPipelinePlan(pendingJob, context)");
  const gateIdx = executor.indexOf("estimateCompanySkillJobCost(");
  assert.ok(planIdx > 0 && gateIdx > planIdx, "계획 선행 단계가 비용 게이트 앞에 있어야 한다");
  // 크레딧을 쓰는 작업은 항상 승인을 요구한다.
  assert.match(costs, /if \(job\.skill_id === "video_pipeline"\)/);
  assert.match(costs, /approvalRequired: true,\s*\n\s*gateId,\s*\n\s*action: `\$\{pendingStills\}개 스틸/);
  // 배치가 예산에서 멈추면 running 을 유지하고 리스를 반납한다.
  assert.match(executor, /if \(result\.continueRunning\) \{[\s\S]*"running", \{[\s\S]*resetExecutionLease: true/);
  assert.match(pipeline, /VIDEO_PIPELINE_RUN_BUDGET_MS = 150_000/);
  assert.match(pipeline, /AGENT_TOOLS\.scene_still\.run\(/);
  assert.match(pipeline, /AGENT_TOOLS\.scene_video\.run\(/);
  // 실패 컷은 조용히 넘어가지 않고 스텝에 기록한다.
  assert.match(pipeline, /step\.still = "failed"/);
  assert.match(pipeline, /step\.video = "failed"/);
  // continue 는 승인 대기·종료 상태에서는 재개하지 않는다.
  assert.match(cont, /approval\.status === "pending"/);
  assert.match(cont, /\["completed", "failed", "cancelled"\]\.includes\(job\.status\)/);
  assert.match(cont, /waitUntil\(execution\.then/);
});

test("★채팅은 video_pipeline 도구와 canvas.* UI 액션으로 캔버스를 조종하고, 데이터 변경은 도구로만 한다", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  const orch = read("prototype/functions/api/agent/_orchestrator.ts");
  assert.match(shared, /video_pipeline: \{ agentId: "plot"[\s\S]*run: runVideoPipelineTool \}/);
  assert.match(shared, /\/api\/agent\/skills\/video_pipeline\/jobs\?wait=1/);
  for (const a of ["canvas.open", "canvas.focus", "canvas.select", "canvas.refresh"]) {
    assert.ok(orch.includes(`"${a}"`), `allowlist 에 ${a} 가 있어야 한다`);
  }
  assert.match(orch, /"action":"canvas\.open","projectId"/);
  assert.match(orch, /video_pipeline: `\[\[RUN: video_pipeline \|/);
  // /api/video 는 imageDataUrl 만 읽는다 — 에이전트 i2v 가 t2v 로 떨어지던 이름 불일치가 재발하면 안 된다.
  assert.match(shared, /imageDataUrl: String\(input\?\.imageUrl \|\| input\?\.imageDataUrl \|\| ""\)/);
});

test("★제작 캔버스는 서버 그래프(단일 조립 프롬프트)를 그리고, 저장·생성은 에이전트 잡으로만 보낸다", () => {
  const graph = read("prototype/functions/api/agent/production-graph.ts");
  const canvas = read("ai-company-app/src/components/ProductionCanvas.tsx");
  const panel = read("ai-company-app/src/components/VideoPipelinePanel.tsx");
  const api = read("ai-company-app/src/lib/api.ts");
  const app = read("ai-company-app/src/App.tsx");
  const menu = read("ai-company-app/src/components/RightMenu.tsx");
  assert.match(graph, /import \{ buildSceneImagePrompt, buildSceneVideoPrompt, cleanHeader \} from "\.\.\/_shared\/prompt-assembly\.js"/);
  assert.match(graph, /imagePrompt = buildSceneImagePrompt\(s, header, \{\}\)/);
  assert.match(graph, /type: "cutRef"/);
  assert.match(graph, /type: "sequence"/);
  assert.match(graph, /type: "commonOverride"/);
  // data:/blob: 은 캔버스에 싣지 않는다(무게·OOM 전례).
  assert.match(graph, /raw\.startsWith\("data:"\) \|\| raw\.startsWith\("blob:"\)/);
  // 노드 종류 고정(연출 문법) — 자유 배선 없음.
  assert.match(graph, /export type GraphNodeType = "common" \| "location" \| "character" \| "cut"/);
  // 캔버스의 쓰기는 전부 에이전트 도구 잡.
  assert.match(canvas, /createAgentJob\(type, input\)/);
  assert.match(canvas, /enqueue\("scene_upsert"/);
  assert.match(canvas, /enqueueMany\("scene_still"/);
  assert.match(canvas, /enqueueMany\("scene_video"/);
  assert.doesNotMatch(canvas, /\/api\/project\/save/);
  assert.match(canvas, /useUiAction\(\(action\) => \{[\s\S]*name\.startsWith\("canvas\."\)/);
  // 실제 전송값을 보여준다.
  assert.match(canvas, /selected\.data\.imagePrompt/);
  assert.match(canvas, /selected\.data\.videoPrompt/);
  // 에이전트 모드 패널: 계획 → 승인 → 이어가기.
  assert.match(panel, /createCompanySkillJob\("video_pipeline"/);
  assert.match(panel, /approveCompanySkillJob\(job\.id, decision/);
  assert.match(panel, /continueCompanySkillJob\(next\.id\)/);
  assert.match(api, /export async function continueCompanySkillJob/);
  assert.match(api, /nk_token=/);
  // 캔버스는 상단 메뉴가 아니라 SKILL 줄의 '영상·캔버스' 분류로 연다(사용자 결정).
  assert.doesNotMatch(menu, /onCanvas|canvas/);
  assert.match(app, /name\.startsWith\("canvas\."\)[\s\S]*setSkillCategoryId\(CANVAS_SKILL_CATEGORY_ID\)/);
  const skills = read("ai-company-app/src/lib/companySkills.ts");
  const box = read("ai-company-app/src/components/SkillBox.tsx");
  const workspace = read("ai-company-app/src/components/SkillWorkspace.tsx");
  assert.match(skills, /id: "video-production"[\s\S]*icon: "canvas"[\s\S]*status: "available"[\s\S]*id: "video_pipeline"/);
  assert.match(skills, /CANVAS_SKILL_CATEGORY_ID = "video-production"/);
  assert.match(box, /name === "canvas"/);
  assert.match(workspace, /selectedSkill\?\.id === "video_pipeline"[\s\S]*<ProductionCanvas embedded projectId=\{canvasProjectId\}/);
  // 집중 모드: 닫기 옆 확장 버튼이 좌우 패널을 접는다(사용자 요청). 스킬 화면을 떠나면 자동 해제.
  assert.match(workspace, /onToggleFocus[\s\S]*title=\{focusMode \? "패널 다시 열기" : "집중 모드 \(좌우 패널 닫기\)"\}/);
  // 임베드(AI 시네마 셸)에서는 집중 모드가 풀리지 않는다 — 캔버스만 보여야 하므로.
  assert.match(app, /if \(centerView !== "skills" && !EMBED_MODE\) setFocusMode\(false\)/);
  // 집중 모드에선 복귀 버튼만 남고 상단 메뉴(스킬 헤더·캔버스 상단 바)는 전부 숨는다.
  assert.match(workspace, /\{!focusMode && \(\s*<section className="shrink-0 border-b border-edge/);
  // 임베드(AI 시네마 셸)에서는 캔버스 상단 바(프로젝트·줌·일괄 생성)를 남긴다.
  assert.match(workspace, /hideTopBar=\{focusMode && !embed\}/);
  assert.match(canvas, /\{!hideTopBar && \(\s*<section className="flex shrink-0 flex-wrap/);
  // 연결선 곡선·직선 토글: 확장 버튼 옆, 브라우저에 기억, 캔버스가 prop 으로 받는다.
  assert.match(workspace, /writeStorage\("canvasEdgeStyle", next\)/);
  assert.match(workspace, /edgeStyle=\{edgeStyle\}/);
  // 직선 모드는 대각선이 아니라 직각(수직·수평) 경로다(사용자 요청).
  assert.match(canvas, /edgeStyle === "straight"[\s\S]*orthogonalPath\(a, b\)/);
  assert.match(canvas, /L \$\{mx\} \$\{a\.y\} L \$\{mx\} \$\{b\.y\} L \$\{b\.x\} \$\{b\.y\}/);
  assert.doesNotMatch(canvas, /`M \$\{a\.x\} \$\{a\.y\} L \$\{b\.x\} \$\{b\.y\}`/);
  // 연결선 보기·숨기기(눈 아이콘) — 기억하고, 캔버스는 숨김이면 선을 그리지 않는다.
  assert.match(workspace, /writeStorage\("canvasEdgesVisible"/);
  assert.match(workspace, /edgesVisible=\{edgesVisible\}/);
  assert.match(canvas, /edgesVisible && edgesToDraw\.map/);
  assert.match(app, /focusMode \? "lg:hidden"/);
  assert.match(app, /\$\{focusMode \? "" : "lg:flex lg:flex-col"\}/);
  // 버튼 폭 고정 규칙(상태 변화에 폭이 흔들리지 않게).
  assert.match(panel, /min-w-\[96px\]/);
});

test("★에이전트 모드는 캔버스 안에서 대화한다: 대화 독 + 채팅이 만든 파이프라인을 패널이 붙잡는다", () => {
  const dock = read("ai-company-app/src/components/CanvasChatDock.tsx");
  const canvas = read("ai-company-app/src/components/ProductionCanvas.tsx");
  const panel = read("ai-company-app/src/components/VideoPipelinePanel.tsx");
  const list = read("prototype/functions/api/agent/skill-jobs.ts");
  const api = read("ai-company-app/src/lib/api.ts");
  const orch = read("prototype/functions/api/agent/_orchestrator.ts");
  // 같은 채팅 파이프라인(streamChat)을 쓰되 스레드는 프로젝트별.
  assert.match(dock, /streamChat\(message, \(event, data\) =>/);
  assert.match(dock, /`canvas-\$\{projectId\}\$\{sessionSuffix\}`/);
  // 캔버스 맥락을 메시지 앞에 붙이고, 코어의 UI 액션은 같은 화면의 캔버스로 보낸다.
  assert.match(dock, /\[캔버스 프로젝트 \$\{projectId\}/);
  assert.match(dock, /case "ui_action":[\s\S]*dispatchUiAction\(data\.action\)/);
  assert.match(dock, /case "job_ready":[\s\S]*onJobReady\(data\?\.payload\)/);
  // 한글 IME: 전송은 keyup 의 진짜 Enter.
  assert.match(dock, /const onKeyUp = \(fn[\s\S]*isComposing/);
  assert.match(canvas, /<CanvasChatDock/);
  assert.match(canvas, /setPipelineNonce\(\(n\) => n \+ 1\)/);
  // 채팅이 만든 파이프라인을 패널이 서버 목록에서 찾아 붙고, 승인 대기면 패널을 연다.
  assert.match(list, /skill-jobs\?skillId=video_pipeline/);
  assert.match(list, /input\?\.options\?\.projectId/);
  assert.match(api, /export async function listCompanySkillJobs/);
  assert.match(panel, /listCompanySkillJobs\(\{ skillId: "video_pipeline", projectId, limit: 5 \}\)/);
  assert.match(canvas, /onAttached=\{\(job\) => \{ if \(job\.approvalState\?\.status === "pending"\) setAgentOpen\(true\); \}\}/);
  // 코어가 캔버스 맥락 접두를 이해한다.
  assert.match(orch, /\[캔버스 프로젝트 <id> …\]/);
});

test("★작성기는 작업 공간을 잘라먹지 않는 오버레이이고, 첨부·에이전트 설정·생성 설정·크레딧 표시를 갖춘다", () => {
  const dock = read("ai-company-app/src/components/CanvasChatDock.tsx");
  const canvas = read("ai-company-app/src/components/ProductionCanvas.tsx");
  const settingsLib = read("ai-company-app/src/lib/canvasSettings.ts");
  const popover = read("ai-company-app/src/components/GenerationSettingsPopover.tsx");
  const agentPanel = read("ai-company-app/src/components/AgentSettingsPanel.tsx");
  const panel = read("ai-company-app/src/components/VideoPipelinePanel.tsx");
  const shared = read("prototype/functions/api/agent/_shared.ts");
  const specs = read("prototype/functions/api/_shared/video-specs.ts");
  // 두 모드가 한 자리를 번갈아 쓴다(동시에 뜨지 않는다): 에이전트 모드 = 세션 패널(안에 입력창)만, 일반 모드 = 떠 있는 작성기만.
  const agentBranch = dock.slice(dock.indexOf('if (mode === "agent") {'), dock.indexOf("// ════════ 일반 모드"));
  const normalBranch = dock.slice(dock.indexOf("// ════════ 일반 모드"));
  assert.match(agentBranch, /absolute bottom-4 right-4 top-4 z-30[^"]*rounded-3xl/);
  assert.doesNotMatch(agentBranch, /absolute bottom-4 left-1\/2/);
  assert.match(normalBranch, /absolute bottom-4 left-1\/2 z-30/);
  assert.doesNotMatch(normalBranch, /absolute bottom-4 right-4 top-4/);
  // 노드 상세는 우측 패널이 아니라 가운데 4:3 모달(배경 흐림). 노드는 격자 스냅. 범례 없음.
  assert.match(canvas, /absolute inset-0 z-40 flex items-center justify-center bg-black\/55 p-4 backdrop-blur-sm/);
  assert.match(canvas, /aspect-\[4\/3\] max-h-full w-\[min\(1100px,100%\)\]/);
  assert.match(canvas, /const snap = \(v: number\) => Math\.round\(v \/ GRID\) \* GRID;/);
  assert.doesNotMatch(canvas, /Shift\+클릭 다중 선택/);
  assert.match(canvas, /빈 컷 일괄 생성/);
  // 일반 모드는 대화 없이 선택 컷에 바로 생성하고, '에이전트' 칩이 모드를 바꾼다.
  assert.match(normalBranch, /onClick=\{\(\) => switchMode\("agent"\)\}/);
  assert.match(normalBranch, /generateNow\(draft\)/);
  assert.match(dock, /onDirectGenerate\(settings\.kind, text\)/);
  assert.match(canvas, /const directGenerate = useCallback\(async \(kind: "image" \| "video", prompt: string\)/);
  assert.match(canvas, /onDirectGenerate=\{directGenerate\}/);
  // 스트림이 끊기면 서버에 저장된 답을 다시 읽는다.
  assert.match(dock, /if \(failed\) window\.setTimeout\(\(\) => \{ void loadThread\(\);/);
  // 사용자 중지는 오류가 아니다.
  assert.match(dock, /text: "응답을 중지했어요\."/);
  assert.match(dock, /placeholder=\{projectId \? "무엇을 만들고 싶으신가요\?"/);
  assert.match(canvas, /\{\/\* 대화 — 작성기\(하단 중앙 필\) \+ 세션 패널\(오른쪽 오버레이\)/);
  // 이미지 첨부(파일·붙여넣기) → 멀티모달로 전달.
  assert.match(dock, /reader\.readAsDataURL\(file\)/);
  assert.match(dock, /onPaste=\{onPaste\}/);
  assert.match(dock, /images = attachments\.map\(\(a\) => \(\{ base64: a\.base64, mimeType: a\.mimeType \}\)\)/);
  assert.match(dock, /\{ conversationId, signal: controller\.signal, images \}/);
  // 새 세션 · 제안 카드.
  assert.match(dock, /const newSession = \(\) => \{/);
  assert.match(dock, /같이 브레인스토밍해 줘/);
  // 생성 설정: 이미지/동영상 · 비율 · 모델 · 해상도 · 길이 · 개수 · 크레딧(서버 요율).
  assert.match(popover, /quoteCanvasCredits\(settings\)/);
  assert.match(popover, /크레딧<\/span>이 사용됩니다/);
  assert.match(settingsLib, /fetch\("\/api\/credits\/quote"/);
  // 에이전트 설정: 생성 전 확인 항상/안 함 + 기본값. '안 함' 은 브라우저가 승인 게이트를 대신 누른다.
  assert.match(agentPanel, /에이전트가 미디어를 생성하고 자동으로 크레딧을 사용합니다\./);
  assert.match(canvas, /if \(settings\.confirmBeforeGenerate \|\| !projectId\) return;/);
  assert.match(canvas, /await approveItem\(String\(j\.id\)\)/);
  assert.match(panel, /if \(!autoApprove \|\| !job \|\| job\.approvalState\?\.status !== "pending"/);
  // 설정이 실제 생성 경로에 닿는다: 인스펙터 버튼 → 도구 입력 → /api/imagen·/api/video.
  assert.match(canvas, /provider: settings\.image\.provider, imageSize: settings\.image\.size/);
  assert.match(canvas, /videoModel: settings\.video\.model, durationSeconds: settings\.video\.durationSec, resolution: settings\.video\.resolution/);
  assert.match(shared, /\.\.\.\(input\?\.provider \? \{ provider: String\(input\.provider\) \} : \{\}\)/);
  assert.match(shared, /\.\.\.\(input\?\.resolution \? \{ resolution: String\(input\.resolution\) \} : \{\}\)/);
  // 코어에게 기본값을 맥락으로 넘긴다.
  assert.match(dock, /describeSettingsForAgent\(settings\)/);
  // 길이 선택지는 서버 SSOT(video-specs.ts) 미러 — 값이 어긋나면 서버가 조용히 스냅한다.
  const serverChoices = {};
  const block = specs.slice(specs.indexOf("export const MODEL_DURATION_CHOICES"), specs.indexOf("export function allowedDurationsFor"));
  const named = { DURATIONS_VEO: [4, 6, 8], DURATIONS_KLING: [5, 10], CHOICES_SEEDANCE: [4, 5, 6, 8, 10, 15], DURATIONS_VIDU: [4, 5, 6, 8, 10] };
  for (const m of block.matchAll(/"([a-z0-9-]+)":\s*([A-Z_]+)/g)) serverChoices[m[1]] = named[m[2]];
  const clientBlock = settingsLib.slice(settingsLib.indexOf("export const VIDEO_DURATION_CHOICES"), settingsLib.indexOf("export function durationChoicesFor"));
  for (const m of clientBlock.matchAll(/"([a-z0-9-]+)":\s*\[([0-9, ]+)\]/g)) {
    const client = m[2].split(",").map((v) => Number(v.trim()));
    assert.deepEqual(client, serverChoices[m[1]], `영상 길이 선택지가 서버와 다르다: ${m[1]}`);
  }
});

test("★프로젝트 선택기는 숫자 id 가 아니라 시리즈 › 에피소드 제목으로 고르고, 시리즈는 접힌 그룹이다", () => {
  const endpoint = read("prototype/functions/api/agent/production-projects.ts");
  const picker = read("ai-company-app/src/components/ProjectPicker.tsx");
  const canvas = read("ai-company-app/src/components/ProductionCanvas.tsx");
  const api = read("ai-company-app/src/lib/api.ts");
  const shared = read("prototype/functions/api/agent/_shared.ts");
  // 서버가 data.json 을 읽어 시리즈·에피소드 제목과 씬/스틸/영상 수를 붙인다.
  assert.match(endpoint, /export function summarizeProject\(/);
  assert.match(endpoint, /const seriesTitle = text\(extra\.sharedSeriesTitle \|\| payload\.seriesTitle/);
  assert.match(endpoint, /episodeTitle = text\(payload\.episodeTitle \|\| project\?\.title/);
  assert.match(endpoint, /projects\.sort\(\(a, b\) => \(b\.savedAt/);
  // 공유 프로젝트는 소유자 폴더에서 읽는다.
  assert.match(shared, /&ownerId=\$\{encodeURIComponent\(ownerId\)\}/);
  assert.match(api, /export async function listProductionProjects/);
  // 선택기: 시리즈 그룹 접힘 + 검색 + 캔버스는 <select> 를 더 쓰지 않는다.
  assert.match(picker, /const groups = useMemo<SeriesGroup\[\]>/);
  assert.match(picker, /placeholder="시리즈·에피소드 검색"/);
  assert.match(picker, /if \(current\) next\.add\(current\.seriesId \|\| current\.id\)/);
  assert.match(canvas, /<ProjectPicker projects=\{projects\} value=\{projectId\} onChange=\{setProjectId\}/);
  assert.doesNotMatch(canvas, /<option value="">프로젝트 선택…<\/option>/);
});

// TypeScript 를 그대로 실행할 수는 없으니 ai-company-app 의 typescript 로 변환해 순수 함수만 검증한다.
function loadPipelineModule() {
  let ts;
  try {
    ts = createRequire(path.join(process.cwd(), "ai-company-app", "package.json"))("typescript");
  } catch {
    return null;
  }
  const src = read("prototype/functions/api/agent/_video-pipeline-executor.ts");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const calls = [];
  const fakeTools = {
    scene_still: { run: async (input) => { calls.push(["still", input.sceneId]); if (String(input.sceneId) === "2") throw new Error("boom"); return { signedUrl: "https://x/still", promptEcho: "p" }; } },
    scene_video: { run: async (input) => { calls.push(["video", input.sceneId]); return { videoUrl: "https://x/clip", promptEcho: "v" }; } },
  };
  const mod = { exports: {} };
  const req = (name) => {
    if (name.endsWith("credit-rates.js")) return { quoteCredits: (feature) => ({ credits: feature === "video" ? 40 : 20 }) };
    if (name === "./_shared") return { AGENT_TOOLS: fakeTools };
    throw new Error(`unexpected require: ${name}`);
  };
  new Function("require", "module", "exports", js)(req, mod, mod.exports);
  return { mod: mod.exports, calls };
}

test("★계획은 빈 컷만 pending 으로 잡고 크레딧을 합산하며, 배치는 스틸→영상 순으로 돌고 실패를 기록한다", async (t) => {
  const loaded = loadPipelineModule();
  if (!loaded) { t.skip("typescript 를 찾지 못해 런타임 검증을 건너뛴다"); return; }
  const { mod, calls } = loaded;
  const job = { id: "job", input: { options: { projectId: "p1", stages: ["still", "video"], maxScenesPerRun: 5 } } };
  const scenes = [
    { id: 1, estSec: 6 },                                        // 둘 다 없음
    { id: 2, imageDataUrl: "gs://b/still2.png", estSec: 6 },     // 스틸 있음 → 영상만
    { id: 3, imageDataUrl: "gs://b/s3.png", videoUrl: "gs://b/v3.mp4" }, // 둘 다 있음 → skipped
  ];
  const plan = mod.buildVideoPipelinePlan(job, { scenes }, {});
  assert.deepEqual(plan.steps.map((s) => [s.still, s.video]), [["pending", "pending"], ["skipped", "pending"], ["skipped", "skipped"]]);
  assert.equal(plan.summary.pendingStills, 1);
  assert.equal(plan.summary.pendingVideos, 2);
  assert.equal(plan.summary.credits, 20 + 40 + 40);

  // regenerate 면 있는 것도 다시 만든다.
  const again = mod.buildVideoPipelinePlan({ ...job, input: { options: { projectId: "p1", regenerate: true } } }, { scenes }, {});
  assert.equal(again.summary.pendingStills, 3);

  // sceneIds 로 대상 컷을 좁힌다.
  const only = mod.buildVideoPipelinePlan({ ...job, input: { options: { projectId: "p1", sceneIds: ["1"] } } }, { scenes }, {});
  assert.deepEqual(only.steps.map((s) => s.video), ["pending", "skipped", "skipped"]);

  const result = await mod.runVideoPipelineBatch(plan, {}, { budgetMs: 60_000 });
  assert.deepEqual(calls, [["still", 1], ["video", 1], ["video", 2]]);
  assert.equal(result.continueRunning, false);
  assert.equal(result.plan.steps[0].still, "done");
  assert.equal(result.plan.steps[0].video, "done");
  assert.equal(result.plan.steps[1].video, "done");

  // 스틸이 실패한 컷은 영상을 시도하지 않고 pending 으로 남긴다 → continueRunning 이 아니라 failed 로 표시.
  calls.length = 0;
  const failing = mod.buildVideoPipelinePlan(job, { scenes: [{ id: 2, estSec: 6 }] }, {});
  const r2 = await mod.runVideoPipelineBatch(failing, {}, { budgetMs: 60_000 });
  assert.deepEqual(calls, [["still", 2]]);
  assert.equal(r2.plan.steps[0].still, "failed");
  assert.equal(r2.plan.steps[0].video, "pending");
  assert.match(r2.plan.steps[0].stillError, /boom/);
  assert.equal(r2.continueRunning, true, "남은 pending 이 있으면 이어가기 대상이다");
  const reset = mod.resetFailedSteps(r2.plan);
  assert.equal(reset.steps[0].still, "pending");

  // 예산 소진 시 멈추고 이어가기 표시.
  calls.length = 0;
  const big = mod.buildVideoPipelinePlan({ ...job, input: { options: { projectId: "p1", stages: ["still"], maxScenesPerRun: 1 } } }, { scenes: [{ id: 1 }, { id: 3 }] }, {});
  const r3 = await mod.runVideoPipelineBatch(big, {}, { budgetMs: 60_000 });
  assert.deepEqual(calls, [["still", 1]]);
  assert.equal(r3.continueRunning, true);
  assert.equal(mod.describePlanProgress(r3.plan).done, 1);
});
