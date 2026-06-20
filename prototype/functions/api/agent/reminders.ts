// prototype/functions/api/agent/reminders.ts
// GET /api/agent/reminders → 발화 시각이 된(아직 안 울린) 알람을 '울림' 처리하고 반환. ★ user_id 격리.
// 프런트가 주기 폴링해 브라우저 알림+채팅+소리로 알린다. (앱이 열려 있는 동안 동작)
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, popDueReminders, listUpcomingReminders } from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const sql = getSql(env);
    if (!sql) return send({ due: [], upcoming: [] }, 200, origin);
    await ensureAgentSchema(sql);
    const due = await popDueReminders(sql, auth.userId); // 경과/실행 → 삭제하며 반환(울림용)
    const upcoming = await listUpcomingReminders(sql, auth.userId); // 예정 목록(예약 패널용)
    return send({ due, upcoming }, 200, origin);
  } catch (e: any) {
    return send({ due: [], upcoming: [], error: e?.message || "알람 조회 오류" }, 200, origin);
  }
};
