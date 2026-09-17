import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(import.meta.dirname, "../js/ui/ai-video-gen.js"), "utf8");

// 2026-09-17: Seedance 2.5 생성을 눌렀는데 영상 4개가 만들어져 크레딧이 빠졌다.
// 생성 잠금을 서버 접수(videoStart) 전에 풀어, 참조 업로드로 접수가 오래 걸리는 동안 버튼이 다시 눌렸다.
test("영상 생성 잠금은 서버가 작업을 접수한 뒤(finally)에만 풀린다", () => {
  const start = source.indexOf("async function startGeneration()");
  assert.ok(start >= 0);
  const end = source.indexOf("\n  }\n", source.indexOf("} finally {", start));
  const body = source.slice(start, end);

  assert.match(body, /if \(state\.generating\) return;/);
  const lockAt = body.indexOf("state.generating = true;");
  const requestAt = body.indexOf("await NK.api.videoStart(payload)");
  const finallyAt = body.indexOf("} finally {");
  const unlocks = [...body.matchAll(/state\.generating = false;/g)].map((m) => m.index);

  assert.ok(lockAt >= 0 && requestAt > lockAt, "요청 전에 잠근다");
  assert.equal(unlocks.length, 1, "잠금 해제는 한 곳뿐");
  assert.ok(finallyAt > requestAt && unlocks[0] > finallyAt, "잠금 해제는 요청 뒤 finally 안에서만");
});
