// 2026-09-29: 후반편집 렌더 결과가 늘 검은 화면으로 시작하고(인스타그램 표지도 검정), V1 영상 클립 자체의 소리가 빠졌다.
//  - 첫 프레임: loadedmetadata 만 기다리고 0초 seek 은 건너뛰어, 디코딩 전 영상을 drawImage → 배경색만 인코딩.
//  - 소리: WebCodecs 렌더는 A1·M1 클립만 섞고 V1 영상의 오디오('오디오 ON')는 읽지 않았다.
//  - 키프레임: 첫 프레임 하나뿐(파일 전체가 GOP 하나).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");
const render = read("js/service/postprod-render.js");
const post = read("js/ui/post-production.js");

test("첫 프레임: 영상을 실제로 디코딩시키고, 그릴 수 있을 때까지 기다린 뒤 그린다", () => {
  assert.match(render, /function isVideoDrawable\(video\) \{\s*return !!video && Number\(video\.readyState\) >= 2 && !video\.seeking;/);
  assert.match(render, /try \{ await primeVideoFirstFrame\(video, Number\(clip\.videoOffset\) \|\| 0\); \} catch \(_\) \{ \}/);
  const prime = render.slice(render.indexOf("async function primeVideoFirstFrame("), render.indexOf("function awaitVideoFrameAt("));
  assert.match(prime, /video\.play\(\)/, "디코더를 깨운다");
  assert.match(prime, /waitForVideoSeek\(video, target \+ 0\.04, 2500\)/, "목표가 0초여도 실제 seek 이 일어나게 튕긴다");
  const frameAt = render.slice(render.indexOf("function awaitVideoFrameAt("), render.indexOf("function waitForVideoSeek("));
  assert.match(frameAt, /waitVideoDrawable\(video, Math\.max\(200, Number\(timeoutMs\) \|\| 1200\)\)\.then\(finish\);/);
  assert.doesNotMatch(frameAt, /< 0\.005\) \{[^}]*finish\(true\);\s*return;/, "목표 위치라고 바로 통과하지 않는다");
  const loop = render.slice(render.indexOf("async function runVideoSegmentOffline("), render.indexOf("function runSegmentOffline("));
  assert.ok(loop.indexOf("waitVideoDrawable(video, 1500)") < loop.indexOf("drawFn(t)"), "그리기 전에 준비를 확인");
});

test("키프레임: 2초마다", () => {
  assert.match(render, /var KEYFRAME_EVERY_FRAMES = 60;/);
  assert.equal((render.match(/state\.encoder\.encode\(frame, \{ keyFrame: state\.globalFrame % KEYFRAME_EVERY_FRAMES === 0 \}\);/g) || []).length, 2);
  assert.doesNotMatch(render, /state\.encoder\.encode\(frame\);/);
});

test("소리: '오디오 ON' 인 V1 영상 클립의 소리를 컷 시작점부터 섞는다", () => {
  const clips = post.slice(post.indexOf("function getAudioClipsForRender("), post.indexOf("function getActiveSubtitleLabels("));
  assert.match(clips, /if \(t\.key === 'visuals'\) \{/);
  assert.match(clips, /v\.soundOn === false \|\| !isVideoUrl\(v\.url\)\) continue;/);
  assert.match(clips, /type: 'clip', videoOffset: Math\.max\(0, Number\(v\.videoOffset\) \|\| 0\)/);
  const mix = render.slice(render.indexOf("async function encodeAudioForMuxer("), render.indexOf("var mixedBuf = await offCtx.startRendering();"));
  assert.match(mix, /try \{ src\.start\(clip\.start, srcOffset, clipDur\); \} catch \(_\) \{\}/);
  assert.match(render, /try \{ src\.start\(baseTime \+ clip\.start, srcOffset, playDur\); \} catch \(_\) \{ \}/);
});
