// prototype/functions/api/agent/edge-brief.ts
// GET  /api/agent/edge-brief  → 그날 첫 접속 시 엣지 일일 수익 브리핑을 1회만 생성해 반환.
// POST /api/agent/edge-brief  → { enabled?, hour_kst? } 설정 변경.
// Pages Functions 에는 Cron Trigger 가 붙지 않아, 프런트의 기존 리마인더 폴링에 편승한다.
// ★ 전 구간 user_id 격리(authorizeRequest). ★ Polar 미등록이면 조용히 due:false (잔소리 반복 금지).
import { authorizeRequest } from "../_shared/auth.js";
import {
  send, corsHeaders, getSql, ensureAgentSchema, addMessage, runPolarMetricsTool,
} from "./_shared";
import { formatReadResult, getAgent } from "./_orchestrator";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

/** KST 기준 오늘 날짜(YYYY-MM-DD)와 현재 시(0~23). 서버 TZ와 무관하게 UTC+9로 직접 계산. */
function kstNow(): { date: string; hour: number } {
  const k = new Date(Date.now() + 9 * 3600 * 1000);
  return { date: k.toISOString().slice(0, 10), hour: k.getUTCHours() };
}

interface BriefRow { enabled: boolean; hour_kst: number; last_brief_date: string | null }

async function loadRow(sql: any, userId: string): Promise<BriefRow> {
  const rows = await sql(
    "SELECT enabled, hour_kst, last_brief_date FROM agent_daily_brief WHERE user_id = $1",
    [userId]
  );
  const r = rows[0];
  if (!r) return { enabled: true, hour_kst: 9, last_brief_date: null };
  return {
    enabled: r.enabled !== false,
    hour_kst: Number.isFinite(Number(r.hour_kst)) ? Number(r.hour_kst) : 9,
    // date 컬럼은 드라이버에 따라 Date 객체로 올 수 있어 문자열로 정규화.
    last_brief_date: r.last_brief_date ? String(r.last_brief_date).slice(0, 10) : null,
  };
}

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const { date, hour } = kstNow();
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const sql = getSql(env);
    if (!sql) return send({ due: false, date }, 200, origin);
    await ensureAgentSchema(sql);

    const row = await loadRow(sql, auth.userId);
    if (!row.enabled) return send({ due: false, date }, 200, origin);
    // 아직 브리핑 시각 전이거나, 오늘 이미 보냈으면 끝.
    if (hour < row.hour_kst) return send({ due: false, date }, 200, origin);
    if (row.last_brief_date && row.last_brief_date >= date) return send({ due: false, date }, 200, origin);

    const url = new URL(request.url);
    const conversationId = String(url.searchParams.get("conversationId") || date).trim() || date;
    const ctx = { request, env, authHeader: request.headers.get("Authorization") || "", userId: auth.userId, conversationId };

    // 오늘 + 최근 7일. Polar 미등록/토큰 오류면 여기서 throw → 조용히 due:false.
    let todayOut: any, weekOut: any;
    try {
      todayOut = await runPolarMetricsTool({ period: "today" }, ctx);
      weekOut = await runPolarMetricsTool({ period: "7d" }, ctx);
    } catch (_) {
      // 미등록·토큰만료 등 → 브리핑을 만들지 않는다. 매일 아침 "토큰 등록하세요" 반복 금지.
      return send({ due: false, date }, 200, origin);
    }

    const text = [
      `☀️ **오늘의 수익 브리핑** (${date} KST)`,
      ``,
      formatReadResult("polar_metrics", todayOut),
      ``,
      `---`,
      ``,
      formatReadResult("polar_metrics", weekOut),
    ].join("\n");

    const edge = getAgent("edge");
    // 대화에 남겨 새로고침 후에도 기록이 유지되게 한다.
    try {
      await addMessage(sql, {
        userId: auth.userId, conversationId, role: "agent",
        agentId: "edge", name: edge?.name || "엣지", text,
      });
    } catch (_) { /* 메시지 저장 실패해도 브리핑 자체는 내려준다 */ }

    // 같은 날 중복 브리핑 방지 — 반환 전에 갱신.
    await sql(
      `INSERT INTO agent_daily_brief (user_id, last_brief_date)
       VALUES ($1, $2::date)
       ON CONFLICT (user_id) DO UPDATE SET last_brief_date = EXCLUDED.last_brief_date, updated_at = now()`,
      [auth.userId, date]
    );

    return send({
      due: true, date,
      brief: { agentId: "edge", name: edge?.name || "엣지", emoji: edge?.emoji || "", text },
    }, 200, origin);
  } catch (e: any) {
    // 브리핑은 부가 기능 — 실패해도 앱 폴링을 깨지 않는다.
    return send({ due: false, date, error: e?.message || "브리핑 조회 오류" }, 200, origin);
  }
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const sql = getSql(env);
    if (!sql) return send({ ok: false, message: "DB에 연결하지 못했어요." }, 200, origin);
    await ensureAgentSchema(sql);

    const body: any = await request.json().catch(() => ({}));
    const cur = await loadRow(sql, auth.userId);
    const enabled = body?.enabled === undefined ? cur.enabled : !!body.enabled;
    const rawHour = Number(body?.hour_kst);
    const hour = Number.isFinite(rawHour) ? Math.min(Math.max(Math.trunc(rawHour), 0), 23) : cur.hour_kst;

    await sql(
      `INSERT INTO agent_daily_brief (user_id, enabled, hour_kst)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET enabled = EXCLUDED.enabled, hour_kst = EXCLUDED.hour_kst, updated_at = now()`,
      [auth.userId, enabled, hour]
    );
    return send({ ok: true, enabled, hour_kst: hour }, 200, origin);
  } catch (e: any) {
    return send({ ok: false, message: String(e?.message || "설정 저장 실패") }, 200, origin);
  }
};
