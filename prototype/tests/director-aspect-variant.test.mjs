// 디렉터 결과물의 다른 비율판(16:9 확정본 → 9:16 세로판)을 새 프로젝트로 — 원본을 덮지 않는다(2026-10-14).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildAspectVariant, variantSequence, defaultVariantAspect } from "../functions/api/_shared/director-aspect-variant.js";

const root = path.resolve(import.meta.dirname, "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");

const seq = {
  id: "seq-semo-attack", title: "세모의 습격", order: 1, aspectRatio: "16:9", status: "confirmed", prompt: "Sequence prompt…",
  confirmedTakeId: "take-d2-1080", confirmedAt: "2026-10-14T01:17:14Z",
  cuts: [
    { id: "c1", label: "CUT 1", start: 0, end: 3, action: "내려온다", stillUrl: "gs://b/users/u/ai-video/projectsp/image/1.png", stillApproved: true, stillNote: "v2" },
    { id: "c2", label: "CUT 2", start: 3, end: 5.5, action: "건드린다", stillUrl: "gs://b/users/u/ai-video/projectsp/image/2.png", stillApproved: true },
  ],
  references: [{ asset: "gs://b/users/u/ai-video/brands/s/ip/semo/a.png", role: "세모 캐릭터 시트", appliesTo: ["*"] }],
  takes: [
    { id: "take-d2", kind: "full", draft: true, status: "done", videoPath: "gs://b/480.mp4" },
    { id: "take-d2-1080", kind: "full", draft: false, status: "confirmed", videoPath: "gs://b/users/u/ai-video/projectsp/videos/take-d2-1080.mp4" },
  ],
  selectedTakeIds: ["take-d2-1080"],
};
const source = { title: "세모의 습격", aspectRatio: "16:9",
  payload: { episodeTitle: "세모의 습격", aspectRatio: "16:9", story: "세모가 도시를…", characters: ["@세모"], narrationEnabled: false,
    directorConfirmed: { confirmedAt: "x" }, renderMeta: { outputVideoObjectName: "v.mp4" }, brandStudioPublishResults: [{ id: "a" }] } };

test("비율판: 원본 스틸·완성 영상은 참조로, 컷 스틸·테이크·확정은 비운다", () => {
  const v = variantSequence(seq, { aspectRatio: "9:16", sourceAspect: "16:9" });
  assert.equal(v.id, "seq-semo-attack");
  assert.equal(v.aspectRatio, "9:16");
  assert.equal(v.status, "refs");
  assert.deepEqual(v.takes, []);
  assert.deepEqual(v.selectedTakeIds, []);
  assert.equal(v.confirmedTakeId, undefined);
  assert.equal(v.cuts[0].stillUrl, undefined);
  assert.equal(v.cuts[0].stillApproved, undefined);
  assert.equal(v.cuts[0].action, "내려온다");
  assert.equal(v.cuts[1].end, 5.5);
  assert.equal(v.prompt, "Sequence prompt…");
  // 기존 참조(캐릭터 시트) + 원본 스틸 2장(컷별) + 원본 완성 영상(확정 테이크)
  assert.equal(v.references.length, 4);
  assert.equal(v.references[1].asset, "gs://b/users/u/ai-video/projectsp/image/1.png");
  assert.deepEqual(v.references[1].appliesTo, ["c1"]);
  assert.match(v.references[1].role, /16:9 원본 스틸 CUT 1 — .*9:16 구도/);
  assert.equal(v.references[3].asset, "gs://b/users/u/ai-video/projectsp/videos/take-d2-1080.mp4");
  assert.match(v.references[3].role, /referenceVideos/);
  assert.equal(v.variantOf.takeVideo, "gs://b/users/u/ai-video/projectsp/videos/take-d2-1080.mp4");
});

test("비율판 계획: 개요만 옮기고 확정·대표 영상·발행 기록은 옮기지 않는다", () => {
  const plan = buildAspectVariant(source, { sequences: [seq], notes: { rules: "인물은 리본 안", lessons: "교훈" } }, { aspectRatio: "9:16", sourceProjectId: "semo" });
  assert.equal(plan.title, "세모의 습격 (9:16)");
  assert.equal(plan.payloadPatch.aspectRatio, "9:16");
  assert.equal(plan.payloadPatch.story, "세모가 도시를…");
  assert.deepEqual(plan.payloadPatch.characters, ["@세모"]);
  assert.equal(plan.payloadPatch.topic, "세모의 습격 (9:16)");
  assert.deepEqual(plan.payloadPatch.variantOf, { projectId: "semo", title: "세모의 습격", aspectRatio: "16:9" });
  for (const k of ["directorConfirmed", "renderMeta", "brandStudioPublishResults", "sequences"]) assert.equal(plan.payloadPatch[k], undefined, k);
  assert.match(plan.notes.rules, /^인물은 리본 안\n\n\[9:16 판\]/);
  assert.equal(plan.notes.lessons, "교훈");
  assert.equal(plan.sequences[0].aspectRatio, "9:16");
});

