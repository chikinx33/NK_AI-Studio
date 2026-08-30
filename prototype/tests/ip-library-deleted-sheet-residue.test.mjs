import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

/**
 * ★회귀: IP 라이브러리에서 시트를 지우고 새로 올린 뒤 새로고침하면, 지운 시트가
 * 깨진 썸네일 찌꺼기로 되살아났다.
 *
 * 원인은 병합 방식이었다. 브랜드 레코드를 합칠 때 시트를 sheetId 합집합으로 모아서,
 * 서버 응답이나 오래된 프로젝트 페이로드에 남아 있던 옛 시트가 매번 다시 끼어들었다.
 * 저장 시 서버는 목록에서 빠진 시트의 GCS 오브젝트를 실제로 지우므로,
 * 되살아난 레코드는 로드 실패한 썸네일로 남는다.
 *
 * 이제 시트 목록은 합집합이 아니라 "권한 있는 한쪽"을 통째로 채택한다.
 */
function loadBrandService(apiStub) {
  const store = new Map();
  const sandbox = {
    console,
    Date,
    JSON,
    Map,
    Set,
    Promise,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  sandbox.window = sandbox;
  sandbox.NK = { api: apiStub || null, service: {}, store: null, config: {} };
  vm.createContext(sandbox);
  vm.runInContext(read("prototype/js/service/brand.js"), sandbox);
  return sandbox.NK.service.brand;
}

const sheetEntry = (token, sheetIds) => ({
  characterId: "char_001",
  displayName: token.replace(/^@/, ""),
  token,
  items: sheetIds.map((id, index) => ({
    sheetId: id,
    imageDataUrl: `gs://bucket/${id}.png`,
    isPrimary: index === 0,
  })),
});

const sheetIdsOf = (record, token) => {
  const entry = (record.characterSheets || []).find((row) => row.token === token);
  return (entry ? entry.items : []).map((item) => item.sheetId);
};

test("★서버에서 다시 읽어도 지운 시트가 되살아나지 않는다", async () => {
  // 서버에는 저장 결과(옛 시트 삭제 + 새 시트)만 남아 있다.
  const remote = {
    brandId: "b1",
    brandTitle: "네모",
    characterSheets: [sheetEntry("@네모", ["sheet_new"])],
  };
  const brand = loadBrandService({
    brandGet: async () => ({ data: { brand: remote } }),
  });

  // 로컬 캐시에는 아직 지우기 전 시트가 남아 있는 상태.
  brand.create({
    brandId: "b1",
    brandTitle: "네모",
    characterSheets: [sheetEntry("@네모", ["sheet_old", "sheet_new"])],
  });

  const merged = await brand.hydrateFromServer("b1", { force: true, ttlMs: 0 });
  assert.deepEqual(sheetIdsOf(merged, "@네모"), ["sheet_new"]);
});

test("★서버가 시트 필드를 안 주면 로컬 시트를 지우지 않는다", async () => {
  const brand = loadBrandService({
    brandGet: async () => ({ data: { brand: { brandId: "b1", brandTitle: "네모" } } }),
  });
  brand.create({
    brandId: "b1",
    brandTitle: "네모",
    characterSheets: [sheetEntry("@네모", ["sheet_new"])],
  });

  const merged = await brand.hydrateFromServer("b1", { force: true, ttlMs: 0 });
  assert.deepEqual(sheetIdsOf(merged, "@네모"), ["sheet_new"]);
});

test("★옛 시트가 남은 프로젝트 페이로드가 라이브러리 편집을 되돌리지 않는다", async () => {
  const brand = loadBrandService({
    brandSave: async (brandId, payload) => ({ brand: payload }),
  });
  brand.create({
    brandId: "b1",
    brandTitle: "네모",
    characterSheets: [sheetEntry("@네모", ["sheet_old"])],
  });

  // 라이브러리에서 옛 시트를 지우고 새 시트를 올려 저장.
  const saved = await brand.persistShared("b1", {
    characterSheets: [sheetEntry("@네모", ["sheet_new"])],
  });
  assert.ok(saved.sheetsUpdatedAt, "저장 시각이 기록돼야 다음 병합에서 최신 편집을 알아본다");

  // 아직 갱신되지 않은 다른 프로젝트가 브랜드로 동기화된다.
  const stale = brand.upsertFromProject({
    id: "p1",
    title: "네모",
    payload: {
      brandId: "b1",
      brandTitle: "네모",
      characterSheets: [sheetEntry("@네모", ["sheet_old"])],
    },
  });

  assert.deepEqual(sheetIdsOf(stale, "@네모"), ["sheet_new"]);
});

test("★시트를 한 번도 저장한 적 없는 브랜드는 프로젝트 시트를 이관받는다", () => {
  const brand = loadBrandService(null);
  brand.create({ brandId: "b1", brandTitle: "네모" });

  const migrated = brand.upsertFromProject({
    id: "p1",
    title: "네모",
    payload: {
      brandId: "b1",
      brandTitle: "네모",
      characterSheets: [sheetEntry("@네모", ["sheet_legacy"])],
    },
  });

  assert.deepEqual(sheetIdsOf(migrated, "@네모"), ["sheet_legacy"]);
});

/**
 * ★회귀: 이미지 생성이 참조하는 시트도 프로젝트 페이로드 사본이 브랜드를 덮어써서,
 * 이미 삭제된 이미지를 레퍼런스로 집어 들었다. 이제는 앞선(브랜드) 소스가 이긴다.
 */
test("★이미지 파이프라인은 브랜드 시트를 우선한다", () => {
  const src = read("prototype/ui/pipeline-image.js");
  const pick = (signature) => {
    const start = src.indexOf(signature);
    assert.ok(start > -1, `${signature} 가 있어야 한다`);
    const end = src.indexOf("\n  }\n", start) + "\n  }\n".length;
    return src.slice(start, end);
  };
  const factory = new Function(`
    ${pick("function normalizeText(value) {")}
    ${pick("function normalizeToken(value) {")}
    ${pick("function normalizeKnowledgeCharacters(value) {")}
    ${pick("function normalizeCharacterSheets(value, characters) {")}
    ${pick("function mergeCharacterSheetSources(sources, characters) {")}
    return mergeCharacterSheetSources;
  `);
  const mergeCharacterSheetSources = factory();

  const merged = mergeCharacterSheetSources(
    [
      [sheetEntry("@네모", ["sheet_new"])],
      [sheetEntry("@네모", ["sheet_old"])],
    ],
    [{ token: "@네모", displayName: "네모" }]
  );
  assert.deepEqual(sheetIdsOf({ characterSheets: merged }, "@네모"), ["sheet_new"]);
});

test("★브랜드에 시트가 없는 캐릭터는 프로젝트 시트로 보충된다", () => {
  const src = read("prototype/ui/pipeline-image.js");
  const pick = (signature) => {
    const start = src.indexOf(signature);
    const end = src.indexOf("\n  }\n", start) + "\n  }\n".length;
    return src.slice(start, end);
  };
  const factory = new Function(`
    ${pick("function normalizeText(value) {")}
    ${pick("function normalizeToken(value) {")}
    ${pick("function normalizeKnowledgeCharacters(value) {")}
    ${pick("function normalizeCharacterSheets(value, characters) {")}
    ${pick("function mergeCharacterSheetSources(sources, characters) {")}
    return mergeCharacterSheetSources;
  `);
  const merged = factory()(
    [
      [{ token: "@네모", displayName: "네모", items: [] }],
      [sheetEntry("@네모", ["sheet_project"])],
    ],
    [{ token: "@네모", displayName: "네모" }]
  );
  assert.deepEqual(sheetIdsOf({ characterSheets: merged }, "@네모"), ["sheet_project"]);
});
