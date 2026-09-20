import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

function loadMediaHelpers() {
  const source = read("prototype/ui/pipeline-media.js");
  const end = source.indexOf("// ── 미디어 로딩 신뢰성");
  const window = { NK: {}, location: { href: "https://nkstudio.org/scenes.html" } };
  const context = vm.createContext({ window, URL, console, setTimeout, clearTimeout });
  vm.runInContext(source.slice(0, end), context, { filename: "pipeline-media.js" });
  return window.NK.uiPipelineMedia;
}

test("미사용 판정은 프로젝트 데이터의 직접 objectName과 프록시 URL 참조를 모두 보호한다", () => {
  const media = loadMediaHelpers();
  const direct = "users/u/ai-video/projects/p/images/direct.png";
  const proxied = "users/u/ai-video/projects/p/images/proxied.png";
  const unused = "users/u/ai-video/projects/p/images/unused.png";
  const cyclic = { refObjectName: direct };
  cyclic.self = cyclic;
  const roots = [
    cyclic,
    { payload: { storyboardSheets: [{ panels: [{ imageDataUrl: `/api/media/proxy?objectName=${encodeURIComponent(proxied)}` }] }] } }
  ];

  const referenced = new Set(media.collectReferencedObjectNames(roots, [direct, proxied, unused]));
  assert.equal(referenced.has(direct), true);
  assert.equal(referenced.has(proxied), true);
  assert.equal(referenced.has(unused), false);
});

test("라이브러리 미사용 버튼은 등록 항목을 제외한 이미지들만 선택한다", () => {
  const source = read("prototype/ui/pipeline.js");
  assert.match(source, /id="lib-unused-btn"[^>]*>미사용<\/button>/);
  assert.match(source, /await collectRegisteredLibraryNames\(\)/);
  assert.match(source, /filter\(function \(name\) \{ return name && !registeredNames\.has\(name\); \}\)/);
  assert.match(source, /selectedNames = new Set\(unusedNames\)/);
  assert.match(source, /hydrateFromServer\(brandId, \{ ttlMs: 5000 \}\)/);
});

test("프로젝트 상태를 읽지 못하면 전체를 미사용으로 오판하지 않고 중단한다", () => {
  const source = read("prototype/ui/pipeline.js");
  assert.match(source, /if \(!state && !draft\) throw new Error\('project_state_unavailable'\)/);
  assert.match(source, /if \(!media \|\| !media\.collectReferencedObjectNames\) throw new Error\('usage_checker_unavailable'\)/);
});
