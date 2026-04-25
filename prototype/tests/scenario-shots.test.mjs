import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SHOT_TYPES,
  CAMERA_MOVES,
  SHOT_TYPE_KEYS,
  CAMERA_MOVE_KEYS,
  buildVocabPromptKo,
  buildVocabPromptEn,
  normalizeShotType,
  normalizeCameraMove,
} from "../functions/api/scenario/shots/vocab.js";

import {
  buildShotPromptKo,
  buildShotPromptEn,
  buildShotUserPromptKo,
  buildShotUserPromptEn,
  parseShotResponse,
  reconcileDurations,
  fallbackSingleShot,
} from "../functions/api/scenario/shots/decomposer.js";

// ─── vocab ─────────────────────────────────────────────────────────────

test("vocab: 정확히 12개 shotType, 10개 cameraMove", () => {
  assert.equal(SHOT_TYPE_KEYS.length, 12);
  assert.equal(CAMERA_MOVE_KEYS.length, 10);
});

test("vocab: 모든 shotType 에 ko/en/hint 가 있다", () => {
  for (const k of SHOT_TYPE_KEYS) {
    const v = SHOT_TYPES[k];
    assert.ok(v.ko && v.en && v.hint, `${k} 누락`);
  }
});

test("vocab: 모든 cameraMove 에 ko/en/hint 가 있다", () => {
  for (const k of CAMERA_MOVE_KEYS) {
    const v = CAMERA_MOVES[k];
    assert.ok(v.ko && v.en && v.hint, `${k} 누락`);
  }
});

test("vocab: ko/en 프롬프트에 모든 어휘 키가 포함된다", () => {
  const ko = buildVocabPromptKo();
  const en = buildVocabPromptEn();
  for (const k of SHOT_TYPE_KEYS) {
    assert.ok(ko.includes(k), `KO 누락: ${k}`);
    assert.ok(en.includes(k), `EN 누락: ${k}`);
  }
  for (const k of CAMERA_MOVE_KEYS) {
    assert.ok(ko.includes(k), `KO 누락: ${k}`);
    assert.ok(en.includes(k), `EN 누락: ${k}`);
  }
});

test("vocab: normalizeShotType — 케이스/하이픈/공백 흡수", () => {
  assert.equal(normalizeShotType("cu"), "CU");
  assert.equal(normalizeShotType(" CU "), "CU");
  assert.equal(normalizeShotType("two-shot"), "TWO_SHOT");
  assert.equal(normalizeShotType("two shot"), "TWO_SHOT");
  assert.equal(normalizeShotType("UNKNOWN"), null);
  assert.equal(normalizeShotType(""), null);
  assert.equal(normalizeShotType(null), null);
});

test("vocab: normalizeCameraMove — 케이스/하이픈/공백 흡수", () => {
  assert.equal(normalizeCameraMove("STATIC"), "static");
  assert.equal(normalizeCameraMove("push-in"), "push_in");
  assert.equal(normalizeCameraMove("Pull Out"), "pull_out");
  assert.equal(normalizeCameraMove("orbit"), null);
  assert.equal(normalizeCameraMove(""), null);
});

// ─── prompts ───────────────────────────────────────────────────────────

test("prompt: 시스템 프롬프트에 핵심 룰들이 포함", () => {
  const ko = buildShotPromptKo();
  assert.ok(ko.includes("1~5 샷"));
  assert.ok(ko.includes("≤ 6초"));
  assert.ok(ko.includes("±20%"));
  assert.ok(ko.includes("CU"));
  assert.ok(ko.includes("static"));

  const en = buildShotPromptEn();
  assert.ok(en.includes("1-5 shots"));
  assert.ok(en.includes("≤ 6 seconds"));
  assert.ok(en.includes("±20%"));
});

