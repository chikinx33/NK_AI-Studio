// prototype/functions/api/_shared/admin-users.ts
// 회원 레지스트리(admin/users.json) 로드/저장 + 관리자 권한 가드.
// 저장소는 GCS JSON 단일 문서를 사용한다(기존 userdata 저장 방식과 동일한 인프라).
import { buildAdminObject, sanitizeUserId } from "./storage";
import { readGcsJson, writeGcsJson, resolveGcsEnv } from "./gcs.js";
import { hashPassword } from "./password.js";

export const ADMIN_USERS_FILE = "users.json";
export const REGISTRY_VERSION = 1;

// 권한 키(접근 가능 페이지) 단일 정의처. 새 페이지 추가 시 여기만 갱신.
export const PERMISSION_PAGES = ["videogen", "image", "video", "brand", "admin"] as const;
export type PermissionPage = (typeof PERMISSION_PAGES)[number];

export interface AdminUser {
  id: string;
  name: string;
  pwHash: string;
  permissions: string[]; // [] = 전체 권한
  role: "admin" | "member";
  active: boolean;
  createdAt: string;
  updatedAt: string;
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

/** 레지스트리를 로드한다. 없으면 빈 레지스트리를 반환. */
export async function loadRegistry(env: any): Promise<UsersRegistry> {
  const { found, data } = await readGcsJson(env, adminObjectName(env));
  if (!found || !data || !Array.isArray((data as any).users)) {
    return { version: REGISTRY_VERSION, updatedAt: "", users: [] };
  }
  const reg = data as UsersRegistry;
  reg.users = reg.users.map(normalizeUser).filter((u) => !!u.id);
  if (typeof reg.version !== "number") reg.version = REGISTRY_VERSION;
  return reg;
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

/**
 * 주어진 userId가 관리자 권한을 갖는지 검증한다.
 * - env 1차 관리자이거나
 * - 레지스트리에서 active 하고 role==="admin" 인 회원
 */
export async function requireAdmin(env: any, userId: string): Promise<boolean> {
  const uid = sanitizeUserId(userId);
  if (!uid) return false;
  if (uid === primaryAdminId(env)) return true;
  try {
    const reg = await loadRegistry(env);
    const user = findUser(reg, uid);
    return !!(user && user.active && user.role === "admin");
  } catch (_) {
    return false;
  }
}

/** 신규 회원 객체를 생성한다(비밀번호 해싱 포함). */
export async function createUserRecord(input: {
  id: string;
  name?: string;
  password: string;
  permissions?: string[];
  role?: "admin" | "member";
  active?: boolean;
}): Promise<AdminUser> {
  const id = sanitizeUserId(input.id);
  if (!id) throw new Error("invalid_user_id");
  const pw = String(input.password || "");
  if (!pw) throw new Error("password_required");
  const now = new Date().toISOString();
  return {
    id,
    name: String(input.name || "").slice(0, 80),
    pwHash: await hashPassword(pw),
    permissions: sanitizePermissions(input.permissions),
    role: input.role === "admin" ? "admin" : "member",
    active: input.active !== false,
    createdAt: now,
    updatedAt: now,
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
    pwHash: String(src.pwHash || ""),
    permissions: sanitizePermissions(src.permissions),
    role: src.role === "admin" ? "admin" : "member",
    active: src.active !== false,
    createdAt: String(src.createdAt || ""),
    updatedAt: String(src.updatedAt || ""),
  };
}
