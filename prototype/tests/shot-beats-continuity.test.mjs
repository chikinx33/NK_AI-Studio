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
  assert.match(src, /각 샷은 4초 이상, ≤ 6초/);
  assert.match(src, /Each shot is at least 4 seconds and ≤ 6 seconds/);
  // ★예시도 같은 바닥을 지켜야 한다. 규칙은 4초인데 예시가 2초면 모델은 예시를 따른다.
  assert.match(src, /CU 얼굴\(5초\) \+ MS 뒷모습 실루엣\(5초\)/);
  assert.match(src, /CU face \(5s\) \+ MS silhouette from behind \(5s\)/);
  assert.doesNotMatch(src, /\(2초\) \+ MS/);
});

test("★한 컷 안의 시간을 적을 자리(beats)가 프롬프트 규칙에 있다", () => {
  const src = decomposer();
  // 연속 무브를 쪼개지 말라는 지시가 한/영 양쪽에 있다.
  assert.match(src, /연속된 카메라 무브를 두 샷으로 쪼개지 마라/);
  assert.match(src, /NEVER split one continuous camera move into two shots/);
  // 첫 비트가 스틸컷이라는 것도 명시한다.
  assert.match(src, /이것이 스틸컷이 되는 첫 프레임이다/);
  assert.match(src, /It becomes the still image \(the first frame\)/);
  // ★출력 형식에 beats 가 들어 있어야 한다 — 한국어·영어 양쪽 모두.
  // (영어 스키마에 beats 가 빠져 있어, 영어로 만들면 절대 채워지지 않던 버그가 있었다)
  assert.equal((src.match(/"beats":\[\{"at":0,"what":/g) || []).length, 2);
  // 응답 직전에 한 번 더 확인시킨다 — 마지막 문장이 누락을 크게 줄인다.
  assert.match(src, /cameraMove 가 static 이 아닌 샷에 beats 가 없으면 잘못된 응답이다/);
  assert.match(src, /is not "static" and has no beats is an invalid response/);
  // 필드 목록에서도 필수임을 밝힌다(규칙 번호에 묻히지 않게).
  assert.match(src, /cameraMove 가 static 이 아니면 필수/);
  assert.match(src, /REQUIRED whenever cameraMove is not "static"/);
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

test("★시나리오 화면에서도 타임라인을 보고 고칠 수 있다", () => {
  const ui = read("prototype/js/ui/scenario.js");
  // 컷 카드에 타임라인 칸이 있다(화면·행동 옆).
  assert.match(ui, /class="view-lines view-beats-lines"/);
  assert.match(ui, /contenteditable="true" data-placeholder=/);
  // "0s 발만 프레임에" 형식으로 보여 주고 되돌린다.
  assert.match(ui, /const beatsToText = \(beats\) => \{/);
  assert.match(ui, /const textToBeats = \(text\) => \{/);
  assert.match(ui, /out\[0\]\.at = 0;/, "첫 줄은 언제나 컷의 시작(=스틸컷)");
  assert.match(ui, /if \(out\.length < 2\) return null;/, "변화가 없으면 시간표를 두지 않는다");
  // 한/영 라벨이 짝을 이룬다.
  assert.match(ui, /timeline: 'Timeline'/);
  assert.match(ui, /timeline: '타임라인'/);
});

test("★타임라인 칸은 필요한 컷에만 나온다", () => {
  // 이 칸은 사용자가 채우는 칸이 아니라 컷 분할이 채우는 칸이다.
  // 아무 컷에나 빈칸을 띄우면 "내가 적어야 하나?" 로 읽힌다.
  const ui = read("prototype/js/ui/scenario.js");
  const start = ui.indexOf("const beatsText = beatsToText(s.beats);");
  const block = ui.slice(start, ui.indexOf("view-beats-lines", start));
  assert.match(block, /const moving = String\(s\.cameraMove \|\| 'static'\)/);
  assert.match(block, /if \(!beatsText && !moving\) return '';/);
  // 플레이스홀더가 누가 채우는 칸인지 알려 준다.
  assert.match(ui, /컷을 나눌 때 AI 가 채웁니다/);
  assert.match(ui, /Filled in when cuts are split/);
});

test("★편집·저장이 타임라인을 지우지 않는다", () => {
  const ui = read("prototype/js/ui/scenario.js");
  // 카드에서 수집할 때 싣고,
  assert.match(ui, /const beats = beatsEl \? textToBeats\(beatsEl\.innerText \|\| beatsEl\.textContent \|\| ''\) : null;/);
  assert.match(ui, /action: hasStructuredEdit \? actionText : '',[\s\S]{0,20}beats,/);
  // 스냅샷 머지에서도 지킨다(화면에 없을 수 있는 필드라 undefined 면 이전 값 유지).
  assert.match(ui, /const beats = \(s\.beats !== undefined \? s\.beats : prev\.beats\) \|\| null;/);
  assert.match(ui, /composition,[\s\S]{0,30}action,[\s\S]{0,30}beats[\s\S]{0,20}\}\);/);
});

function pathToFileUrl(rel) {
  const abs = path.resolve(process.cwd(), rel);
  return "file:///" + abs.replace(/\\/g, "/");
}
