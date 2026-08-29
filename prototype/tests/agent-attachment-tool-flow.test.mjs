import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * 첨부 이미지를 받은 에이전트의 도구 호출 흐름.
 *
 * 실제로 있었던 일: 사용자가 캐릭터 시트를 첨부하고 분석을 요청하자 픽셀이 정상적으로
 * 분석을 끝냈다. 그런데 그 뒤에 imagen_describe 를 또 불렀고, 첨부에는 URL 이 없어
 * "🔎 조회 중" → "❌ 조회에 실패했어요: image_reference_unavailable" 이 이어졌다.
 * 답은 이미 나왔는데 실패만 남아 흐름이 망가진 것이다.
 *
 * 원인은 두 겹이었다.
 *  1) 첨부는 멀티모달 블록으로 모델에게 이미 보이는데, 그 사실을 알려주지 않았다.
 *     그래서 모델이 "분석하려면 도구를 불러야지" 하고 자리표시자 URL 로 호출했다.
 *  2) 부를 수 없는 호출인데도 실행을 시작해 실패 문구가 사용자에게 노출됐다.
 */

const root = process.cwd();
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const shared = () => read("prototype/functions/api/agent/_shared.ts");
const orch = () => read("prototype/functions/api/agent/_orchestrator.ts");

/** isUsableImageRef 만 떼어 내 실제로 실행한다(정규식 훑기가 아니라 동작 검증). */
function loadIsUsableImageRef() {
  const src = shared();
  const start = src.indexOf("export function isUsableImageRef");
  assert.ok(start > 0, "isUsableImageRef 를 못 찾음");
  const end = src.indexOf("\n}", start) + 2;
  const body = src.slice(start, end).replace(/^export /, "").replace(/: any\b/g, "").replace(/: boolean\b/g, "");
  const ctx = vm.createContext({});
  vm.runInContext(body + "\n;globalThis.__fn = isUsableImageRef;", ctx);
  return ctx.__fn;
}

const isUsableImageRef = loadIsUsableImageRef();

test("자리표시자·지어낸 주소는 이미지 참조로 인정하지 않는다", () => {
  // 모델이 첨부를 가리키려다 실제로 넣었던 형태들
  assert.equal(isUsableImageRef("이미지URL"), false);
  assert.equal(isUsableImageRef("<이미지URL>"), false);
  assert.equal(isUsableImageRef("{imageUrl}"), false);
  assert.equal(isUsableImageRef("첨부된 이미지"), false);
  assert.equal(isUsableImageRef("https://example.com/image.png"), false);
  assert.equal(isUsableImageRef("https://placeholder.test/a.png"), false);
  assert.equal(isUsableImageRef(""), false);
  assert.equal(isUsableImageRef(null), false);
  // 상대 경로 아닌 맨 문자열도 거부
  assert.equal(isUsableImageRef("attached-image"), false);
});

test("실제 저장된 이미지 주소는 통과시킨다", () => {
  assert.equal(isUsableImageRef("https://storage.googleapis.com/nkstudio/a.png"), true);
  assert.equal(isUsableImageRef("gs://nkstudio-video-out/sheets/a.png"), true);
  assert.equal(isUsableImageRef("/api/media/proxy?src=gs%3A%2F%2Fx%2Fy.png"), true);
  assert.equal(isUsableImageRef("data:image/png;base64,AAAA"), true);
});

test("imagen_describe 는 부를 수 없는 호출을 precheck 로 걸러낸다", () => {
  const src = shared();
  assert.match(src, /precheck\?: \(input: any\) => string \| null;/);
  // 도구 정의에 precheck 가 붙어 있어야 한다.
  const block = src.slice(src.indexOf("imagen_describe: {"), src.indexOf("imagen_describe: {") + 500);
  assert.match(block, /precheck:/);
  assert.match(block, /isUsableImageRef/);
});

test("precheck 에 걸리면 '조회 중' 안내조차 내지 않고 건너뛴다", () => {
  const src = orch();
  const runTools = src.slice(src.indexOf("const runTools = async"), src.indexOf("const runTools = async") + 2500);
  const precheckAt = runTools.indexOf("tool.precheck");
  const noticeAt = runTools.indexOf("조회 중이에요");
  assert.ok(precheckAt > 0, "runTools 에 precheck 처리가 없음");
  assert.ok(noticeAt > 0, "조회 중 안내를 못 찾음");
  // 안내를 emit 하기 '전에' 걸러야 한다. 순서가 뒤집히면 실패 문구가 그대로 노출된다.
  assert.ok(precheckAt < noticeAt, "precheck 는 '조회 중' 안내보다 앞서야 합니다");
  assert.match(runTools, /tool_precheck_skip/);
});

test("첨부가 있으면 '이미 보고 있다'를 시스템 프롬프트에 넣는다", () => {
  const src = orch();
  // 첨부 유무를 speak() 가 계산해 buildAgentSystem 으로 넘겨야 한다.
  assert.match(src, /const hasAttachments = \(opts\.images \|\| \[\]\)\.some/);
  assert.match(src, /companyProjects, hasAttachments \}\)/);
  assert.match(src, /hasAttachments\?: boolean;/);
  // 안내 문구의 핵심 두 가지: 이미 보인다 / 조회 도구를 부르지 마라.
  assert.match(src, /지금 당신에게 그대로 보이고 있습니다/);
  assert.match(src, /imagen_describe 같은 조회 도구를 부르지 마세요/);
  assert.match(src, /답을 이미 냈다면 그걸로 끝입니다/);
  // 첨부가 없을 땐 이 블록이 붙지 않아야 한다(불필요한 토큰·혼선 방지).
  assert.match(src, /opts\.hasAttachments\s*\?\s*`/);
});

test("imagen_describe 도구 설명이 첨부에는 쓰지 말라고 못박는다", () => {
  const src = orch();
  const line = src.split("\n").find((l) => l.includes("imagen_describe: `[[RUN:"));
  assert.ok(line, "imagen_describe 도구 설명을 못 찾음");
  assert.match(line, /실제 주소가 있는 이미지에만 사용/);
  assert.match(line, /첨부한 이미지는 이미 눈에 보이므로/);
  // 예시 값이 자리표시자면 모델이 그대로 따라 넣는다.
  assert.doesNotMatch(line, /"imageUrl": "이미지URL"/);
});
