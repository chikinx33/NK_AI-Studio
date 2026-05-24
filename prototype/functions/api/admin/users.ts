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
  requireMaster,
  createUserRecord,
  sanitizePermissions,
  publicUser,
  primaryAdminId,
  REGISTRY_VERSION,
} from "../_shared/admin-users";
import { resolveGcsEnv, deleteGcsPrefix } from "../_shared/gcs.js";
import { buildUserRoot } from "../_shared/storage";
import { loadSharesStrict, saveShares, removeAllOwnerShares, removeAllGrantsToUser } from "../_shared/shares";

type PagesFunction = (ctx: { request: Request; env: any; waitUntil?: (p: Promise<any>) => void }) => Promise<Response>;

const corsHeaders = (origin: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
});

const send = (data: any, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });

/** 인증 + 마스터 검증 공통 처리. 회원 관리는 오직 마스터만 가능. */
async function gate(request: Request, env: any, origin: string | null): Promise<Response | { userId: string }> {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  if (!requireMaster(env, auth.userId)) return send({ error: "master_required" }, 403, origin);
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
        primaryAdminId: primaryAdminId(env),
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

    // 마스터(=primaryAdminId)는 항상 전체권한/active. 그 외 회원은 항상 member 역할
    // (회원에게는 '관리자' 역할을 줄 수 없음 — 마스터는 단 하나).
    const isPrimaryTarget = id === primaryAdminId(env);
    const record = await createUserRecord({
      id,
      name: body.name,
      password: pw,
      permissions: isPrimaryTarget ? [] : body.permissions,
      role: isPrimaryTarget ? "admin" : "member",
      active: isPrimaryTarget ? true : (body.active !== false),
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
    if (typeof body.active === "boolean") user.active = body.active;
    if (body.password) user.pwHash = await hashPassword(String(body.password).trim());
    // 마스터는 항상 admin/active(잠금 방지). 그 외 회원은 항상 member(관리자 역할 불가).
    if (id === primaryAdminId(env)) {
      user.role = "admin";
      user.active = true;
    } else {
      user.role = "member";
    }
    user.updatedAt = new Date().toISOString();

    await saveRegistry(env, reg);
    return send({ ok: true, user: publicUser(user) }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, origin);
  }
};

export const onRequestDelete: PagesFunction = async ({ request, env, waitUntil }) => {
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
      await saveRegistry(env, reg);
      return send({ ok: true, id, soft }, 200, origin);
    }

    // 하드 삭제: 웹 목록에 즉시 반영되도록 레지스트리에서 '먼저' 제거하고 응답한다.
    // GCS 파일 폴더와 공유 레지스트리 정리는 시간이 오래 걸릴 수 있으므로
    // 백그라운드(waitUntil)에서 best-effort 로 수행한다(실패해도 UI엔 영향 없음).
    reg.users = reg.users.filter((u) => sanitizeUserId(u.id) !== id);
    await saveRegistry(env, reg);

    const cleanup = (async () => {
      // 1) 이 회원이 소유한 모든 데이터 폴더(users/{id}/) 통째 삭제(배치).
      try {
        const { basePrefix } = resolveGcsEnv(env);
        const userRoot = buildUserRoot(basePrefix, id);
        await deleteGcsPrefix(env, `${userRoot}/`);
      } catch (e: any) {
        try { console.error("[admin/users] gcs cleanup failed:", e?.message || e); } catch (_) { /* noop */ }
      }
      // 2) 공유 레지스트리 정리: 소유 공유 제거 + 이 회원에게 부여된 grant 회수.
      try {
        const sharesReg = await loadSharesStrict(env);
        removeAllOwnerShares(sharesReg, id);
        removeAllGrantsToUser(sharesReg, id);
        await saveShares(env, sharesReg);
      } catch (e: any) {
        try { console.error("[admin/users] share cleanup failed:", e?.message || e); } catch (_) { /* noop */ }
      }
    })();

    if (typeof waitUntil === "function") {
      waitUntil(cleanup); // 응답 후에도 런타임이 정리 작업을 끝까지 실행하도록 등록
    } else {
      await cleanup; // waitUntil 미지원 환경(로컬 등) 폴백 — 정리를 마친 뒤 응답
    }

    return send({ ok: true, id, soft }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
