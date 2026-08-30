import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");
const imagen = () => read("prototype/functions/api/imagen.ts");

/**
 * 레퍼런스 ↔ 이미지 바인딩은 프로바이더마다 방법이 다르다.
 *
 * Gemini: 이미지 바로 앞에 라벨 텍스트를 끼워 넣을 수 있다(buildGeminiParts).
 * OpenAI(images/edits): image[] 순서대로 올라갈 뿐이라 그런 자리가 없다. 그래서
 *   "One reference image is a CONTINUITY reference..." 같은 문장이 어떤 이미지를
 *   가리키는지 모델이 알 수 없었다. 실제 전송 순서대로 번호를 매긴 목록을 붙여 묶어 준다.
 */

test("★OpenAI 경로는 이미지 순서를 프롬프트에 명시한다", () => {
  const src = imagen();
  assert.match(src, /function buildOpenAIReferenceManifest\(/);
  assert.match(src, /The input images are provided in this exact order:/);

  // 전송 순서(대화 이력 → 레퍼런스)와 같은 순서로 번호를 매긴다.
  const fn = src.slice(
    src.indexOf("function buildOpenAIReferenceManifest("),
    src.indexOf("async function callOpenAIImage(opts: {")
  );
  const historyAt = fn.indexOf("for (let i = 0; i < conversationCount; i++)");
  const refsAt = fn.indexOf("referenceImages.forEach(");
  assert.ok(historyAt > -1 && refsAt > historyAt, "대화 이력이 먼저 올라가므로 번호도 먼저다");
});

test("★역할별로 다른 지시를 준다 (배경·소품·연속성·캐릭터)", () => {
  const src = imagen();
  const fn = src.slice(
    src.indexOf("function buildOpenAIReferenceManifest("),
    src.indexOf("async function callOpenAIImage(opts: {")
  );
  assert.match(fn, /referenceKind === "continuity"[\s\S]{0,240}NOT its camera, framing or composition/);
  assert.match(fn, /referenceKind === "prop"[\s\S]{0,260}place and scale it as this shot requires/);
  assert.match(fn, /referenceKind === "environment"[\s\S]{0,300}keep its layout, architecture, materials, colors and lighting/);
  assert.match(fn, /the registered character reference for/);
});

test("★매니페스트가 실제 호출 프롬프트에 붙는다", () => {
  const src = imagen();
  assert.match(src, /const promptForCall = manifest \? `\$\{opts\.prompt\}\\n\$\{manifest\}` : opts\.prompt;/);
  // edits·generations 양쪽 모두 이 프롬프트를 쓴다.
  assert.match(src, /buildOpenAIEditsRequest\(opts\.model, promptForCall/);
  assert.match(src, /buildOpenAIGenerationsRequest\(opts\.model, promptForCall/);
  // 레퍼런스가 없을 땐 붙이지 않는다.
  assert.match(src, /const manifest = isEdit/);
});

test("★마스크가 있으면 대화 이력은 빠지므로 번호도 빠진다", () => {
  const src = imagen();
  // allRefs 구성과 매니페스트의 대화 이력 개수가 같은 조건을 쓴다.
  assert.match(src, /opts\.maskImage\s*\?\s*0\s*:\s*opts\.conversationHistory\.length/);
  assert.match(src, /const allRefs[\s\S]{0,200}opts\.maskImage/);
});
