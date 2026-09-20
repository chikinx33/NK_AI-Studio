import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("GCS object deletion batches large selections and treats 404 as idempotent success", async () => {
  const moduleUrl = pathToFileURL(path.join(process.cwd(), "prototype/functions/api/_shared/gcs.js")).href;
  const { deleteGcsObjectsWithToken } = await import(moduleUrl);
  const originalFetch = globalThis.fetch;
  const requestSizes = [];
  let requestIndex = 0;

  globalThis.fetch = async (_url, options) => {
    const size = (String(options && options.body || "").match(/Content-ID: <item-/g) || []).length;
    requestSizes.push(size);
    const statuses = Array.from({ length: size }, (_, index) => {
      if (requestIndex === 0 && index === 0) return 404;
      if (requestIndex === 2 && index === size - 1) return 500;
      return 204;
    });
    requestIndex += 1;
    return new Response(statuses.map((status) => `HTTP/1.1 ${status} Result`).join("\r\n"), { status: 200 });
  };

  try {
    const names = Array.from({ length: 205 }, (_, index) => `root/image-${index}.png`);
    names.push(names[0]); // 중복 선택은 한 번만 삭제한다.
    const result = await deleteGcsObjectsWithToken(
      { bucket: "bucket", userProject: "" },
      "token",
      names
    );

    assert.deepEqual(requestSizes, [100, 100, 5]);
    assert.equal(result.requestedCount, 205);
    assert.equal(result.deletedCount, 204);
    assert.equal(result.failedCount, 1);
    assert.equal(result.results[0].status, 404);
    assert.equal(result.results.at(-1).status, 500);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("project delete endpoint uses the shared batch deletion path", () => {
  const source = read("prototype/functions/api/project/delete.ts");
  assert.match(source, /deleteGcsObjects\(env, safeTargets\)/);
  assert.match(source, /deleteGcsObjects\(env, names\)/);
  assert.match(source, /listGcsObjects\(env, prefix\)/);
  assert.doesNotMatch(source, /for \(const name of deleteTargets\)/);
  assert.doesNotMatch(source, /storage\.googleapis\.com\/storage\/v1/);
  assert.doesNotMatch(source, /function getGoogleAccessToken/);
});

test("project image deletion protects assets currently registered to cuts and background masters", () => {
  const source = read("prototype/functions/api/project/delete.ts");
  assert.match(source, /readGcsJson\(env, `\$\{projectPrefix\}\/reference\/data\.json`\)/);
  assert.match(source, /collectProtectedImageObjects\(projectRecord\.data\)/);
  assert.match(source, /protectedObjects\.has\(name\)/);
  assert.match(source, /현재 컷·배경·시트에 등록된 이미지는 먼저 교체하거나 연결을 해제해야 삭제할 수 있어요/);
  assert.match(source, /add\(location\?\.setSheet\?\.objectName\)/);
  assert.match(source, /add\(payload\?\.styleAnchor\?\.objectName\)/);
});

test("library UI accepts idempotent deletes and reconciles after an interrupted response", () => {
  const source = read("prototype/ui/pipeline.js");
  assert.match(source, /status === 200 \|\| status === 204 \|\| status === 404/);
  assert.match(source, /await NK\.api\.library\(kind, projectId\)/);
  assert.match(source, /confirmedMissing = new Set\(names\.filter/);
  assert.match(source, /purgeDeletedMediaFromScenes\(confirmedMissing\)/);
  assert.match(source, /저장소 상태를 다시 확인했습니다\./);
});
