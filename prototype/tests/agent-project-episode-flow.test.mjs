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
