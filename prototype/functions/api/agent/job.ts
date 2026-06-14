// prototype/functions/api/agent/job.ts
// POST /api/agent/job   — 잡 생성 + 백그라운드(waitUntil) 도구 실행
// GET  /api/agent/job?id=<id> — 잡 상태 폴링 (영상 status.ts 와 동형)
// ★ 멀티테넌시: 생성·조회 모두 authorizeRequest 의 userId 로 격리.
import { authorizeRequest } from "../_shared/auth.js";
import {
  AGENT_TOOLS,
  type ToolContext,
  send,
  corsHeaders,
  getSql,
  ensureAgentSchema,
  createJob,
  getJob,
  setJobStatus,
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
    if (!sql) return send({ error: "DATABASE_URL 미설정 — 잡 저장소(Neon)를 사용할 수 없습니다." }, 503, origin);
    await ensureAgentSchema(sql);

    const body = await request.json().catch(() => ({} as any));
    const type = String(body?.type || "").trim();
    const requestedAgent = String(body?.agentId || "").trim();
    const input = body?.input && typeof body.input === "object" ? body.input : {};

    const tool = AGENT_TOOLS[type];
    if (!tool) {
      return send({ error: `알 수 없는 작업 유형: "${type}"`, allowed: Object.keys(AGENT_TOOLS) }, 400, origin);
    }
    // agentId 가 오면 도구 소유 에이전트와 일치해야 함(없으면 도구 기본값 사용).
    const agentId = requestedAgent || tool.agentId;
    if (requestedAgent && requestedAgent !== tool.agentId) {
      return send({ error: `"${type}" 작업은 ${tool.agentId} 담당입니다.` }, 400, origin);
    }

    const job = await createJob(sql, { userId: auth.userId, type, agentId, input });

    // 백그라운드 처리: 응답은 즉시 jobId 반환, 실제 도구 실행은 waitUntil 로.
    const authHeader = String(request.headers.get("Authorization") || "");
    waitUntil(processJob({ request, env, authHeader, userId: auth.userId }, sql, job.id, type, input));

    return send({ ok: true, jobId: job.id, status: job.status, agentId }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "잡 생성 중 오류" }, 500, origin);
  }
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!id) return send({ error: "id is required" }, 400, origin);

    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
    await ensureAgentSchema(sql);

    const job = await getJob(sql, id, auth.userId);
    if (!job) return send({ error: "not_found" }, 404, origin); // 타인 잡도 404로 숨김
    return send({ ok: true, job }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "잡 조회 중 오류" }, 500, origin);
  }
};

/** 도구 실행 파이프라인: working → (tool.run) → review_pending | error. */
async function processJob(
  ctx: ToolContext,
  sql: ReturnType<typeof getSql>,
  jobId: string,
  type: string,
  input: any
): Promise<void> {
  if (!sql) return;
  try {
    await setJobStatus(sql, jobId, ctx.userId, { status: "working" });
    const tool = AGENT_TOOLS[type];
    const output = await tool.run(input, ctx);
    // Phase 0: 부수효과 없는 생성물 → 자동 완료 후 사람 검수 게이트로.
    await setJobStatus(sql, jobId, ctx.userId, {
      status: "review_pending",
      output,
      reviewStatus: "pending",
    });
  } catch (e: any) {
    await setJobStatus(sql, jobId, ctx.userId, {
      status: "error",
      error: String(e?.message || e || "tool_failed"),
    });
  }
}
