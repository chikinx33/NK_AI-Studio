// 디렉터 확정: 완성 테이크를 scenes·이야기·대표 영상으로 옮기고 시나리오·메인 프로덕션을 잠근다(2026-10-14).
// 디렉터 결과는 payload.sequences 에만 있어 시나리오·메인 프로덕션·영상 캔버스·SNS 세팅에서 "컷 0" 이었다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { applyDirectorConfirm, pickFinalTake, toGsPath } from "../functions/api/_shared/director-confirm.js";

const root = path.resolve(import.meta.dirname, "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");

const BUCKET = "nk-bucket";
const V1080 = "gs://nk-bucket/users/u1/ai-video/projectsp1/videos/take-2-abc.mp4";
const seq = (over = {}) => ({
  id: "seq-1", title: "세모의 습격", order: 1, durationSec: 28, status: "review",
  cuts: [
    { id: "c1", label: "CUT 1", start: 0, end: 3, shot: "익스트림 로우", action: "세모가 내려온다", acting: "놀람", camera: "틸트업", stillUrl: "users/u1/ai-video/projectsp1/image/1.png", copy: "쿵!" },
    { id: "c2", label: "CUT 2", start: 3, end: 5.5, shot: "로우앵글 와이드", action: "건물을 건드린다", stillUrl: "gs://nk-bucket/users/u1/ai-video/projectsp1/image/2.png" },
  ],
  takes: [
    { id: "take-1", kind: "full", draft: true, status: "done", videoPath: "gs://nk-bucket/x/480.mp4", durationSec: 28 },
    { id: "take-2", kind: "full", draft: false, draftOfTakeId: "take-1", resolution: "1080p", status: "done", videoPath: V1080, durationSec: 28 },
    { id: "take-3", kind: "patch", range: { start: 22, end: 28 }, status: "done", videoPath: "gs://nk-bucket/x/patch.mp4" },
  ],
  selectedTakeIds: ["take-1", "take-3"],
  ...over,
});
const doc = (over = {}) => ({ title: "세모의 습격", payload: { sequences: [seq()], ...(over.payload || {}) }, scenes: over.scenes || [] });

test("확정: 컷 → scenes(스틸만), 대표 영상 = 1080p 완성본, 잠금 표시", () => {
  const { data, result } = applyDirectorConfirm(doc(), { sequenceId: "seq-1", bucket: BUCKET, now: "2026-10-14T00:00:00Z" });
  assert.equal(data.scenes.length, 2);
  const [a, b] = data.scenes;
  assert.equal(a.id, 1);
  assert.equal(a.imagePath, "gs://nk-bucket/users/u1/ai-video/projectsp1/image/1.png");
  assert.equal(a.imageDataUrl, a.imagePath);
  assert.equal(a.estSec, 3);
  assert.equal(b.estSec, 2.5);
  assert.equal(a.sceneLocation, "세모의 습격");
  assert.equal(a.action, "세모가 내려온다 — 놀람");
  assert.equal(a.subtitleText, "쿵!");
  // 컷에는 영상을 붙이지 않는다(영상은 한 편 — 엔케 결정)
  assert.equal(a.videoUrl, undefined);
  assert.equal(a.videoPath, undefined);

  const p = data.payload;
  assert.equal(p.renderMeta.outputVideoObjectName, "users/u1/ai-video/projectsp1/videos/take-2-abc.mp4");
  assert.equal(p.renderMeta.outputDurationSec, 28);
  assert.equal(p.renderMeta.source, "director");
  assert.deepEqual(p.directorConfirmed, { confirmedAt: "2026-10-14T00:00:00Z", sequences: [{ id: "seq-1", title: "세모의 습격", takeId: "take-2" }] });
  assert.match(p.story, /세모의 습격/);
  assert.match(p.story, /CUT 1: 세모가 내려온다/);
  assert.equal(p.topic, "세모의 습격");

  const s = p.sequences[0];
  assert.equal(s.status, "confirmed");
  // 완성 테이크 + 이미 골라 둔 부분 재생성(드래프트 take-1 은 빠진다)
  assert.deepEqual(s.selectedTakeIds, ["take-2", "take-3"]);
  assert.equal(s.takes.find((t) => t.id === "take-2").status, "confirmed");
  assert.equal(result.representativeVideo, "users/u1/ai-video/projectsp1/videos/take-2-abc.mp4");
  assert.equal(result.stills, 2);
});

