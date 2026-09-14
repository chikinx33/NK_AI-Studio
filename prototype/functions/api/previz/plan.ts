// POST /api/previz/plan — 프리비즈 자동 연출 계획.
// body: { projectId, targetIds[], contextIds?[], prior?{actors,views,heights}, setSize?[w,d] }
// 응답: { ok, plan, targets, model }  plan 은 모델이 낸 JSON(형식 검증·좌표 풀이는 클라이언트 autoStage.ts).
//
// 스튜디오 기능이라 사용자가 등록한 Claude 자격증명만 쓴다(studioAuth). 미등록이면 412.
// Cloudflare 30초 안에 끝나도록 요청당 컷 수를 PREVIZ_PLAN_CHUNK 로 제한하고 25초에 끊는다.
import { authorizeRequest } from "../_shared/auth.js";
import { buildClaudeSystem, claudeFetch, studioAuth, isClaudeAuthRequired, CLAUDE_AUTH_REQUIRED } from "../_shared/claude-auth.js";
import { isCreditExhausted } from "../_shared/credit-exhausted.js";
import { buildPrevizPlanPrompt, extractPlanJson, PREVIZ_PLAN_CHUNK, PREVIZ_PLAN_MAX_TOKENS, PREVIZ_PLAN_MODEL } from "../_shared/previz-plan.js";
import { AGENT_TOOLS, corsHeaders, send } from "../agent/_shared";

const TIMEOUT_MS = 25_000;

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const who = await authorizeRequest(request, env);
    if (!who.ok) return send({ error: who.error }, who.status, origin);

    let auth: any;
    try {
      auth = await studioAuth(env, who.userId);
    } catch (e) {
      if (isClaudeAuthRequired(e)) return send({ error: CLAUDE_AUTH_REQUIRED }, 412, origin);
      throw e;
    }

    const body: any = await request.json().catch(() => null);
    const projectId = String(body?.projectId || "").trim();
    const targetIds = (Array.isArray(body?.targetIds) ? body.targetIds : []).map(String).slice(0, PREVIZ_PLAN_CHUNK);
    if (!projectId || !targetIds.length) return send({ error: "projectId and targetIds are required" }, 400, origin);

    const ctx = { request, env, authHeader: String(request.headers.get("Authorization") || ""), userId: who.userId };
    const project = await AGENT_TOOLS.project_get.run({ projectId }, ctx as any);
    const prompt = buildPrevizPlanPrompt(project, {
      targetIds,
      contextIds: Array.isArray(body?.contextIds) ? body.contextIds : [],
      prior: body?.prior && typeof body.prior === "object" ? body.prior : {},
      setSize: Array.isArray(body?.setSize) ? body.setSize : null,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("previz_plan_timeout"), TIMEOUT_MS);
    let text = "";
    try {
      const res = await claudeFetch(env, auth, (sub: boolean) => ({
        model: PREVIZ_PLAN_MODEL,
        max_tokens: PREVIZ_PLAN_MAX_TOKENS,
        temperature: 0.3,
        system: buildClaudeSystem(sub, prompt.system),
        messages: [{ role: "user", content: prompt.user }],
      }), { signal: controller.signal });
      const raw = await res.text();
      if (!res.ok) {
        if (isCreditExhausted(raw, res.status)) return send({ error: "CREDIT_EXHAUSTED" }, 402, origin);
        return send({ error: `Claude ${res.status}: ${raw.slice(0, 300)}` }, 500, origin);
      }
      const data = JSON.parse(raw);
      text = (Array.isArray(data?.content) ? data.content : []).map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");
    } catch (e: any) {
      if (controller.signal.aborted) return send({ error: "previz_plan_timeout" }, 500, origin);
      throw e;
    } finally {
      clearTimeout(timer);
    }

    const plan = extractPlanJson(text);
    return send({ ok: true, plan, targets: prompt.targets, model: PREVIZ_PLAN_MODEL }, 200, origin);
  } catch (e: any) {
    return send({ error: String(e?.message || e || "previz plan failed") }, 500, origin);
  }
};
