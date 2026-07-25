import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("일반 채팅 음성은 사용자가 명시적으로 켠 경우에만 활성화된다", async () => {
  const app = await read("ai-company-app/src/App.tsx");

  assert.match(app, /readStorage\("agentVoiceEnabled"\) === "1"/);
  assert.doesNotMatch(app, /readStorage\("agentVoiceEnabled"\) !== "0"/);
});