test("prompt: user 프롬프트는 scene 의 핵심 필드를 포함", () => {
  const scene = {
    id: 3,
    estSec: 4,
    sceneIntent: "관객이 결단을 느낀다",
    sceneLocation: "성벽 위",
    visual: "전사가 칼을 뽑는다",
    narration: "이제 시작이다",
    dialogue: [{ speaker: "@hero", line: "간다." }],
  };
  const ko = buildShotUserPromptKo(scene);
  assert.ok(ko.includes("[scene id] 3"));
  assert.ok(ko.includes("4초"));
  assert.ok(ko.includes("결단을 느낀다"));
  assert.ok(ko.includes("성벽 위"));
  assert.ok(ko.includes("칼을 뽑는다"));
  assert.ok(ko.includes("이제 시작이다"));
  assert.ok(ko.includes("@hero"));
  assert.ok(ko.includes('"3.1"'));

  const en = buildShotUserPromptEn(scene);
  assert.ok(en.includes("[scene id] 3"));
  assert.ok(en.includes("4s"));
});

// ─── parser ────────────────────────────────────────────────────────────

test("parser: 정상 JSON → 구조화된 shots", () => {
  const text = JSON.stringify({
    shots: [
      { id: "3.1", duration: 1, shotType: "CU", cameraMove: "static", composition: "전사 얼굴", action: "고개 듦" },
      { id: "3.2", duration: 1, shotType: "INSERT", cameraMove: "tilt", composition: "손이 칼자루", action: "손가락 감쌈" },
      { id: "3.3", duration: 2, shotType: "MS", cameraMove: "track", composition: "뒷모습 실루엣", action: "칼을 뽑음" },
    ],
  });
  const out = parseShotResponse(text, { id: 3 });
  assert.equal(out.length, 3);
  assert.equal(out[0].shotType, "CU");
  assert.equal(out[2].cameraMove, "track");
});

test("parser: 코드펜스 ```json``` 으로 둘러싸인 응답도 복구", () => {
  const text = "```json\n" + JSON.stringify({
    shots: [{ id: "1.1", duration: 2, shotType: "MS", cameraMove: "static", composition: "X", action: "Y" }],
  }) + "\n```";
  const out = parseShotResponse(text, { id: 1 });
  assert.ok(out);
  assert.equal(out.length, 1);
});

test("parser: 알 수 없는 shotType/cameraMove 는 안전 기본값으로 정규화", () => {
  const text = JSON.stringify({
    shots: [{ id: "1.1", duration: 2, shotType: "DRONE_SHOT", cameraMove: "orbit", composition: "X", action: "Y" }],
  });
  const out = parseShotResponse(text, { id: 1 });
  assert.equal(out[0].shotType, "MS");      // fallback
  assert.equal(out[0].cameraMove, "static"); // fallback
});

test("parser: duration 이 6초를 넘으면 6초로 캡", () => {
  const text = JSON.stringify({
    shots: [{ id: "1.1", duration: 12, shotType: "CU", cameraMove: "static", composition: "X", action: "Y" }],
  });
  const out = parseShotResponse(text, { id: 1 });
  assert.equal(out[0].duration, 6);
});

test("parser: duration 이 0 이하면 최소값 0.5 로 보정", () => {
  const text = JSON.stringify({
    shots: [{ id: "1.1", duration: 0, shotType: "CU", cameraMove: "static", composition: "X", action: "Y" }],
  });
  const out = parseShotResponse(text, { id: 1 });
  assert.equal(out[0].duration, 0.5);
});

test("parser: composition + action 둘 다 비면 그 샷은 버린다", () => {
  const text = JSON.stringify({
    shots: [
      { id: "1.1", duration: 1, shotType: "CU", cameraMove: "static", composition: "", action: "" },
      { id: "1.2", duration: 1, shotType: "MS", cameraMove: "static", composition: "real", action: "real" },
    ],
  });
  const out = parseShotResponse(text, { id: 1 });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "1.2");
});

