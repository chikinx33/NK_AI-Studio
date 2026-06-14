// prototype/functions/api/agent/status.ts
// GET /api/agent/status — 라비오크 StatusInfo 계약(클라우드 고정). App 부팅용.
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, getRuntime } from "./_shared";
import { ROSTER } from "./_orchestrator";
import { CLOUD_MODELS } from "../_shared/cloud-models.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const cloudReady = Boolean(String(env?.ANTHROPIC_API_KEY || "").trim());
  let workMode: "on" | "off" = "on";
  let autonomous = false;
  const sql = getSql(env);
  if (sql) {
    await ensureAgentSchema(sql);
    const rt = await getRuntime(sql, auth.userId);
    workMode = rt.workMode;
    autonomous = rt.autonomous;
  }
  return send({
    company: "AI 스튜디오",
    llmMode: "cloud",
    workMode,
    autonomous,
    resolvedBackend: "cloud",
    reason: cloudReady ? "NK Claude" : "ANTHROPIC_API_KEY 없음",
    localModel: "auto",
    ollama: { up: false, models: [], chatModels: [], loaded: [], autoModel: null },
    cloud: { configured: cloudReady },
    ceoModel: CLOUD_MODELS.core, // 실제 코어(오케스트레이터) 모델 — 클라우드 모델 매핑과 일치
    agentCount: ROSTER.length,
  }, 200, origin);
};
