// prototype/functions/api/agent/integrations.ts
// GET  /api/agent/integrations — 각 도구의 연결 상태 표시.
//   · 공용 env 키 도구(GEMINI·TAVILY 등): 서버 환경변수 존재 여부만 노출(값 미노출).
//   · BYOK 도구(Polar): 사용자가 UI에서 등록. hasValue 불리언만 노출 — ★ 토큰 값은 절대 반환 금지.
// POST /api/agent/integrations — BYOK 도구면 실제 저장(agent_credentials), 그 외는 기존 안내 그대로.
// 라비오크 ToolIntegration 계약.
import { authorizeRequest } from "../_shared/auth.js";
import {
  send, corsHeaders, AGENT_TOOLS, getSql, ensureAgentSchema, getGoogleOAuth,
  saveCredentials, listCredentialKeys, deleteCredentials,
} from "./_shared";
import { getAgent } from "./_orchestrator";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

// ── 사용자별 등록 도구(BYOK) ──────────────────────────────────────────────
// 여기 등록된 도구는 사용자가 UI에서 직접 키를 넣고 저장한다(공용 env 키가 아님).
// 이번 단계에서는 Polar 만. 다른 도구는 기존 공용 env 방식 유지.
const BYOK_TOOLS: Record<string, {
  provider: string; agentId: string; title: string;
  fields: { key: string; label: string; required: boolean; secret: boolean; placeholder?: string; hint?: string }[];
}> = {
  polar_metrics: {
    provider: "polar", agentId: "edge", title: "Polar 수익",
    fields: [
      {
        key: "access_token", label: "Polar Organization Access Token (읽기 스코프만)", required: true, secret: true,
        placeholder: "polar_oat_...",
        hint: "Polar 대시보드 → Settings → Organization Access Token. 스코프는 읽기만 체크하세요: metrics · orders · subscriptions · customers · products",
      },
      {
        key: "app_products", label: "앱별 상품 매핑 JSON (선택)", required: false, secret: false,
        placeholder: '{"memoment":["상품UUID"]}',
        hint: "비워두면 상품명으로 자동 매칭해요. 정확히 고정하고 싶을 때만 채우세요 — UUID는 엣지에게 '우리 Polar 상품 목록 보여줘'라고 하면 나와요.",
      },
      {
        key: "usd_krw", label: "원화 환산 환율 (선택)", required: false, secret: false,
        placeholder: "1380", hint: "넣으면 금액을 달러와 원화로 함께 보여줘요. 비우면 달러만.",
      },
      {
        key: "api_base", label: "API 주소 (선택)", required: false, secret: false,
        placeholder: "https://sandbox-api.polar.sh/v1", hint: "비우면 실서버(api.polar.sh)를 써요. 샌드박스 테스트할 때만 바꾸세요.",
      },
    ],
  },
};

