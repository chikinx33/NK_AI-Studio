import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// 2026-10-20: content_register 를 승인해 등록·SNS 초안까지 끝났는데, 코어가 "RUN 마커가 실행되지 않아 등록 자체가 안 됐다"고 답했다.
// 원인: 대화 기록엔 RUN 마커가 지워져 남고, 승인 결과는 일반 문구뿐, 프롬프트엔 '승인 대기'만 있고 끝난 작업은 없었다.
const root = resolve(import.meta.dirname, "../..");
const esbuild = createRequire(import.meta.url)(resolve(root, "ai-company-app/node_modules/esbuild"));
const read = (file) => readFileSync(resolve(root, file), "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
const load = (src, name) => new Function(`${esbuild.transformSync(src.replace(/export /g, ""), { loader: "ts" }).code}\nreturn ${name};`)();

const orchestrator = read("prototype/functions/api/agent/_orchestrator.ts");
const recentJobsBlock = load(
  orchestrator.slice(orchestrator.indexOf("export interface RecentJobBrief"), orchestrator.indexOf("/** 브랜드 허브 정의를 프롬프트용으로 추린 것. */")),
  "recentJobsBlock",
);
const review = read("prototype/functions/api/agent/review.ts");
const approvalDoneText = load(
  review.slice(review.indexOf("export function approvalDoneText"), review.indexOf("/** 회사 지식 적재")),
  "approvalDoneText",
);

test("content_register 승인 문구는 등록 위치·초안 포맷과 '발행은 아직'을 말한다", () => {
  const text = approvalDoneText("content_register", {
    kind: "content_register", projectId: "nekoban-ep01", title: "EP01 게임 소개 숏폼", formats: ["instagram", "tiktok", "youtube-shorts"],
  }, {});
  assert.match(text, /EP01 게임 소개 숏폼/);
  assert.match(text, /nekoban-ep01/);
  assert.match(text, /instagram, tiktok, youtube-shorts/);
  assert.match(text, /발행은 하지 않았/);
  assert.doesNotMatch(text, /요청하신 작업을 실행했어요/);
});

test("최근 작업 기록 블록: 완료·실패를 사실로 주고, 마커가 안 보여도 미실행으로 판단하지 말라고 지시한다", () => {
  assert.equal(recentJobsBlock([]), "");
  assert.equal(recentJobsBlock(undefined), "");
  const block = recentJobsBlock([
    { type: "content_register", agentName: "리치", status: "approved", at: "2026-10-20T04:36:00Z", result: "에피소드 nekoban-ep01 에 등록했어요.\nSNS 세팅에 초안을 저장했어요." },
    { type: "publish", agentName: "리치", status: "error", at: "2026-10-20T04:40:00Z", result: "token expired" },
  ]);
  assert.match(block, /\[완료 · 10\. 20\. 13:36\] content_register \(담당: 리치\) — 에피소드 nekoban-ep01 에 등록했어요\. SNS 세팅/);
  assert.match(block, /\[실패 · .*\] publish .*token expired/);
  assert.match(block, /RUN 마커가 지워져/);
});

test("직원 프롬프트에 최근 작업 블록이 실제로 들어가고, 한 번의 쿼리로 대기·최근 잡을 읽는다", () => {
  assert.match(orchestrator, /\$\{pendingBlock\}\$\{recentJobsBlock\(opts\.recentJobs\)\}/);
  assert.match(orchestrator, /listAgentJobsForPrompt\(sql, userId\)/);
  assert.match(orchestrator, /recentJobs: cachedJobs\.recent\.map/);
  const shared = read("prototype/functions/api/agent/_shared.ts");
  assert.doesNotMatch(shared, /function listPendingReviewJobs/);
  const fn = shared.slice(shared.indexOf("export async function listAgentJobsForPrompt"), shared.indexOf("export async function setJobStatus"));
  assert.equal((fn.match(/await sql\(/g) || []).length, 1, "서브요청 한도 — 쿼리는 하나");
});
