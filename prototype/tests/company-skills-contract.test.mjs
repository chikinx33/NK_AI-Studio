import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("회사 스킬은 상단 메뉴 아래에 대분류 아이콘만 표시하고 구현된 분류만 연다", async () => {
  const [registry, skillBox, app] = await Promise.all([
    read("ai-company-app/src/lib/companySkills.ts"),
    read("ai-company-app/src/components/SkillBox.tsx"),
    read("ai-company-app/src/App.tsx"),
  ]);

  assert.match(registry, /id: "design-content"[\s\S]*status: "available"/);
  assert.match(registry, /id: "infographic"[\s\S]*status: "available"/);
  assert.match(registry, /id: "documents-office"[\s\S]*status: "coming-soon"/);
  assert.match(registry, /id: "development-automation"/);
  assert.match(skillBox, /COMPANY_SKILL_CATEGORIES\.map/);
  assert.match(skillBox, /disabled=\{!available\}/);
  assert.match(skillBox, />Skill<\/h2>/);
  assert.match(skillBox, /flex items-center gap-1/);
  assert.match(skillBox, /text-orange-400/);
  assert.doesNotMatch(skillBox, /개 사용 가능|BETA|grid-cols-4/);
  assert.match(app, /<SkillBox/);
  assert.match(app, /onOpenCategory=\{openSkillCategory\}/);
  assert.match(app, /centerView === "skills"/);
  assert.match(app, /<RightMenu[\s\S]*<SkillBox[\s\S]*<Approvals/);
});

test("스킬 페이지는 세부 스킬을 단일 선택하고 기존 인포그래픽 워크스페이스를 재사용한다", async () => {
  const [workspace, videoWorkspace] = await Promise.all([
    read("ai-company-app/src/components/SkillWorkspace.tsx"),
    read("ai-company-app/src/components/AgentVideoWorkspace.tsx"),
  ]);

  assert.match(workspace, /role="radiogroup"/);
  assert.match(workspace, /role="radio"/);
  assert.match(workspace, /aria-checked=\{selected\}/);
  assert.match(workspace, /setSelectedSkillId\(skill\.id\)/);
  assert.match(workspace, /selectedSkill\?\.id === "infographic"/);
  assert.match(workspace, /<AgentVideoWorkspace onClose=\{onClose\} embedded/);
  assert.match(videoWorkspace, /embedded = false/);
});

test("직접 실행과 에이전트 지시는 같은 업무 저장소에 출처만 구분해 기록한다", async () => {
  const [workspaceContext, shared, endpoint] = await Promise.all([
    read("ai-company-app/src/contexts/AgentVideoWorkspaceContext.tsx"),
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/agent-video.ts"),
  ]);

  assert.match(workspaceContext, /skillCategoryId: "design-content"/);
  assert.match(workspaceContext, /skillId: "infographic"/);
  assert.match(workspaceContext, /invocationMode: "manual"/);
  assert.match(shared, /invocationMode: "agent"/);
  assert.match(endpoint, /invocationMode: body\?\.invocationMode === "manual" \? "manual" : "agent"/);
  assert.match(endpoint, /JSON\.stringify\(\{ input, spec, contributions, skill \}\)/);
  assert.match(endpoint, /INSERT INTO company_work_items/);
});