// NK 도구 → NK 스튜디오 env 키 매핑(이미 스튜디오에 구현된 연동 재사용).
const TOOL_KEYS: Record<string, { key: string; label: string; alt?: string[]; optional?: boolean }[]> = {
  image: [{ key: "GEMINI_API_KEY", label: "이미지 생성 키 (Gemini/Google/OpenAI)", alt: ["GOOGLE_API_KEY", "OPENAI_API_KEY"] }],
  sound: [{ key: "ELEVENLABS_API_KEY", label: "사운드 생성 키 (ElevenLabs)" }],
  video: [{ key: "ATLASCLOUD_API_KEY", label: "영상 생성 키 (AtlasCloud/xAI)", alt: ["XAI_API_KEY"] }],
  web_search: [{ key: "TAVILY_API_KEY", label: "웹 검색 키 (Tavily)", alt: ["TAVILY_KEY"] }],
  web_fetch: [
    { key: "TAVILY_API_KEY", label: "웹 열람 1단계 (Tavily Extract)", alt: ["TAVILY_KEY"] },
    { key: "CLOUDFLARE_ACCOUNT_ID", label: "웹 열람 2단계 계정 ID (Cloudflare)", alt: ["CF_ACCOUNT_ID"], optional: true },
    { key: "CF_BROWSER_TOKEN", label: "웹 열람 2단계 토큰 (Cloudflare Browser Rendering)", alt: ["CLOUDFLARE_API_TOKEN"], optional: true },
  ],
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

  // BYOK 카드 — ★ 값은 절대 내려보내지 않고 '설정됨' 여부(hasValue)만.
  try {
    const sql = getSql(env);
    if (sql) {
      await ensureAgentSchema(sql);
      for (const [tool, spec] of Object.entries(BYOK_TOOLS)) {
        const have = new Set(await listCredentialKeys(sql, auth.userId, spec.provider));
        const meta = getAgent(spec.agentId);
        const fields = spec.fields.map((f) => ({
          key: f.key, type: (f.secret ? "password" : "text") as const, label: f.label,
          required: f.required, secret: f.secret, hasValue: have.has(f.key),
          placeholder: f.placeholder || "",
          // 입력칸에 placeholder 가 이미 보이므로 hint 는 '어디서 얻는지/무슨 뜻인지'만 설명한다.
          hint: have.has(f.key)
            ? `저장됨 ✓ 바꾸려면 새 값을 입력하세요(빈 칸으로 저장하면 기존 값 유지). ${f.hint || ""}`.trim()
            : (f.hint || ""),
        }));
        items.push({
          agentId: spec.agentId, agentName: meta?.name || "", emoji: meta?.emoji || "",
          tool, fields, byok: true,
          configured: fields.filter((f) => f.required).every((f) => f.hasValue),
        });
      }
    }
  } catch (_) { /* DB 미연결 → 카드 생략 */ }

  return send(items, 200, origin);
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

  const body: any = await request.json().catch(() => ({}));
  const tool = String(body?.tool || "").trim();
  const spec = BYOK_TOOLS[tool];

  // 사용자별 등록 도구 → 실제 저장.
  if (spec) {
    const sql = getSql(env);
    if (!sql) return send({ ok: false, message: "DB에 연결하지 못해 저장하지 못했어요." }, 200, origin);
    await ensureAgentSchema(sql);
    const values: Record<string, any> = body?.values || {};

    // 연결 해제(전체 삭제).
    if (body?.clear === true) {
      await deleteCredentials(sql, auth.userId, spec.provider);
      return send({ ok: true, message: `${spec.title} 연결을 해제했어요.` }, 200, origin);
    }

    // 알 수 없는 키는 버린다(스키마 밖 값 저장 방지).
    const allowed = new Set(spec.fields.map((f) => f.key));
    const filtered: Record<string, any> = {};
    for (const [k, v] of Object.entries(values)) if (allowed.has(k)) filtered[k] = v;

    // app_products 는 JSON 유효성 선검사 — 깨진 JSON이 저장돼 조용히 무시되는 것 방지.
    if (String(filtered.app_products || "").trim()) {
      try {
        const parsed = JSON.parse(String(filtered.app_products));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object 아님");
      } catch {
        return send({ ok: false, message: '앱별 상품 매핑이 올바른 JSON이 아니에요. 예: {"memoment":["상품UUID"]}' }, 200, origin);
      }
    }

    try {
      const saved = await saveCredentials(
        sql, auth.userId, spec.provider, filtered,
        spec.fields.filter((f) => f.secret).map((f) => f.key), env
      );
      if (!saved.length) return send({ ok: true, message: "변경된 값이 없어요." }, 200, origin);
      return send({ ok: true, message: `${spec.title} 설정을 저장했어요. '연결 테스트'로 확인해보세요.`, saved }, 200, origin);
    } catch (e: any) {
      return send({ ok: false, message: String(e?.message || "저장 실패") }, 200, origin);
    }
  }

  // 그 외 도구는 기존대로 스튜디오 공용 env 키 사용.
  return send({ ok: true, message: "NK 스튜디오 공용 키를 사용해요. 별도 입력이 필요 없어요." }, 200, origin);
};
