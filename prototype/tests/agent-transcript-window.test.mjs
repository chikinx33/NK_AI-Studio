// 코어가 "C안 캡션이 대화에 안 남아 있다"고 한 원인(2026-09-24): 트랜스크립트가 최근 12턴을 잡음까지 세어 잘랐다.
// 진행 안내("🔎 조회 중", "🛠️ 시작했어요", "🔐 승인 필요")는 빼고, 내용 있는 발언을 24턴·900자까지 남긴다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "../..");
const esbuild = createRequire(import.meta.url)("../../ai-company-app/node_modules/esbuild");

function loadTranscript() {
  const src = fs.readFileSync(path.join(root, "prototype/functions/api/agent/_shared.ts"), "utf8");
  const start = src.indexOf("/** 진행 안내성 잡음(");
  const end = src.indexOf("// ── 채팅에서 지목한 항목(참조)");
  const slice = src.slice(start, end);
  const js = esbuild.transformSync(slice, { loader: "ts", format: "cjs" }).code;
  const sandbox = { exports: {}, module: { exports: {} } };
  vm.runInNewContext(js, sandbox);
  // esbuild cjs 는 module.exports 로 내보낸다(exports 객체가 아니라).
  return { ...sandbox.exports, ...sandbox.module.exports };
}

test("트랜스크립트는 진행 안내 잡음을 빼고 내용 있는 발언을 더 길게 남긴다", () => {
  const { buildTranscript, TRANSCRIPT_NOISE, TRANSCRIPT_MAX_TURNS } = loadTranscript();
  assert.equal(TRANSCRIPT_MAX_TURNS, 24);
  const noise = ["🔎 jobs_status 조회 중이에요…", "🛠️ publish 작업을 시작했어요. 잠시 기다려주세요…", "🔐 이 작업은 승인이 필요해요. 오른쪽 **승인 패널**에서 승인하면 그때 실제로 실행할게요."];
  for (const n of noise) assert.ok(TRANSCRIPT_NOISE.test(n), n);
  assert.ok(!TRANSCRIPT_NOISE.test("이렇게 세 가지 뽑아봤어요! A안 … C안 …"));
  const msgs = [];
  msgs.push({ role: "agent", name: "리치", text: "이렇게 세 가지 뽑아봤어요!\nA안 …\nB안 …\nC안 (짧고 여운) 올해 가장 크고 밝은 달, 좋은 사람들과 나눠요" });
  for (let i = 0; i < 14; i++) msgs.push({ role: "agent", name: "리치", text: i % 3 === 0 ? "🛠️ publish 작업을 시작했어요. 잠시 기다려주세요…" : i % 3 === 1 ? "🔐 이 작업은 승인이 필요해요. 오른쪽 **승인 패널**에서 승인하면 그때 실제로 실행할게요." : "🔎 jobs_status 조회 중이에요…" });
  msgs.push({ role: "user", text: "c 안으로 가자." });
  const t = buildTranscript(msgs, "엔케");
  assert.ok(t.includes("C안 (짧고 여운)"), "세 가지 안이 잡음에 밀려 사라지면 안 된다");
  assert.ok(!t.includes("🛠️ publish 작업을 시작했어요"));
  assert.ok(t.endsWith("엔케: c 안으로 가자."));
});

test("긴 발언은 앞·뒤를 남기고 가운데만 줄인다", () => {
  const { buildTranscript } = loadTranscript();
  const long = "가".repeat(2000);
  const t = buildTranscript([{ role: "agent", name: "잉크", text: long }], "엔케");
  assert.ok(t.includes("…(중략)…"));
  assert.ok(t.length < 1000);
});
