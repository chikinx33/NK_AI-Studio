// prototype/tests/threads-publish-empty-body.test.mjs
// 스레드 발행이 "Unexpected end of JSON input" 으로 죽던 문제(2026-09-24):
// 메타가 일시 오류 때 본문을 비워 보내면 res.json() 이 터져 HTTP 상태도 못 보고 실패했다.
// → Threads 헬퍼는 모두 안전 파싱(readThreadsJson)을 쓰고, 빈 응답·5xx 는 재시도한다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

test("Threads 헬퍼 구간에는 날것의 res.json() 이 없다", async () => {
  const src = await read("prototype/functions/api/sns/publish.ts");
  const start = src.indexOf("// ── Threads(메타) 헬퍼");
  const end = src.indexOf("export const onRequestPost");
  assert.ok(start > 0 && end > start);
  const block = src.slice(start, end);
  assert.doesNotMatch(block, /await\s+res\.json\(\)/);
  assert.doesNotMatch(block, /await\s+r\.json\(\)/);
  assert.match(block, /async function readThreadsJson\(res: Response, what: string\)/);
  assert.match(block, /return \{ __empty: true, __status: res\.status, __raw: text\.slice\(0, 200\) \};/);
});

test("컨테이너 생성은 빈 응답·5xx 를 3회까지 재시도하고, 오류 문구에 HTTP 상태를 남긴다", async () => {
  const src = await read("prototype/functions/api/sns/publish.ts");
  const fn = src.slice(src.indexOf("async function createThreadsContainer"), src.indexOf("async function waitForThreadsContainer"));
  assert.match(fn, /for \(let attempt = 0; attempt < 3; attempt\+\+\)/);
  assert.match(fn, /if \(!isThreadsTransient\(data, res\.status\)\) break;/);
  assert.match(fn, /const err = new Error\(`Threads 컨테이너 생성 실패: \$\{lastText\}\$\{diag \? ` \[진단\] \$\{diag\}` : ""\}`\);\s*\(err as any\)\.opaque = opaque;\s*throw err;/);
  assert.match(src, /메타 서버가 HTTP \$\{status\} 로 빈 응답을 보냈어요/);
  assert.match(src, /if \(data\?\.__empty\) return true;\s*if \(status >= 500\) return true;/);
});

test("상태 대기는 빈 응답을 다음 폴링으로 넘기고, 게시는 빈 응답을 재시도한다", async () => {
  const src = await read("prototype/functions/api/sns/publish.ts");
  const wait = src.slice(src.indexOf("async function waitForThreadsContainer"), src.indexOf("async function publishThreadsContainer"));
  assert.match(wait, /const d = await readThreadsJson\(r, "컨테이너 상태 조회"\);/);
  const pub = src.slice(src.indexOf("async function publishThreadsContainer"), src.indexOf("export const onRequestPost"));
  assert.match(pub, /if \(data\.__empty\) continue;/);
  assert.match(pub, /lastMsg = threadsErrorText\(data, res\.status\);/);
});

test("토큰 갱신도 빈 본문을 안전하게 읽는다", async () => {
  const src = await read("prototype/functions/api/_shared/threads-token.ts");
  const fn = src.slice(src.indexOf("export async function refreshThreadsToken"), src.indexOf("export async function getThreadsToken"));
  assert.doesNotMatch(fn, /await res\.json\(\)/);
  assert.match(fn, /const raw = await res\.text\(\);/);
  assert.match(fn, /HTTP \$\{res\.status\}/);
});

