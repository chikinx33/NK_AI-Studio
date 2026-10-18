// prototype/functions/api/agent/publish-step.ts
// POST /api/agent/publish-step { jobId, index, abandon? }
// 승인된 발행(publish) 잡의 채널 하나를 올린다. 승인(review.ts)이 채널 목록(publishSteps)을 돌려주면
// 화면이 채널마다 이 요청을 동시에 보낸다 — 한 요청에서 8개 채널을 다 올리면 100초를 넘어 524 로 끊겼다(2026-10-18).
// abandon: 화면이 그 채널 요청의 응답을 못 받았을 때(시간 초과 등) '확인 필요' 실패로 기록해 마무리가 막히지 않게 한다.
// ★ 멀티테넌시: 본인 잡만(runPublishStep 이 user_id 로 조회).
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, AGENT_META, runPublishStep } from "./_shared";
import { approvalDoneText } from "./review";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
    await ensureAgentSchema(sql);
    const body: any = await request.json().catch(() => ({}));
    const jobId = String(body?.jobId || "").trim();
    const index = Number(body?.index);
    if (!/^[0-9a-f-]{36}$/i.test(jobId) || !Number.isInteger(index) || index < 0) return send({ error: "jobId·index 가 필요해요." }, 400, origin);
    const abandon = body?.abandon ? String(body.reason || "응답을 받지 못했어요").slice(0, 160) : "";
    const authHeader = String(request.headers.get("Authorization") || "");
    const { step, final } = await runPublishStep(sql, { request, env, authHeader, userId: auth.userId }, jobId, index, abandon);
    if (!final) return send({ ok: true, step, done: false }, 200, origin);
    const meta = AGENT_META.reach || { name: "리치" };
    return send({
      ok: true, step, done: true,
      message: {
        role: "agent", agentId: "reach", name: meta.name, files: [],
        text: final.failedText ? `⚠️ ${final.failedText}` : approvalDoneText("publish", final.output, {}),
      },
    }, 200, origin);
  } catch (e: any) {
    return send({ error: String(e?.message || e || "채널 발행에 실패했어요.") }, 500, origin);
  }
};
