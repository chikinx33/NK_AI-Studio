// prototype/functions/api/agent/review.ts
// POST /api/agent/review { id, decision: "approved"|"revise", note? }
// 사람(엔케)의 검수 게이트. 승인 시 회사 지식에 "결정" 1줄 적재(맛보기, best-effort).
// ★ 멀티테넌시: 본인 잡만 검수 가능(getJob 이 user_id 격리).
import { authorizeRequest } from "../_shared/auth.js";
import {
  send,
  corsHeaders,
  getSql,
  ensureAgentSchema,
  getJob,
  setJobStatus,
  AGENT_META,
  AGENT_TOOLS,
} from "./_shared";

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
    if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
    await ensureAgentSchema(sql);

    const body = await request.json().catch(() => ({} as any));
    const id = String(body?.id || "").trim();
    const decision = String(body?.decision || "").trim();
    const note = body?.note != null ? String(body.note).slice(0, 2000) : null;
    if (!id) return send({ error: "id is required" }, 400, origin);
    if (decision !== "approved" && decision !== "revise") {
      return send({ error: 'decision must be "approved" or "revise"' }, 400, origin);
    }

    const job = await getJob(sql, id, auth.userId);
    if (!job) return send({ error: "not_found" }, 404, origin); // 타인 잡 숨김

    // 승인 게이트 도구(gate)는 승인 전에는 실행되지 않은 상태(output 없음)다.
    // → 승인된 지금 비로소 실제로 실행한다("승인 후 실제 업무 추진").
    const tool = AGENT_TOOLS[job.type];
    let updated;
    if (decision === "approved" && tool?.gate && !job.output) {
      try {
        const authHeader = String(request.headers.get("Authorization") || "");
        const toolInput = typeof job.input === "string" ? (() => { try { return JSON.parse(job.input); } catch { return {}; } })() : (job.input || {});
        const output = await tool.run(toolInput, { request, env, authHeader, userId: auth.userId });
        updated = await setJobStatus(sql, id, auth.userId, {
          status: "approved", output, reviewStatus: "approved", reviewNote: note,
        });
      } catch (e: any) {
        await setJobStatus(sql, id, auth.userId, { status: "error", error: String(e?.message || e) });
        return send({ error: `승인 실행 중 오류: ${e?.message || e}` }, 500, origin);
      }
    } else {
      updated = await setJobStatus(sql, id, auth.userId, {
        status: decision === "approved" ? "approved" : "revise",
        reviewStatus: decision,
        reviewNote: note,
      });
    }

    // 승인 시: 회사 지식에 "사용 확정"을 결정으로 적재(맛보기). 실패해도 검수는 성공 처리.
    if (decision === "approved") {
      const meta = AGENT_META[job.agent_id] || { name: job.agent_id, role: "" };
      const text = `${meta.name}(${meta.role})의 ${job.type} 산출물 사용 확정`;
      const authHeader = String(request.headers.get("Authorization") || "");
      waitUntil(recordDecision(request, authHeader, text).catch(() => {}));
    }

    return send({ ok: true, job: updated }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "검수 처리 중 오류" }, 500, origin);
  }
};

/** 회사 지식 적재(맛보기) — 기존 /api/knowledge 재사용. RAG 미설정이면 graceful 무시. */
async function recordDecision(request: Request, authHeader: string, text: string): Promise<void> {
  await fetch(new URL("/api/knowledge", request.url).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify({ name: "ai-company-decision", text }),
  });
}