test("parser: 6개 이상이면 5개로 잘림", () => {
  const text = JSON.stringify({
    shots: Array.from({ length: 7 }, (_, i) => ({
      id: `1.${i + 1}`, duration: 1, shotType: "CU", cameraMove: "static", composition: `c${i}`, action: `a${i}`,
    })),
  });
  const out = parseShotResponse(text, { id: 1 });
  assert.equal(out.length, 5);
});

test("parser: 망가진 JSON → null", () => {
  assert.equal(parseShotResponse("not json at all", { id: 1 }), null);
  assert.equal(parseShotResponse("", { id: 1 }), null);
  assert.equal(parseShotResponse(null, { id: 1 }), null);
});

test("parser: shots 키가 없으면 null", () => {
  const text = JSON.stringify({ other: 1 });
  assert.equal(parseShotResponse(text, { id: 1 }), null);
});

test("parser: id 누락 시 sceneId.idx 로 자동 생성", () => {
  const text = JSON.stringify({
    shots: [
      { duration: 1, shotType: "CU", cameraMove: "static", composition: "x", action: "y" },
      { duration: 1, shotType: "MS", cameraMove: "static", composition: "x", action: "y" },
    ],
  });
  const out = parseShotResponse(text, { id: 7 });
  assert.equal(out[0].id, "7.1");
  assert.equal(out[1].id, "7.2");
});

// ─── reconcileDurations ────────────────────────────────────────────────

test("reconcile: 합이 estSec 와 ±20% 안이면 그대로", () => {
  const shots = [
    { id: "1.1", duration: 1, shotType: "CU", cameraMove: "static", composition: "", action: "" },
    { id: "1.2", duration: 2, shotType: "MS", cameraMove: "static", composition: "", action: "" },
  ];
  const out = reconcileDurations(shots, { estSec: 3 });
  assert.deepEqual(out.map((s) => s.duration), [1, 2]);
});

test("reconcile: 합이 너무 크면 비례 축소", () => {
  const shots = [
    { id: "1.1", duration: 4, shotType: "CU", cameraMove: "static", composition: "", action: "" },
    { id: "1.2", duration: 4, shotType: "MS", cameraMove: "static", composition: "", action: "" },
  ];
  const out = reconcileDurations(shots, { estSec: 4 });
  const sum = out.reduce((a, s) => a + s.duration, 0);
  assert.ok(Math.abs(sum - 4) < 0.5, `sum=${sum} 가 4 근처여야 함`);
});

test("reconcile: 합이 너무 작으면 비례 확장", () => {
  const shots = [
    { id: "1.1", duration: 0.5, shotType: "CU", cameraMove: "static", composition: "", action: "" },
    { id: "1.2", duration: 0.5, shotType: "MS", cameraMove: "static", composition: "", action: "" },
  ];
  const out = reconcileDurations(shots, { estSec: 4 });
  const sum = out.reduce((a, s) => a + s.duration, 0);
  assert.ok(Math.abs(sum - 4) < 0.5);
});

test("reconcile: 빈 입력은 그대로", () => {
  assert.deepEqual(reconcileDurations([], { estSec: 4 }), []);
});

// ─── fallbackSingleShot ────────────────────────────────────────────────

test("fallback: visual 을 그대로 1개 shot 으로 wrap", () => {
  const scene = { id: 5, estSec: 3, visual: "전사가 검을 든다." };
  const out = fallbackSingleShot(scene);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "5.1");
  assert.equal(out[0].duration, 3);
  assert.equal(out[0].shotType, "MS");
  assert.equal(out[0].cameraMove, "static");
  assert.match(out[0].action, /검을/);
});

test("fallback: estSec 이 6 초과면 6 으로 캡", () => {
  const scene = { id: 5, estSec: 12, visual: "long" };
  const out = fallbackSingleShot(scene);
  assert.equal(out[0].duration, 6);
});

test("fallback: visual 비면 기본 문구", () => {
  const scene = { id: 5, estSec: 2 };
  const out = fallbackSingleShot(scene);
  assert.equal(out.length, 1);
  assert.ok(out[0].action);
  assert.ok(out[0].composition);
});
