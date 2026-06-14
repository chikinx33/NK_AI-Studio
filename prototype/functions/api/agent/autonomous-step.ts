// prototype/functions/api/agent/autonomous-step.ts
// POST /api/agent/autonomous-step { conversationId? }
// 자율 근무 한 스텝: 출근(workMode=on) + 자율(autonomous=true)일 때만, 코어가 진행 중 프로젝트를
// 점검하고 직원에게 위임해 실제 업무를 한 걸음 진행시킨다. 프런트가 주기 폴링으로 호출.
// (브라우저가 열려 있는 동안 동작. 24/7 무인 실행은 Cloudflare Cron 후속.)
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, getRuntime } from "./_shared";
import { runGroupChat } from "./_orchestrator";

type PagesFunction = (ctx: {
  request: Request;
  env: any;
  waitUntil: (p: Promise<any>) => void;
}) => Promise<Response>;

const AUTO_TRIGGER =
  "[자율 근무 점검] 지금은 자율 근무 시간입니다. 진행 중인 프로젝트와 단톡방 맥락을 점검하고, " +
  "다음으로 필요한 작업이 있으면 담당 직원을 [[CALL: id | 구체적인 지시]]로 호출해 한 걸음 진행시키세요. " +
  "새로 시작할 일이 없으면 직원을 호출하지 말고 한 줄로만 '대기 중'이라고 답하세요. 같은 일을 반복 지시하지 마세요.";

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction = async ({ request, env, waitUntil }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
    await ensureAgentSchema(sql);

    // 휴식(퇴근) 중이거나 자율 모드가 꺼져 있으면 아무 활동도 하지 않는다.
    const rt = await getRuntime(sql, auth.userId).catch(() => ({ workMode: "on", autonomous: false }));
    if (rt.workMode === "off" || !rt.autonomous) {
      return send({ ok: true, skipped: true, reason: rt.workMode === "off" ? "resting" : "autonomous_off" }, 200, origin);
    }

    const body = await request.json().catch(() => ({} as any));
    const conversationId = String(body?.conversationId || "main").trim() || "main";

    const authHeader = String(request.headers.get("Authorization") || "");
    const toolCtx = { request, env, authHeader, userId: auth.userId };
    waitUntil(
      runGroupChat(env, { sql, userId: auth.userId, conversationId, toolCtx }, { autoTrigger: AUTO_TRIGGER }).catch(() => {})
    );

    return send({ ok: true, stepped: true, conversationId }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "자율 스텝 처리 중 오류" }, 500, origin);
  }
};
