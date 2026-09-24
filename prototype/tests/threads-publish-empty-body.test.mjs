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
  assert.match(fn, /throw new Error\(`Threads 컨테이너 생성 실패: \$\{lastText\}`\);/);
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
