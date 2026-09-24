// 승인한 영상이 업무 폴더에서 보이지 않던 문제(2026-09-24).
// 영상 잡의 결과는 1시간 서명 URL(videoUrl) 뿐이라 업무 등록 시 objectName 이 빈 값으로 들어갔고,
// 폴더는 objectName 으로만 소스를 합치므로 "영상·이미지 소스는 없어요" 만 보였다.
// 서버는 서명 URL 에서 저장 경로를 되찾아 남기고, 폴더는 예전 항목도 서명 URL 에서 경로를 되찾아 그린다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

test("서버: 완료된 영상 잡 결과와 업무 등록 메타에 objectName 이 남는다", async () => {
  const shared = await read("prototype/functions/api/agent/_shared.ts");
  assert.match(shared, /export function mediaObjectNameFromUrl\(raw: string\): string \{\s*const ref = brandAssetImageRef\(String\(raw \|\| ""\), ""\);/);
  const reconcile = shared.slice(shared.indexOf("export async function reconcileVideoJobs("), shared.indexOf("\n}\n", shared.indexOf("export async function reconcileVideoJobs(")));
  assert.match(reconcile, /const objectName = String\(output\.objectName \|\| ""\)\.trim\(\) \|\| mediaObjectNameFromUrl\(check\.videoUrl\);/);
  assert.match(reconcile, /\.\.\.\(objectName \? \{ objectName \} : \{\}\)/);
  const filed = shared.slice(shared.indexOf("export async function fileJobAsWorkItem("), shared.indexOf("\n}\n", shared.indexOf("export async function fileJobAsWorkItem(")));
  assert.match(filed, /objectName: output\?\.objectName \|\| mediaObjectNameFromUrl\(output\?\.videoUrl \|\| output\?\.audioUrl \|\| ""\),/);
});

test("업무 폴더: 영상 업무는 비디오 아이콘·플레이어로 열리고, 소스 목록에 mp4 가 합쳐진다(예전 항목은 서명 URL 에서 경로 복원)", async () => {
  const work = await read("ai-company-app/src/components/WorkExplorer.tsx");
  assert.match(work, /function objectNameFromStorageUrl\(raw: string\): string/);
  assert.match(work, /function mediaWorkObject\(work: CompanyWorkItem\): string \{\s*const direct = String\(work\.metadata\?\.objectName \|\| ""\)[^\n]*\n\s*return direct \|\| objectNameFromStorageUrl\(String\(work\.metadata\?\.signedUrl \|\| ""\)\);/);
  assert.match(work, /function isVideoWork\(work: CompanyWorkItem\): boolean/);
  assert.match(work, /function mergeWorkOutput\(work: CompanyWorkItem, items: AgentVideoStorageItem\[\]\): AgentVideoStorageItem\[\] \{\s*const objectName = mediaWorkObject\(work\);/);
  assert.match(work, /else if \(isVideoWork\(work\) && work\.metadata\?\.jobId\) \{[\s\S]*contentType: "video\/mp4", kind: "video", jobId: String\(work\.metadata\.jobId\)/);
  assert.match(work, /: isVideoWork\(work\) \? <VideoWorkIcon className=/);
  assert.match(work, /const mediaKind = imageWorkObject\(work\) \? "image" : \(isVideoWork\(work\) \|\| work\.work_type === "infographic"\) \? "video" : "doc";/);
});

test("업무 폴더: 수정(image_edit)·업스케일·컷 스틸 업무도 이미지 썸네일로 보인다", async () => {
  const work = await read("ai-company-app/src/components/WorkExplorer.tsx");
  assert.match(work, /const IMAGE_WORK_TYPES = new Set\(\["image", "image_edit", "upscale", "scene_still", "set_master", "set_angle", "set_sheet"\]\);/);
  const fn = work.slice(work.indexOf("function imageWorkObject("), work.indexOf("\n}\n", work.indexOf("function imageWorkObject(")));
  assert.match(fn, /IMAGE_WORK_TYPES\.has\(String\(work\.work_type \|\| ""\)\)/);
  assert.match(fn, /\/\\\.\(png\|jpe\?g\|webp\|gif\)\$\/i\.test\(objectName\)/, "종류를 몰라도 파일 확장자가 그림이면 썸네일");
  assert.doesNotMatch(fn, /work\.work_type !== "image"\) return ""/);
});
