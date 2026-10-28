// prototype/functions/api/_shared/agent-settings-view.js
// 직원(agent_settings_get 도구)에게 줄 설정 응답을 잘못 읽지 않게 풀어 준다.
// 날것 그대로 주면 defaults(기본 배정)를 "실제 적용 모델"로, 이미지 연결 프로그램의 링크 만료일을
// "ChatGPT 구독 만료일"로 읽어 사용자에게 틀린 답을 했다(2026-10-29).
import { CLOUD_MODELS, resolveAgentModel } from "./cloud-models.js";

export function describeSettingsForAgent(data) {
  const out = { ...(data || {}) };
  delete out.cloudModels; // agentModels.defaults 와 같은 값 — 두 번 주면 '적용 목록'으로 오해한다
  const models = out.agentModels;
  if (models && typeof models === "object") {
    const selections = models.selections && typeof models.selections === "object" ? models.selections : {};
    const effective = {};
    Object.keys(models.defaults || CLOUD_MODELS).forEach((id) => {
      effective[id] = resolveAgentModel(id, selections).model;
    });
    out.agentModels = {
      effective,
      selections,
      defaults: models.defaults,
      note: "effective 가 지금 실제로 쓰이는 모델이다. 직접 선택(selections)이 있으면 기본 배정(defaults)보다 우선한다.",
    };
  }
  const connector = out.generation && out.generation.connector;
  if (connector && typeof connector === "object") {
    const { expiresAt, ...rest } = connector;
    out.generation = {
      ...out.generation,
      connector: {
        ...rest,
        linkExpiresAt: expiresAt || "",
        note: "linkExpiresAt 은 ChatGPT 구독 만료일이 아니다. 연결 프로그램이 켜져 있는 동안 계속 30일씩 늘어나는 연결 유효기간이고, "
          + "마지막으로 켜져 있던 때(lastSeen)부터 30일 뒤다. plan 은 ChatGPT 요금제 이름일 뿐 만료 정보가 없다.",
      },
    };
  }
  return out;
}
