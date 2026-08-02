import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * 모델 제공사의 "잔액 부족" 응답을 알아보는 판별기 테스트.
 *
 * 배경: 같은 정규식이 Claude 기반 엔드포인트 5곳에 복사돼 있었고, 전부 Anthropic 의
 * 실제 문구를 놓쳤다. 그래서 크레딧이 바닥나도 402(CREDIT_EXHAUSTED)가 아니라
 * 일반 500 이 나갔고, 브랜드 스튜디오의 생성 버튼은 눌러도 아무 반응이 없어 보였다.
 *
 * 소스를 정규식으로 훑지 않고 실제로 실행해서 반환값을 검증한다.
 */

const SRC = path.join(process.cwd(), "prototype/functions/api/_shared/credit-exhausted.js");

/** ESM 모듈을 vm 에서 실행하기 위해 export 키워드만 걷어내고 평가한다. */
function loadHelper() {
  const src = fs
    .readFileSync(SRC, "utf8")
    .replace(/^export default .*$/m, "")
    .replace(/^export /gm, "");
  const ctx = vm.createContext({});
  vm.runInContext(src + "\n;globalThis.__fn = isCreditExhausted;", ctx);
  return ctx.__fn;
}

const isCreditExhausted = loadHelper();

// 2026-08-02 실제로 받은 응답. 이 문구를 놓쳐서 버그가 났다.
const ANTHROPIC_REAL =
  '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011CddNcSgKyd3eqpGzrkdyu"}';

test("Anthropic 의 실제 잔액 부족 응답을 잡아낸다 (회귀 케이스)", () => {
  assert.equal(isCreditExhausted(ANTHROPIC_REAL), true);
});

test("타입이 invalid_request_error 여도 잔액 부족이면 잡는다", () => {
  // 예전 패턴은 "billing_error" 타입만 봤다. Anthropic 은 그 타입을 쓰지 않는다.
  assert.ok(!ANTHROPIC_REAL.includes("billing_error"), "회귀 케이스 전제가 깨졌다");
  assert.equal(isCreditExhausted(ANTHROPIC_REAL), true);
});

test("HTTP 402 는 본문과 무관하게 잔액 부족이다", () => {
  assert.equal(isCreditExhausted("", 402), true);
  assert.equal(isCreditExhausted("whatever", 402), true);
});

test("알려진 표현들을 모두 잡는다", () => {
  for (const text of [
    '{"error":{"type":"billing_error"}}',
    '{"error":"credit_balance too low"}',
    "Your credit balance is too low",
    "insufficient_quota",
    "insufficient credit",
    "You exceeded your current quota",
  ]) {
    assert.equal(isCreditExhausted(text), true, `놓친 표현: ${text}`);
  }
});

test("무관한 오류는 잔액 부족으로 오인하지 않는다", () => {
  for (const text of [
    "",
    '{"error":{"type":"overloaded_error","message":"Overloaded"}}',
    '{"error":{"type":"rate_limit_error"}}',
    "Anthropic error: 500 internal",
    "network timeout",
  ]) {
    assert.equal(isCreditExhausted(text), false, `오인한 표현: ${text}`);
  }
});

test("판별 규칙은 한 곳에만 있다 — 엔드포인트가 자체 정규식을 갖지 않는다", () => {
  const roots = ["prototype/functions"];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(js|ts)$/.test(entry.name)) continue;
      if (full.endsWith("credit-exhausted.js")) continue;
      const src = fs.readFileSync(full, "utf8");
      // 잔액 판별 문구를 직접 들고 있으면 드리프트가 난다. 헬퍼를 쓸 것.
      if (/billing_error|credit_balance/.test(src)) offenders.push(full);
    }
  };
  for (const r of roots) walk(path.join(process.cwd(), r));
  assert.deepEqual(offenders, [], `자체 정규식이 남아 있다:\n${offenders.join("\n")}`);
});

test("Claude 를 호출하는 엔드포인트는 헬퍼로 잔액 부족을 판정한다", () => {
  for (const rel of [
    "prototype/functions/api/draft-generate.js",
    "prototype/functions/api/hashtags.js",
    "prototype/functions/api/story-structure.js",
    "prototype/functions/api/scenario.js",
    "prototype/functions/api/scenario/shots/index.js",
  ]) {
    const src = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    assert.ok(/import \{ isCreditExhausted \}/.test(src), `${rel} 이 헬퍼를 import 하지 않는다`);
    assert.ok(/isCreditExhausted\(/.test(src), `${rel} 이 헬퍼를 호출하지 않는다`);
  }
});

test("브랜드 스튜디오는 AI 생성 실패를 삼키지 않는다", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "prototype/js/ui/brand-studio.js"), "utf8");
  // 재생성/보완 경로가 console.error 만 하고 끝나면 버튼이 죽은 것처럼 보인다.
  for (const tag of ["[draft-generate]", "[draft-refine]"]) {
    const at = src.indexOf(`console.error('${tag}'`);
    assert.ok(at > 0, `${tag} 오류 처리부를 찾지 못했다`);
    const after = src.slice(at, at + 300);
    assert.ok(
      /alert\(describeGenError\(err\)\)/.test(after),
      `${tag} 실패가 사용자에게 전달되지 않는다 (console 만 남긴다)`
    );
  }
  // 크레딧 소진은 원문 대신 전용 안내로 바꿔 보여준다
  assert.ok(/creditExhausted/.test(src) && /CREDIT_EXHAUSTED/.test(src), "크레딧 소진 분기가 없다");
  for (const key of ["alertCreditExhausted"]) {
    const hits = src.split(key).length - 1;
    assert.ok(hits >= 3, `${key} 가 ko/en 양쪽에 정의되고 사용돼야 한다 (발견 ${hits}회)`);
  }
});
