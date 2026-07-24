import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("프로젝트 카드는 서버 UI 상태를 기준으로 기본 접힘 렌더링된다", async () => {
  const [shared, dashboard, api] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("ai-company-app/src/components/Dashboard.tsx"),
    read("ai-company-app/src/lib/api.ts"),
  ]);

  assert.match(shared, /collapsed: data\?\.ui\?\.collapsed !== false/);
  assert.match(shared, /await writeProjectUi\(sql, userId, item\.row\.id, item\.data, \{ order: item\.explicitOrder \}\)/);
  assert.match(shared, /order: explicitOrder/);
  assert.match(dashboard, /const isOpen = p\.collapsed === false/);
  assert.doesNotMatch(dashboard, /useState<Set<string>>\(new Set\(\)\)/);
  assert.match(api, /collapsed: boolean/);
  assert.match(api, /order: number/);
});

test("프로젝트 카드는 드래그 순서를 공통 레이아웃 API에 영속화한다", async () => {
  const [dashboard, clientApi, endpoint, shared] = await Promise.all([
    read("ai-company-app/src/components/Dashboard.tsx"),
    read("ai-company-app/src/lib/api.ts"),
    read("prototype/functions/api/agent/project-layout.ts"),
    read("prototype/functions/api/agent/_shared.ts"),
  ]);

  assert.match(dashboard, /data-project-card-id=\{p\.id\}/);
  assert.match(dashboard, /draggable/);
  assert.match(dashboard, /dropProject\(p\.id/);
  assert.match(dashboard, /reorderProjectCards\(ordered\.map\(\(p\) => p\.id\)\)/);
  assert.match(clientApi, /action: "reorder", projectIds/);
  assert.match(endpoint, /reorderProjectsByIds/);
  assert.match(shared, /data\.ui = \{[\s\S]*\.\.\.ui/);
});

test("코어는 프로젝트 카드 접기·펼치기·역순·지정 순서를 실제 DB 명령으로 실행한다", async () => {
  const orchestrator = await read("prototype/functions/api/agent/_orchestrator.ts");

  assert.match(orchestrator, /\[\[PROJECT: collapse \| 프로젝트명\]\]/);
  assert.match(orchestrator, /\[\[PROJECT: expand_all\]\]/);
  assert.match(orchestrator, /\[\[PROJECT: reverse\]\]/);
  assert.match(orchestrator, /\[\[PROJECT: reorder \| 프로젝트명1 > 프로젝트명2 > 프로젝트명3\]\]/);
  assert.match(orchestrator, /p\.action === "collapse_all"/);
  assert.match(orchestrator, /p\.action === "reverse"/);
  assert.match(orchestrator, /setProjectCollapsedByName/);
  assert.match(orchestrator, /reorderProjectsByNames/);
});
