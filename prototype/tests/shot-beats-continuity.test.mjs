import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

/**
 * ★설계 회귀: 하나의 연속 연출이 두 컷으로 갈려 같은 그림이 두 번 생성됐다.
 *
 * 시나리오 의도: "발만 보이다가 카메라가 틸트업하며 전신이 드러난다".
 * 그런데 이게 컷1(2초) + 컷2(3초)로 갈렸다. 컷마다 스틸컷을 따로 만드니 모델은 맥락을
 * 알 수 없고, 컷1에도 전신 컷2에도 전신 — 거의 같은 그림이 두 번 나왔다. 가려졌다가
 * 드러나는 연출 자체가 사라진 것이다.
 *
 * 원인 세 겹:
 *   1) 최소 컷 길이가 2초였다. 영상 모델은 4초 미만을 못 만든다(Kling 5초) — 2·3초 컷은
 *      쪼갤 이유가 없는데도 쪼개진 것이다.
 *   2) 한 컷 안의 "시간"을 적을 자리가 없었다. 그래서 모델이 무브의 결과를 다음 컷으로 만들었다.
 *   3) 스틸컷을 컷 설명 전체로 그렸다. "틸트업하며 전신을 드러냄"을 그대로 그리니
 *      시작 프레임이 이미 끝 상태였다.
 *
 * 이제: 컷 = 하나의 카메라 셋업, 그 안의 시간은 beats. 스틸컷은 beats[0](t=0),
 * 영상은 beats 를 시간 분배 프롬프트로 받는다.
 */

const decomposer = () => read("prototype/functions/api/scenario/shots/decomposer.js");
const imageUi = () => read("prototype/ui/pipeline-image.js");
const videoUi = () => read("prototype/ui/pipeline-video.js");

test("★최소 컷 길이가 영상 모델 바닥(4초)과 같다", () => {
  const src = decomposer();
  assert.match(src, /const MIN_SHOT_DURATION = 4;/);
  // 왜 4인지 근거를 코드에 남긴다(다음 사람이 2로 되돌리지 않게).
  assert.match(src, /영상 생성 모델의 최소 길이가 4초/);
  // 한국어·영어 프롬프트 둘 다 새 바닥을 말한다.
  assert.match(src, /각 샷은 ≥ 4초/);
  assert.match(src, /Each shot must be ≥ 4 seconds/);
});

