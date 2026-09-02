// prototype/functions/api/_shared/admin-users.ts
// 회원 레지스트리(admin/users.json) 로드/저장 + 관리자 권한 가드.
// 저장소는 GCS JSON 단일 문서를 사용한다(기존 userdata 저장 방식과 동일한 인프라).
import { buildAdminObject, sanitizeUserId } from "./storage";
import { readGcsJson, writeGcsJson, resolveGcsEnv } from "./gcs.js";
import { hashPassword } from "./password.js";

export const ADMIN_USERS_FILE = "users.json";
export const REGISTRY_VERSION = 1;

// 권한 키(접근 가능 페이지) 단일 정의처. 새 페이지 추가 시 여기만 갱신.
export const PERMISSION_PAGES = ["videogen", "image", "video", "brand", "doc", "sound", "ai_company", "admin"] as const;
export type PermissionPage = (typeof PERMISSION_PAGES)[number];

export interface AdminUser {
  id: string;
  name: string;
  email: string; // 구글 로그인 매칭용(소문자 정규화). 빈 문자열이면 구글 로그인 불가.
  pwHash: string;
  permissions: string[]; // [] = 전체 권한
  role: "admin" | "member";
  active: boolean;
  createdAt: string;
  updatedAt: string;
  deletionRequestedAt: string;
  deleteAfter: string;
}

export interface UsersRegistry {
  version: number;
  updatedAt: string;
  users: AdminUser[];
}

const LEGACY_AUTH_ID = "limfactory";

function adminObjectName(env: any): string {
  const { basePrefix } = resolveGcsEnv(env);
  return buildAdminObject(basePrefix, ADMIN_USERS_FILE);
}

/** env 기준 1차(슈퍼) 관리자 ID. 레지스트리와 무관하게 항상 관리자. */
export function primaryAdminId(env: any): string {
  return sanitizeUserId((env && env.AUTH_ID) || LEGACY_AUTH_ID);
}

function emptyRegistry(): UsersRegistry {
  return { version: REGISTRY_VERSION, updatedAt: "", users: [] };
}

/**
 * 레지스트리를 엄격하게 로드한다(읽기 실패 시 throw).
 * 쓰기(생성/수정/삭제) 전에 사용 — 일시적 읽기 오류로 기존 데이터를 덮어쓰지 않도록 보호.
 */
export async function loadRegistryStrict(env: any): Promise<UsersRegistry> {
  const { found, data } = await readGcsJson(env, adminObjectName(env));
  if (!found || !data || !Array.isArray((data as any).users)) {
    return emptyRegistry();
  }
  const reg = data as UsersRegistry;
  reg.users = reg.users.map(normalizeUser).filter((u) => !!u.id);
  if (typeof reg.version !== "number") reg.version = REGISTRY_VERSION;
  return reg;
}

/**
 * 레지스트리를 로드한다(읽기 실패에 견딤 — 오류 시 빈 레지스트리).
 * 조회(GET)·권한 판정 등 읽기 전용 경로에서 사용. 파일이 아직 없거나
 * 일시적 GCS 오류여도 500 대신 빈 목록으로 동작하게 한다.
 */
export async function loadRegistry(env: any): Promise<UsersRegistry> {
  try {
    return await loadRegistryStrict(env);
  } catch (e: any) {
    try { console.error("[admin-users] loadRegistry read failed:", e?.message || e); } catch (_) { /* noop */ }
    return emptyRegistry();
  }
}

/** 레지스트리를 저장한다(updatedAt 갱신). */
export async function saveRegistry(env: any, registry: UsersRegistry): Promise<void> {
  const payload: UsersRegistry = {
    version: REGISTRY_VERSION,
    updatedAt: new Date().toISOString(),
    users: (registry.users || []).map(normalizeUser).filter((u) => !!u.id),
  };
  await writeGcsJson(env, adminObjectName(env), payload);
}

/** ID로 회원을 찾는다(없으면 null). */
export function findUser(registry: UsersRegistry, id: string): AdminUser | null {
  const uid = sanitizeUserId(id);
  return (registry.users || []).find((u) => sanitizeUserId(u.id) === uid) || null;
}

/** 이메일을 소문자/trim 으로 정규화한다(빈 문자열이면 ''). */
export function normalizeEmail(raw: any): string {
  const v = String(raw || "").trim().toLowerCase();
  // 아주 단순한 형식 검증: 공백 없는 a@b 꼴만 허용. 부적합하면 '' 반환(저장 안 함).
  if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "";
  return v.slice(0, 120);
}

