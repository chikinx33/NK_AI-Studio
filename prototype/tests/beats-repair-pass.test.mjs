import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");
const toUrl = (rel) => "file:///" + path.resolve(process.cwd(), rel).replace(/\\/g, "/");

/**
 * ★타임라인(beats)이 늘 비어 있던 이유.
 *
 * beats 는 AI 가 채우는 값인데, 프롬프트에 규칙만 적어 두고 코드는 결과를 확인하지 않았다.
 * 모델이 빼먹으면 그냥 빈 채로 저장됐고, 다시 생성해도 채워질지는 운이었다.
 * 빠지면 스틸컷이 무브의 "끝 상태"로 만들어져, 가려졌다가 드러나는 연출이 통째로 사라진다.
 *
 * 이제 코드가 확인한다 — 카메라가 움직이는데 beats 가 없으면 그 샷만 짚어 한 번 더 요청한다.
 */

test("★카메라가 움직이는데 시간표가 없는 샷을 찾아낸다", async () => {
  const mod = await import(toUrl("prototype/functions/api/scenario/shots/decomposer.js"));
  const shots = [
    { id: "1.1", cameraMove: "static", beats: null },                    // 정적 — 없는 게 맞다
    { id: "1.2", cameraMove: "tilt", beats: null },                      // ← 빠졌다
    { id: "1.3", cameraMove: "pan", beats: [{ at: 0, what: "a" }] },     // 한 줄뿐 — 시간표가 아니다
    { id: "1.4", cameraMove: "push-in", beats: [{ at: 0, what: "a" }, { at: 2, what: "b" }] },
  ];
  const missing = mod.shotsMissingBeats(shots);
  assert.deepEqual(missing.map((s) => s.id), ["1.2", "1.3"]);
});

test("★보정 요청은 빠진 샷만 짚고 나머지는 건드리지 말라고 한다", async () => {
  const mod = await import(toUrl("prototype/functions/api/scenario/shots/decomposer.js"));
  const ko = mod.buildBeatsRepairPrompt([{ id: "2.1" }, { id: "2.3" }], "ko");
  assert.match(ko, /\[2\.1, 2\.3\]/);
  assert.match(ko, /beats\[0\]\.at 은 반드시 0/);
  assert.match(ko, /다른 것은 하나도 바꾸지 마라/);
  // 왜 필요한지도 모델에게 말해 준다(규칙보다 이유가 잘 먹힌다).
  assert.match(ko, /스틸컷이 무브의 끝 상태로 만들어져/);

  const en = mod.buildBeatsRepairPrompt([{ id: "2.1" }], "en");
  assert.match(en, /\[2\.1\]/);
  assert.match(en, /beats\[0\]\.at must be 0/);
  assert.match(en, /Do not change anything else/);
});

test("★분해 직후 한 번만 다시 요청한다", () => {
  const src = read("prototype/functions/api/scenario/shots/index.js");
  const fn = src.slice(src.indexOf("export async function decomposeScene"), src.indexOf("export async function decomposeScenes"));
  assert.match(fn, /const missing = shotsMissingBeats\(shots\);/);
  assert.match(fn, /if \(missing\.length\) \{/);
  // 원래 프롬프트에 보정 지시를 덧붙여 다시 부른다.
  assert.match(fn, /buildBeatsRepairPrompt\(missing, lang\)/);
  // 재시도는 1회 — 반복 호출로 비용·지연이 불어나지 않게.
  assert.equal((fn.match(/buildBeatsRepairPrompt/g) || []).length, 1);
  // 더 나빠지지 않을 때만 채택한다.
  assert.match(fn, /shotsMissingBeats\(repaired\)\.length < missing\.length/);
  // 보정이 실패해도 원래 결과로 진행한다(생성이 멈추면 안 된다).
  assert.match(fn, /catch \(_\) \{ \/\* 보정 실패는 조용히 넘긴다/);
});

test("★정적인 샷에는 시간표를 요구하지 않는다", async () => {
  const mod = await import(toUrl("prototype/functions/api/scenario/shots/decomposer.js"));
  // 처음부터 끝까지 한 상태인 컷은 시간표가 없는 게 맞다 — 괜히 재요청하면 비용만 든다.
  assert.deepEqual(mod.shotsMissingBeats([{ id: "3.1", cameraMove: "static" }]), []);
  assert.deepEqual(mod.shotsMissingBeats([{ id: "3.2" }]), []);
});
