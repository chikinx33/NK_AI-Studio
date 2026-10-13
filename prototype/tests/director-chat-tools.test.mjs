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
