// 직원이 설정을 읽고 "리치는 Sonnet 5.5 로 적용 중", "커넥터 구독(pro) 11/19 만료" 라고 틀리게 답했다(2026-10-29).
// defaults 를 적용 목록으로, 연결 링크 만료일을 구독 만료일로 읽은 것 — 도구 결과에 실제 적용 모델과 뜻을 담는다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describeSettingsForAgent } from "../functions/api/_shared/agent-settings-view.js";
import { CLOUD_MODELS } from "../functions/api/_shared/cloud-models.js";

test("직접 선택이 기본 배정보다 앞선 실제 적용 모델을 effective 로 준다", () => {
  const view = describeSettingsForAgent({
    cloudModels: CLOUD_MODELS,
    agentModels: { selections: { reach: { provider: "anthropic", model: "claude-opus-5-5" } }, defaults: CLOUD_MODELS },
  });
  assert.equal(view.agentModels.effective.reach, "claude-opus-5-5");
  assert.equal(view.agentModels.effective.radar, CLOUD_MODELS.radar);
  assert.equal(view.agentModels.effective.core, CLOUD_MODELS.core);
  assert.equal(view.cloudModels, undefined, "defaults 와 같은 목록을 두 번 주지 않는다");
  assert.match(view.agentModels.note, /effective 가 지금 실제로 쓰이는 모델/);
});

test("연결 프로그램 만료일은 구독 만료가 아니라 연결 유효기간으로 이름을 바꿔 준다", () => {
  const view = describeSettingsForAgent({
    generation: { imageEnabled: true, connector: { configured: true, online: false, plan: "pro", expiresAt: "2026-11-19T00:00:00Z", lastSeen: "2026-10-20T00:00:00Z" } },
  });
  const c = view.generation.connector;
  assert.equal(c.expiresAt, undefined);
  assert.equal(c.linkExpiresAt, "2026-11-19T00:00:00Z");
  assert.equal(c.lastSeen, "2026-10-20T00:00:00Z");
  assert.match(c.note, /ChatGPT 구독 만료일이 아니다/);
  assert.equal(view.generation.imageEnabled, true);
});

test("agent_settings_get 도구가 이 풀이를 거치고, 연결 상태에 마지막 접속 시각이 실린다", async () => {
  const shared = await readFile(new URL("../functions/api/agent/_shared.ts", import.meta.url), "utf8");
  assert.match(shared, /describeSettingsForAgent\(await callInternalJson\(ctx, "\/api\/agent\/settings"\)\)/);
  const codex = await readFile(new URL("../functions/api/_shared/codex-images.ts", import.meta.url), "utf8");
  assert.match(codex, /lastSeen: row\?\.last_seen \|\| ''/);
});
