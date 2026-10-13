import test from "node:test";
import assert from "node:assert/strict";
import { isApprovalText, answersApprove, autoApproveActive, turnEnded, AUTO_APPROVE_KEY, AUTO_APPROVE_MAX_MS } from "../src/gateway/approval.js";

test("채팅 승인: '승인'·'진행해' 같은 지시는 승인, 부정·질문·명사 쓰임은 아니다", () => {
  for (const t of ["승인", "승인!", "승인합니다", "승인, 8장 다 가자", "좋아 진행해", "그대로 진행하자", "진행 ㄱ"]) assert.ok(isApprovalText(t), t);
  for (const t of ["승인 안 해", "미승인", "진행하지 마", "승인 보류", "승인 전에 C3 바꿔 줘", "승인하면 어떻게 돼?", "진행 상황 알려 줘",
    "지금 진행 중이야?", "C10 다시 그려 줘", ""]) assert.ok(!isApprovalText(t), t);
});

test("버튼 질문: 라벨에 '승인'이 든 선택지를 고르면 승인, 건너뜀·취소는 아니다", () => {
  assert.ok(answersApprove([{ choices: ["승인 · 스틸 8장 (160크레딧)"] }], false));
  assert.ok(!answersApprove([{ choices: ["구도 다시 잡기"] }], false));
  assert.ok(!answersApprove([{ choices: ["승인 · 스틸 8장"] }], true));
  assert.ok(!answersApprove([{ skipped: true, choices: ["승인"] }], false));
});

test("일괄 승인은 최대 60분, 디렉터가 차례를 마치면(end_turn) 풀린다 — 승인·질문 대기는 차례 끝이 아니다", () => {
  const now = Date.parse("2026-10-14T10:00:00Z");
  assert.ok(autoApproveActive({ [AUTO_APPROVE_KEY]: new Date(now - 1000).toISOString() }, now));
  assert.ok(!autoApproveActive({ [AUTO_APPROVE_KEY]: new Date(now - AUTO_APPROVE_MAX_MS - 1).toISOString() }, now));
  assert.ok(!autoApproveActive({}, now));
  assert.ok(turnEnded({ type: "session.status_idle", stop_reason: { type: "end_turn" } }));
  assert.ok(!turnEnded({ type: "session.status_idle", stop_reason: { type: "requires_action", event_ids: ["sevt_1"] } }));
  assert.ok(turnEnded({ type: "session.status_terminated" }));
});
