// 에이전트의 브랜드 목록이 대시보드 BRAND 카드와 달랐던 원인(2026-09-24):
// brand_list 는 브랜드 허브 폴더 id 만 돌려줬고(projects1771052244218 같은 폴더명 노출), 허브 정의가 없는 시리즈는 빠졌으며,
// 허브 제목(SHAPES)과 시리즈 제목(모양새 친구들)이 달랐다. 이제 허브 정의 ∪ 프로젝트 시리즈를 합쳐 사용자가 보는 이름으로 낸다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");
const fnBody = (src, head) => {
  const start = src.indexOf(head);
  assert.ok(start >= 0, `${head} 가 있어야 한다`);
  return src.slice(start, src.indexOf("\n}\n", start));
};

test("brand/list?full=1 이 브랜드 정의까지 한 번에 돌려준다", async () => {
  const src = await read("prototype/functions/api/brand/list.ts");
  assert.match(src, /const full = new URL\(request\.url\)\.searchParams\.get\("full"\) === "1";/);
  assert.match(src, /buildAiVideoBrandPrefix\(basePrefix, userId, id\)/);
  assert.match(src, /reference\/data\.json/);
  assert.match(src, /return send\(\{ ok: true, ids, brands \}, 200, origin\);/);
});

test("brand_list 도구는 허브 ∪ 프로젝트 시리즈를 합쳐 사용자가 보는 이름·에피소드 수·정의 유무를 낸다", async () => {
  const shared = await read("prototype/functions/api/agent/_shared.ts");
  const fn = fnBody(shared, "async function runBrandListTool(");
  assert.match(fn, /callInternalJson\(ctx, "\/api\/brand\/list\?full=1"\)/);
  assert.match(fn, /callInternalJson\(ctx, "\/api\/agent\/production-projects"\)/);
  assert.match(fn, /const title = \(sr\?\.seriesTitle \|\| hubTitle \|\| id\);/, "시리즈 제목 > 허브 제목 > id");
  assert.match(fn, /note: "프로젝트 시리즈만 있고 브랜드 허브 정의 없음\(brand_save 로 등록 가능\)"/);
  assert.match(fn, /허브 폴더는 있는데 정의\(보이스·타깃\)가 비어 있음/);
  assert.match(fn, /return \{ kind: "brand_list", count: items\.length, items, ids \};/);
  const orch = await read("prototype/functions/api/agent/_orchestrator.ts");
  assert.match(orch, /대시보드 BRAND 카드와 같은 눈높이 — 브랜드 허브 정의 ∪ 프로젝트 시리즈/);
  assert.match(orch, /브랜드\(IP\) \$\{items\.length\}개예요 — 대시보드 BRAND 카드와 같아요\./);
  assert.match(orch, /if \(!b\.hasHub\) bits\.push\("허브 정의 미등록"\);/);
});

test("브랜드 브리프 로더는 full 목록 한 번으로 읽고 시리즈 이름을 별칭으로 붙인다", async () => {
  const orch = await read("prototype/functions/api/agent/_orchestrator.ts");
  const fn = fnBody(orch, "export async function loadBrandBriefs(");
  assert.match(fn, /fetch\(new URL\("\/api\/brand\/list\?full=1", ctx\.request\.url\)\.toString\(\), \{ headers \}\)/);
  assert.doesNotMatch(fn, /\/api\/brand\/get\?brandId=/, "브랜드마다 get 을 부르지 않는다");
  assert.match(fn, /brands\.slice\(0, 8\)/);
  assert.match(fn, /if \(alias && alias !== brief\.title\) brief\.aliases = \[alias\];/);
  assert.match(orch, /aliases\?: string\[\];/);
  assert.match(orch, /프로젝트 시리즈명: \$\{b\.aliases\.join\(", "\)\}/);
});
