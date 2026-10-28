import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EMPTY_PATH_ERROR,
  cleanCompanyPath,
  requireWritePath,
  prefixWithCreatedFolder,
} from "../functions/api/_shared/company-file-path.js";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("빈 경로·null 은 쓰기 전에 '경로를 지정해주세요' 로 막는다", () => {
  assert.equal(EMPTY_PATH_ERROR, "경로를 지정해주세요");
  for (const input of [{}, { path: "" }, { path: "   " }, { path: null }, { path: undefined }, { path: "null" }, { path: "/" }, null]) {
    assert.throws(() => requireWritePath(input), { message: EMPTY_PATH_ERROR }, JSON.stringify(input));
  }
  assert.equal(requireWritePath({ file: "\\보고서\\a.md " }), "보고서/a.md");
  assert.equal(cleanCompanyPath("//a//b.md/"), "a/b.md");
});

test("mkdir 이 만든 폴더 경로를 write 경로 앞에 붙인다", () => {
  assert.equal(prefixWithCreatedFolder("보고서.md", "프로젝트/2026 캠페인"), "프로젝트/2026 캠페인/보고서.md");
  assert.equal(prefixWithCreatedFolder("초안/a.md", "프로젝트"), "프로젝트/초안/a.md");
  // 이미 폴더 경로로 시작하면 두 번 붙이지 않는다.
  assert.equal(prefixWithCreatedFolder("프로젝트/2026 캠페인/보고서.md", "프로젝트/2026 캠페인"), "프로젝트/2026 캠페인/보고서.md");
  // 맨 위부터 일부만 쓴 경로도 폴더 안으로 넣는다.
  assert.equal(prefixWithCreatedFolder("프로젝트/보고서.md", "프로젝트/2026 캠페인"), "프로젝트/2026 캠페인/보고서.md");
  // 폴더 이름 끝부분만 붙여 쓴 경로는 겹친 부분을 한 번만 쓴다.
  assert.equal(prefixWithCreatedFolder("2026 캠페인/보고서.md", "프로젝트/2026 캠페인"), "프로젝트/2026 캠페인/보고서.md");
  // 파일 이름이 폴더 이름과 같아도 파일은 폴더 안에 생긴다.
  assert.equal(prefixWithCreatedFolder("기획", "기획"), "기획/기획");
  // 여러 번 적용해도 결과가 같다(승인 시 run 에서 한 번 더 적용돼도 안전).
  const once = prefixWithCreatedFolder("a.md", "x/y");
  assert.equal(prefixWithCreatedFolder(once, "x/y"), once);
  // 만든 폴더가 없으면 경로 그대로.
  assert.equal(prefixWithCreatedFolder("a.md", ""), "a.md");
  assert.equal(prefixWithCreatedFolder("a.md", undefined), "a.md");
  assert.throws(() => prefixWithCreatedFolder("", "x"), { message: EMPTY_PATH_ERROR });
});

test("mkdir 결과 경로가 같은 턴의 write 승인 카드 경로로 이어진다", async () => {
  const shared = await read("prototype/functions/api/agent/_shared.ts");
  assert.match(shared, /lastCreatedFolder\?: string;/);
  assert.match(shared, /ctx\.lastCreatedFolder = String\(created\?\.entry\?\.path \|\| path\);/);
  assert.match(shared, /prefixWithCreatedFolder\(requireWritePath\(input\), ctx\.lastCreatedFolder\)/);
  assert.match(shared, /company_files_write: \{[^\n]*gate: true, prepare: prepareCompanyFilesWriteInput, run: runCompanyFilesWriteTool \}/);
  const orchestrator = await read("prototype/functions/api/agent/_orchestrator.ts");
  assert.match(orchestrator, /r\.tool === "company_files_write" && deferredRuns\.some\(\(d: any\) => d\.tool === "company_files_mkdir"\)/);
});
