// 라비오크 게임 대시보드 도구(raviok_hq) — 엔케 본인 계정 두 개에서만 보이고, GET 만 하고, 보고에 필요한 만큼만 남긴다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isRaviokHqEmail, raviokHqRequest, trimRaviokHq, RAVIOK_HQ_EMAILS } from "../functions/api/agent/_raviok-hq.js";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("허용 계정은 엔케 본인 두 개뿐이다", () => {
  assert.deepEqual(RAVIOK_HQ_EMAILS, ["chikinx1@gmail.com", "raviok0623@gmail.com"]);
  assert.equal(isRaviokHqEmail(" Chikinx1@gmail.com "), true);
  assert.equal(isRaviokHqEmail("raviok0623@gmail.com"), true);
  assert.equal(isRaviokHqEmail("someone@gmail.com"), false);
  assert.equal(isRaviokHqEmail(""), false);
});

test("화면 → API 경로, 게임 id 는 검증한다", () => {
  assert.deepEqual(raviokHqRequest({}), { view: "summary", path: "/api/summary" });
  assert.deepEqual(raviokHqRequest({ view: "수익" }), { view: "revenue", path: "/api/revenue" });
  assert.deepEqual(raviokHqRequest({ view: "reviews" }), { view: "reviews", path: "/api/reviews" });
  assert.deepEqual(raviokHqRequest({ view: "game", game: "PuzzleKnight" }), { view: "game", game: "puzzleknight", path: "/api/game/puzzleknight" });
  assert.throws(() => raviokHqRequest({ view: "game" }), /id 가 필요해요/);
  assert.throws(() => raviokHqRequest({ view: "game", game: "../login" }), /id 가 필요해요/);
});

test("요약은 내부 식별자·스파크라인을 빼고 KPI·할 일·매출은 남긴다", () => {
  const out = trimRaviokHq("summary", {
    at: "2026-10-20T06:14:27Z",
    totals: { active: 46 }, revenue: { month: 257 }, discord: { members: 2 }, promo: { posts: 1 },
    todos: [{ who: "nk", level: "mid", game: "홍보", link: "#/promo", text: "글 1건", how: "홍보 탭" }],
    games: [{ id: "puzzleknight", name: "PuzzleKnight", package: "com.raviok.puzzleknight", ga4: "1", discord: ["x"], spark: [1, 2], kpi: { installs: { now: 1 } }, reviews: [{ stars: 5, text: "굿", reply: null, gameName: "퍼즐" }] }],
    order: { kpi: [] }, errors: [],
  });
  assert.equal(out.revenue.month, 257);
  assert.equal(out.todos[0].text, "글 1건");
  assert.equal(out.todos[0].link, undefined);
  const g = out.games[0];
  assert.equal(g.kpi.installs.now, 1);
  assert.equal(g.package, undefined);
  assert.equal(g.ga4, undefined);
  assert.equal(g.spark, undefined);
  assert.equal(out.order, undefined);
  assert.equal(g.recentReviews[0].replied, false);
  assert.match(out.note, /원\(KRW\)/);
});

test("게임 상세·수익은 시계열을 최근 구간으로 자른다", () => {
  const series = Array.from({ length: 90 }, (_, i) => ({ d: `d${i}` }));
  assert.equal(trimRaviokHq("game", { game: { id: "a" }, series }).series.length, 21);
  const days = Array.from({ length: 91 }, (_, i) => ({ d: `d${i}`, ad: 1, iap: 0, web: 0, won: 1, impressions: 9 }));
  const rev = trimRaviokHq("revenue", { days, months: [], thisMonth: [] });
  assert.equal(rev.days.length, 31);
  assert.equal(rev.days[0].impressions, undefined);
});

test("도구는 등록되고, 다른 계정에는 프롬프트·직원 목록·능력 목록 어디에도 보이지 않는다", async () => {
  const [shared, orchestrator, agents] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
    read("prototype/functions/api/agent/agents.ts"),
  ]);
  assert.match(shared, /raviok_hq: \{ agentId: "edge", agentIds: \["core"\], kind: "read", synthesize: true, run: runRaviokHqTool \}/);
  // 실행 시에도 계정을 다시 확인하고, 명부 장애면 닫는다
  assert.match(shared, /if \(!\(await canUseRaviokHq\(ctx\.env, ctx\.userId\)\)\) throw/);
  assert.match(shared, /catch \(_\) \{\s*return false;\s*\}/);
  // 쓰기 없음
  assert.doesNotMatch(shared.slice(shared.indexOf("async function runRaviokHqTool"), shared.indexOf("async function runRaviokHqTool") + 2000), /method: "POST"/);
  assert.match(orchestrator, /\[\[RUN: raviok_hq/);
  assert.match(orchestrator, /new Set\(opts\.hiddenTools \?\? \["raviok_hq"\]\)/);
  assert.match(orchestrator, /hiddenTools = opts\.userId && \(await canUseRaviokHq/);
  assert.match(agents, /name === "raviok_hq" && !hqVisible/);
  assert.match(shared, /tool !== "raviok_hq" \|\| hqVisible/);
});
