// "이 이미지와 영상을 X 브랜드의 에피소드로 추가해줘" 가 project_list 조회 뒤 멈추던 원인(2026-09-24):
//  1) project_list 가 synthesize 없는 읽기 도구라 결과를 그대로 찍고 모델이 다시 생각하지 않았다.
//  2) 결과가 숫자 id 뿐이라 "SHAPES 시리즈" 를 찾을 수 없었다.
//  3) 지목한 이미지·영상을 컷에 붙일 방법(scene_upsert 의 자산 필드)이 없었다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");
const fnBody = (src, head) => {
  const start = src.indexOf(head);
  assert.ok(start >= 0, `${head} 가 있어야 한다`);
  return src.slice(start, src.indexOf("\n}\n", start));
};

test("project_list 는 제목·seriesId 를 함께 주고, 결과를 본 모델이 이어서 행동한다(synthesize)", async () => {
  const [shared, orch] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);
  assert.match(shared, /project_list: \{ agentId: "core", kind: "read", synthesize: true, run: runProjectListTool \}/);
  assert.match(shared, /brand_list: \{ agentId: "core", kind: "read", synthesize: true, run: runBrandListTool \}/);
  const list = fnBody(shared, "async function runProjectListTool(");
  assert.match(list, /callInternalJson\(ctx, "\/api\/agent\/production-projects"\)/);
  assert.match(list, /seriesId: String\(p\?\.seriesId \|\| ""\), seriesTitle: String\(p\?\.seriesTitle \|\| ""\)/);
  assert.match(orch, /★결과를 본 뒤 멈추지 말고 이어서 행동한다: 시리즈에 에피소드를 추가하라면 같은 seriesTitle 의 seriesId 를 찾아/);
  assert.match(orch, /"seriesId": "기존 시리즈에 붙일 때 그 seriesId\(project_list 결과 · 새 시리즈면 생략\)"/);
  // 폴백 렌더도 제목을 보여 준다
  assert.match(orch, /const name = \[p\.seriesTitle, p\.episodeTitle\]\.filter\(Boolean\)\.join\(" · "\) \|\| p\.title \|\| id;/);
});

test("scene_upsert 가 지목한 이미지·영상(jobId·objectName)을 컷의 스틸·영상으로 붙인다", async () => {
  const [shared, orch] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);
  const fn = fnBody(shared, "async function runSceneUpsertTool(");
  assert.match(fn, /"imagePath", "imageDataUrl", "videoUrl"\];/, "자산 필드가 화이트리스트에 있다");
  assert.match(fn, /const stillJob = String\(input\?\.stillJobId \|\| input\?\.imageJobId \|\| ""\)\.trim\(\);/);
  assert.match(fn, /const videoJob = String\(input\?\.videoJobId \|\| ""\)\.trim\(\);/);
  assert.match(fn, /if \(stillJob\) \{ const gs = await assetFromJob\(stillJob\); patch\.imagePath = gs; patch\.imageDataUrl = gs; \}/);
  assert.match(fn, /if \(videoJob\) patch\.videoUrl = await assetFromJob\(videoJob\);/);
  assert.match(fn, /mediaObjectNameFromUrl\(String\(out\.videoUrl \|\| out\.signedUrl \|\| ""\)\)/, "옛 영상 잡도 서명 URL 에서 경로를 되찾는다");
  const doc = orch.slice(orch.indexOf("    scene_upsert: `[[RUN: scene_upsert |"), orch.indexOf("`,", orch.indexOf("    scene_upsert: `[[RUN: scene_upsert |")));
  assert.match(doc, /"stillJobId": "지목한 이미지 jobId\(선택 · 컷 스틸로 부착\)", "videoJobId": "지목한 영상 jobId\(선택 · 컷 영상으로 부착\)"/);
});

test("프로젝트 요약 API 는 project_list 도구를 되부르지 않고(재귀), 20초 캐시를 가지며, 도구는 15초 기한으로만 기다린다", async () => {
  const [pp, shared, orch] = await Promise.all([
    read("prototype/functions/api/agent/production-projects.ts"),
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);
  assert.doesNotMatch(pp, /AGENT_TOOLS\.project_list\.run\(/, "project_list → 요약 → project_list 재귀가 30초 도구 예산을 넘겼다");
  assert.match(pp, /fetch\(new URL\("\/api\/project\/list", request\.url\)\.toString\(\)/);
  assert.match(pp, /const SUMMARY_TTL_MS = 20_000;/);
  assert.match(pp, /summaryCache\.set\(auth\.userId, \{ at: Date\.now\(\), projects \}\);/);
  assert.match(shared, /function withDeadline<T>\(p: Promise<T>, ms: number, fallback: T\): Promise<T>/);
  assert.match(shared, /withDeadline\(callInternalJson\(ctx, "\/api\/agent\/production-projects"\), SUMMARY_DEADLINE_MS, null as any\)/);
  assert.match(shared, /withDeadline\(callInternalJson\(ctx, "\/api\/brand\/list\?full=1"\), SUMMARY_DEADLINE_MS, null as any\)/);
  assert.match(orch, /const timer = setTimeout\(\(\) => ac\.abort\(\), 8000\);/, "브리프 로더는 8초 기한");
});

test("조회 결과를 본 코어의 위임(CALL)도 같은 턴에 실행된다 — '리치에게 시키기' 배지만 남고 멈추지 않는다", async () => {
  const orch = await read("prototype/functions/api/agent/_orchestrator.ts");
  assert.match(orch, /if \(agentId === "core" && !soloAgent && depth < 2 && res2\.calls\.length > 0\) \{\s*const calls = res2\.calls\.slice\(0, 3\);\s*coreDelegateCount \+= calls\.length;/);
  assert.match(orch, /try \{ await runWorker\(c\.agentId, c\.instruction\); \} catch \{ \/\* 개별 직원 실패 시 다음으로 \*\/ \}/);
});

test("시간 부족으로 미룬 조회는 사용자가 '계속' 을 치지 않아도 같은 스트림에서 서버가 이어서 실행한다", async () => {
  const [orch, chat] = await Promise.all([
    read("prototype/functions/api/agent/_orchestrator.ts"),
    read("prototype/functions/api/agent/chat.ts"),
  ]);
  assert.doesNotMatch(orch, /"계속"이라고 말씀해 주시면 이어서 조회할게요/, "사용자에게 떠넘기는 문구가 사라졌다");
  assert.match(orch, /deferredRuns\.push\(\{ tool: r\.tool, reason: r\.reason, agentId \}\);/);
  assert.match(orch, /opts: \{ autoTrigger\?: string; resumeRuns\?: DeferredRun\[\] \} = \{\}/);
  assert.match(orch, /if \(opts\.resumeRuns\?\.length\) \{[\s\S]*await runTools\(runs, agentId\);[\s\S]*return finish\(\);/);
  assert.match(orch, /const TURN_BUDGET_MS = 100000;/);
  assert.match(orch, /const RUN_MIN_MS = 12000;/);
  assert.match(chat, /for \(let round = 0; round < 2 && Array\.isArray\(produced\?\.deferred\) && produced\.deferred\.length; round\+\+\) \{\s*produced = await runGroupChat\(env, deps, \{ resumeRuns: produced\.deferred \}\);/);
});
