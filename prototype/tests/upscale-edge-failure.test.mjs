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

test("업스케일은 원본 바이트를 Worker 로 통과시키지 않는다", () => {
  const src = read("prototype/functions/api/upscale.ts");
  // 저장된 객체는 gs:// 참조(fileData)로 그대로 넘긴다 (다운로드 없음)
  assert.match(src, /fileData: \{ mimeType: mimeFromName\(cleanObject\), fileUri: gcsUri \}/);
  assert.match(src, /gs:\/\/\$\{outParsed\.bucket\}/);
  // 예전처럼 GCS 에서 원본을 통째로 내려받는 경로가 남아 있으면 안 된다
  assert.doesNotMatch(src, /download\/storage\/v1\/b/);
});

/**
 * 이 프로젝트의 Vertex Imagen 표면은 전 모델·전 리전 404 (실측: 서비스 계정·Owner 동일,
 * 가짜 모델명 대조군과 같은 응답). 같은 자격증명으로 Gemini 이미지 모델은 200.
 * → 기본 업스케일은 Gemini 이미지 모델의 고해상도 충실 재현으로 간다.
 */
test("기본 업스케일 경로는 Gemini 이미지 모델(global)이다", () => {
  const src = read("prototype/functions/api/upscale.ts");
  assert.match(src, /GEMINI_UPSCALE_MODEL \|\| "gemini-3\.1-flash-image"/);
  assert.match(src, /responseModalities: \["IMAGE"\]/);
  assert.match(src, /imageConfig: \{ imageSize: upscaleSize \}/);
  // 충실 재현 지시 — 내용·스타일 변경 금지가 프롬프트에 명시돼야 한다
  assert.match(src, /Do not change the composition/);
  // Imagen predict 는 env 로 강제할 때만 시도한다 (기본 경로에서 404 왕복 낭비 금지)
  assert.match(src, /forcedImagen && imagenSource/);
  assert.doesNotMatch(src, /"imagen-4\.0-upscale-preview", "imagegeneration@002"/);
});

test("Vertex 호출은 플랫폼 한도보다 먼저 끊고 이유를 돌려준다", () => {
  const src = read("prototype/functions/api/upscale.ts");
  assert.match(src, /const VERTEX_TIMEOUT_MS = \d+;/);
  const ms = Number(src.match(/const VERTEX_TIMEOUT_MS = (\d+);/)[1]);
  assert.ok(ms > 0 && ms < 30000, `한도(30초)보다 짧아야 한다: ${ms}ms`);
  assert.match(src, /signal: AbortSignal\.timeout\(VERTEX_TIMEOUT_MS\)/);
  assert.match(src, /code: timedOut \? "vertex_timeout" : "vertex_request_failed"/);
  assert.match(src, /시간 초과/);
});

/**
 * 실제로 겪은 증상: 우리 함수가 502(JSON 본문 포함)를 돌려주자 Cloudflare 가 그걸
 * 게이트웨이 오류로 보고 본문을 자기 "502 Bad gateway" HTML 로 갈아치웠다. 화면에는
 * 원인 대신 그 페이지가 통째로 떴고, 로그에는 함수가 Ok 로 끝났다고 찍혀 추적이 어려웠다.
 * 같은 실수를 어디서도 반복하지 않도록 전 엔드포인트를 훑는다.
 */
test("Pages Function 은 502·504 를 반환하지 않는다 (본문이 엣지 오류 페이지로 바뀐다)", () => {
  const dir = path.join(process.cwd(), "prototype/functions");
  const offenders = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|js|mjs)$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, "utf8");
      text.split(/\r?\n/).forEach((line, i) => {
        // send(...)/json(...) 의 status 인자 자리에 502·504 가 오는 경우
        if (/,\s*50[24]\s*,/.test(line) || /status:\s*50[24]\b/.test(line)) {
          offenders.push(`${path.relative(process.cwd(), full)}:${i + 1}`);
        }
      });
    }
  };
  walk(dir);
  assert.deepEqual(offenders, [], `502/504 를 돌려주면 Cloudflare 가 본문을 덮어쓴다 → 500 을 쓸 것: ${offenders.join(", ")}`);
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
