import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("여러 에이전트 답변은 공통 표시 큐에서 한 건씩 노출된다", async () => {
  const [app, chat] = await Promise.all([
    read("ai-company-app/src/App.tsx"),
    read("ai-company-app/src/components/Chat.tsx"),
  ]);

  assert.match(chat, /queued\?: boolean/);
  assert.match(app, /presentationQueueRef = useRef<AgentPresentationItem\[]>\(\[\]\)/);
  assert.match(app, /while \(presentationQueueRef\.current\.length > 0/);
  assert.match(app, /const item = presentationQueueRef\.current\.shift\(\)!/);
  // 노출은 감시 타이머와 함께 await 한다 — 한 건이 멈춰도 큐가 계속 흐르도록.
  assert.match(app, /const timedOut = await Promise\.race\(\[\s*\n\s*revealAgentTurn\(item\.turnId, item\.agentId, item\.text\)/);
  assert.match(app, /const presentedTurns = turns\.filter\(\(turn\) => !turn\.queued\)/);
  assert.match(app, /liveTurnIsVisible = turnsRef\.current\.some/);
  assert.match(app, /else presentationQueueRef\.current\.unshift\(item\)/);
});

test("실시간 발언과 일괄 도착 보고도 동일한 순차 표시 경로를 사용한다", async () => {
  const app = await read("ai-company-app/src/App.tsx");

  assert.match(app, /case "turn_end"[\s\S]*enqueueAgentPresentation\(reveal\)/);
  assert.match(app, /if \(r\.messages\?\.length\)[\s\S]*presentCompletedAgentTurns\(add\)/);
  assert.match(app, /onAgentSay=\{\(m\) => \{[\s\S]*presentCompletedAgentTurns\(\[/);
  assert.doesNotMatch(app, /commit\(\[\.\.\.turnsRef\.current, \.\.\.add\]\)/);
});

test("사용자 입력과 대화 전환은 대기열을 안전하게 정리한다", async () => {
  const app = await read("ai-company-app/src/App.tsx");

  assert.match(app, /async function send[\s\S]*finishAgentPresentations\(\)/);
  assert.match(app, /cancelAgentPresentations\(\);[\s\S]*getConversationMessages\(activeConvId\)/);
  assert.match(app, /presentationWorkerRef\.current \+= 1/);
  // 일시정지도 재생 대기를 끝낸다 (ended/error/pause + 시간 상한을 finish 로 일원화)
  assert.match(app, /const finish = \(\) => \{[\s\S]{0,90}resolve\(\);/);
  assert.match(app, /audio\.onpause = finish/);
});
