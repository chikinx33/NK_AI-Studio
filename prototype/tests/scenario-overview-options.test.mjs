// 개요에서 고를 수 있는 값은 브라우저 폼과 서버(직원·캔버스)가 같은 것을 봐야 한다.
// 한쪽만 고치면 직원이 지어낸 값이 저장되거나, 폼에 없는 값이 캔버스에 뜬다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PURPOSE_CATEGORIES, NEEDS_LIST, TONE_LIST, STYLE_LIST, TARGET_OPTIONS, DURATION_OPTIONS,
  overviewOptions, matchOption, matchSubgenre,
} from "../functions/api/_shared/overview-options.js";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

/** 브라우저 파일에서 배열 리터럴 하나를 꺼내 값 목록으로 만든다. */
function stringList(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} 를 찾지 못했다`);
  const open = source.indexOf("[", start);
  const close = source.indexOf("]", open);
  return source.slice(open + 1, close).split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
}

test("목적·톤·스타일 목록이 브라우저와 서버에서 같다", async () => {
  const core = await read("prototype/core.js");
  assert.deepEqual(stringList(core, "core.needsList"), NEEDS_LIST);
  assert.deepEqual(stringList(core, "core.toneList"), TONE_LIST);
  assert.deepEqual(stringList(core, "core.styleList"), STYLE_LIST);
});

test("장르·세부 장르가 브라우저와 서버에서 같다", async () => {
  const core = await read("prototype/core.js");
  const start = core.indexOf("core.purposeCategories");
  const block = core.slice(start, core.indexOf("core.needsList"));
  for (const [category, subgenres] of Object.entries(PURPOSE_CATEGORIES)) {
    assert.ok(block.includes(`'${category}'`), `장르 "${category}" 가 브라우저 목록에 없다`);
    for (const sub of subgenres) assert.ok(block.includes(`'${sub}'`), `세부 장르 "${sub}" 가 브라우저 목록에 없다`);
  }
});

test("타겟·길이 선택지가 시나리오 폼과 같다", async () => {
  const form = await read("prototype/js/ui/scenario.js");
  for (const target of TARGET_OPTIONS) assert.ok(form.includes(`value: '${target.value}'`), `타겟 "${target.value}" 누락`);
  for (const duration of DURATION_OPTIONS) assert.ok(form.includes(`value: '${duration.value}'`), `길이 "${duration.value}" 누락`);
});

test("고를 수 없는 값은 거절하고, 세부 장르는 장르 안에서 찾는다", () => {
  assert.equal(matchOption(TONE_LIST, "스토리"), "스토리");
  assert.equal(matchOption(TONE_LIST, "아무거나"), "");
  assert.equal(matchOption(TARGET_OPTIONS, "전 연령"), "전 연령");
  assert.equal(matchSubgenre("스토리 · 서사", "창작"), "창작");
  assert.equal(matchSubgenre("스토리 · 서사", "레시피"), "레시피"); // 다른 장르에 있으면 찾아는 준다
  assert.equal(matchSubgenre("스토리 · 서사", "없는장르"), "");
});

test("옵션 API 와 개요 도구가 같은 목록을 쓴다", async () => {
  const [endpoint, shared, orchestrator, graph] = await Promise.all([
    read("prototype/functions/api/scenario/options.js"),
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
    read("prototype/functions/api/agent/production-graph.ts"),
  ]);
  assert.match(endpoint, /overviewOptions/);
  assert.match(shared, /overview-options\.js/);
  assert.match(shared, /\n  project_overview_get: \{/);
  assert.match(shared, /project_overview_save: \{[\s\S]{0,200}gate: true/);
  // 준 항목만 고친다(payload 통짜 덮어쓰기는 씬·플레이트를 날린다)
  assert.match(shared, /if \(input\?\.topic !== undefined\)/);
  assert.match(shared, /changed: Object\.keys\(payload\)/);
  assert.match(orchestrator, /\[\[RUN: project_overview_get/);
  assert.match(orchestrator, /\[\[RUN: project_overview_save/);
  assert.match(orchestrator, /사용자가 말한 것만 채우고 나머지는 비워 둘 것/);
  // 캔버스가 따로 조회하지 않게 그래프가 개요 요약을 함께 싣는다
  assert.match(graph, /overview: \{/);
  assert.match(graph, /characterCount:/);
  assert.ok(Object.keys(overviewOptions()).includes("voiceModes"));
});
