// prototype/functions/api/agent/integration-test.ts
// POST /api/agent/integration-test { tool } — 도구의 NK 키 설정 여부로 연결 상태 확인.
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders } from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const TOOL_KEYS: Record<string, { key: string; alt?: string[] }[]> = {
  image: [{ key: "GEMINI_API_KEY", alt: ["GOOGLE_API_KEY", "OPENAI_API_KEY"] }],
  sound: [{ key: "ELEVENLABS_API_KEY" }],
  video: [{ key: "ATLASCLOUD_API_KEY", alt: ["XAI_API_KEY"] }],
};
const has = (env: any, key: string, alt?: string[]) =>
  !!String(env?.[key] || "").trim() || (alt || []).some((k) => String(env?.[k] || "").trim());

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const body = await request.json().catch(() => ({} as any));
  const tool = String(body?.tool || "").trim();
  const keys = TOOL_KEYS[tool];
  if (!keys) return send({ ok: false, message: `알 수 없는 도구: ${tool}` }, 200, origin);
  const ok = keys.every((k) => has(env, k.key, k.alt));
  return send({
    ok,
    message: ok ? "연결됨 — NK 스튜디오 공용 키로 작동해요." : "스튜디오에 이 도구의 키가 아직 설정되지 않았어요.",
  }, 200, origin);
};