test("같은 비율 복제: 스틸·승인까지 그대로, 테이크·확정만 비운다", () => {
  const plan = buildAspectVariant(source, { sequences: [seq], notes: { rules: "인물은 리본 안" } }, { aspectRatio: "16:9", sourceProjectId: "semo" });
  assert.equal(plan.sameAspect, true);
  assert.equal(plan.title, "세모의 습격 (복제)");
  assert.equal(plan.payloadPatch.topic, "세모의 습격 (복제)");
  const v = plan.sequences[0];
  assert.equal(v.cuts[0].stillUrl, "gs://b/users/u/ai-video/projectsp/image/1.png");
  assert.equal(v.cuts[0].stillApproved, true);
  assert.deepEqual(v.takes, []);
  assert.equal(v.confirmedTakeId, undefined);
  // 스틸은 컷에 그대로 있으니 참조로 다시 넣지 않는다(원본 완성 영상만 참조로)
  assert.equal(v.references.length, 2);
  assert.match(v.references[1].role, /원본 완성 영상/);
  assert.match(plan.notes.rules, /\[복제\] 이 프로젝트는 '세모의 습격'\(16:9/);
});

test("세로 → 가로도 같은 규칙(가로 전제 문구 없음)", () => {
  const vertical = { ...source, aspectRatio: "9:16", payload: { ...source.payload, aspectRatio: "9:16" } };
  const plan = buildAspectVariant(vertical, { sequences: [{ ...seq, aspectRatio: "9:16" }] }, { aspectRatio: "16:9", sourceProjectId: "semo" });
  assert.equal(plan.title, "세모의 습격 (16:9)");
  assert.doesNotMatch(JSON.stringify(plan), /가로 구도|가로 화면/);
});

test("비율판 계획: 잘못된 비율·디렉터 시퀀스 없음은 거절", () => {
  assert.throws(() => buildAspectVariant(source, { sequences: [seq] }, { aspectRatio: "4:3", sourceProjectId: "semo" }), /invalid_aspect_ratio/);
  assert.throws(() => buildAspectVariant(source, { sequences: [] }, { aspectRatio: "9:16", sourceProjectId: "semo" }), /no_director_sequences/);
  assert.equal(defaultVariantAspect("16:9"), "9:16");
  assert.equal(defaultVariantAspect("9:16"), "16:9");
});

test("엔드포인트·화면: 새 에피소드로 만들고 시퀀스·기억을 옮긴다, 디렉터 화면 버튼", () => {
  const ep = read("prototype/functions/api/director/aspect-variant.ts");
  assert.match(ep, /AGENT_TOOLS\.project_add_episode\.run\(\{ parentProjectId: projectId, episodeTitle: plan\.title \}/);
  assert.match(ep, /op: "upsert", sequence: seq/);
  assert.match(ep, /op: "notes", notes: plan\.notes/);
  const dw = read("ai-company-app/src/components/DirectorWorkspace.tsx");
  // '에피소드 복제' 하나로, 비율(16:9·9:16·1:1)을 고른다. 같은 비율은 스틸까지 그대로.
  assert.match(dw, /duplicate: "에피소드 복제"/);
  assert.match(dw, /duplicate: "Duplicate episode"/);
  assert.match(dw, /\["16:9", "9:16", "1:1"\]\.map\(\(ar\) =>/);
  assert.match(dw, /ar === sourceAspect \? modeText\.sameAspect : modeText\.otherAspect/);
  // 콘티·테이크 접기/펼치기: 기본 펼침, 마지막 상태 기억
  assert.match(dw, /readUserStorage\("directorPanelConti"\) !== "0"/);
  assert.match(dw, /readUserStorage\("directorPanelTakes"\) !== "0"/);
  assert.match(dw, /writeUserStorage\("directorPanelConti", v \? "0" : "1"\)/);
  assert.match(dw, /\{contiOpen && <div className="space-y-2">/);
  assert.match(dw, /\{takesOpen && <div className="space-y-2">/);
  assert.match(read("ai-company-app/src/lib/directorSteps.ts"), /"\/api\/director\/aspect-variant"/);
});
