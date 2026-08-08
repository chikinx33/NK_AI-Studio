import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

/**
 * 업스케일이 실패했을 때 사용자에게 Cloudflare 의 502 HTML 페이지가 통째로 뜨던 문제.
 *
 * 두 갈래로 막는다.
 *  1) 서버: 이미지 바이트를 Worker 로 통과시키지 않고, Vertex 가 늦으면 우리가 먼저 끊는다
 *     (Function 이 플랫폼 한도에 걸려 죽으면 응답 자체가 없어 502 HTML 이 대신 나간다).
 *  2) 클라이언트: 그래도 엣지 오류 페이지를 받으면 제목·Ray ID 한 줄로 줄여 보여준다.
 */

test("업스케일은 이미지 바이트를 Worker 로 통과시키지 않는다", () => {
  const src = read("prototype/functions/api/upscale.ts");
  // 저장된 객체는 gs:// 로 그대로 넘긴다 (다운로드 없음)
  assert.match(src, /sourceImage = \{ gcsUri: `gs:\/\/\$\{outParsed\.bucket\}/);
  // 결과도 Vertex 가 GCS 에 직접 쓴다
  assert.match(src, /storageUri: `gs:\/\/\$\{outParsed\.bucket\}\/\$\{outputPrefix\}\/`/);
  // 예전처럼 GCS 에서 원본을 통째로 내려받는 경로가 남아 있으면 안 된다
  assert.doesNotMatch(src, /download\/storage\/v1\/b/);
});

test("Vertex 호출은 플랫폼 한도보다 먼저 끊고 이유를 돌려준다", () => {
  const src = read("prototype/functions/api/upscale.ts");
  assert.match(src, /const VERTEX_TIMEOUT_MS = \d+;/);
  const ms = Number(src.match(/const VERTEX_TIMEOUT_MS = (\d+);/)[1]);
  assert.ok(ms > 0 && ms < 30000, `한도(30초)보다 짧아야 한다: ${ms}ms`);
  assert.match(src, /signal: AbortSignal\.timeout\(VERTEX_TIMEOUT_MS\)/);
  // 끊겼을 때는 504 로, 그 외 요청 실패는 502 로 — 어느 쪽이든 JSON 으로 끝난다
  assert.match(src, /timedOut \? 504 : 502/);
  assert.match(src, /시간 초과/);
});

test("엣지 오류 HTML 은 제목·Ray ID 한 줄로 줄여 보여준다", () => {
  const api = read("prototype/api.js");
  assert.match(api, /function \(text\) \{[\s\S]*?<title>/);
  assert.match(api, /Ray ID/);
  // JSON 오류가 먼저, HTML 요약이 그다음, 원문은 마지막 폴백
  assert.match(api, /return edgeErrorSummary\(t\) \|\| t;/);
});

test("edgeErrorSummary 는 Cloudflare 502 페이지를 한 줄로 줄인다", async () => {
  // api.js 는 브라우저 전역(window)을 쓰므로 함수 본문만 떼어내 검증한다
  const api = read("prototype/api.js");
  const start = api.indexOf("var edgeErrorSummary = function");
  const end = api.indexOf("var e = function");
  assert.ok(start > 0 && end > start, "edgeErrorSummary 를 찾지 못했다");
  const factory = new Function(api.slice(start, end) + "\nreturn edgeErrorSummary;");
  const edgeErrorSummary = factory();

  const cfPage = [
    "<!DOCTYPE html>",
    '<html class="no-js" lang="en-US"><head>',
    "<title>nkstudio.org | 502: Bad gateway</title>",
    "</head><body>",
    'Cloudflare Ray ID: <strong class="font-semibold">a27c92571d33095d</strong>',
    "</body></html>",
  ].join("\n");

  const summary = edgeErrorSummary(cfPage);
  assert.equal(summary, "nkstudio.org | 502: Bad gateway (Cloudflare Ray ID: a27c92571d33095d)");
  // 원문 길이의 일부만 남아야 한다 (통째로 흘리지 않는다)
  assert.ok(summary.length < 120);
  // HTML 이 아니면 손대지 않는다 — JSON·평문 오류는 그대로 흘러가야 한다
  assert.equal(edgeErrorSummary('{"error":"nope"}'), "");
  assert.equal(edgeErrorSummary("upscale_error"), "");
});
