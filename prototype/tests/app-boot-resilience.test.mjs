// 화면이 통째로 안 뜨던 사고 — 2026-08-13 실측 회귀 방지.
//
// 세션이 끊겨 /api/agent/agents 가 401 을 주자 { error: … } 객체가 그대로 상태에 들어갔고,
// 사이드바의 agents.find(...) 가 "find is not a function" 으로 터지면서 React 가 아무것도
// 그리지 못했다. 사용자 화면에는 "AI 기업을 불러오는 중입니다…" 만 남았다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");
const api = read("ai-company-app/src/lib/api.ts");
const app = read("ai-company-app/src/App.tsx");

test("★getAgents 는 응답 상태와 형태를 확인한다 (json() 을 그대로 믿지 않는다)", () => {
  const fn = api.slice(api.indexOf("export async function getAgents"), api.indexOf("export interface AgentVoicePreset"));
  assert.match(fn, /res\.status === 401 \|\| res\.status === 403/);
  assert.match(fn, /if \(!res\.ok\)/);
  assert.match(fn, /Array\.isArray\(data\)/);
  // 예전처럼 한 줄로 넘기지 않는다
  assert.doesNotMatch(fn, /return \(await fetch\("\/api\/agent\/agents"\)\)\.json\(\);/);
});

test("★어떤 실패에도 agents 는 배열로 유지된다", () => {
  const boot = app.slice(app.indexOf("getAgents()"), app.indexOf("getAgents()") + 500);
  assert.match(boot, /setAgents\(Array\.isArray\(list\) \? list : \[\]\)/);
  assert.match(boot, /setAgents\(\[\]\)/); // catch 에서도
  assert.doesNotMatch(boot, /getAgents\(\)\.then\(setAgents\)/);
});

test("세션이 끊기면 빈 화면 대신 로그인 길을 보여준다", () => {
  assert.match(app, /if \(sessionExpired && agents\.length === 0\)/);
  assert.match(app, /로그인이 풀렸어요/);
  assert.match(app, /href="\/app"/);
});

test("사이드바는 여전히 agents 를 배열로 다룬다 (형태 계약 확인)", () => {
  const sidebar = read("ai-company-app/src/components/Sidebar.tsx");
  assert.match(sidebar, /agents\.find\(|agents\.filter\(|agents\.map\(/);
});
