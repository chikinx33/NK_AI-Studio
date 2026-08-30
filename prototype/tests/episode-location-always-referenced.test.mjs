import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");
const src = () => read("prototype/ui/pipeline-image.js");

/**
 * ★회귀: 배경 레퍼런스를 만들어 뒀는데도 컷마다 배경이 달랐다.
 *
 * 에피소드 배경 플레이트(episodeLocations)는 사용자가 컷 레퍼런스로 직접 고른 경우
 * (cutRefId = "loc:...")에만 붙었다. '컷 기반 생성'은 이전 컷을 직접 고르게 하려고 만든
 * 기능이지, 배경 참조의 스위치가 아니다. 그래서 대부분의 컷에서 등록해 둔 배경이
 * 그냥 무시됐고, 배경 레퍼런스를 구축한 의미가 없었다.
 *
 * 이제 이 컷의 장소가 등록된 공간과 맞으면 체크 여부와 무관하게 항상 참조한다.
 */

test("★등록된 배경 플레이트는 컷 기반 생성 체크와 무관하게 붙는다", () => {
  const s = src();
  // 환경 레퍼런스 합치기는 원래 cutRef 와 별개로 항상 돈다.
  assert.match(s, /배경·소품\(환경\) 레퍼런스: 캐릭터 활성화 여부와 무관하게 항상 시도/);
  // 그 경로에서 에피소드 배경 플레이트를 찾는다.
  assert.match(s, /function matchEpisodeLocation\(payload, projectRecord, scene, text, skipId\)/);
  assert.match(s, /function episodeLocationAsset\(row\)/);

  const bundle = s.slice(
    s.indexOf("function buildEnvironmentReferenceBundle"),
    s.indexOf("function mergeEnvironmentReferences")
  );
  assert.match(bundle, /var locAsset = episodeLocationAsset\(matchEpisodeLocation\(/);
  // 등록된 자산이 하나도 없어도 배경 플레이트만으로 붙을 수 있어야 한다.
  assert.doesNotMatch(
    bundle,
    /if \(!assets\.length\) return \{ referenceImages: \[\], promptLines: \[\] \};/,
    "브랜드 자산이 없다고 먼저 빠져나가면 에피소드 배경도 못 붙는다"
  );
});

test("★장소 판정은 씬 배정(sceneIds) 우선, 그다음 이름", () => {
  const s = src();
  const fn = s.slice(
    s.indexOf("function matchEpisodeLocation"),
    s.indexOf("function episodeLocationAsset")
  );
  const sceneIdAt = fn.indexOf("Array.isArray(rows[i].sceneIds)");
  const nameAt = fn.indexOf("normalizeText(rows[k].name)");
  assert.ok(sceneIdAt > -1 && nameAt > sceneIdAt, "추출 때 배정된 sceneIds 를 먼저 본다");
  // 이미지가 없는 장소는 후보에서 빠진다.
  const rowsFn = s.slice(s.indexOf("function episodeLocationRows"), s.indexOf("function matchEpisodeLocation"));
  assert.match(rowsFn, /if \(!row \|\| !String\(row\.refObjectName \|\| ''\)\.trim\(\)\) return;/);
});

test("★배경 플레이트는 소품에 밀리지 않고 자리를 차지한다", () => {
  const s = src();
  const bundle = s.slice(
    s.indexOf("function buildEnvironmentReferenceBundle"),
    s.indexOf("function mergeEnvironmentReferences")
  );
  // 매칭 목록 맨 앞에 넣고 자른다.
  assert.match(bundle, /matched = \[locAsset\]\.concat\(matched\.filter\(/);
  assert.match(bundle, /\}\)\)\.slice\(0, max\);/);
});

test("★캐릭터 시트가 슬롯을 다 먹어도 배경이 들어갈 자리를 만든다", () => {
  const s = src();
  const fn = s.slice(
    s.indexOf("function mergeEnvironmentReferences(args)"),
    s.indexOf("function mergeEnvironmentReferences(args)") + 3000
  );
  // 같은 캐릭터의 추가 포즈 한 장만 양보시킨다(첫 장은 남긴다).
  assert.match(fn, /if \(\(counts\[key\] \|\| 0\) > 1\)/);
  assert.match(fn, /remaining = 1;/);
  // 붙일 게 없으면 원래 페이로드를 그대로 돌려준다(괜히 시트를 버리지 않게).
  assert.match(fn, /if \(!bundle\.referenceImages\.length\) return \{ referencePayload: referencePayload/);
});

test("★사용자가 그 장소를 직접 고른 컷에는 중복으로 붙이지 않는다", () => {
  const s = src();
  assert.match(s, /var pickedLocationId = cutRefStr\.indexOf\('loc:'\) === 0 \? cutRefStr\.slice\(4\)\.split\('#'\)\[0\] : '';/);
  assert.match(s, /skipEpisodeLocationId: pickedLocationId/);
  assert.match(s, /skipEpisodeLocationId: args\.skipEpisodeLocationId/);
});

test("★배경은 레이아웃을 유지하되 구도는 이 컷이 정한다", () => {
  const s = src();
  const bundle = s.slice(
    s.indexOf("function buildEnvironmentReferenceBundle"),
    s.indexOf("function mergeEnvironmentReferences")
  );
  assert.match(bundle, /keep the same layout, architecture, props, materials, colors, and lighting/);
  assert.match(bundle, /do not copy the framing of the reference image/);
});
