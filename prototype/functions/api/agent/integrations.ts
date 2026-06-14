// prototype/functions/api/agent/integrations.ts
// GET  /api/agent/integrations — NK 스튜디오에 설정된 키로 각 도구가 작동하는지 상태 표시.
// POST /api/agent/integrations — NK는 공용 env 키 사용(사용자 입력 불필요) → 안내만.
// 라비오크 ToolIntegration 계약. 키는 NK env(시크릿)에서 존재 여부만 노출(값 미노출).
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, AGENT_TOOLS } from "./_shared";
import { getAgent } from "./_orchestrator";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

// NK 도구 → NK 스튜디오 env 키 매핑(이미 스튜디오에 구현된 연동 재사용).
const TOOL_KEYS: Record<string, { key: string; label: string; alt?: string[] }[]> = {
  image: [{ key: "GEMINI_API_KEY", label: "이미지 생성 키 (Gemini/Google/OpenAI)", alt: ["GOOGLE_API_KEY", "OPENAI_API_KEY"] }],
  sound: [{ key: "ELEVENLABS_API_KEY", label: "사운드 생성 키 (ElevenLabs)" }],
  video: [{ key: "ATLASCLOUD_API_KEY", label: "영상 생성 키 (AtlasCloud/xAI)", alt: ["XAI_API_KEY"] }],
};

function hasKey(env: any, key: string, alt?: string[]): boolean {
  if (String(env?.[key] || "").trim()) return true;
  return (alt || []).some((k) => String(env?.[k] || "").trim());
}

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

  const items = Object.entries(TOOL_KEYS).map(([tool, keys]) => {
    const def = AGENT_TOOLS[tool];
    const meta = def ? getAgent(def.agentId) : undefined;
    const fields = keys.map((k) => ({
      key: k.key, type: "password" as const, label: k.label, required: true,
      secret: true, hasValue: hasKey(env, k.key, k.alt),
      hint: "NK 스튜디오 공용 키로 작동 — 별도 입력이 필요 없어요.",
    }));
    return {
      agentId: def?.agentId || "", agentName: meta?.name || "", emoji: meta?.emoji || "",
      tool, fields, configured: fields.every((f) => f.hasValue),
    };
  });
  return send(items, 200, origin);
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  // NK: 도구는 스튜디오 공용 env 키로 작동. 사용자별 키 입력은 미지원(후속 BYOK).
  return send({ ok: true, message: "NK 스튜디오 공용 키를 사용해요. 별도 입력이 필요 없어요." }, 200, origin);
};