test("확정: 개요(이야기·주제)가 이미 있으면 그대로 둔다", () => {
  const { data } = applyDirectorConfirm(doc({ payload: { story: "내가 쓴 이야기", topic: "내 주제" } }), { sequenceId: "seq-1", bucket: BUCKET });
  assert.equal(data.payload.story, "내가 쓴 이야기");
  assert.equal(data.payload.topic, "내 주제");
});

test("확정: 일반 컷이 있으면 동의(replaceExisting) 없이 덮지 않는다", () => {
  const withScenes = doc({ scenes: [{ id: 1, shot: "a" }, { id: 2, shot: "b" }, { id: 3, shot: "c" }] });
  assert.throws(() => applyDirectorConfirm(withScenes, { sequenceId: "seq-1", bucket: BUCKET }), (e) => e.message === "scenes_exist" && e.existingScenes === 3);
  const { data, result } = applyDirectorConfirm(withScenes, { sequenceId: "seq-1", bucket: BUCKET, replaceExisting: true });
  assert.equal(data.scenes.length, 2);
  assert.equal(result.replacedScenes, 3);
  // 이미 디렉터로 확정된 프로젝트의 재확정은 디렉터 컷끼리의 갱신이라 묻지 않는다.
  assert.doesNotThrow(() => applyDirectorConfirm(data, { sequenceId: "seq-1", bucket: BUCKET }));
});

test("확정: 드래프트(480p)만 있으면 완성본이 없다고 멈춘다", () => {
  const onlyDraft = doc({ payload: { sequences: [seq({ takes: [seq().takes[0]] })] } });
  assert.throws(() => applyDirectorConfirm(onlyDraft, { sequenceId: "seq-1", bucket: BUCKET }), /no_final_take/);
  assert.throws(() => applyDirectorConfirm(doc(), { sequenceId: "nope", bucket: BUCKET }), /sequence_not_found/);
  assert.equal(pickFinalTake(seq(), "take-1"), null);
  assert.equal(pickFinalTake(seq()).id, "take-2");
});

test("확정: 시퀀스가 여럿이면 순서대로 이어 컷을 만들고, 대표 영상은 포스트 렌더에 맡긴다", () => {
  const second = seq({ id: "seq-2", title: "반격", order: 2, status: "confirmed", confirmedTakeId: "take-2",
    cuts: [{ id: "d1", label: "CUT 1", start: 0, end: 4, action: "반격", stillUrl: "gs://nk-bucket/s.png" }] });
  const first = doc({ payload: { renderMeta: { outputVideoObjectName: "old.mp4", source: "director" } } });
  first.payload.sequences = [second, seq()];
  const { data, result } = applyDirectorConfirm(first, { sequenceId: "seq-1", bucket: BUCKET });
  assert.equal(data.scenes.length, 3);
  assert.equal(data.scenes[0].sceneLocation, "세모의 습격");
  assert.equal(data.scenes[2].sceneLocation, "반격");
  assert.equal(data.scenes[2].sceneBreak, true);
  assert.equal(data.payload.renderMeta, undefined);
  assert.equal(result.sequencesConfirmed, 2);
});

test("저장소 경로 정리: users/… · 서명 URL · gs:// 만 받고 data: 는 버린다", () => {
  assert.equal(toGsPath("users/u/a.png", "b"), "gs://b/users/u/a.png");
  assert.equal(toGsPath("https://storage.googleapis.com/b/users/u/a%20b.png?X-Goog-Signature=1", "x"), "gs://b/users/u/a b.png");
  assert.equal(toGsPath("data:image/png;base64,AAA", "b"), "");
});

