// prototype/functions/api/admin/users.ts
// 회원 관리 CRUD 엔드포인트. 모든 메서드는 관리자 권한(requireAdmin)을 요구한다.
//   GET    /api/admin/users            → 회원 목록(비밀번호 해시 제외)
//   POST   /api/admin/users            → 신규 회원 생성
//   PATCH  /api/admin/users            → 회원 정보/권한/비밀번호 수정 (body.id 대상)
//   DELETE /api/admin/users            → 회원 삭제 (body.id 또는 ?id=, soft/hard)
import { authorizeRequest, sanitizeUserId } from "../_shared/auth.js";
import { hashPassword } from "../_shared/password.js";
import {
  loadRegistry,
  loadRegistryStrict,
  saveRegistry,
  findUser,
  requireAdmin,
  createUserRecord,
  sanitizePermissions,
  publicUser,
  primaryAdminId,
  REGISTRY_VERSION,
} from "../_shared/admin-users";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const corsHeaders = (origin: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
});

const send = (data: any, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });

/** 인증 + 관리자 검증 공통 처리. 실패 시 Response, 성공 시 { userId } 반환. */
async function gate(request: Request, env: any, origin: string | null): Promise<Response | { userId: string }> {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const isAdmin = await requireAdmin(env, auth.userId);
  if (!isAdmin) return send({ error: "admin_required" }, 403, origin);
  return { userId: auth.userId };
}

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const g = await gate(request, env, origin);
    if (g instanceof Response) return g;
    const reg = await loadRegistry(env);
    return send(
      {
        ok: true,
        version: reg.version || REGISTRY_VERSION,
        updatedAt: reg.updatedAt || "",
        users: reg.users.map(publicUser),
      },
      200,
      origin,
    );
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, origin);
  }
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const g = await gate(request, env, origin);
    if (g instanceof Response) return g;
    const body = await request.json().catch(() => ({} as any));
    const id = sanitizeUserId(body.id || "");
    if (!id) return send({ error: "invalid_user_id" }, 400, origin);
    const pw = String(body.password || "");
    if (!pw) return send({ error: "password_required" }, 400, origin);

    const reg = await loadRegistryStrict(env);
    if (findUser(reg, id)) return send({ error: "user_exists" }, 409, origin);

    const record = await createUserRecord({
      id,
      name: body.name,
      password: pw,
      permissions: body.permissions,
      role: body.role === "admin" ? "admin" : "member",
      active: body.active !== false,
    });
    reg.users.push(record);
    await saveRegistry(env, reg);
    return send({ ok: true, user: publicUser(record) }, 201, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, origin);
  }
};

export const onRequestPatch: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const g = await gate(request, env, origin);
    if (g instanceof Response) return g;
    const body = await request.json().catch(() => ({} as any));
    const id = sanitizeUserId(body.id || "");
    if (!id) return send({ error: "invalid_user_id" }, 400, origin);

    const reg = await loadRegistryStrict(env);
    const user = findUser(reg, id);
    if (!user) return send({ error: "user_not_found" }, 404, origin);

    // 낙관적 락: 클라이언트가 보낸 updatedAt이 현재와 다르면 충돌.
    if (body.expectedUpdatedAt && String(body.expectedUpdatedAt) !== String(user.updatedAt || "")) {
      return send({ error: "conflict", current: publicUser(user) }, 409, origin);
    }

    if (typeof body.name === "string") user.name = body.name.slice(0, 80);
    if (Array.isArray(body.permissions)) user.permissions = sanitizePermissions(body.permissions);
    if (body.role === "admin" || body.role === "member") user.role = body.role;
    if (typeof body.active === "boolean") user.active = body.active;
    if (body.password) user.pwHash = await hashPassword(String(body.password));
    user.updatedAt = new Date().toISOString();

    await saveRegistry(env, reg);
    return send({ ok: true, user: publicUser(user) }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, origin);
  }
};

export const onRequestDelete: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const g = await gate(request, env, origin);
    if (g instanceof Response) return g;
    const body = await request.json().catch(() => ({} as any));
    let id = sanitizeUserId(body.id || "");
    if (!id) {
      try {
        id = sanitizeUserId(new URL(request.url).searchParams.get("id") || "");
      } catch (_) { /* noop */ }
    }
    if (!id) return send({ error: "invalid_user_id" }, 400, origin);

    // 1차(슈퍼) 관리자는 삭제 금지.
    if (id === primaryAdminId(env)) return send({ error: "cannot_delete_primary_admin" }, 400, origin);

    const reg = await loadRegistryStrict(env);
    const user = findUser(reg, id);
    if (!user) return send({ error: "user_not_found" }, 404, origin);

    const soft = body.soft === true || String(body.mode || "").toLowerCase() === "soft";
    if (soft) {
      user.active = false;
      user.updatedAt = new Date().toISOString();
    } else {
      reg.users = reg.users.filter((u) => sanitizeUserId(u.id) !== id);
    }
    await saveRegistry(env, reg);
    return send({ ok: true, id, soft }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
