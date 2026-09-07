// GET /api/agent/skill-jobs?skillId=video_pipeline&projectId=<id>&limit=20
//
// SkillJob 목록. 제작 캔버스의 에이전트 모드 패널이 "이 프로젝트의 최신 파이프라인"을 찾을 때 쓴다 —
// 채팅에서 video_pipeline 도구로 만든 잡도 패널이 잡아 승인 버튼을 보여줘야 대화형이 완성된다.
import { authorizeRequest } from "../_shared/auth.js";
import { corsHeaders, ensureAgentSchema, getSql, send } from "./_shared";
import { listCompanySkillJobs, toCompanySkillJobDto } from "./_skill-jobs";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const url = new URL(request.url);
    const skillId = String(url.searchParams.get("skillId") || "").trim();
    const projectId = String(url.searchParams.get("projectId") || "").trim();
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
    await ensureAgentSchema(sql);
    const rows = await listCompanySkillJobs(sql, auth.userId, 100);
    const jobs = rows
      .filter((row) => !skillId || row.skill_id === skillId)
      .filter((row) => {
        if (!projectId) return true;
        const input = row.input && typeof row.input === "object" ? row.input as any : {};
        return String(input?.options?.projectId || "") === projectId;
      })
      .slice(0, limit)
      .map((row) => toCompanySkillJobDto(row));
    return send({ ok: true, jobs }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "SkillJob 목록 조회 실패") }, 500, origin);
  }
};
