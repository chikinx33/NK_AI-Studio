// prototype/functions/api/agent/worker-step.ts
// POST /api/agent/worker-step
// 체인 방식 직원 단일 실행 엔드포인트.
// runGroupChat이 5명 이상 위임 시 직원을 이곳으로 하나씩 보내 독립 CF invocation(새 30s 윈도우)에서 처리.
// 현재 직원을 처리한 뒤 waitUntil 안에서 다음 worker-step을 연쇄 호출 — 사슬처럼 이어짐.
import { authorizeRequest } from "../_shared/auth.js";
import { hasPagePermission } from "../_shared/admin-users.js";
import { send, corsHeaders, getSql, ensureAgentSchema } from "./_shared";
import { runWorkerStep } from "./_orchestrator";

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
    if (!(await hasPagePermission(env, auth.userId, "ai_company"))) {
      return send({ error: "forbidden" }, 403, origin);
    }

    const sql = getSql(env);
    if (!sql) return send({ error: "no database" }, 503, origin);
    await ensureAgentSchema(sql);

    const body = await request.json().catch(() => ({} as any));
    const { conversationId, message, address, calls, callIndex } = body as {
      conversationId: string;
      message: string;
      address: string;
      calls: { agentId: string; instruction: string }[];
      callIndex: number;
    };

    if (!Array.isArray(calls) || callIndex >= calls.length) {
      return send({ ok: true, done: true }, 200, origin);
    }

    const current = calls[callIndex];
    const authHeader = request.headers.get("Authorization") || "";
    const requestOrigin = new URL(request.url).origin;

    // 현재 직원 실행 + 다음 직원 체인 — waitUntil으로 즉시 응답 반환 후 백그라운드 처리
    waitUntil(
      (async () => {
        try {
          await runWorkerStep(env, {
            sql,
            userId: auth.userId,
            conversationId,
            message,
            address,
            agentId: current.agentId,
            instruction: current.instruction,
          });
        } catch (e) {
          console.error(`[worker-step] ${current.agentId} 실패:`, e);
          // 실패해도 체인은 계속 이어짐
        }

        // 다음 직원이 있으면 새 invocation으로 체인
        const nextIndex = callIndex + 1;
        if (nextIndex < calls.length) {
          await fetch(`${requestOrigin}/api/agent/worker-step`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": authHeader },
            body: JSON.stringify({ conversationId, message, address, calls, callIndex: nextIndex }),
          }).catch(() => {});
        }
      })()
    );

    // HTTP 응답은 즉시 반환 — 실제 처리는 waitUntil 백그라운드
    return send({ ok: true, agentId: current.agentId, callIndex }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "worker-step 처리 중 오류" }, 500, origin);
  }
};
