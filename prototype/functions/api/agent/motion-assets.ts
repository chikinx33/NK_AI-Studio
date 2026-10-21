// GET /api/agent/motion-assets?workId=
// 인포그래픽 영상 렌더 직전에 받을 자산 목록(브랜드 그림·업무 파일·배경음악)과 사이트 다운로드 경로를 돌려준다.
// 브라우저가 이 경로로 파일을 받아 이 PC 렌더러(server.js /local-motion)로 넘긴다.
import { authorizeRequest } from "../_shared/auth.js";
import { corsHeaders, getSql, send } from "./_shared";
import { buildMotionAssetManifest, normalizeMotionAssetSelection } from "./_motion-assets";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const workId = String(new URL(request.url).searchParams.get("workId") || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(workId)) return send({ error: "workId가 필요합니다." }, 400, origin);
    const sql = getSql(env);
    if (!sql) return send({ error: "DB를 사용할 수 없습니다." }, 503, origin);
    const rows = await sql(
      "SELECT metadata FROM company_work_items WHERE id = $1 AND user_id = $2 LIMIT 1",
      [workId, auth.userId],
    );
    if (!rows[0]) return send({ error: "회사 업무를 찾지 못했습니다." }, 404, origin);
    const selection = normalizeMotionAssetSelection(rows[0]?.metadata?.input?.assets);
    const manifest = await buildMotionAssetManifest({ env, sql, userId: auth.userId, selection });
    return send({ schema: "motion-assets/v1", workId, ...manifest }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "자산 목록을 만들지 못했습니다.") }, 500, origin);
  }
};
