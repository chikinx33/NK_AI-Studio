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

test("미사용 판정은 현재 등록 슬롯만 보호하고 이미지 이력과 교체 전 시트는 제외한다", () => {
  const media = loadMediaHelpers();
  const cut = "users/u/ai-video/projects/p/images/cut-current.png";
  const history = "users/u/ai-video/projects/p/images/cut-old.png";
  const background = "users/u/ai-video/projects/p/images/background.png";
  const boardOld = "users/u/ai-video/projects/p/images/board-old.png";
  const boardCurrent = "users/u/ai-video/projects/p/images/board-current.png";
  const panelCurrent = "users/u/ai-video/projects/p/images/panel-current.png";
  const character = "users/u/ai-video/projects/p/images/character.png";
  const cacheOnly = "users/u/ai-video/projects/p/images/cache-only.png";
  const project = {
    scenes: [{ id: 1, sceneLocation: "방", imagePath: cut, imageHistory: [history] }],
    payload: {
      episodeLocations: [{ name: "방", refObjectName: background }],
      storyboardSheets: [
        { kind: "board", status: "fresh", cutIds: [1], objectName: boardOld, panels: [] },
        { kind: "board", status: "fresh", cutIds: [1], objectName: boardCurrent, panels: [{ objectName: panelCurrent }] }
      ],
      characterSheets: [{ token: "@A", items: [{ imageDataUrl: `/api/media/proxy?objectName=${encodeURIComponent(character)}` }] }],
      imageLibraryItems: [{ objectName: cacheOnly }]
    }
  };
  const candidates = [cut, history, background, boardOld, boardCurrent, panelCurrent, character, cacheOnly];

  const referenced = new Set(media.collectRegisteredImageObjectNames(project, null, candidates));
  assert.equal(referenced.has(cut), true);
  assert.equal(referenced.has(background), true);
  assert.equal(referenced.has(boardCurrent), true);
  assert.equal(referenced.has(panelCurrent), true);
  assert.equal(referenced.has(character), true);
  assert.equal(referenced.has(history), false);
  assert.equal(referenced.has(boardOld), false);
  assert.equal(referenced.has(cacheOnly), false);
});

test("장면 순서와 공간이 달라져 stale 된 스토리보드 이미지는 미사용으로 분류한다", () => {
  const media = loadMediaHelpers();
  const staleBoard = "users/u/ai-video/projects/p/images/stale-board.png";
  const project = {
    scenes: [
      { id: 1, sceneLocation: "방" },
      { id: 2, sceneLocation: "복도", sceneBreak: true }
    ],
    payload: {
      storyboardSheets: [{ kind: "board", status: "fresh", cutIds: [1, 2], objectName: staleBoard }]
    }
  };
  const referenced = new Set(media.collectRegisteredImageObjectNames(project, null, [staleBoard]));
  assert.equal(referenced.has(staleBoard), false);
});

test("라이브러리 미사용 버튼은 등록 항목을 제외한 이미지들만 선택한다", () => {
  const source = read("prototype/ui/pipeline.js");
  assert.match(source, /kind === 'image' \? '<button class="btn-secondary" id="lib-unused-btn"[^>]*>미사용<\/button>' : ''/);
  assert.match(source, /await collectRegisteredLibraryNames\(\)/);
  assert.match(source, /filter\(function \(name\) \{ return name && !registeredNames\.has\(name\); \}\)/);
  assert.match(source, /selectedNames = new Set\(unusedNames\)/);
  assert.match(source, /hydrateFromServer\(brandId, \{ ttlMs: 5000 \}\)/);
  assert.match(source, /collectRegisteredImageObjectNames\(state \|\| draft, brandRecord, candidates\)/);
});

test("프로젝트 상태를 읽지 못하면 전체를 미사용으로 오판하지 않고 중단한다", () => {
  const source = read("prototype/ui/pipeline.js");
  assert.match(source, /if \(!state && !draft\) throw new Error\('project_state_unavailable'\)/);
  assert.match(source, /if \(!media \|\| !media\.collectRegisteredImageObjectNames\) throw new Error\('usage_checker_unavailable'\)/);
});
