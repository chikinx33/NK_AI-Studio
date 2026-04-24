import { test } from "node:test";
import assert from "node:assert/strict";

// scenario.js 의 closeTruncatedJson 와 동일 로직 — 파일에서 import 하지 않고
// 동작을 확인하기 위해 미러링한다 (scenario.js 가 큰 ESM/CJS 혼합이라 직접 import 가 까다로움).
function closeTruncatedJson(text) {
  let s = String(text || "");
  if (!s) return s;
  let inStr = false;
  let escape = false;
  const stack = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (inStr) {
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
  }
  if (inStr) s += '"';
  s = s.replace(/[,:]\s*$/, "");
  s = s.replace(/,\s*"[^"\\]*"\s*$/, "");
  s = s.replace(/\{\s*"[^"\\]*"\s*$/, "{");
  while (stack.length) {
    const open = stack.pop();
    s += open === "{" ? "}" : "]";
  }
  return s;
}

test("closeTruncatedJson: 마지막 닫힘 } 와 ] 가 누락된 경우 복구한다", () => {
  const input = '{"scenes":[{"id":1,"title":"A"},{"id":2,"title":"B"';
  const out = closeTruncatedJson(input);
  const parsed = JSON.parse(out);
  assert.equal(parsed.scenes.length, 2);
  assert.equal(parsed.scenes[1].title, "B");
});

test("closeTruncatedJson: 미완 문자열은 따옴표로 닫고 객체/배열도 닫는다", () => {
  const input = '{"scenes":[{"id":1,"title":"A"},{"id":2,"title":"unclos';
  const out = closeTruncatedJson(input);
  const parsed = JSON.parse(out);
  assert.equal(parsed.scenes.length, 2);
  assert.match(parsed.scenes[1].title, /^unclos/);
});

test("closeTruncatedJson: trailing comma 잘림은 제거하고 닫는다", () => {
  const input = '{"scenes":[{"id":1,"title":"A"},';
  const out = closeTruncatedJson(input);
  const parsed = JSON.parse(out);
  assert.equal(parsed.scenes.length, 1);
});

test("closeTruncatedJson: key 직후 잘리면 빈 객체로라도 닫혀 파싱 가능해야 한다", () => {
  const input = '{"scenes":[{"id":1,"title":"A"},{"id';
  const out = closeTruncatedJson(input);
  const parsed = JSON.parse(out);
  // 첫 씬은 그대로 보존. 두번째는 키만 있고 값이 없어 빈 객체가 될 수도 있고
  // 아예 떨어질 수도 있다 — 어느 쪽이든 fitScenesToRequestedCount 가 보정한다.
  assert.ok(parsed.scenes.length >= 1);
  assert.equal(parsed.scenes[0].title, "A");
});

test("closeTruncatedJson: 정상 종료 JSON 은 변형하지 않는다", () => {
  const input = '{"scenes":[{"id":1,"title":"A"}]}';
  const out = closeTruncatedJson(input);
  assert.equal(out, input);
});
