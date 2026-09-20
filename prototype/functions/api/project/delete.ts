// prototype/functions/api/project/delete.ts
// Delete objects under:
// {basePrefix}/users/{userId}/ai-video/projects{projectId}/
import { buildAiVideoProjectPrefix, buildAiVideoUserRoot } from "../_shared/storage";
import { authorizeRequest } from "../_shared/auth.js";
import { loadSharesStrict, saveShares, removeProjectShares, removeAllOwnerShares } from "../_shared/shares";
import { deleteGcsObjects, listGcsObjects, resolveGcsEnv } from "../_shared/gcs.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

// Open CORS for local/server dashboards.
const corsHeaders = (origin: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Origin": origin || "*",
  "Vary": "Origin",
});

const send = (data: any, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const body = await request.json().catch(() => ({} as any));
    const projectId = String(body.projectId || "").trim();
    const userId = auth.userId;
    const confirm = String(body.confirm || "").trim() === "yes";
    const deleteAll = String(body.all || "").trim() === "true";
    if (!projectId || !confirm) {
      return send({ error: "projectId and confirm=yes are required" }, 400, origin);
    }

    const { basePrefix } = resolveGcsEnv(env);
    const userRoot = buildAiVideoUserRoot(basePrefix, userId);
    const projectPrefix = buildAiVideoProjectPrefix(basePrefix, userId, projectId);
    const prefix = deleteAll ? `${userRoot}/projects` : `${projectPrefix}/`;

    // Validate prefix boundaries (simple sanity check)
    if (!deleteAll && !/^[a-zA-Z0-9._-]+$/.test(projectId)) {
      return send({ error: "Invalid projectId format" }, 400, origin);
    }

    const objectName = String((body.objectName || body.object || "")).trim();
    const objectNames = Array.isArray(body.objectNames)
      ? body.objectNames.map((value: any) => String(value || "").trim()).filter(Boolean)
      : [];
    if (objectName || objectNames.length) {
      const allowedPrefix = `${projectPrefix}/`;
      const deleteTargets = objectNames.length ? objectNames : [objectName];
      if (deleteTargets.some((name) => !name.startsWith(allowedPrefix))) {
        return send({ error: "Invalid objectName for project" }, 400, origin);
      }
      const result = await deleteGcsObjects(env, deleteTargets);
      return send({
        ...result,
        single: deleteTargets.length === 1,
      }, 200, origin);
    }

    // 프로젝트 전체 삭제도 같은 배치 경로를 사용해 객체 수와 무관하게 서브요청을 제한한다.
    const names = (await listGcsObjects(env, prefix)).filter((name: string) => name.startsWith(prefix));
    const result = await deleteGcsObjects(env, names);

    // 프로젝트(또는 전체) 삭제 시, 해당 프로젝트의 공유 grant도 정리한다.
    // (남아있으면 공유받은 계정 화면에 유령 카드가 보임)
    try {
      const sreg = await loadSharesStrict(env);
      if (deleteAll) removeAllOwnerShares(sreg, userId);
      else removeProjectShares(sreg, userId, projectId);
      await saveShares(env, sreg);
    } catch (_) { /* 공유 정리 실패는 삭제 자체를 막지 않음 */ }

    return send({ ...result, listedCount: names.length, prefix, deleteAll }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, request.headers.get("Origin"));
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) => {
  const origin = request.headers.get("Origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
};
