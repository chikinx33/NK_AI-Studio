// prototype/functions/api/agent/integration-test.ts
// POST /api/agent/integration-test { tool } — 도구의 NK 키 설정 여부로 연결 상태 확인.
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, getGoogleOAuth } from "./_shared";
import { refreshAccessToken } from "./_google";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const TOOL_KEYS: Record<string, { key: string; alt?: string[] }[]> = {
  image: [{ key: "GEMINI_API_KEY", alt: ["GOOGLE_API_KEY", "OPENAI_API_KEY"] }],
  sound: [{ key: "ELEVENLABS_API_KEY" }],
  video: [{ key: "ATLASCLOUD_API_KEY", alt: ["XAI_API_KEY"] }],
  web_search: [{ key: "TAVILY_API_KEY", alt: ["TAVILY_KEY"] }],
  naver_datalab: [{ key: "NAVER_CLIENT_ID" }, { key: "NAVER_CLIENT_SECRET" }],
  github: [], // 키 없이도 공개 레포 동작 → 항상 사용 가능
};
const has = (env: any, key: string, alt?: string[]) =>
  !!String(env?.[key] || "").trim() || (alt || []).some((k) => String(env?.[k] || "").trim());

/** 싱크 구글 연동 테스트 — refresh_token 으로 access token 갱신 + 읽기 1건(부수효과 없음). */
async function testGoogle(env: any, userId: string, tool: string): Promise<{ ok: boolean; message: string }> {
  let row: { refresh_token: string; email: string | null; scopes?: string } | null = null;
  try {
    const sql = getSql(env);
    await ensureAgentSchema(sql);
    row = await getGoogleOAuth(sql, userId);
  } catch {
    return { ok: false, message: "연결 상태를 확인하지 못했어요(DB)." };
  }
  if (!row?.refresh_token) return { ok: false, message: "아직 구글이 연결되지 않았어요. '구글 연결'을 먼저 해주세요." };
  let access = "";
  try {
    access = await refreshAccessToken(env, row.refresh_token);
  } catch (e: any) {
    return { ok: false, message: `토큰 갱신 실패 — 다시 연결해주세요. (${String(e?.message || e)})` };
  }
  try {
    if (tool === "gmail") {
      const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { Authorization: `Bearer ${access}` },
      });
      const d: any = await r.json();
      if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`);
      return { ok: true, message: `✅ Gmail 연결 정상 — ${d.emailAddress || row.email || ""} (총 ${d.messagesTotal ?? "?"}통)` };
    }
    if (tool === "drive") {
      const r = await fetch(
        "https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id,name)",
        { headers: { Authorization: `Bearer ${access}` } }
      );
      const d: any = await r.json();
      if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status} — 드라이브 권한이 없으면 구글을 재연결해주세요.`);
      return { ok: true, message: `✅ 드라이브 연결 정상 — 파일 읽기 확인` };
    }
    if (tool === "sheets") {
      // 시트는 기본 조회 대상이 없어 부여된 스코프로 확인.
      if (!/spreadsheets/.test(row.scopes || "")) {
        return { ok: false, message: "시트 권한이 아직 없어요. 구글 '연결 해제' 후 다시 연결하면 시트 권한이 추가돼요." };
      }
      return { ok: true, message: "✅ 시트 권한 연결됨(읽기 전용) — 시트 URL을 주면 읽어와요." };
    }
    // calendar
    const r = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1",
      { headers: { Authorization: `Bearer ${access}` } }
    );
    const d: any = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`);
    return { ok: true, message: `✅ 캘린더 연결 정상 — '${d.summary || "primary"}' 읽기 확인` };
  } catch (e: any) {
    return { ok: false, message: `❌ 연결 실패: ${String(e?.message || e)}` };
  }
}

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const body = await request.json().catch(() => ({} as any));
  const tool = String(body?.tool || "").trim();

  // 구글 OAuth 연동(싱크 gmail·calendar·drive, 엣지 sheets)은 사용자별 토큰으로 라이브 검증.
  if (tool === "gmail" || tool === "calendar" || tool === "drive" || tool === "sheets") {
    return send(await testGoogle(env, auth.userId, tool), 200, origin);
  }

  const keys = TOOL_KEYS[tool];
  if (!keys) return send({ ok: false, message: `알 수 없는 도구: ${tool}` }, 200, origin);
  if (tool === "github") {
    const ok = has(env, "GITHUB_TOKEN", ["GH_TOKEN"]);
    return send({ ok: true, message: ok ? "✅ GitHub 연결됨 — 토큰 설정됨(사설·높은 한도)." : "✅ GitHub 사용 가능 — 공개 레포는 토큰 없이도 동작해요. (사설/한도↑는 GITHUB_TOKEN)" }, 200, origin);
  }
  const ok = keys.every((k) => has(env, k.key, k.alt));
  return send({
    ok,
    message: ok ? "연결됨 — NK 스튜디오 공용 키로 작동해요." : "스튜디오에 이 도구의 키가 아직 설정되지 않았어요.",
  }, 200, origin);
};
