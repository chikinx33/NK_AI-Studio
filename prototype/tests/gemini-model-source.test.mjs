import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Gemini 텍스트·비전 모델 이름은 한 곳에서만 정한다.
 *
 * 배경: 같은 기본값("gemini-2.5-flash")이 6개 파일에 흩어져 있었다. 구글이 그 모델을
 * 신규 사용자에게 닫으면서 IP 시트 분석이 404 로 죽었고, 고치려면 6군데를 다 찾아야 했다.
 *
 *   Gemini API error (404): This model models/gemini-2.5-flash is no longer available
 *   to new users. Please update your code to use models/gemini-3.6-flash
 *
 * 다음 교체가 왔을 때 또 흩어져 있지 않도록 이 테스트가 막는다.
 */

const root = process.cwd();
const API = path.join(root, "prototype/functions/api");
const read = (p) => fs.readFileSync(p, "utf8");

/** functions/api 아래 모든 .ts/.js (단일 원천 파일 자신은 제외). */
function sourceFiles(dir = API, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|js)$/.test(name) && !p.endsWith(path.join("_shared", "gemini-models.js"))) out.push(p);
  }
  return out;
}

test("단일 원천이 존재하고 후속 모델을 가리킨다", () => {
  const src = read(path.join(API, "_shared/gemini-models.js"));
  assert.match(src, /export const GEMINI_TEXT_MODEL_DEFAULT = "gemini-3\.6-flash"/);
  assert.match(src, /export function geminiTextModel\(env\)/);
  assert.match(src, /export function geminiGenerateUrl\(env, model\)/);
  // env 로 덮어쓸 수 있어야 다음 교체 때 배포 없이 넘길 수 있다.
  assert.match(src, /GEMINI_PROMPT_ANALYSIS_MODEL \|\| env\.GEMINI_TEXT_MODEL/);
});

test("퇴역한 gemini-2.5-flash 를 코드에서 쓰지 않는다", () => {
  const offenders = [];
  for (const file of sourceFiles()) {
    const src = read(file);
    for (const [i, line] of src.split("\n").entries()) {
      // TTS 계열(gemini-2.5-flash-preview-tts 등)은 별개 모델이라 대상이 아니다.
      if (!/gemini-2\.5-flash(?!-)/.test(line)) continue;
      if (/^\s*(\/\/|\*)/.test(line)) continue; // 주석의 회귀 설명은 남겨 둔다
      offenders.push(`${path.relative(root, file)}:${i + 1}`);
    }
  }
  assert.deepEqual(offenders, [], `퇴역 모델을 직접 쓰는 곳: ${offenders.join(", ")}`);
});

test("모델 이름을 URL 에 직접 박지 않는다", () => {
  const offenders = [];
  for (const file of sourceFiles()) {
    const src = read(file);
    for (const [i, line] of src.split("\n").entries()) {
      // generativelanguage 엔드포인트에 모델명을 리터럴로 박으면 교체 때 또 흩어진다.
      // (TTS 는 자체 모델 목록을 쓰므로 제외)
      if (!/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-/.test(line)) continue;
      if (/tts/i.test(line)) continue;
      offenders.push(`${path.relative(root, file)}:${i + 1}`);
    }
  }
  assert.deepEqual(offenders, [], `모델명을 URL 에 직접 박은 곳: ${offenders.join(", ")}`);
});

test("분석 경로들이 단일 원천을 통해 모델을 고른다", () => {
  for (const rel of ["ip/analyze.ts", "imagen-describe.ts"]) {
    const src = read(path.join(API, rel));
    assert.match(src, /from "\.\.?\/?(_shared|\.\.\/_shared)\/gemini-models\.js"/, `${rel} 가 단일 원천을 import 하지 않음`);
    assert.match(src, /geminiTextModel\(env\)/, `${rel} 가 env 오버라이드를 존중하지 않음`);
  }
});
