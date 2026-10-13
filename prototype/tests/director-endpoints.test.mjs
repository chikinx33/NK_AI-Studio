// NK 디렉터(Cloud Run) 전용 사이트 엔드포인트: 서비스 비밀 확인, 시퀀스 저장 규칙, 편집기 저장과의 경합 방지.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
const esbuild = createRequire(import.meta.url)(path.join(root, "ai-company-app/node_modules/esbuild"));

function loadSequenceOps() {
  const src = read("prototype/functions/api/project/sequences.ts");
  const start = src.indexOf("const MAX_SEQUENCES");
  const consts = src.slice(start, src.indexOf("const headers ="));
  const fnStart = src.indexOf("function cleanSequence(");
  const fnEnd = src.indexOf("export const onRequestGet");
  // 컷 스틸·참조 경로 정리(cleanCutStill·cleanReferenceAsset)는 공용 모듈에서 가져온다 — 실구현을 인라인한다.
  const mediaPath = read("prototype/functions/api/_shared/director-media-path.js").replace(/^export /gm, "");
  const js = esbuild.transformSync(mediaPath + consts + src.slice(fnStart, fnEnd), { loader: "ts" }).code;
  return new Function(js + "\nreturn { applyOp, cleanSequence, cleanNotes };")();
}

test("디렉터 전용 엔드포인트는 서비스 비밀을 요구하고 비밀이 없으면 닫힌다", () => {
  const shared = read("prototype/functions/api/director/_shared.ts");
  assert.match(shared, /if \(!expected \|\| !got\) return false;/);
  for (const f of ["delegate.ts", "charge.ts"]) {
    assert.match(read(`prototype/functions/api/director/${f}`), /directorAuth\(request, env, true\)/, f);
  }
  const state = read("prototype/functions/api/director/state.ts");
  assert.match(state, /onRequestPost[\s\S]*directorAuth\(request, env, true\)/, "상태 쓰기는 디렉터 서비스만");
  assert.match(state, /state_must_not_contain_secrets/);
});

test("위임 토큰은 7일, 소유자 여부를 함께 알려 준다", () => {
  const src = read("prototype/functions/api/director/delegate.ts");
  assert.match(src, /DIRECTOR_DELEGATE_TTL_SEC = 7 \* 24 \* 3600/);
  assert.match(src, /isOwner: requireMaster\(env, auth\.userId\)/);
});

