import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("코어 UI_ACTION은 서버 allowlist를 거쳐 SSE로 현재 브라우저에 전달된다", () => {
  const orchestrator = read("prototype/functions/api/agent/_orchestrator.ts");
  const chat = read("prototype/functions/api/agent/chat.ts");
  const api = read("ai-company-app/src/lib/api.ts");
  assert.match(orchestrator, /const UI_ACTION_ALLOWLIST = new Set/);
  assert.match(orchestrator, /JSON\.parse\(String\(raw/);
  assert.match(orchestrator, /onUiAction\?:/);
  assert.match(orchestrator, /자율 근무에서는 UI_ACTION을 절대 출력하지 마세요/);
  assert.match(chat, /type: "ui_action", action/);
  assert.match(api, /onEvent\("ui_action", \{ action: event\.action \}\)/);
});

test("AI 회사 화면들은 공통 UI action 이벤트로 안전한 표시 제어를 수행한다", () => {
  const app = read("ai-company-app/src/App.tsx");
  const collapsible = read("ai-company-app/src/components/CollapsibleSection.tsx");
  const work = read("ai-company-app/src/components/WorkExplorer.tsx");
  const video = read("ai-company-app/src/components/AgentVideoWorkspace.tsx");
  const uiActions = read("ai-company-app/src/lib/uiActions.ts");
  assert.match(app, /case "ui_action"/);
  assert.match(app, /window\.setTimeout\(\(\) => dispatchUiAction\(action\), 0\)/);
  assert.match(collapsible, /action\.action !== "panel\.set"/);
  assert.match(work, /action\.action === "work_explorer\.view"/);
  assert.match(video, /action\.action === "video\.configure"/);
  assert.match(uiActions, /for \(const entry of recentUiActions\)/);
  assert.match(uiActions, /handlerRef\.current\(entry\.value\)/);
});

test("삭제·승인·외부 연결 UI action은 사람 확인 게이트를 유지한다", () => {
  const approvals = read("ai-company-app/src/components/Approvals.tsx");
  const results = read("ai-company-app/src/components/Results.tsx");
  const integrations = read("ai-company-app/src/components/Integrations.tsx");
  const work = read("ai-company-app/src/components/WorkExplorer.tsx");
  assert.match(approvals, /window\.confirm/);
  assert.match(results, /window\.confirm/);
  assert.match(integrations, /Google 연결을 해제할까요/);
  assert.match(work, /window\.confirm\(`'\$\{work\.title\}' 업무와 보관된 소스를 모두 삭제할까요/);
});

test("대화 로그 통계·보존·정리는 더 이상 성공만 반환하는 빈 구현이 아니다", () => {
  const api = read("ai-company-app/src/lib/api.ts");
  const settings = read("prototype/functions/api/agent/settings.ts");
  const auth = read("prototype/functions/api/_shared/claude-auth.js");
  assert.match(api, /settings\?kind=logStats/);
  assert.match(api, /kind: "logRetention"/);
  assert.match(api, /kind: "cleanupLogs"/);
  assert.match(settings, /DELETE FROM agent_messages/);
  assert.match(settings, /DELETE FROM agent_conversation_meta/);
  assert.match(auth, /export async function saveLogRetention/);
});

test("스킬 준비도는 실제 연동 상태에서 계산된다", () => {
  const api = read("ai-company-app/src/lib/api.ts");
  assert.match(api, /const integrations = await getIntegrations\(\)/);
  assert.match(api, /integration\.configured \? "ready" : "needs_config"/);
  assert.doesNotMatch(api, /getSkillReadiness[\s\S]{0,180}return \[\]/);
});
