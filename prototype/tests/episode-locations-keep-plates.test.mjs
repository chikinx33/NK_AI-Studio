import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

/**
 * ★회귀: 시나리오를 다시 생성하면 만들어 둔 배경 플레이트가 통째로 사라졌다.
 *
 * 재생성하면 공간 목록도 다시 추출되는데, 새 목록에는 이미지가 없다. 그걸 그대로
 * 갈아끼우는 바람에 배경 레퍼런스 창이 전부 '배경 없음' 이 됐다 — 파일은 저장소에
 * 그대로 남아 있는데도. 소품(episodeProps)은 재추출 대상이 아니라 살아남아서,
 * "소품은 보이는데 배경만 안 보인다" 는 증상으로 나타났다.
 */

function loadService() {
  const sandbox = { console, JSON, Math, Date };
  sandbox.window = sandbox;
  sandbox.NK = { service: {} };
  vm.createContext(sandbox);
  vm.runInContext(read("prototype/js/service/episode-locations.js"), sandbox);
  return sandbox.NK.service.episodeLocations;
}

test("★이름이 같은 공간은 배경 플레이트를 그대로 물려받는다", () => {
  const svc = loadService();
  const prev = [
    { id: "girls-room", name: "소녀의 방", description: "옛 묘사", refObjectName: "proj/plate-1.png", sceneIds: ["1"] },
  ];
  const next = [
    { id: "girls-room", name: "소녀의 방", description: "새로 뽑은 묘사", sceneIds: ["1", "2"] },
  ];
  const merged = svc.mergeWithExisting(next, prev);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].refObjectName, "proj/plate-1.png", "만들어 둔 배경이 끊기면 안 된다");
  // 묘사·씬 배정은 새 추출을 따른다(새 시나리오에 맞춰 다시 쓰인 것이므로).
  assert.equal(merged[0].description, "새로 뽑은 묘사");
  assert.deepEqual(merged[0].sceneIds, ["1", "2"]);
});

test("★세부 배경도 함께 물려받는다", () => {
  const svc = loadService();
  const prev = [{
    name: "놀이터",
    refObjectName: "proj/playground.png",
    variants: [{ id: "v-swing", label: "그네", description: "그네 클로즈업", refObjectName: "proj/swing.png" }],
  }];
  const merged = svc.mergeWithExisting([{ name: "놀이터", description: "d" }], prev);
  assert.equal(merged[0].variants.length, 1);
  assert.equal(merged[0].variants[0].refObjectName, "proj/swing.png");
  assert.equal(merged[0].variants[0].description, "그네 클로즈업");
});

test("★새 묘사가 비면 이전 묘사를 지킨다", () => {
  const svc = loadService();
  const merged = svc.mergeWithExisting(
    [{ name: "소녀의 방", description: "   " }],
    [{ name: "소녀의 방", description: "사용자가 고친 묘사", refObjectName: "a.png" }]
  );
  assert.equal(merged[0].description, "사용자가 고친 묘사");
});

test("★이전에 없던 새 공간은 그대로 들어온다", () => {
  const svc = loadService();
  const merged = svc.mergeWithExisting([{ name: "옥상", description: "d" }], [{ name: "소녀의 방", refObjectName: "a.png" }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, "옥상");
  assert.ok(!merged[0].refObjectName, "남의 배경을 물려받으면 안 된다");
});

test("★이전 목록이 없어도 안전하다", () => {
  const svc = loadService();
  assert.deepEqual(svc.mergeWithExisting([{ name: "a" }], null), [{ name: "a" }]);
  assert.deepEqual(svc.mergeWithExisting([], [{ name: "a" }]), []);
});

test("★시나리오 재생성 경로가 이 병합을 실제로 쓴다", () => {
  const ui = read("prototype/js/ui/scenario.js");
  // 이전 목록을 payload 를 덮기 전에 잡아 둔다.
  assert.match(ui, /const prevEpLocs = Array\.isArray\(currentPayload\?\.episodeLocations\)/);
  // 새 추출 결과에 얹는다.
  assert.match(ui, /epLocs = NK\.service\.episodeLocations\.mergeWithExisting\(epLocs, prevEpLocs\);/);
  // 규칙 기반 폴백도 같은 이전 목록을 본다.
  assert.match(ui, /derive\(draft\.scenes, \{ existing: prevEpLocs \}\)/);
  // 병합이 저장 대상 payload 에 반영된다.
  assert.match(ui, /Object\.assign\(\{\}, draft\.payload, \{ episodeLocations: epLocs \}\)/);
});