test("대화 사용량 정산: 소유자 무과금, 누적 증가분만, 같은 누적값은 한 번", () => {
  const src = read("prototype/functions/api/_shared/credits.ts");
  const fn = src.slice(src.indexOf("export async function chargeDirectorUsage"));
  assert.match(fn, /if \(requireMaster\(env, userId\)\) return \{ ok: true, owner: true, charged: 0/);
  assert.match(fn, /const delta = cumulative - asInt\(prevRows\[0\]\?\.c\);/);
  assert.match(fn, /`director:\$\{sid\}:\$\{cumulative\}`/);
  assert.match(fn, /startsWith\("duplicate_"\)\) return \{ ok: true, charged: 0/);
});

test("미디어 서명 URL 은 본인 저장 영역만, 업로드는 허용한 형식만", () => {
  const src = read("prototype/functions/api/director/media-url.ts");
  assert.match(src, /obj\.includes\("\.\."\) \|\| !obj\.startsWith\(userRoot\)/);
  assert.match(src, /unsupported_content_type/);
  const gcs = read("prototype/functions/api/_shared/gcs.js");
  assert.match(gcs, /export async function signGcsObjectUrl/);
  assert.match(gcs, /const signedHeaders = contentType \? "content-type;host" : "host";/);
});

test("시퀀스 저장: upsert·putTake·select·delete", () => {
  const { applyOp } = loadSequenceOps();
  let list = applyOp([], { op: "upsert", sequence: { id: "seq-a", title: "A", cuts: [{ id: "C01", start: 0, end: 1.5 }] } });
  assert.equal(list.length, 1);
  list = applyOp(list, { op: "putTake", sequenceId: "seq-a", take: { id: "take-1", status: "running" } });
  list = applyOp(list, { op: "putTake", sequenceId: "seq-a", take: { id: "take-1", status: "done", videoUrl: "gs://b/x.mp4" } });
  list = applyOp(list, { op: "putTake", sequenceId: "seq-a", take: { id: "take-2", status: "running" } });
  assert.equal(list[0].takes.length, 2);
  assert.equal(list[0].takes[0].status, "done");
  assert.equal(list[0].takes[0].videoUrl, "gs://b/x.mp4");
  list = applyOp(list, { op: "select", sequenceId: "seq-a", selectedTakeIds: ["take-1", "../bad"] });
  assert.deepEqual(list[0].selectedTakeIds, ["take-1"]);
  assert.equal(list[0].cuts.length, 1, "테이크 갱신이 컷을 지우지 않는다");
  list = applyOp(list, { op: "delete", sequenceId: "seq-a" });
  assert.equal(list.length, 0);
});

test("시퀀스 저장: 잘못된 입력은 거절한다", () => {
  const { applyOp } = loadSequenceOps();
  assert.throws(() => applyOp([], { op: "upsert", sequence: { id: "../x" } }), /invalid_sequence_id/);
  assert.throws(() => applyOp([], { op: "putTake", sequenceId: "nope", take: { id: "t" } }), /sequence_not_found/);
  assert.throws(() => applyOp([], { op: "upsert", sequence: { id: "big", blob: "x".repeat(400 * 1024) } }), /sequence_too_large/);
  assert.throws(() => applyOp([], { op: "weird", sequenceId: "a" }), /sequence_not_found|unknown_op/);
});

test("시퀀스 쓰기와 편집기 저장은 GCS 세대 확인으로 서로 덮어쓰지 않는다", () => {
  const seq = read("prototype/functions/api/project/sequences.ts");
  assert.match(seq, /ifGenerationMatch=\$\{encodeURIComponent\(generation\)\}/);
  assert.match(seq, /if \(res\.status === 412\) return false;/);
  const save = read("prototype/functions/api/project/save.ts");
  assert.match(save, /for \(let attempt = 0; attempt < 4; attempt\+\+\)/);
  assert.match(save, /&ifGenerationMatch=\$\{encodeURIComponent\(generation\)\}/);
  assert.match(save, /if \(res\.status === 412 && attempt < 3\) continue;/);
  // 화면이 들고 있던 옛 sequences·directorNotes 사본은 버리고 서버 값을 보존한다.
  assert.match(save, /for \(const key of \["sequences", "directorNotes"\]\)/);
  assert.match(save, /mergedPayload\[key\] = existing\.payload\[key\];\s*\n\s*else delete mergedPayload\[key\];/);
});

test("프로젝트 기억(directorNotes): 길이 제한, 비밀값 거절, 시퀀스와 같은 저장소", () => {
  const { cleanNotes } = loadSequenceOps();
  const n = cleanNotes({ rules: "모든 인물은 리본 울타리 안", lessons: "x".repeat(30000), extra: 1 });
  assert.equal(n.rules, "모든 인물은 리본 울타리 안");
  assert.equal(n.lessons.length, 20000);
  assert.equal(n.extra, undefined);
  assert.throws(() => cleanNotes({ rules: "key sk-ant-api03-abc" }), /invalid_notes_secret/);
  const seq = read("prototype/functions/api/project/sequences.ts");
  assert.match(seq, /if \(body\?\.op === "notes"\)/);
  assert.match(seq, /notes: payload\.directorNotes \|\| null/);
});

test("Seedance 2.5 드래프트·완성: 요청과 요금이 같은 규칙을 쓴다", () => {
  const v = read("prototype/functions/api/video.ts");
  assert.match(v, /if \(\(body as any\)\?\.draft === true\) \{ atlasBody\.draft = true; atlasBody\.resolution = "480p"; \}/);
  assert.match(v, /model: "bytedance\/seedance-2\.5\/draft-complete",\s*\n\s*draft_id: draftId,/);
  // 참조 오디오는 data: 그대로가 아니라 GCS 에 올려 서명 URL 로 보낸다(직접 올린 오디오 + 캐릭터 보이스).
  assert.match(v, /audiosResolved\.push\(await toAtlasMediaUrl\(audioDataUrl/);
  assert.match(v, /toAtlasMediaUrl\(referenceAudios\[i\]/);
  assert.match(v, /atlasBody\.reference_audios = audiosResolved/);
  const p = read("prototype/functions/api/_shared/video-pricing.ts");
  assert.match(p, /resolution: input\.draft \? "480p"/);
  assert.match(p, /atlasModel === "bytedance\/seedance-2\.5\/draft-complete"/);
});

test("영상 상태 조회는 사용자 Atlas 키를 먼저 쓴다", () => {
  const s = read("prototype/functions/api/video/status.ts");
  assert.match(s, /const atlasKeys = await atlasKeysFor\(env, auth\.userId\);/);
  assert.doesNotMatch(s, /const atlasKey = env\.ATLASCLOUD_API_KEY/);
  assert.equal((s.match(/fetchAtlasPrediction\(statusUrl, atlasKeys\)/g) || []).length, 4);
});
