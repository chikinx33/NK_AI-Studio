import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("AI 기업 루트는 시작 오류를 검은 화면 대신 오류 경계로 격리한다", async () => {
  const main = await read("ai-company-app/src/main.tsx");
  assert.match(main, /<ErrorBoundary onReset=\{\(\) => window\.location\.reload\(\)\}>/);
  assert.match(main, /<AgentVideoWorkspaceProvider>[\s\S]*<App \/>/);
  assert.match(main, /try \{[\s\S]*location\.replace\("\/app"\)[\s\S]*location\.href = "\/app"/);
});

test("AI 기업 HTML은 모듈 부팅 실패 시 복구 UI를 남긴다", async () => {
  const html = await read("ai-company-app/index.html");
  assert.match(html, /id="nk-ai-bootstrap"/);
  assert.match(html, /AI 기업을 불러오지 못했습니다/);
  assert.match(html, /location\.reload\(\)/);
  assert.match(html, /href="\/app"/);
});

test("시작 시 사용하는 브라우저 저장소는 접근 실패와 잘못된 순서 데이터를 안전하게 무시한다", async () => {
  const storage = await read("ai-company-app/src/lib/safeStorage.ts");
  const sidebar = await read("ai-company-app/src/components/Sidebar.tsx");
  const workspace = await read("ai-company-app/src/contexts/AgentVideoWorkspaceContext.tsx");
  assert.match(storage, /export function readStorage/);
  assert.match(storage, /export function writeStorage/);
  assert.match(storage, /catch \{[\s\S]*return fallback/);
  assert.match(sidebar, /Array\.isArray\(parsed\)/);
  assert.match(workspace, /readStorage\(SKILL_JOB_STORAGE_KEY\)/);
});
