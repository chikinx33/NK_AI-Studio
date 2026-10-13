// 디렉터 단계 화면(B): Claude 단발 호출 프롬프트·결과 정리, 플레이북 단일 원천.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
const assist = await import(pathToFileURL(path.join(root, "prototype/functions/api/_shared/director-assist.js")).href);
const sync = await import(pathToFileURL(path.join(root, "scripts/sync-director-playbook.mjs")).href);

test("플레이북 사본은 스킬 원본과 같다(규칙 단일 원천)", () => {
  assert.equal(read(sync.PLAYBOOK_TARGET), sync.buildPlaybookModule().replace(/\r\n/g, "\n"),
    "node scripts/sync-director-playbook.mjs 를 실행해 사본을 갱신하세요");
});

test("op 마다 해당 플레이북 문서를 system 에 싣고, 무음악·균등 분배 금지를 지시한다", () => {
  const seq = { id: "seq-a", title: "운동장", durationSec: 20, aspectRatio: "16:9", brief: "공이 굴러간다",
    cuts: [{ id: "C01", start: 0, end: 2, shot: "WS", action: "달린다" }], references: [{ asset: "gs://b/a.png", role: "father", appliesTo: ["*"] }] };
  const ctx = { projectTitle: "부금협", characters: [{ name: "아빠", description: "40대" }], notes: { rules: "리본 울타리 안" } };
  const conti = assist.buildAssistPrompt("conti", { sequence: seq, context: ctx });
  assert.match(conti.system, /# 상시 규칙/);
  assert.match(conti.system, /# 콘티 · 참조 배치표/);
  assert.match(conti.user, /균등하게 나누지 않는다/);
  assert.match(conti.user, /리본 울타리 안/);
  assert.match(conti.user, /아빠/);
  const prompt = assist.buildAssistPrompt("prompt", { sequence: seq, context: ctx });
  assert.match(prompt.system, /# Seedance 2\.5 운용/);
  assert.match(prompt.user, /@Image1/);
  assert.match(prompt.user, /무음악/);
  const review = assist.buildAssistPrompt("review", { sequence: seq, take: { id: "t1" }, qa: { sceneCuts: [1.5] }, frameTimes: [1] });
  assert.match(review.system, /# 검수 체크리스트/);
  assert.throws(() => assist.buildAssistPrompt("weird", {}), /unknown_assist_op/);
});

test("콘티 정리: 0초 시작·빈틈 없음·마지막은 시퀀스 길이, 균등 분배는 경고", () => {
  const { cuts, warnings } = assist.normalizeCuts([
    { id: "C02", start: 3, end: 6, shot: "MS", action: "b" },
    { id: "C01", start: 0.2, end: 3, shot: "WS", action: "a" },
    { id: "C03", start: 6, end: 9.5, shot: "CU", action: "c" },
  ], 10);
  assert.deepEqual(cuts.map((c) => [c.id, c.start, c.end]), [["C01", 0, 3], ["C02", 3, 6], ["C03", 6, 10]]);
  assert.deepEqual(warnings, []);
  const eq = assist.normalizeCuts([{ start: 0, end: 3, shot: "a", action: "a" }, { start: 3, end: 6, shot: "b", action: "b" }, { start: 6, end: 9, shot: "c", action: "c" }], 9);
  assert.ok(eq.warnings.includes("equal_rhythm"));
  assert.equal(eq.cuts[0].id, "C01");
});

test("부분 재생성: 길이는 4~30초 정수, 참조 번호는 있는 것만", () => {
  const seq = { durationSec: 20, references: [{}, {}, {}] };
  const p = assist.normalizePatch({ range: { start: 2.3, end: 4.1 }, referenceNumbers: [1, 3, 3, 9], replacesCuts: ["C03", "../x"], prompt: "AUDIO: absolutely NO music. 0.0-1.8 ..." }, seq);
  assert.deepEqual(p.range, { start: 2.3, end: 4.1 });
  assert.equal(p.durationSeconds, 4);
  assert.deepEqual(p.referenceNumbers, [1, 3]);
  assert.deepEqual(p.replacesCuts, ["C03"]);
  assert.throws(() => assist.normalizePatch({ prompt: "짧음" }, seq), /assist_patch_prompt_missing/);
});

test("결과 해석: 코드펜스 섞인 JSON, 프롬프트 본문, 검수 판정", () => {
  const conti = assist.finishAssist("conti", "설명\n```json\n{\"cuts\":[{\"start\":0,\"end\":5,\"shot\":\"WS\",\"action\":\"a\"}],\"notes\":\"n\"}\n```", { sequence: { durationSec: 8 } });
  assert.equal(conti.cuts[0].end, 8);
  assert.equal(conti.notes, "n");
  assert.match(assist.finishAssist("prompt", "```\nA 20-second stylized commercial...\n```", {}).prompt, /^A 20-second/);
  const r = assist.finishAssist("review", '{"verdict":"maybe","fail":["C06 공"],"pass":[]}', {});
  assert.equal(r.verdict, "fail");
  assert.throws(() => assist.extractJson("없음"), /assist_json_missing/);
});

test("검수 프레임은 data:image base64 만 Claude 이미지로 넘긴다(원격 URL 은 열지 않는다)", () => {
  const blocks = assist.frameBlocks(["data:image/jpeg;base64,AAAA", "https://evil/x.png", "data:text/html;base64,AAAA"]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].source.media_type, "image/jpeg");
});

test("assist 엔드포인트: 스튜디오 인증, 응답 흘려 보내기, Opus 5.5 에 temperature 를 보내지 않는다", () => {
  const src = read("prototype/functions/api/director/assist.ts");
  assert.match(src, /studioAuth\(env, who\.userId\)/);
  assert.match(src, /CLAUDE_AUTH_REQUIRED \}, 412/);
  assert.match(src, /"Content-Type", "text\/event-stream; charset=utf-8"/);
  assert.match(src, /stream: true/);
  assert.doesNotMatch(src, /temperature/);
  assert.equal(assist.ASSIST_MODEL, "claude-opus-5-5");
});
