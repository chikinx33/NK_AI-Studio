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

test("★새 세트 계획의 평면도(layout)는 이름이 같은 세트에서도 살아남고, 부감 마스터·세트 시트는 물려받는다", () => {
  const svc = loadService();
  const prev = [{
    name: "소녀의 방", refObjectName: "proj/front.png", masterAngle: "top",
    variants: [{ id: "angle-top", label: "부감", refObjectName: "proj/top.png" }],
    setSheet: { sheetId: "sh1", objectName: "proj/sheet.png" },
    layout: { back: "옛 뒷벽" },
  }];
  const next = [{ name: "소녀의 방", description: "새 묘사", layout: { back: "창문", left: "침대", right: "책장", front: "문", floor: "러그" } }];
  const merged = svc.mergeWithExisting(next, prev);
  assert.equal(merged[0].layout.back, "옛 뒷벽", "마스터가 있으면 마스터의 평면도가 진실 — 새 계획이 덮지 않는다");
  // 마스터가 없으면 새 계획의 평면도가 살아남아야 한다(화이트리스트 재조립에 걸려 증발하던 회귀)
  const noMaster = svc.mergeWithExisting(next, [{ name: "소녀의 방", refObjectName: "proj/front.png", layout: { back: "옛 뒷벽" } }]);
  assert.equal(noMaster[0].layout.back, "창문", "새 계획의 평면도가 화이트리스트에 걸려 증발하면 안 된다");
  assert.equal(merged[0].refObjectName, "proj/front.png");
  assert.equal(merged[0].variants[0].refObjectName, "proj/top.png", "부감 마스터도 물려받는다");
  assert.equal(merged[0].setSheet.sheetId, "sh1", "세트 시트도 물려받는다");
  assert.equal(merged[0].masterAngle, "top");
  // 새 계획에 평면도가 없으면 이전 평면도를 지킨다
  const merged2 = svc.mergeWithExisting([{ name: "소녀의 방", description: "d" }], prev);
  assert.equal(merged2[0].layout.back, "옛 뒷벽");
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

test("★제작 화면(배경 편집기)의 작업용 복사본·저장이 layout·setSheet·masterAngle·plateDiag 를 지킨다 — 길목 화이트리스트 회귀 방지", () => {
  const src = read("prototype/ui/pipeline.js");
  assert.match(src, /layout: l\.layout \|\| null, setSheet: l\.setSheet \|\| null, masterAngle: l\.masterAngle \|\| '', plateDiag: l\.plateDiag \|\| null/);
  assert.match(src, /if \(l\.layout\) out\.layout = l\.layout;\s*\n\s*if \(l\.setSheet\) out\.setSheet = l\.setSheet;\s*\n\s*if \(l\.masterAngle\) out\.masterAngle = l\.masterAngle;\s*\n\s*if \(l\.plateDiag\) out\.plateDiag = l\.plateDiag;/);
});

test("★부감 마스터가 있는 세트는 재생성해도 이전 평면도·묘사를 지킨다(마스터 = 세트의 진실; 새 글이 이미지와 어긋나면 안 된다)", () => {
  const svc = loadService();
  const prev = [{ name: "소녀의 방", description: "분홍 줄무늬 벽, 책상", layout: { back: "책장", right: "창문" }, variants: [{ id: "angle-top", refObjectName: "p/top.png" }] }];
  const merged = svc.mergeWithExisting([{ name: "소녀의 방", description: "노란 벽, 침대", layout: { back: "침대", right: "문" } }], prev);
  assert.equal(merged[0].layout.back, "책장");
  assert.equal(merged[0].description, "분홍 줄무늬 벽, 책상");
  // 마스터가 없으면 새 계획을 따른다(기존 규칙)
  const merged2 = svc.mergeWithExisting([{ name: "옥상", description: "새 묘사", layout: { back: "난간" } }], [{ name: "옥상", description: "옛 묘사", layout: { back: "옛" }, refObjectName: "f.png" }]);
  assert.equal(merged2[0].layout.back, "난간");
  assert.equal(merged2[0].description, "새 묘사");
});