test("★한 컷 안의 시간을 적을 자리(beats)가 프롬프트 규칙에 있다", () => {
  const src = decomposer();
  // 연속 무브를 쪼개지 말라는 지시가 한/영 양쪽에 있다.
  assert.match(src, /연속된 카메라 무브를 두 샷으로 쪼개지 마라/);
  assert.match(src, /NEVER split one continuous camera move into two shots/);
  // 첫 비트가 스틸컷이라는 것도 명시한다.
  assert.match(src, /이것이 스틸컷으로 만들어지는\s*\n?\s*.*첫 프레임이다/);
  assert.match(src, /It becomes the still image \(the first frame\)/);
  // 출력 형식에 beats 가 들어 있다.
  assert.match(src, /"beats":\[\{"at":0,"what":/);
});

test("★짧은 씬은 컷을 억지로 쪼개지 않고 합쳐서 시간표로 잇는다", async () => {
  const mod = await import(pathToFileUrl("prototype/functions/api/scenario/shots/decomposer.js"));
  const shots = [
    { id: "1.1", duration: 4, shotType: "MS", cameraMove: "static", composition: "발과 하체만 프레임 하단에", action: "가만히 서 있다" },
    { id: "1.2", duration: 3, shotType: "WS", cameraMove: "tilt", composition: "세 캐릭터 전신과 방 전체", action: "고개를 든다" },
  ];
  const out = mod.reconcileDurations(shots, { estSec: 5 });

  assert.equal(out.length, 1, "5초 씬에 4초 컷 둘은 들어가지 않는다");
  const beats = out[0].beats;
  assert.ok(Array.isArray(beats) && beats.length >= 2, "두 화면이 시간표로 남아야 한다");
  assert.equal(beats[0].at, 0, "첫 비트는 샷의 시작 — 이게 스틸컷이 된다");
  assert.match(beats[0].what, /발과 하체만/);
  assert.ok(beats[1].at > 0 && beats[1].at < out[0].duration, "두 번째 화면은 샷 안의 나중 시점");
  assert.match(beats[1].what, /전신/);
});

test("★비트 시각은 컷 길이가 바뀌면 같은 비율로 따라간다", async () => {
  const mod = await import(pathToFileUrl("prototype/functions/api/scenario/shots/decomposer.js"));
  // 8초짜리를 4초로 줄이면 4초 지점의 비트는 2초로 와야 한다. 그대로 두면 샷 밖으로
  // 밀려나 통째로 사라지고, 시간표가 있던 컷이 조용히 평범한 컷이 된다.
  const scaled = mod.scaleBeats([{ at: 0, what: "a" }, { at: 4, what: "b" }], 0.5);
  assert.deepEqual(scaled.map((b) => b.at), [0, 2]);
});

test("★비트가 하나뿐이면(변화 없음) 시간표를 두지 않는다", async () => {
  const mod = await import(pathToFileUrl("prototype/functions/api/scenario/shots/decomposer.js"));
  assert.equal(mod.normalizeBeats([{ at: 0, what: "가만히" }], 4), null);
  // 첫 비트는 언제나 0 으로 끌어온다(스틸컷이 샷의 시작이어야 하므로).
  const fixed = mod.normalizeBeats([{ at: 2, what: "a" }, { at: 3, what: "b" }], 5);
  assert.equal(fixed[0].at, 0);
  // 샷 밖의 비트는 버린다.
  assert.equal(mod.normalizeBeats([{ at: 0, what: "a" }, { at: 9, what: "b" }], 4), null);
});

test("★스틸컷은 컷의 첫 프레임으로 만든다", () => {
  const src = imageUi();
  assert.match(src, /function firstFrameText\(row\)/);
  // 첫 프레임만 그리라고 모델에게 못박는다.
  assert.match(src, /This still is the FIRST FRAME of the shot \(t=0\)/);
  assert.match(src, /Do NOT render the end state of the camera move/);
  // 씬 컷과 샷 컷 두 경로 모두에 적용된다.
  const hits = src.match(/FIRST FRAME of the shot/g) || [];
  assert.ok(hits.length >= 2, "컷·샷 이미지 프롬프트 양쪽에 있어야 한다");
});

test("★영상 프롬프트는 시간 분배로 나간다", () => {
  const src = videoUi();
  assert.match(src, /function buildBeatTimeline\(scene, durationSec\)/);
  assert.match(src, /'Shot timeline \(what is visible over time\)'/);
  // "0.0s-2.5s: ..." 형식
  assert.match(src, /from \+ 's-' \+ to \+ 's: ' \+ row\.what/);
});

test("★비트가 씬까지 실려 온다 (서버 → 클라이언트)", () => {
  const flatten = read("prototype/functions/api/scenario-shots.js");
  assert.match(flatten, /beats: Array\.isArray\(sh\.beats\) && sh\.beats\.length \? sh\.beats : null,/);
});

test("★타임라인이 컷 행에 보인다", () => {
  const row = read("prototype/ui/pipeline-scene-row.js");
  assert.match(row, /function buildBeatTimelineHtml\(scene\)/);
  assert.match(row, /타임라인/);
  // 어느 줄이 스틸컷이 되는지 표시한다.
  assert.match(row, /is-first-frame/);
  assert.match(row, /스틸컷/);
  const css = read("prototype/styles.css");
  assert.match(css, /\.prompt-beats \{/);
  assert.match(css, /\.prompt-beats li\.is-first-frame/);
});

function pathToFileUrl(rel) {
  const abs = path.resolve(process.cwd(), rel);
  return "file:///" + abs.replace(/\\/g, "/");
}
