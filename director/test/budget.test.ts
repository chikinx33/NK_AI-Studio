import test from "node:test";
import assert from "node:assert/strict";
process.env.MEMBER_SESSION_BUDGET_CENTS = "1000";
process.env.OWNER_SESSION_BUDGET_CENTS = "5000";
const { sessionBudgetCents } = await import("../src/gateway/sessions.js");

test("회원 세션 예산은 잔액(원가 환산)과 상한 중 작은 쪽", () => {
  // 1300 크레딧 = $13 판매가 = $10 원가 = 1000센트
  assert.equal(sessionBudgetCents(false, 1300), 1000);
  assert.equal(sessionBudgetCents(false, 130), 100);
  assert.equal(sessionBudgetCents(false, 100000), 1000);
  assert.equal(sessionBudgetCents(false, 0), 0);
});

test("소유자는 사고 방지 상한만", () => {
  assert.equal(sessionBudgetCents(true, 0), 5000);
});