test("서버: 확정 API·저장 잠금·에이전트 잠금 안내", () => {
  const seqApi = read("prototype/functions/api/project/sequences.ts");
  assert.match(seqApi, /if \(body\?\.op === "confirm"\)/);
  assert.match(seqApi, /if \(msg === "scenes_exist"\) return send\(\{ error: msg, existingScenes/);
  const save = read("prototype/functions/api/project/save.ts");
  assert.match(save, /const scenesLocked = !!existing\?\.payload\?\.directorConfirmed;/);
  assert.match(save, /const mergedScenes = hasScenes && !scenesLocked/);
  assert.match(save, /for \(const key of \["sequences", "directorNotes", "directorConfirmed"\]\)/);
  const agent = read("prototype/functions/api/agent/_shared.ts");
  assert.match(agent, /path === "\/api\/project\/save" && Array\.isArray\(init\.body\?\.scenes\) && init\.body\.scenes\.length && data\?\.scenesLocked/);
});

test("화면: 시나리오(개요 제외)·메인 프로덕션 '수정 불가', 디렉터 확정 버튼·도구", () => {
  const lock = read("prototype/js/ui/director-lock.js");
  assert.match(lock, /label: '수정 불가'/);
  assert.match(lock, /label: 'Read-only'/);
  const scn = read("prototype/js/ui/scenario.js");
  // 대본 카드만 잠그고(펼치기는 둔다), 시나리오 생성·컷 다시 나누기·주입을 막는다. 개요·초기화·저장하기는 쓴다.
  assert.match(scn, /dl\.applyRegions\(\[document\.getElementById\('scenario-cards'\)\], locked, \{ keep: '\.scenario-card-toggle' \}\)/);
  assert.match(scn, /document\.querySelector\('button\[type="submit"\]\[form="scenario-form"\]'\),\s*\n\s*document\.getElementById\('decompose-shots'\),\s*\n\s*document\.getElementById\('scenario-inject-btn'\)/);
  assert.match(scn, /directorLocked \? \[\] : draft\.scenes/);
  assert.match(scn, /if \(_prevDirectorConfirmed\) draft\.payload\.directorConfirmed = _prevDirectorConfirmed;/);
  const pipe = read("prototype/ui/pipeline.js");
  // 메인 프로덕션도 내용 확인용 컨트롤(펼치기/접기·다운로드)은 잠그지 않는다.
  assert.match(pipe, /dl\.applyRegions\(\[meta, document\.getElementById\('pipeline-scenes'\)\], locked, \{ keep: PIPELINE_VIEW_CONTROLS \}\)/);
  assert.match(pipe, /var PIPELINE_VIEW_CONTROLS = '\.scene-row-toggle, \.scene-shot-toggle, #pipeline-expand-all, #pipeline-collapse-all, #pipeline-focus-mode, '/);
  // '수정 불가' 라벨은 두 페이지 모두 같은 공통 라벨(본문 맨 위 가운데)
  // 줄을 따로 차지하지 않고 상단 줄 가운데(펼침/접기 묶음) 맨 앞에, 자물쇠 아이콘만(글자는 툴팁)
  assert.match(pipe, /dl\.applyPageBadge\(document\.querySelector\('#pipeline-meta \.pipeline-fold-center'\), locked\);/);
  assert.match(scn, /dl\.applyPageBadge\(document\.querySelector\('#scenario-section \.right-caption \.caption-fold-mode'\), locked\);/);
  assert.match(lock, /host\.insertBefore\(pill, host\.firstChild\);/);
  assert.doesNotMatch(lock, /pill\.appendChild\(document\.createTextNode/);
  assert.match(read("prototype/styles.css"), /\.director-lock-pill \{[^}]*border-radius: 50%;/);
  assert.doesNotMatch(read("prototype/styles.css"), /\.director-lock-banner/);
  assert.match(pipe, /if \(!lockedByDirector && Array\.isArray\(freshState\.scenes\)/);
  for (const page of ["prototype/scenario.html", "prototype/scenes.html"]) {
    const h = read(page);
    assert.ok(h.indexOf("js/ui/director-lock.js") > 0 && h.indexOf("js/ui/director-lock.js") < h.indexOf("js/ui/scenario.js"), page);
  }
  const dw = read("ai-company-app/src/components/DirectorWorkspace.tsx");
  assert.match(dw, /confirm: "확정"/);
  assert.match(dw, /confirm: "Confirm"/);
  assert.match(dw, /e\?\.body\?\.error !== "scenes_exist"/);
  const tools = read("director/src/mcp/tools.ts");
  assert.match(tools, /server\.registerTool\("sequence_confirm"/);
  assert.match(tools, /op: "confirm", sequenceId/);
});
