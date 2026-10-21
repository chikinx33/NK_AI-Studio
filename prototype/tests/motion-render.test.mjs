import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { audioFilterGraph, cueTime, isAllowedUrl } from "../../ai-company-app/scripts/render-motion-page.mjs";

const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), "utf8");

test("효과음 시점은 박자 번호(소수 포함)와 초 표기를 모두 받는다", () => {
  const beats = [0.5, 1.0, 1.6, 2.0];
  assert.equal(cueTime("s3.25", beats), 3.25);
  assert.equal(cueTime(1, beats), 1.0);
  assert.ok(Math.abs(cueTime(1.5, beats) - 1.3) < 1e-9);
  assert.throws(() => cueTime(3, beats), /박자/);
});

test("페이지는 허용 폴더 안 파일만 읽고 인터넷 요청은 막힌다", () => {
  const root = path.resolve("F:/promo");
  const inside = pathToFileURL(path.join(root, "nekoban", "a.png")).href;
  const outside = pathToFileURL(path.resolve("F:/secret.txt")).href;
  const sibling = pathToFileURL(path.resolve("F:/promo-evil/a.png")).href;
  assert.equal(isAllowedUrl(`${inside}?lang=ko`, [root]), true);
  assert.equal(isAllowedUrl(outside, [root]), false);
  assert.equal(isAllowedUrl(sibling, [root]), false);
  assert.equal(isAllowedUrl("https://example.com/a.js", [root]), false);
  assert.equal(isAllowedUrl("data:image/png;base64,AAAA", [root]), true);
});

test("소리 그래프는 원본 키트와 같이 배경음악 페이드·박자 효과음·-14 LUFS를 만든다", () => {
  const graph = audioFilterGraph({ duration: 15.35, bgmVolume: 0.55, cues: [{ delayMs: 1695.4, gain: 1 }] });
  assert.match(graph, /atrim=0:15\.350,afade=t=out:st=14\.450:d=0\.9,volume=0\.55\[m\]/);
  assert.match(graph, /\[1:a\].*adelay=1695\|1695\[s1\]/);
  assert.match(graph, /\[m\]\[s1\]amix=inputs=2:normalize=0,atrim=0:15\.350,loudnorm=I=-14:TP=-1\.5:LRA=11\[out\]/);
});

test("렌더러는 240fps 촬영 후 모션블러로 60fps를 만들고 낮은 우선순위로 돈다", async () => {
  const source = await read("ai-company-app/scripts/render-motion-page.mjs");
  assert.match(source, /options\.fps \|\| 60/);
  assert.match(source, /options\.sub \|\| 4/);
  assert.match(source, /tmix=frames=\$\{sub\},framestep=\$\{sub\}/);
  assert.match(source, /PRIORITY_BELOW_NORMAL/);
  assert.match(source, /Fetch\.failRequest/);
  // Remotion 동봉 ffmpeg에는 tmix가 없어 모션블러가 빠진다. 전체 빌드만 쓴다.
  assert.doesNotMatch(source, /compositor-win32/);
});