/** 이메일로 회원을 찾는다(승인된 구글 로그인 매칭용). 빈 이메일은 매칭 금지. */
export function findUserByEmail(registry: UsersRegistry, email: string): AdminUser | null {
  const target = normalizeEmail(email);
  if (!target) return null;
  return (registry.users || []).find((u) => normalizeEmail(u.email) === target) || null;
}

/**
 * 마스터(이 프로젝트를 운영하는 유일한 최고 관리자 = env 1차 관리자)인지 검증한다.
 * 회원 관리(생성·삭제·권한설정) 등 운영 기능은 오직 마스터만 가능하다.
 * 회원에게 어떤 권한을 줘도 마스터가 될 수 없다.
 */
export function requireMaster(env: any, userId: string): boolean {
  const uid = sanitizeUserId(userId);
  return !!uid && uid === primaryAdminId(env);
}

/**
 * 사용자의 페이지 권한 목록을 반환한다.
 * null 반환 = 전체 접근(관리자 / 미등록(레거시) / 빈 권한 / 레지스트리 장애).
 * 빈 배열 반환 = 권한 없음(비활성 계정).
 * 이 규칙은 클라이언트의 hasPermission(빈 배열=전체 허용)과 동일하게 맞춰
 * 기존 사용자가 잠기지 않도록 한다.
 */
export async function getUserPermissions(env: any, userId: string): Promise<string[] | null> {
  const uid = sanitizeUserId(userId);
  if (!uid) return null;
  if (uid === primaryAdminId(env)) return null;
  try {
    const reg = await loadRegistry(env);
    const user = findUser(reg, uid);
    if (!user) return null;            // 미등록 → 전체 접근(현행 동작 유지)
    if (user.role === "admin") return null;
    if (!user.active) return [];       // 비활성 → 권한 없음
    if (!user.permissions || user.permissions.length === 0) return null; // 빈 권한 = 전체
    return user.permissions;
  } catch (_) {
    return null;                       // 레지스트리 장애 시 잠금 방지
  }
}

/** 특정 페이지 권한 보유 여부. true면 허용. */
export async function hasPagePermission(env: any, userId: string, page: string): Promise<boolean> {
  const perms = await getUserPermissions(env, userId);
  if (perms === null) return true;
  return perms.indexOf(String(page || "")) !== -1;
}

/** 신규 회원 객체를 생성한다(비밀번호 해싱 포함). */
export async function createUserRecord(input: {
  id: string;
  name?: string;
  email?: string;
  password: string;
  permissions?: string[];
  role?: "admin" | "member";
  active?: boolean;
}): Promise<AdminUser> {
  const id = sanitizeUserId(input.id);
  if (!id) throw new Error("invalid_user_id");
  // 로그인 검증은 pw.trim()을 사용하므로, 해시 생성도 동일하게 trim하여 불일치를 방지한다.
  const pw = String(input.password || "").trim();
  if (!pw) throw new Error("password_required");
  const now = new Date().toISOString();
  return {
    id,
    name: String(input.name || "").slice(0, 80),
    email: normalizeEmail(input.email),
    pwHash: await hashPassword(pw),
    permissions: sanitizePermissions(input.permissions),
    role: input.role === "admin" ? "admin" : "member",
    active: input.active !== false,
    createdAt: now,
    updatedAt: now,
    deletionRequestedAt: "",
    deleteAfter: "",
  };
}

/** 권한 배열을 화이트리스트로 정규화한다. */
export function sanitizePermissions(permissions: any): string[] {
  if (!Array.isArray(permissions)) return [];
  const allow = new Set(PERMISSION_PAGES as readonly string[]);
  const out: string[] = [];
  for (const p of permissions) {
    const key = String(p || "").trim().toLowerCase();
    if (allow.has(key) && out.indexOf(key) === -1) out.push(key);
  }
  return out;
}

/** 클라이언트에 노출할 안전한 형태(비밀번호 해시 제거). */
export function publicUser(user: AdminUser): Omit<AdminUser, "pwHash"> {
  const { pwHash, ...rest } = user;
  return rest;
}

function normalizeUser(raw: any): AdminUser {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    id: sanitizeUserId(src.id),
    name: String(src.name || "").slice(0, 80),
    email: normalizeEmail(src.email),
    pwHash: String(src.pwHash || ""),
    permissions: sanitizePermissions(src.permissions),
    role: src.role === "admin" ? "admin" : "member",
    active: src.active !== false,
    createdAt: String(src.createdAt || ""),
    updatedAt: String(src.updatedAt || ""),
    deletionRequestedAt: String(src.deletionRequestedAt || ""),
    deleteAfter: String(src.deleteAfter || ""),
  };
}
