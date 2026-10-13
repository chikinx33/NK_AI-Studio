// 디렉터 화면에서 바로 만들기: 기존 시리즈에 새 에피소드 / 새 시리즈. 채팅 에이전트와 같은 도구를 쓴다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
const esbuild = createRequire(import.meta.url)(path.join(root, "ai-company-app/node_modules/esbuild"));

function loadBuildCreateRequest() {
  const src = read("prototype/functions/api/agent/production-projects.ts");
  const textFn = src.slice(src.indexOf("function text("), src.indexOf("function hasMedia("));
  const body = src.slice(src.indexOf("const TITLE_MAX"), src.indexOf("export const onRequestOptions"));
  const js = esbuild.transformSync(textFn + body.replace("export function", "function"), { loader: "ts" }).code;
  return new Function(js + "\nreturn buildCreateRequest;")();
}

test("새 에피소드는 부모 프로젝트와 에피소드 이름이 있어야 project_add_episode 로 간다", () => {
  const build = loadBuildCreateRequest();
  assert.deepEqual(build({ mode: "episode", parentProjectId: "moyangsae-abc", episodeTitle: " 운동장 " }),
    { ok: true, tool: "project_add_episode", input: { parentProjectId: "moyangsae-abc", episodeTitle: "운동장" } });
  assert.equal(build({ mode: "episode", episodeTitle: "x" }).error, "parent_project_required");
  assert.equal(build({ mode: "episode", parentProjectId: "../etc", episodeTitle: "x" }).error, "parent_project_required");
  assert.equal(build({ mode: "episode", parentProjectId: "a" }).error, "episode_title_required");
});

test("새 시리즈는 시리즈 이름이 필수이고, 첫 에피소드 이름이 없으면 스튜디오처럼 'EP1' 을 붙인다", () => {
  const build = loadBuildCreateRequest();
  assert.deepEqual(build({ mode: "series", seriesTitle: "모양새 친구들" }),
    { ok: true, tool: "project_create", input: { seriesTitle: "모양새 친구들", episodeTitle: "모양새 친구들 EP1" } });
  assert.equal(build({ mode: "series", seriesTitle: "A", episodeTitle: "첫 화" }).input.episodeTitle, "첫 화");
  assert.equal(build({ mode: "series" }).error, "series_title_required");
  assert.equal(build({ mode: "nope" }).error, "invalid_mode");
});

test("POST 는 인증 후 같은 도구를 실행하고 목록 캐시를 비운다", () => {
  const src = read("prototype/functions/api/agent/production-projects.ts");
  assert.match(src, /export const onRequestPost[\s\S]*authorizeRequest\(request, env\)[\s\S]*AGENT_TOOLS\[plan\.tool\]\.run[\s\S]*summaryCache\.delete\(auth\.userId\)/);
});

test("디렉터 화면에 만들기 버튼이 있고, 만든 뒤 목록을 새로 읽어 그 프로젝트를 선택한다", () => {
  const dir = read("ai-company-app/src/components/DirectorWorkspace.tsx");
  assert.match(dir, /<NewProjectPopover projects=\{projects\} currentProjectId=\{projectId\} onCreated=\{onProjectCreated\} \/>/);
  assert.match(dir, /listProductionProjects\(\{ fresh: true \}\)[\s\S]*setProjectId\(id\)/);
  const pop = read("ai-company-app/src/components/NewProjectPopover.tsx");
  assert.match(pop, /if \(p\.shared\) continue;/, "공유받은 프로젝트는 부모로 쓰지 않는다");
  assert.match(pop, /onKeyUp=\{onEnter\}/, "한글 IME: keyup Enter");
});
