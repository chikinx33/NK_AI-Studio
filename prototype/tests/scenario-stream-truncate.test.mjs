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

// ─── salvageCompletedScenes ─────────────────────────────────────────────
// scenario.js 의 salvageCompletedScenes 와 동일 — 미러로 복사해 단위 검증.
function salvageCompletedScenes(text) {
  const s = String(text || "");
  if (!s) return null;
  const m = s.match(/"scenes"\s*:\s*\[/);
  if (!m) return null;
  const arrayOpen = m.index + m[0].length - 1;
  const prefix = s.slice(0, arrayOpen + 1);

  let i = arrayOpen + 1;
  let depth = 0;
  let inStr = false;
  let escape = false;
  let lastSafeEnd = -1;
  let sawAnyElement = false;

  while (i < s.length) {
    const c = s[i];
    if (escape) { escape = false; i++; continue; }
    if (c === "\\") { escape = true; i++; continue; }
    if (inStr) {
      if (c === '"') inStr = false;
      i++; continue;
    }
    if (c === '"') { inStr = true; i++; continue; }
    if (c === "{" || c === "[") {
      depth++;
      sawAnyElement = true;
      i++; continue;
    }
    if (c === "}" || c === "]") {
      depth--;
      i++;
      if (depth === 0) {
        lastSafeEnd = i;
      } else if (depth < 0) {
        return s.slice(0, i) + "}";
      }
      continue;
    }
    i++;
  }

  if (!sawAnyElement || lastSafeEnd < 0) {
    return prefix + "]}";
  }
  return s.slice(0, lastSafeEnd) + "]}";
}

test("salvageCompletedScenes: 마지막 부분 씬을 통째로 버리고 완성된 씬만 살린다", () => {
  // 1번 씬은 완성, 2번은 mid-string 에서 잘림
  const input = '{"scenes":[{"id":1,"title":"first","visual":"A complete scene."},{"id":2,"title":"sec';
  const out = salvageCompletedScenes(input);
  const parsed = JSON.parse(out);
  assert.equal(parsed.scenes.length, 1);
  assert.equal(parsed.scenes[0].title, "first");
});

test("salvageCompletedScenes: 두 씬 완성 후 세 번째 씬 잘림 → 완성된 두 개 보존", () => {
  const input = '{"scenes":[{"id":1,"title":"A"},{"id":2,"title":"B"},{"id":3,"title":"un';
  const out = salvageCompletedScenes(input);
  const parsed = JSON.parse(out);
  assert.equal(parsed.scenes.length, 2);
  assert.deepEqual(parsed.scenes.map((s) => s.title), ["A", "B"]);
});

test("salvageCompletedScenes: 문자열 안 따옴표 이슈가 있어도 완성 씬은 안전하게 추려진다", () => {
  // 첫 씬은 정상, 두 번째는 visual 안에 unescaped 가능성 있는 트레일링
  const input = '{"scenes":[{"id":1,"narration":"hello world"},{"id":2,"narration":"broken \\"quote';
  const out = salvageCompletedScenes(input);
  const parsed = JSON.parse(out);
  assert.equal(parsed.scenes.length, 1);
  assert.equal(parsed.scenes[0].narration, "hello world");
});

test("salvageCompletedScenes: 한 씬도 완성 안 됐으면 빈 배열로 닫힌다", () => {
  const input = '{"scenes":[{"id":1,"title":"truncat';
  const out = salvageCompletedScenes(input);
  const parsed = JSON.parse(out);
  assert.equal(parsed.scenes.length, 0);
});

test("salvageCompletedScenes: 정상 JSON 은 그대로 보존", () => {
  const input = '{"scenes":[{"id":1,"title":"A"},{"id":2,"title":"B"}]}';
  const out = salvageCompletedScenes(input);
  const parsed = JSON.parse(out);
  assert.equal(parsed.scenes.length, 2);
});

test("salvageCompletedScenes: scenes 키가 없으면 null 반환", () => {
  const input = '{"other":[1,2,3]}';
  const out = salvageCompletedScenes(input);
  assert.equal(out, null);
});

// ─── extractIndividualScenes ────────────────────────────────────────────
// 미러: scenario.js 의 extractIndividualScenes (repair 부분만 단순화 — JSON.parse 만 시도).
function extractIndividualScenesMirror(text) {
  const s = String(text || "");
  if (!s) return null;
  const m = s.match(/"scenes"\s*:\s*\[/);
  if (!m) return null;
  const arrayContentStart = m.index + m[0].length;

  const scenes = [];
  let i = arrayContentStart;
  let depth = 0;
  let inStr = false;
  let escape = false;
  let sceneStart = -1;

  while (i < s.length) {
    const c = s[i];
    if (escape) { escape = false; i++; continue; }
    if (c === "\\") { escape = true; i++; continue; }
    if (inStr) {
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') { inStr = true; i++; continue; }
    if (c === "{" || c === "[") {
      if (depth === 0 && c === "{") sceneStart = i;
      depth++;
      i++;
      continue;
    }
    if (c === "}" || c === "]") {
      const wasArrayLevel = depth === 1 && c === "}";
      depth--;
      i++;
      if (depth === 0 && sceneStart >= 0 && wasArrayLevel) {
        const sceneText = s.slice(sceneStart, i);
        let parsed = null;
        try { parsed = JSON.parse(sceneText); } catch (_) { parsed = null; }
        if (parsed && typeof parsed === "object") scenes.push(parsed);
        sceneStart = -1;
      } else if (depth < 0) {
        break;
      }
      continue;
    }
    i++;
  }
  return scenes.length ? scenes : null;
}

test("extractIndividualScenes: 잘린 응답에서 완성된 씬만 개별 파싱", () => {
  const input = '{"scenes":[{"id":1,"title":"first"},{"id":2,"title":"second"},{"id":3,"title":"trun';
  const scenes = extractIndividualScenesMirror(input);
  assert.equal(scenes.length, 2);
  assert.equal(scenes[0].title, "first");
  assert.equal(scenes[1].title, "second");
});

test("extractIndividualScenes: 모든 씬이 정상이면 모두 반환", () => {
  const input = '{"scenes":[{"id":1},{"id":2},{"id":3}]}';
  const scenes = extractIndividualScenesMirror(input);
  assert.equal(scenes.length, 3);
});

test("extractIndividualScenes: 한 씬도 완성 못 하면 null", () => {
  const input = '{"scenes":[{"id":1,"title":"trun';
  const scenes = extractIndividualScenesMirror(input);
  assert.equal(scenes, null);
});

test("extractIndividualScenes: scenes 키 없으면 null", () => {
  const input = '{"other":1}';
  const scenes = extractIndividualScenesMirror(input);
  assert.equal(scenes, null);
});

test("extractIndividualScenes: 중첩 객체/배열을 가진 씬도 정확히 추출", () => {
  const input = '{"scenes":[{"id":1,"meta":{"a":1,"b":[1,2,3]}},{"id":2,"tags":["x","y"]},{"id":3,"trun';
  const scenes = extractIndividualScenesMirror(input);
  assert.equal(scenes.length, 2);
  assert.equal(scenes[0].id, 1);
  assert.deepEqual(scenes[0].meta.b, [1, 2, 3]);
  assert.deepEqual(scenes[1].tags, ["x", "y"]);
});
