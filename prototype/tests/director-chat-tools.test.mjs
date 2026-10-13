import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

test("디렉터 대화: 에이전트 대화 화면과 같은 스크롤 추종·맨 아래로·복사·다시 보내기", () => {
  const ws = read("ai-company-app/src/components/DirectorWorkspace.tsx");
  // 위로 올려 읽는 중에는 새 글이 와도 끌어내리지 않는다(예전엔 매번 맨 아래로 튀었다).
  assert.ok(ws.includes("useEffect(() => { if (stickRef.current) scrollToBottom(\"auto\"); }"));
  assert.ok(ws.includes("onScroll={onListScroll} onWheel={onListWheel}"));
  assert.ok(ws.includes("{showJump && ("));
  assert.ok(ws.includes('title="맨 아래(최신 대화)로"'));
  // 복사: 사용자 글과 디렉터 답변(다음 메시지 제안 주석은 뺀 본문)
  assert.ok(ws.includes("onClick={() => void copyText(it.id, it.text)}"));
  assert.ok(ws.includes("onClick={() => void copyText(it.id, body)}"));
  // 다시 보내기: 입력창·첨부는 그대로 두고 그 글만 다시 보낸다. 작업 중에는 막는다.
  assert.ok(ws.includes("onClick={() => void send(it.text)} disabled={!sessionId || running}"));
  assert.ok(ws.includes("if (!resend) { setDraft(\"\"); setAttachments([]); }"));
});

test("디렉터 대화: 연달아 실행된 도구 호출은 한 줄로 접는다(스틸 8장 = 줄 8개였다)", () => {
  const ws = read("ai-company-app/src/components/DirectorWorkspace.tsx");
  assert.ok(ws.includes("export function groupToolRuns(items: Item[]): DisplayItem[]"));
  assert.ok(ws.includes("if (run.length > 1) out.push({ kind: \"toolrun\""));
  assert.ok(ws.includes("{groupToolRuns(items).map((it) => {"));
  assert.ok(ws.includes("`진행 중 ${pending}`"));
});

test("일괄 승인: 채팅 '승인'이면 이번 차례의 유료 호출을 카드 없이 실행하고, 차례가 끝나면 푼다", () => {
  const stream = read("director/src/gateway/stream.ts");
  assert.ok(stream.includes("if (isPendingApproval(ev) && !(await tryAutoApprove(ev))) write(res, await approvalEvent(caller, ev));"));
  assert.ok(stream.includes("if (turnEnded(ev)) await anthropic.beta.sessions.update(sessionId, { metadata: { [AUTO_APPROVE_KEY]: null } }"));
  assert.ok(stream.includes("if (!PAID_TOOLS.has(String(ev?.name || \"\")) || autoConfirmed.has(ev.id)) return false;"));
  const sessions = read("director/src/gateway/sessions.ts");
  // 메시지를 보내기 전에 켠다 — 디렉터가 곧바로 유료 도구를 부를 수 있다.
  assert.ok(sessions.indexOf("await setAutoApprove(session, isApprovalText(text));") < sessions.indexOf("await anthropic.beta.sessions.events.send(session.id, { events });"));
  assert.ok(sessions.includes("if (answersApprove(answers, cancelled)) await setAutoApprove(session, true);"));
  const system = read("director/agent/system.md");
  assert.ok(system.includes("일괄 승인: 사용자가 채팅으로 \"승인\"이라고 하거나"));
});
