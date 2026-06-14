// prototype/functions/api/agent/chat.ts
// POST /api/agent/chat { message, conversationId? }
// 단톡방에 사용자 메시지 → 코어가 응답(Phase 1a: 코어 단일, waitUntil 백그라운드).
// ★ 멀티테넌시: user_id 격리. 위임·통솔(멀티 호출)은 Phase 1b(Workflows).
import { authorizeRequest } from "../_shared/auth.js";
import {
  send,
  corsHeaders,
  getSql,
  ensureAgentSchema,
  addMessage,
  getRuntime,
} from "./_shared";
import { runGroupChat } from "./_orchestrator";

type PagesFunction = (ctx: {
  request: Request;
  env: any;
  waitUntil: (p: Promise<any>) => void;
}) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction = async ({ request, env, waitUntil }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정 — 대화 저장소(Neon)를 사용할 수 없습니다." }, 503, origin);
    await ensureAgentSchema(sql);

    const body = await request.json().catch(() => ({} as any));
    const message = String(body?.message || "").trim();
    const conversationId = String(body?.conversationId || "main").trim() || "main";
    if (!message) return send({ error: "message is required" }, 400, origin);

    const userMsg = await addMessage(sql, {
      userId: auth.userId, conversationId, role: "user", text: message,
    });

    // 휴식(퇴근) 중에는 모든 에이전트가 활동을 멈춘다 — 코어가 짧게 안내만 하고 위임/통솔하지 않음.
    const rt = await getRuntime(sql, auth.userId).catch(() => ({ workMode: "on", autonomous: false }));
    if (rt.workMode === "off") {
      await addMessage(sql, {
        userId: auth.userId, conversationId, role: "agent", agentId: "core", name: "코어",
        text: "지금은 모두 휴식 중이에요. 🌙 출근시키면 다시 일을 시작할게요.",
      }).catch(() => {});
      return send({ ok: true, conversationId, userMessageId: userMsg.id, resting: true }, 200, origin);
    }

    // 위임·통솔은 백그라운드(waitUntil)에서 멀티 호출. 프런트는 /api/agent/messages 폴링으로 받음.
    const authHeader = String(request.headers.get("Authorization") || "");
    const toolCtx = { request, env, authHeader, userId: auth.userId };
    waitUntil(
      runGroupChat(env, { sql, userId: auth.userId, conversationId, toolCtx, firstMessage: message }).catch(async (e: any) => {
        await addMessage(sql, {
          userId: auth.userId, conversationId, role: "agent", agentId: "core", name: "코어",
          text: `⚠️ 응답 생성 중 문제가 생겼어요: ${String(e?.message || e)}`,
        }).catch(() => {});
      })
    );

    return send({ ok: true, conversationId, userMessageId: userMsg.id }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "대화 처리 중 오류" }, 500, origin);
  }
};
