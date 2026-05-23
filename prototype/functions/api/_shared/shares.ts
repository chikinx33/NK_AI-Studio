// prototype/functions/api/_shared/shares.ts
// 프로젝트 공유(협업) 레지스트리. 소유자만 자신의 프로젝트를 다른 계정에 공유할 수 있다.
// 저장소는 GCS JSON 단일 문서(admin/shares.json) — users.json과 동일 인프라.
import { buildAdminObject, sanitizeUserId } from "./storage";
import { readGcsJson, writeGcsJson, resolveGcsEnv } from "./gcs.js";

export const SHARES_FILE = "shares.json";
export const SHARES_VERSION = 1;
export type ShareRole = "viewer" | "editor";

export interface ShareGrant {
  userId: string;
  role: ShareRole;
  at: string;
}

export interface ShareEntry {
  ownerId: string;
  projectId: string;
  title: string;
  seriesId: string;
  seriesTitle: string;
  grants: ShareGrant[];
  updatedAt: string;
}

export interface SharesRegistry {
  version: number;
  updatedAt: string;
  shares: ShareEntry[];
}

function sharesObjectName(env: any): string {
  const { basePrefix } = resolveGcsEnv(env);
  return buildAdminObject(basePrefix, SHARES_FILE);
}

function emptyRegistry(): SharesRegistry {
  return { version: SHARES_VERSION, updatedAt: "", shares: [] };
}

function normalizeRole(raw: any): ShareRole {
  return String(raw || "").trim().toLowerCase() === "editor" ? "editor" : "viewer";
}

function normalizeEntry(raw: any): ShareEntry {
  const src = raw && typeof raw === "object" ? raw : {};
  const grants = Array.isArray(src.grants) ? src.grants : [];
  return {
    ownerId: sanitizeUserId(src.ownerId),
    projectId: String(src.projectId || "").trim(),
    title: String(src.title || "").slice(0, 200),
    seriesId: String(src.seriesId || "").slice(0, 120),
    seriesTitle: String(src.seriesTitle || "").slice(0, 200),
    grants: grants
      .map((g: any) => ({
        userId: sanitizeUserId(g && g.userId),
        role: normalizeRole(g && g.role),
        at: String((g && g.at) || ""),
      }))
      .filter((g: ShareGrant) => !!g.userId),
    updatedAt: String(src.updatedAt || ""),
  };
}

/** 공유 레지스트리를 엄격하게 로드(읽기 실패 시 throw — 쓰기 전 보호). */
export async function loadSharesStrict(env: any): Promise<SharesRegistry> {
  const { found, data } = await readGcsJson(env, sharesObjectName(env));
  if (!found || !data || !Array.isArray((data as any).shares)) return emptyRegistry();
  const reg = data as SharesRegistry;
  reg.shares = reg.shares.map(normalizeEntry).filter((e) => !!e.ownerId && !!e.projectId);
  if (typeof reg.version !== "number") reg.version = SHARES_VERSION;
  return reg;
}

/** 공유 레지스트리를 로드(읽기 실패에 견딤 — 조회/권한판정용). */
export async function loadShares(env: any): Promise<SharesRegistry> {
  try {
    return await loadSharesStrict(env);
  } catch (e: any) {
    try { console.error("[shares] load failed:", e?.message || e); } catch (_) { /* noop */ }
    return emptyRegistry();
  }
}

export async function saveShares(env: any, registry: SharesRegistry): Promise<void> {
  const payload: SharesRegistry = {
    version: SHARES_VERSION,
    updatedAt: new Date().toISOString(),
    shares: (registry.shares || [])
      .map(normalizeEntry)
      .filter((e) => !!e.ownerId && !!e.projectId && e.grants.length > 0),
  };
  await writeGcsJson(env, sharesObjectName(env), payload);
}

function findEntry(reg: SharesRegistry, ownerId: string, projectId: string): ShareEntry | null {
  const oid = sanitizeUserId(ownerId);
  const pid = String(projectId || "").trim();
  return reg.shares.find((e) => e.ownerId === oid && e.projectId === pid) || null;
}

/** 소유자가 대상 계정에 권한을 부여/갱신한다. */
export function upsertGrant(
  reg: SharesRegistry,
  ownerId: string,
  projectId: string,
  targetUserId: string,
  role: ShareRole,
  title?: string,
  seriesId?: string,
  seriesTitle?: string,
): void {
  const oid = sanitizeUserId(ownerId);
  const pid = String(projectId || "").trim();
  const tid = sanitizeUserId(targetUserId);
  if (!oid || !pid || !tid) return;
  let entry = findEntry(reg, oid, pid);
  if (!entry) {
    entry = { ownerId: oid, projectId: pid, title: String(title || "").slice(0, 200), seriesId: "", seriesTitle: "", grants: [], updatedAt: "" };
    reg.shares.push(entry);
  }
  if (typeof title === "string" && title) entry.title = title.slice(0, 200);
  if (typeof seriesId === "string" && seriesId) entry.seriesId = seriesId.slice(0, 120);
  if (typeof seriesTitle === "string" && seriesTitle) entry.seriesTitle = seriesTitle.slice(0, 200);
  const now = new Date().toISOString();
  const existing = entry.grants.find((g) => g.userId === tid);
  if (existing) {
    existing.role = normalizeRole(role);
    existing.at = now;
  } else {
    entry.grants.push({ userId: tid, role: normalizeRole(role), at: now });
  }
  entry.updatedAt = now;
}

/** 소유자가 대상 계정의 권한을 회수한다. */
export function removeGrant(reg: SharesRegistry, ownerId: string, projectId: string, targetUserId: string): void {
  const entry = findEntry(reg, ownerId, projectId);
  if (!entry) return;
  const tid = sanitizeUserId(targetUserId);
  entry.grants = entry.grants.filter((g) => g.userId !== tid);
  entry.updatedAt = new Date().toISOString();
}

/** (ownerId, projectId)에 대한 userId의 역할을 반환(없으면 null). */
export function getGrantRole(reg: SharesRegistry, ownerId: string, projectId: string, userId: string): ShareRole | null {
  const entry = findEntry(reg, ownerId, projectId);
  if (!entry) return null;
  const uid = sanitizeUserId(userId);
  const g = entry.grants.find((x) => x.userId === uid);
  return g ? g.role : null;
}

/** userId에게 공유된 프로젝트 목록(소유자/역할 포함). */
export function listSharedWith(reg: SharesRegistry, userId: string): Array<{ ownerId: string; projectId: string; title: string; seriesId: string; seriesTitle: string; role: ShareRole }> {
  const uid = sanitizeUserId(userId);
  const out: Array<{ ownerId: string; projectId: string; title: string; seriesId: string; seriesTitle: string; role: ShareRole }> = [];
  for (const e of reg.shares) {
    const g = e.grants.find((x) => x.userId === uid);
    if (g) out.push({ ownerId: e.ownerId, projectId: e.projectId, title: e.title, seriesId: e.seriesId, seriesTitle: e.seriesTitle, role: g.role });
  }
  return out;
}

/** userId가 소유하여 공유한 프로젝트 목록. */
export function listSharedByOwner(reg: SharesRegistry, ownerId: string): ShareEntry[] {
  const oid = sanitizeUserId(ownerId);
  return reg.shares.filter((e) => e.ownerId === oid);
}
