// prototype/functions/api/agent/cancel-job.ts
// POST /api/agent/cancel-job { id }
// 작업 취소 — 담당 에이전트가 AI로 취소 멘트 생성(하드코딩 없음) + 관련 지식 자율 정리
import { authorizeRequest } from "../_shared/auth.js";
import {
  send,
  corsHeaders,
  getSql,
  ensureAgentSchema,
  getJob,
  setJobStatus,
  addMessage,
  AGENT_META,
} from "./_shared";
import { speak, applyKnows } from "./_orchestrator";

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
    if (!id) return send({ error: "id is required" }, 400, origin);

    const job = await getJob(sql, id, auth.userId);
    if (!job) return send({ error: "not_found" }, 404, origin);

    if (job.status === "cancelled" || job.status === "approved") {
      return send({ error: "이미 처리된 작업이에요." }, 409, origin);
    }

    // 잡 취소 상태 기록
    await setJobStatus(sql, id, auth.userId, { status: "cancelled" });

    const agentId = job.agent_id;
    const meta = AGENT_META[agentId] || { name: agentId, role: "" };
    const inputDesc = String(job.input?.prompt || job.input?.topic || job.type || "작업").slice(0, 200);

    // 담당 에이전트: 취소 확인 멘트 + 관련 지식 정리 (AI가 자율 판단 — 하드코딩 없음)
    const cancelTrigger =
      `사용자가 "${job.type}" 작업(주제: "${inputDesc}")의 결과물을 취소·철회했습니다.\n` +
      `자연스럽게 1~2문장으로 취소를 확인하는 멘트를 해주세요. 불필요한 사과 없이 간결하게.\n` +
      `회사 지식 중 이 작업과 직접 관련된 항목이 있다면 ` +
      `[[KNOW: del | 결정 | 항목내용]] 마커로 삭제하거나 ` +
      `[[KNOW: mod | 결정 | 수정된 내용]] 마커로 업데이트할 수 있습니다.`;

    const agentRes = await speak(env, agentId, cancelTrigger, "", { sql, userId: auth.userId });
    await applyKnows(sql, auth.userId, agentRes.knows, meta.name);

    // 오늘 대화에 에이전트 메시지 저장 (클라이언트가 직접 표시)
    const today = new Date().toISOString().slice(0, 10);
    const savedMsg = await addMessage(sql, {
      userId: auth.userId,
      conversationId: today,
      role: "agent",
      agentId,
      name: meta.name,
      text: agentRes.text,
    });

    // 코어: 백그라운드로 관련 지식 추가 검토 (waitUntil — 응답 후 비동기 처리)
    waitUntil((async () => {
      const coreTrigger =
        `[백그라운드 지식 검토] "${job.type}" 작업(주제: "${inputDesc}")이 사용자에 의해 취소되었습니다. ` +
        `회사 지식 중 이 결정과 관련하여 삭제하거나 수정할 항목이 있는지 검토하세요. ` +
        `필요한 경우에만 KNOW 마커로 처리하고, 없으면 아무것도 하지 마세요.`;
      const coreRes = await speak(env, "core", coreTrigger, "", { sql, userId: auth.userId }).catch(() => null);
      if (coreRes?.knows?.length) {
        await applyKnows(sql, auth.userId, coreRes.knows, "코어").catch(() => {});
      }
    })());

    return send({ ok: true, message: savedMsg }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "취소 처리 중 오류" }, 500, origin);
  }
};
