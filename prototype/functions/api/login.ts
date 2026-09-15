// prototype/functions/api/login.ts
// Login endpoint: validates credentials and issues a signed session token.
// 우선순위: (1) GCS 회원 레지스트리(admin/users.json) → (2) env AUTH_PW 로 1차 관리자 부트스트랩.
// 저장소가 공개라 코드에 박힌 기본 비밀번호·시드 회원은 두지 않는다.
import { issueSessionToken, resolveSessionTtlSec, sanitizeUserId } from "./_shared/auth.js";
import { verifyPassword } from "./_shared/password.js";
import { loadRegistry, findUser } from "./_shared/admin-users";
import {
  loadAccountDeletionsStrict,
  findAccountDeletion,
  isDeletionRegistrationBlocked,
} from "./_shared/account-deletions";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;
const LEGACY_AUTH_ID = "limfactory";

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
    const rememberDevice = body.rememberDevice !== false;
    if (!id || !pw) return json({ error: 'ID and PW are required' }, 400, origin);

    const deletionRegistry = await loadAccountDeletionsStrict(env, true);
    const deletion = findAccountDeletion(deletionRegistry, id);
    if (isDeletionRegistrationBlocked(deletion)) {
      return json({ error: 'account_deletion_pending', deleteAfter: deletion?.deleteAfter || '' }, 403, origin);
    }

    const issueLoginSession = () => issueSessionToken(
      id,
      env,
      resolveSessionTtlSec(rememberDevice),
      { persistent: rememberDevice },
    );

    const envId = sanitizeUserId(env.AUTH_ID || LEGACY_AUTH_ID);
    const envPw = String(env.AUTH_PW || "").trim();
    const isPrimary = id === envId;

    // (1) GCS 회원 레지스트리가 권위(authoritative). 레지스트리에 해당 ID가 있으면
    //     레지스트리 비밀번호로만 검증한다(=어드민 페이지에서 비번 변경이 즉시 반영).
    //     GCS 장애 시에도 잠기지 않도록 try/catch로 감싸 폴백 경로로 진행.
    try {
      const reg = await loadRegistry(env);
      const user = findUser(reg, id);
      if (user) {
        // 최고 관리자(env 1차 관리자)는 절대 잠기지 않도록 active 무시 + 항상 admin.
        if (!isPrimary && user.deletionRequestedAt) {
          return json({ error: 'account_deletion_pending', deleteAfter: user.deleteAfter || '' }, 403, origin);
        }
        if (!isPrimary && !user.active) return json({ error: 'account_disabled' }, 403, origin);
        const ok = await verifyPassword(pw, user.pwHash);
        if (ok) {
          const session = await issueLoginSession();
          // 마스터(1차 관리자)만 role="master". 그 외 회원은 항상 "member".
          const role = isPrimary ? "master" : "member";
          const permissions = isPrimary ? [] : (user.permissions || []);
          return json({ ok: true, user: id, token: session.token, expiresAt: session.expiresAt, permissions, role, persistent: rememberDevice }, 200, origin);
        }
        // 비밀번호 불일치: 일반 회원은 즉시 실패.
        // 최고 관리자는 잠금 방지를 위해 아래 env 부트스트랩(기본/AUTH_PW)으로 폴백한다.
        if (!isPrimary) return json({ error: 'Invalid credentials' }, 401, origin);
      }
    } catch (_) {
      // 레지스트리 로드 실패 → 아래 폴백 경로로 진행
    }

    // (2) 1차(슈퍼) 관리자 부트스트랩 — 레지스트리에 아직 등록 전이거나 GCS 장애 시.
    //     env AUTH_PW 가 설정된 경우에만 허용. 항상 전체 권한 + admin.
    if (isPrimary && envPw && pw === envPw) {
      const session = await issueLoginSession();
      return json({ ok: true, user: id, token: session.token, expiresAt: session.expiresAt, permissions: [], role: "master", persistent: rememberDevice }, 200, origin);
    }

    return json({ error: 'Invalid credentials' }, 401, origin);
  } catch (e: any) {
    return json({ error: e?.message || 'server_error' }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
