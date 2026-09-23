// 승인한 영상이 한참 뒤 재생되지 않던 문제(2026-09-24).
// v3.1874 이전에 완료된 영상 잡은 결과에 1시간짜리 서명 URL(videoUrl)만 남아 objectName 이 없었다.
// 파일은 GCS 에 그대로 있으므로(플래튼이 실패하면 완료 처리 자체가 안 된다) URL 에서 경로를 되찾으면 된다.
// 서버는 조회 때 잡을 한 번 고치고, 클라이언트도 서명 URL 에서 경로를 되찾아 프록시로 연다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

test("서버: 서명 URL 만 남은 잡은 조회(job·jobs) 때 objectName 을 되찾아 저장한다", async () => {
  const [shared, job, jobs] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/job.ts"),
    read("prototype/functions/api/agent/jobs.ts"),
  ]);
  const fn = shared.slice(shared.indexOf("export async function healMediaObjectNames("), shared.indexOf("\n}\n", shared.indexOf("export async function healMediaObjectNames(")));
  assert.match(fn, /if \(!out \|\| String\(out\.objectName \|\| ""\)\.trim\(\)\) continue;/, "이미 경로가 있으면 건드리지 않는다");
  assert.match(fn, /const objectName = mediaObjectNameFromUrl\(url\);/);
  assert.match(fn, /COALESCE\(output->>'objectName', ''\) = ''/, "경쟁 갱신에도 한 번만 쓴다");
  assert.match(job, /if \(fresh\) await healMediaObjectNames\(sql, auth\.userId, \[fresh\]\);/);
  assert.match(jobs, /await healMediaObjectNames\(sql, auth\.userId, items as any\[\]\)\.catch\(\(\) => 0\);/);
});

test("클라이언트: 미리보기·보고는 objectName 이 없어도 GCS 서명 URL 에서 경로를 되찾아 프록시로 연다", async () => {
  const [api, preview] = await Promise.all([
    read("ai-company-app/src/lib/api.ts"),
    read("ai-company-app/src/components/ChatFileAttachments.tsx"),
  ]);
  assert.match(api, /export function objectNameFromStorageUrl\(raw: string\): string/);
  assert.match(api, /export function outputObjectName\(output: any\): string \{[\s\S]*objectNameFromStorageUrl\(String\(output\?\.videoUrl \|\| output\?\.audioUrl \|\| output\?\.signedUrl \|\| ""\)\)/);
  assert.match(api, /export function mediaUrlFromOutput\(output: any\): string \{\s*const objectName = outputObjectName\(output\);/);
  assert.match(preview, /const objectName = outputObjectName\(output\);\s*const proxyUrl = objectName \? `\/api\/media\/proxy\?objectName=\$\{encodeURIComponent\(objectName\)\}` : "";/);
});
