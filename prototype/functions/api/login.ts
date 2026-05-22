// prototype/functions/api/login.ts
// Login endpoint: validates credentials and issues a signed session token.
// 우선순위: (1) env 1차 관리자 → (2) GCS 회원 레지스트리(admin/users.json) →
//          (3) 레거시 하드코딩 회원(최초 로그인 시 레지스트리로 자동 마이그레이션)
import { issueSessionToken, sanitizeUserId } from "./_shared/auth.js";
import { verifyPassword } from "./_shared/password.js";
import { loadRegistry, saveRegistry, findUser, createUserRecord } from "./_shared/admin-users";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;
const LEGACY_AUTH_ID = "limfactory";
const LEGACY_AUTH_PW = "limfactory1234";

// 레거시 하드코딩 회원(시드). 최초 로그인 성공 시 해시 형태로 레지스트리에 이관된다.
// 이관 후에는 어드민 페이지에서 관리하며, 이 배열은 신규 환경 부트스트랩 용도로만 남긴다.
const LEGACY_USERS: Array<{ id: string; pw: string; permissions: string[] }> = [
  { id: "hongdaeitacademy1", pw: "hongdaeitacademy1", permissions: ["videogen", "image"] },
  { id: "hongdaeitacademy2", pw: "hongdaeitacademy2", permissions: ["videogen", "image"] },
  { id: "hongdaeitacademy3", pw: "hongdaeitacademy3", permissions: ["videogen", "image"] },
];

const corsHeaders = (origin: string | null) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Vary': 'Origin',
});

const json = (data: any, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    const body = await request.json().catch(() => ({}));
    const id = sanitizeUserId(body.id || "");
    const pw = String(body.pw || '').trim();
    if (!id || !pw) return json({ error: 'ID and PW are required' }, 400, origin);

    // (1) 1차(슈퍼) 관리자 — env로 재정의 가능. 항상 전체 권한 + admin role.
    const envId = sanitizeUserId(env.AUTH_ID || LEGACY_AUTH_ID);
    const envPw = String(env.AUTH_PW || LEGACY_AUTH_PW).trim();
    if (id === envId && pw === envPw) {
      const session = await issueSessionToken(id, env);
      return json({ ok: true, user: id, token: session.token, expiresAt: session.expiresAt, permissions: [], role: "admin" }, 200, origin);
    }

    // (2) GCS 회원 레지스트리 조회. GCS 장애 시에도 레거시 폴백이 동작하도록 try/catch.
    let registryLoaded = false;
    try {
      const reg = await loadRegistry(env);
      registryLoaded = true;
      const user = findUser(reg, id);
      if (user) {
        if (!user.active) return json({ error: 'account_disabled' }, 403, origin);
        const ok = await verifyPassword(pw, user.pwHash);
        if (!ok) return json({ error: 'Invalid credentials' }, 401, origin);
        const session = await issueSessionToken(id, env);
        return json({ ok: true, user: id, token: session.token, expiresAt: session.expiresAt, permissions: user.permissions || [], role: user.role || "member" }, 200, origin);
      }
    } catch (_) {
      // 레지스트리 로드 실패 → 레거시 폴백으로 진행
      registryLoaded = false;
    }

    // (3) 레거시 하드코딩 회원: 평문 비교 후 성공 시 레지스트리에 1회 이관.
    const legacy = LEGACY_USERS.find(u => sanitizeUserId(u.id) === id && u.pw === pw);
    if (legacy) {
      if (registryLoaded) {
        // 레지스트리가 정상 로드된 경우에만 이관 시도(중복 방지 위해 위에서 findUser가 없었음을 확인함).
        try {
          const reg = await loadRegistry(env);
          if (!findUser(reg, id)) {
            const record = await createUserRecord({
              id,
              name: "",
              password: pw,
              permissions: legacy.permissions,
              role: "member",
              active: true,
            });
            reg.users.push(record);
            await saveRegistry(env, reg);
          }
        } catch (_) { /* 이관 실패는 로그인 자체를 막지 않음 */ }
      }
      const session = await issueSessionToken(id, env);
      return json({ ok: true, user: id, token: session.token, expiresAt: session.expiresAt, permissions: legacy.permissions, role: "member" }, 200, origin);
    }

    return json({ error: 'Invalid credentials' }, 401, origin);
  } catch (e: any) {
    return json({ error: e?.message || 'server_error' }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
