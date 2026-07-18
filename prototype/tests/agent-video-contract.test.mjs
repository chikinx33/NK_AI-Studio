import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Agent Video는 AI Cinema와 분리된 에이전트 협업 API를 제공한다", async () => {
  const source = await read("prototype/functions/api/agent/agent-video.ts");
  assert.match(source, /speak\(\s*env,\s*"plot"/);
  assert.match(source, /Promise\.all\(\[/);
  assert.match(source, /"ink"/);
  assert.match(source, /"pixel"/);
  assert.match(source, /"beat"/);
  assert.match(source, /callClaude\(env, synthesisSystem/);
  assert.doesNotMatch(source, /postprod\/transcode|buildTimelineModel|postTimelineEdits/);
});

test("Agent Video 화면은 Remotion Player와 로컬 MP4 렌더를 연결한다", async () => {
  const [workspace, app, server] = await Promise.all([
    read("ai-company-app/src/components/AgentVideoWorkspace.tsx"),
    read("ai-company-app/src/App.tsx"),
    read("server.js"),
  ]);
  assert.match(workspace, /<Player/);
  assert.match(workspace, /createAgentVideo/);
  assert.match(workspace, /startLocalAgentVideoRender/);
  assert.match(app, /centerView === "video"/);
  assert.match(server, /\/local-agent-video\/render/);
  assert.match(server, /render-agent-video\.mjs/);
});

test("Remotion 렌더러는 동적 명세·효과음·Windows 안전 인코딩을 지원한다", async () => {
  const [component, root, script] = await Promise.all([
    read("ai-company-app/src/remotion/AgentVideo.tsx"),
    read("ai-company-app/src/remotion/Root.tsx"),
    read("ai-company-app/scripts/render-agent-video.mjs"),
  ]);
  assert.match(component, /@remotion\/sfx/);
  assert.match(component, /<Sequence/);
  assert.match(root, /calculateMetadata/);
  assert.match(root, /id="AgentVideo"/);
  assert.match(script, /"--sequence"/);
  assert.match(script, /libx264/);
  assert.match(script, /amix=inputs=/);
});
