import test from "node:test";
import assert from "node:assert/strict";
import { mapEvent, isPendingApproval, errorText } from "../src/gateway/events.js";
import { gsFromSignedUrl, compactProject, quoteInputFor } from "../src/mcp/tools.js";

test("미리보기 델타와 확정 메시지를 화면 이벤트로 바꾼다", () => {
  assert.deepEqual(mapEvent({ type: "event_start", event: { type: "agent.message", id: "sevt_1" } }), [{ type: "text_start", id: "sevt_1" }]);
  assert.deepEqual(mapEvent({ type: "event_delta", event_id: "sevt_1", delta: { type: "content_delta", index: 0, content: { type: "text", text: "안녕" } } }),
    [{ type: "text_delta", id: "sevt_1", text: "안녕" }]);
  const m = mapEvent({ type: "agent.message", id: "sevt_1", content: [{ type: "text", text: "안녕하세요" }], processed_at: "t" });
  assert.equal(m[0].type, "message");
  assert.equal((m[0] as any).text, "안녕하세요");
});

test("승인 대기 도구 호출을 알아본다", () => {
  const ev = { type: "agent.mcp_tool_use", id: "sevt_9", name: "video_submit", mcp_server_name: "nk-studio", input: {}, evaluated_permission: "ask" };
  assert.equal(isPendingApproval(ev), true);
  assert.equal(isPendingApproval({ ...ev, evaluated_permission: "allow" }), false);
  assert.equal((mapEvent(ev)[0] as any).server, "nk-studio");
});

test("오류는 한국어로 보여 준다", () => {
  assert.match(errorText({ type: "billing_error" }), /결제/);
  assert.match(mapEvent({ type: "session.error", error: { type: "mcp_authentication_failed_error" } }).map((e: any) => e.text).join(""), /인증/);
});

test("서명 URL 에서 gs 경로를 되찾는다", () => {
  assert.equal(gsFromSignedUrl("https://storage.googleapis.com/my-bucket/users/a/x%20y.mp4?X-Goog-Signature=abc"), "gs://my-bucket/users/a/x y.mp4");
  assert.equal(gsFromSignedUrl("https://example.com/a.mp4"), "");
});

test("프로젝트 요약은 테이크 상태만 남기고 큰 값은 뺀다", () => {
  const c = compactProject({ title: "T", payload: { sequences: [{ id: "s", cuts: [1, 2], takes: [{ id: "t", status: "done", prompt: "x".repeat(9999) }] }] }, scenes: [{ id: 1, imageDataUrl: "data:..." }] });
  assert.equal(c.sequences[0].cuts, 2);
  assert.equal(c.sequences[0].takes[0].prompt, undefined);
  assert.equal((c.scenes[0] as any).imageDataUrl, undefined);
});

test("승인 카드 견적 입력: 드래프트는 480p, 완성은 complete 모델", () => {
  assert.equal(quoteInputFor("video_submit", { draft: true, durationSeconds: 20 })!.input.resolution, "480p");
  assert.equal(quoteInputFor("video_complete", { durationSeconds: 20 })!.input.videoModel, "seedance-2.5-complete");
  assert.equal(quoteInputFor("project_overview", {}), null);
});
