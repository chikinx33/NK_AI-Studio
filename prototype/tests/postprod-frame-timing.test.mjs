import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * 렌더 결과가 끊겨 보이는 원인은 컨테이너·코덱이 아니다.
 *
 * 출력은 WebCodecs + mp4-muxer 로 만든 정상 mp4 다(H.264 + AAC, fastStart, CFR 30fps).
 * 문제는 그 앞 단계다 — 소스 영상 seek 이 제때 끝나지 않으면 직전 화면이 그대로
 * 다시 인코딩된다. 타임스탬프는 균등한데 그림만 멈춰 있어 뚝뚝 끊겨 보인다.
 * 예전에는 400ms 만 기다리고 조용히 넘어가서, 파일을 아무리 뜯어봐도 원인이 안 나왔다.
 */

const render = fs.readFileSync(path.join(process.cwd(), "prototype/js/service/postprod-render.js"), "utf8");
const ui = fs.readFileSync(path.join(process.cwd(), "prototype/js/ui/post-production.js"), "utf8");

test("출력은 정상 mp4 — 코덱·오디오·fastStart 가 갖춰져 있다", () => {
  assert.match(render, /codec: 'avc'/, "H.264 비디오가 아니다");
  assert.match(render, /codec: 'aac'/, "AAC 오디오가 없다 — 무음으로 나간다");
  assert.match(render, /fastStart: 'in-memory'/, "moov 가 뒤에 있으면 재생 시작이 느리다");
  assert.match(render, /type: 'video\/mp4'/);
});

test("프레임 타임스탬프는 균등하다 (CFR)", () => {
  // 전역 프레임 번호 x 고정 간격 — 가변 프레임레이트가 되면 안 된다.
  assert.match(render, /var timestamp = state\.globalFrame \* frameInterval;/);
  assert.match(render, /duration: Math\.round\(frameInterval\)/, "샘플 길이를 지정하지 않으면 VFR 이 된다");
});

test("seek 대기 시간이 너무 짧지 않다", () => {
  // 400ms 는 정상 seek 도 자주 놓친다 → 그때마다 직전 프레임이 중복된다.
  assert.match(render, /Number\(timeoutMs\) \|\| 1200/, "기본 대기가 다시 짧아졌다");
  assert.ok(!/awaitVideoFrameAt\(video, seekTime, 400\)/.test(render), "호출부가 여전히 400ms 로 기다린다");
  assert.match(render, /awaitVideoFrameAt\(video, seekTime, 1200\)/);
});

test("한 번 놓치면 다시 기다려 본다", () => {
  const at = render.indexOf("var got = false;");
  assert.ok(at > 0, "seek 성공 여부를 보지 않는다");
  const body = render.slice(at, at + 700);
  const tries = (body.match(/awaitVideoFrameAt\(/g) || []).length;
  assert.ok(tries >= 2, `재시도가 없다 (호출 ${tries}회)`);
  assert.match(body, /state\.staleFrames\+\+/, "중복 프레임을 세지 않는다");
});

test("중복 프레임 수를 결과에 담아 알린다", () => {
  assert.match(render, /staleFrames: 0,/, "카운터가 없다");
  assert.match(render, /staleFrames: staleFrames/, "결과에 담지 않는다");
  assert.match(render, /totalFrames: totalFrames/);
  // 조용히 넘어가면 왜 끊기는지 알 방법이 없다
  assert.match(render, /seek 지연으로 재사용한 프레임/);
});

test("끊김이 예상되면 화면으로 알린다 (한/영)", () => {
  const at = ui.indexOf("result.staleFrames");
  assert.ok(at > 0, "렌더 UI 가 중복 프레임을 보지 않는다");
  const body = ui.slice(at - 300, at + 1600);
  assert.match(body, /staleN \/ totalN >= 0\.03/, "임계값 없이 항상 뜨거나 아예 안 뜬다");
  assert.match(body, /Choppy playback expected/, "영문 안내가 없다");
  assert.match(body, /끊김이 예상됩니다/, "한글 안내가 없다");
});
