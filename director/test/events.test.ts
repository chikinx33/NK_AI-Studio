import test from "node:test";
import assert from "node:assert/strict";
import { mapEvent, isPendingApproval, errorText, normalizeQuestions, answerText } from "../src/gateway/events.js";
import { gsFromSignedUrl, compactProject, quoteInputFor, ipFromBrand, loadProjectIp, connectorOfflineNotice, isImageJob, waitImageJob } from "../src/mcp/tools.js";
import { SiteError } from "../src/site.js";

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

test("IP 캐릭터: 시트는 gs 경로만, 시트 없는 등록 캐릭터도 목록에 남긴다", () => {
  const ip = ipFromBrand("shapes", {
    brandTitle: "모양새 친구들",
    brandCharacters: [{ trigger: "@세모", name: "세모", description: "빨간 삼각형" }, { trigger: "@동그라미", name: "동그라미" }],
    characterSheets: [{ token: "@세모", displayName: "세모", items: [
      { imageDataUrl: "data:image/png;base64,AAA" }, { imageDataUrl: "gs://b/users/u/brands/shapes/ip/a.png", isPrimary: true }] }],
  });
  assert.equal(ip.brandTitle, "모양새 친구들");
  assert.equal(ip.characters.length, 2);
  assert.equal(ip.characters[0].description, "빨간 삼각형");
  assert.deepEqual(ip.characters[0].sheets, ["gs://b/users/u/brands/shapes/ip/a.png"]);
  assert.equal(ip.characters[0].primarySheet, "gs://b/users/u/brands/shapes/ip/a.png");
  assert.equal(ip.characters[1].name, "동그라미");
  assert.deepEqual(ip.characters[1].sheets, []);
});

test("프로젝트 IP: brandId 가 없으면 시리즈 제목이 같은 브랜드를 찾는다", async () => {
  const calls: string[] = [];
  const ip = await loadProjectIp(async (p) => {
    calls.push(p);
    if (p.startsWith("/api/brand/list")) return { brands: [{ id: "other", brandTitle: "다른 IP" }, { id: "shapes", brandTitle: "모양새 친구들" }] };
    if (p === "/api/brand/get?brandId=shapes") return { data: { brandTitle: "모양새 친구들", characterSheets: [{ token: "@네모", items: [{ imageDataUrl: "gs://b/n.png" }] }] } };
    return { ok: true, data: null };
  }, { seriesId: "moyangsae" }, ["모양새 친구들"]);
  assert.equal(ip.brandId, "shapes");
  assert.equal(ip.characters[0].name, "네모");
  assert.equal(calls[0], "/api/brand/get?brandId=moyangsae");
});

test("그리기 도구 꺼짐 오류는 API 대체 승인을 묻는 안내로 바꾼다", () => {
  const n = connectorOfflineNotice(new SiteError(409, { error: "chatgpt_connector_offline" }));
  assert.match(n, /useApi:true/);
  assert.match(n, /승인 전에는 다시 부르지 않는다/);
  assert.match(connectorOfflineNotice(new SiteError(412, { error: "chatgpt_connector_required" })), /등록되지 않아/);
  assert.equal(connectorOfflineNotice(new SiteError(500, { error: "x" })), "");
  assert.equal(connectorOfflineNotice(new Error("x")), "");
});

test("구독 그리기 작업 접수(202)는 끝날 때까지 기다려 결과 경로를 돌려준다", async () => {
  assert.equal(isImageJob({ id: "j", status: "queued", result: null }), true);
  assert.equal(isImageJob({ objectName: "users/u/x.png", signedUrl: "https://s" }), false);
  let n = 0;
  const done = await waitImageJob(async () => (++n < 3 ? { id: "j", status: "working" } : { id: "j", status: "done", result: { objectName: "users/u/p/image/a.png", signedUrl: "https://s/a" } }), "j", 5, 1);
  assert.equal(done.status, "done");
  assert.equal(done.objectName, "users/u/p/image/a.png");
  const failed = await waitImageJob(async () => ({ id: "j", status: "error", error: "codex_process_closed" }), "j", 5, 1);
  assert.equal(failed.status, "failed");
  const running = await waitImageJob(async () => ({ id: "j", status: "queued" }), "j", 0, 1);
  assert.equal(running.status, "running");
  assert.match(running.note, /image_status/);
});

test("버튼 질문(ask_user): 질문 이벤트로 바꾸고, 답·건너뛰기·취소를 결과 문장으로 만든다", () => {
  const ev = mapEvent({ type: "agent.custom_tool_use", id: "sevt_q1", name: "ask_user",
    input: { questions: [{ question: "어느 안으로 할까요?", header: "다음 단계", options: [{ label: "A 스틸 1만 다시 (20크레딧)", recommended: true }, { label: "B" }, "C"] }] } });
  assert.equal(ev[0].type, "question");
  const q = (ev[0] as any).questions[0];
  assert.equal(q.options.length, 3);
  assert.equal(q.options[0].recommended, true);
  assert.equal(q.options[2].label, "C");
  assert.deepEqual(mapEvent({ type: "agent.custom_tool_use", id: "x", name: "other", input: {} }), []);
  assert.equal(mapEvent({ type: "user.custom_tool_result", custom_tool_use_id: "sevt_q1", content: [{ type: "text", text: "답" }] })[0].type, "question_answered");
  assert.equal(normalizeQuestions({ questions: [{ question: "", options: ["a"] }] }).length, 0);
  const t = answerText([{ question: "어느 안?", choices: ["A"] }, { question: "구도?", skipped: true }, { question: "길이?", other: "20초" }], false);
  assert.match(t, /어느 안\? → A/);
  assert.match(t, /구도\? → 건너뜀/);
  assert.match(t, /길이\? → 직접 입력: 20초/);
  assert.match(answerText([], true), /취소/);
});