test("빈 500 이면 실패 순간에 계정 조회(/me)·미디어 받기(HTTP·형식·크기)를 진단해 문구에 붙인다", async () => {
  const src = await read("prototype/functions/api/sns/publish.ts");
  assert.match(src, /async function diagnoseThreadsFailure\(accessToken: string, params: Record<string, string>\): Promise<string>/);
  assert.match(src, /\$\{THREADS_API\}\/me\?\$\{new URLSearchParams\(\{ fields: "id,username", access_token: accessToken \}\)/);
  assert.match(src, /await fetch\(mediaUrl, \{ method: "HEAD" \}\)/);
  assert.match(src, /스레드가 받지 않는 형식\(이미지는 JPEG\/PNG, 영상은 MP4\/MOV\)/);
  const fn = src.slice(src.indexOf("async function createThreadsContainer"), src.indexOf("async function waitForThreadsContainer"));
  assert.match(fn, /const diag = opaque \? await diagnoseThreadsFailure\(accessToken, params\) : "";/);
  assert.match(fn, /\[진단\] \$\{diag\}/);
});

test("상위 컨테이너는 빈 500 이면 답글설정 없이 → 본문 정리해서 다시 시도하고, 뺀 내용을 note 로 알린다(2026-09-25)", async () => {
  const src = await read("prototype/functions/api/sns/publish.ts");
  const branch = src.slice(src.indexOf('if (platform === "threads") {'), src.indexOf('if (platform === "x") {'));
  assert.match(branch, /async function createTopLevel\(params: Record<string, string>\): Promise<string>/);
  assert.match(branch, /if \(!e\?\.opaque\) throw e;/);
  assert.match(branch, /const \{ reply_control: _rc, \.\.\.rest \} = params;/);
  assert.match(branch, /sanitizeThreadsText\(params\.text, 480, true\)/);
  // 상위 컨테이너 4곳(단일 캐러셀·캐러셀 상위·단일 미디어·텍스트)은 모두 사다리를 탄다
  assert.equal((branch.match(/await createTopLevel\(/g) || []).length, 4);
  // 자식 컨테이너는 그대로 직접 생성(본문·답글설정이 없다)
  assert.match(branch, /const childId = await createThreadsContainer\(\{ threadsUserId, accessToken, params: childParams \}\);/);
  assert.match(branch, /const text = sanitizeThreadsText\(caption, 500\);/);
  assert.doesNotMatch(branch, /const text = caption\.slice\(0, 500\);/, "UTF-16 슬라이스 코드는 사라졌다(주석 언급은 허용)");
  assert.match(branch, /\.\.\.\(fallbackNotes\.length \? \{ note: fallbackNotes\.join\(" "\) \} : \{\}\)/);
  // 빈 500 실패는 opaque 표시
  assert.match(src, /\(err as any\)\.opaque = opaque;/);
  // 진단에 본문 길이·답글설정·자식 수
  assert.match(src, /shape\.push\(`본문 \$\{Array\.from\(params\.text\)\.length\}자`\)/);
  const agent = await read("prototype/functions/api/agent/_shared.ts");
  assert.match(agent, /if \(r\.note\) notices\.push\(`\$\{platform\}: \$\{String\(r\.note\)\.slice\(0, 200\)\}`\);/);
});

test("sanitizeThreadsText 는 코드포인트 단위로 자르고 홀로 남은 서로게이트·제어문자를 뺀다", async () => {
  const src = await read("prototype/functions/api/sns/publish.ts");
  const start = src.indexOf("function sanitizeThreadsText");
  // TS 타입 표기를 걷어내고 실제 함수로 실행한다
  const fnSrc = src.slice(start, src.indexOf("\n}\n", start) + 3)
    .replace("(input: string, maxChars: number, strict = false): string", "(input, maxChars, strict = false)");
  const sanitizeThreadsText = new Function(`${fnSrc}; return sanitizeThreadsText;`)();
  const emoji = "가".repeat(499) + "😀";
  assert.equal(sanitizeThreadsText(emoji, 500), emoji, "500 코드포인트면 이모지를 반쪽으로 자르지 않는다");
  assert.equal(sanitizeThreadsText("가".repeat(500) + "😀", 500), "가".repeat(500));
  assert.equal(sanitizeThreadsText("a\uD83Db", 500), "ab", "홀로 남은 서로게이트 제거");
  assert.equal(sanitizeThreadsText("a\u0007b\nc", 500), "ab\nc", "제어문자 제거·개행 유지");
  assert.equal(sanitizeThreadsText("a\u200Db\uFE0F", 500, true), "ab", "strict 는 제로폭·변형 선택자 제거");
  assert.equal(sanitizeThreadsText("a\n\n\n\nb", 500), "a\n\nb");
});
