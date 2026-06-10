import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("store scopes draft/pipeline cache per logged-in user", () => {
  const src = read("prototype/store.js");
  // 사용자 식별 + 스코프 키
  assert.match(src, /function computeUid/);
  assert.match(src, /NK\.auth && NK\.auth\.getUser/);
  assert.match(src, /function draftLsKey\(\) \{ return DRAFT_KEY \+ '::' \+ activeUid; \}/);
  assert.match(src, /function pipelineLsKey\(\) \{ return PIPELINE_KEY \+ '::' \+ activeUid; \}/);
  assert.match(src, /function draftDbKey\(\) \{ return CACHE_KEYS\.drafts \+ '::' \+ activeUid; \}/);
  // 사용자 변경 시 재하이드레이션
  assert.match(src, /function ensureUser/);
  assert.match(src, /if \(uid === activeUid\) return;/);
});

test("store read/write paths call ensureUser to switch namespace", () => {
  const src = read("prototype/store.js");
  // getDrafts/saveDrafts/getPipeline/savePipeline 모두 ensureUser로 네임스페이스 보장
  const ensureCalls = src.match(/ensureUser\(\);/g) || [];
  assert.ok(ensureCalls.length >= 5, "ensureUser should guard ready/getDrafts/saveDrafts/getPipeline/savePipeline");
  // 저장은 스코프 키 사용(전역 키 직접 기록 금지)
  assert.match(src, /writeJsonMirror\(draftLsKey\(\), persistable\)/);
  assert.match(src, /schedulePersist\(draftDbKey\(\), persistable\)/);
  assert.match(src, /writeJsonMirror\(pipelineLsKey\(\), persistable\)/);
});

test("store no longer reads legacy global cache keys (no cross-account leak)", () => {
  const src = read("prototype/store.js");
  // bootMemoryFromLocal은 스코프 키에서만 읽는다
  assert.match(src, /memory\.drafts = readJson\(draftLsKey\(\), \[\]\)/);
  assert.match(src, /memory\.pipeline = readJson\(pipelineLsKey\(\), null\)/);
  // 레거시 후보 키 폴백 제거됨
  assert.doesNotMatch(src, /nk_scenario_drafts_v0/);
  // migrateDrafts는 더 이상 전역 키를 끌어오지 않는다(no-op)
  assert.match(src, /store\.migrateDrafts = function \(\) \{ \/\* no-op/);
  // clearPipeline 제공(스코프 캐시 정리)
  assert.match(src, /store\.clearPipeline = function/);
});

test("pipeline cache invalidation goes through scoped store API", () => {
  const scenario = read("prototype/js/ui/scenario.js");
  assert.match(scenario, /NK\.store\.clearPipeline\(\)/);
  // pipeline.js는 명시적 "저장" 후 확정한 미디어 배치를 스코프 캐시에 그대로 보존한다
  // (저장 시 캐시를 비우지 않음 — 새로고침 시 확정 배치를 그대로 복원하기 위함).
  // 다만 파이프라인 캐시를 다룰 때 raw localStorage 키를 직접 제거하는 일은 없어야 한다
  // (계정 격리: 캐시 정리는 반드시 스코프 store API(clearPipeline)로만).
  const pipeline = read("prototype/ui/pipeline.js");
  assert.doesNotMatch(pipeline, /localStorage\.removeItem\(['"]nk_pipeline_last['"]\)/);
});
