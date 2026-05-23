// prototype/functions/api/project/share.ts
// 프로젝트 공유 관리. 소유자만 자신의 프로젝트를 다른 계정에 부여/회수할 수 있다.
//   GET    /api/project/share        → 내가 공유한 목록 + 나에게 공유된 목록 (+관리자: 전체 현황)
//   POST   /api/project/share        → 소유자가 대상 계정에 권한 부여/갱신 {projectId, targetUserId, role, title?}
//   DELETE /api/project/share        → 소유자가 권한 회수 {projectId, targetUserId}
import { authorizeRequest, sanitizeUserId } from "../_shared/auth.js";
import { requireAdmin } from "../_shared/admin-users";
import {
  loadShares,
  loadSharesStrict,
  saveShares,
  upsertGrant,
  removeGrant,
  listSharedWith,
  listSharedByOwner,
  type ShareRole,
} from "../_shared/shares";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const corsHeaders = (origin: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
});

const send = (data: any, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env, { allowQueryToken: true });
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const reg = await loadShares(env);
    const me = auth.userId;
    const result: any = {
      ok: true,
      sharedByMe: listSharedByOwner(reg, me),
      sharedWithMe: listSharedWith(reg, me),
    };
    // 관리자에게는 전체 현황(읽기 전용)을 함께 제공.
    if (await requireAdmin(env, me)) result.all = reg.shares;
    return send(result, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, origin);
  }
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const body = await request.json().catch(() => ({} as any));
    const projectId = String(body.projectId || "").trim();
    const targetUserId = sanitizeUserId(body.targetUserId || "");
    const role: ShareRole = String(body.role || "").toLowerCase() === "editor" ? "editor" : "viewer";
    const title = typeof body.title === "string" ? body.title : "";
    const seriesId = typeof body.seriesId === "string" ? body.seriesId : "";
    const seriesTitle = typeof body.seriesTitle === "string" ? body.seriesTitle : "";
    if (!projectId || !/^[a-zA-Z0-9._-]+$/.test(projectId)) return send({ error: "invalid_project_id" }, 400, origin);
    if (!targetUserId) return send({ error: "invalid_target_user" }, 400, origin);
    // 소유자만 공유 가능 — ownerId는 항상 요청자 본인.
    if (targetUserId === auth.userId) return send({ error: "cannot_share_with_self" }, 400, origin);

    const reg = await loadSharesStrict(env);
    upsertGrant(reg, auth.userId, projectId, targetUserId, role, title, seriesId, seriesTitle);
    await saveShares(env, reg);
    return send({ ok: true, projectId, targetUserId, role }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, origin);
  }
};

export const onRequestDelete: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const body = await request.json().catch(() => ({} as any));
    let projectId = String(body.projectId || "").trim();
    let targetUserId = sanitizeUserId(body.targetUserId || "");
    if (!projectId) {
      try {
        const u = new URL(request.url);
        projectId = String(u.searchParams.get("projectId") || "").trim();
        targetUserId = sanitizeUserId(u.searchParams.get("targetUserId") || "");
      } catch (_) { /* noop */ }
    }
    if (!projectId) return send({ error: "invalid_project_id" }, 400, origin);
    if (!targetUserId) return send({ error: "invalid_target_user" }, 400, origin);

    const reg = await loadSharesStrict(env);
    // 소유자만 회수 가능 — 요청자 소유 프로젝트의 grant만 제거.
    removeGrant(reg, auth.userId, projectId, targetUserId);
    await saveShares(env, reg);
    return send({ ok: true, projectId, targetUserId }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
