// prototype/functions/api/agent/integrations.ts
// GET  /api/agent/integrations — NK 스튜디오에 설정된 키로 각 도구가 작동하는지 상태 표시.
// POST /api/agent/integrations — NK는 공용 env 키 사용(사용자 입력 불필요) → 안내만.
// 라비오크 ToolIntegration 계약. 키는 NK env(시크릿)에서 존재 여부만 노출(값 미노출).
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, AGENT_TOOLS, getSql, ensureAgentSchema, getGoogleOAuth } from "./_shared";
import { getAgent } from "./_orchestrator";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

// NK 도구 → NK 스튜디오 env 키 매핑(이미 스튜디오에 구현된 연동 재사용).
const TOOL_KEYS: Record<string, { key: string; label: string; alt?: string[]; optional?: boolean }[]> = {
  image: [{ key: "GEMINI_API_KEY", label: "이미지 생성 키 (Gemini/Google/OpenAI)", alt: ["GOOGLE_API_KEY", "OPENAI_API_KEY"] }],
  sound: [{ key: "ELEVENLABS_API_KEY", label: "사운드 생성 키 (ElevenLabs)" }],
  video: [{ key: "ATLASCLOUD_API_KEY", label: "영상 생성 키 (AtlasCloud/xAI)", alt: ["XAI_API_KEY"] }],
  web_search: [{ key: "TAVILY_API_KEY", label: "웹 검색 키 (Tavily)", alt: ["TAVILY_KEY"] }],
  naver_datalab: [
    { key: "NAVER_CLIENT_ID", label: "네이버 데이터랩 Client ID" },
    { key: "NAVER_CLIENT_SECRET", label: "네이버 데이터랩 Secret" },
  ],
  github: [{ key: "GITHUB_TOKEN", label: "GitHub 토큰 (선택 — 공개 레포는 없어도 됨)", alt: ["GH_TOKEN"], optional: true }],
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

  const items: any[] = Object.entries(TOOL_KEYS).map(([tool, keys]) => {
    const def = AGENT_TOOLS[tool];
    const meta = def ? getAgent(def.agentId) : undefined;
    const fields = keys.map((k) => ({
      key: k.key, type: "password" as const, label: k.label, required: !k.optional,
      secret: true, hasValue: hasKey(env, k.key, k.alt),
      // 키는 서버(Cloudflare) 환경변수로만 읽는다. 이 입력칸은 저장되지 않으므로 환경변수명을 안내.
      hint: hasKey(env, k.key, k.alt)
        ? `서버 환경변수 ${k.key} 설정됨 ✓`
        : `여기 입력은 저장되지 않아요. Cloudflare Pages 환경변수에 ${k.key}${(k.alt && k.alt.length) ? `(또는 ${k.alt.join("/")})` : ""}를 추가한 뒤 재배포하세요.`,
    }));
    return {
      agentId: def?.agentId || "", agentName: meta?.name || "", emoji: meta?.emoji || "",
      tool, fields, configured: fields.filter((f) => f.required).every((f) => f.hasValue),
    };
  });

  // 싱크(비서) 구글 연동 — env 공용키가 아니라 사용자별 OAuth(refresh_token, Neon 저장).
  // Gmail·Calendar 는 한 번의 '구글 연결'로 두 스코프를 함께 받아 두 카드 모두 연결됨 처리.
  let goog: { email: string | null; scopes: string } | null = null;
  try {
    const sql = getSql(env);
    await ensureAgentSchema(sql);
    const row = await getGoogleOAuth(sql, auth.userId);
    if (row) goog = { email: row.email, scopes: row.scopes || "" };
  } catch (_) { /* DB 미연결 등 → 미연결 카드로 표시 */ }
  const sync = getAgent("sync");
  const syncBase = { agentId: "sync", agentName: sync?.name || "싱크", emoji: sync?.emoji || "📱", fields: [] as any[], oauth: "google" as const };
  const hasGmail = !!goog && /gmail/.test(goog.scopes);
  const hasCal = !!goog && /calendar/.test(goog.scopes);
  const hasDrive = !!goog && /drive/.test(goog.scopes);
  items.push({ ...syncBase, tool: "gmail", configured: hasGmail, connectedAs: hasGmail ? (goog?.email || "") : "" });
  items.push({ ...syncBase, tool: "calendar", configured: hasCal, connectedAs: hasCal ? (goog?.email || "") : "" });
  items.push({ ...syncBase, tool: "drive", configured: hasDrive, connectedAs: hasDrive ? (goog?.email || "") : "" });

  // 엣지(전략) Google Sheets 읽기 — 같은 구글 연결의 시트 스코프로 동작.
  const edge = getAgent("edge");
  const hasSheets = !!goog && /spreadsheets/.test(goog.scopes);
  items.push({
    agentId: "edge", agentName: edge?.name || "엣지", emoji: edge?.emoji || "", fields: [], oauth: "google" as const,
    tool: "sheets", configured: hasSheets, connectedAs: hasSheets ? (goog?.email || "") : "",
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
