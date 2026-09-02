import { buildAdminObject, sanitizeUserId } from "./storage";
import { readGcsJson, writeGcsJson, resolveGcsEnv } from "./gcs.js";

export const ACCOUNT_DELETIONS_FILE = "account-deletions.json";
export const ACCOUNT_DELETION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const ACCOUNT_DELETION_AUDIT_RETENTION_MS = 100 * 24 * 60 * 60 * 1000;

export interface AccountDeletionRecord {
  userId: string;
  requestedAt: string;
  deleteAfter: string;
  revokedBefore: number;
  status: "pending" | "completed";
  attempts: number;
  lastAttemptAt: string;
  lastError: string;
  completedAt: string;
}

export interface AccountDeletionsRegistry {
  version: number;
  updatedAt: string;
  records: AccountDeletionRecord[];
}

let cachedRegistry: AccountDeletionsRegistry | null = null;
let cachedAt = 0;
const CACHE_MS = 10_000;

function objectName(env: any): string {
  const { basePrefix } = resolveGcsEnv(env);
  return buildAdminObject(basePrefix, ACCOUNT_DELETIONS_FILE);
}

function emptyRegistry(): AccountDeletionsRegistry {
  return { version: 1, updatedAt: "", records: [] };
}

function normalizeRecord(raw: any): AccountDeletionRecord {
  const src = raw && typeof raw === "object" ? raw : {};
  const requestedAt = String(src.requestedAt || "");
  const requestedMs = Date.parse(requestedAt);
  const deleteAfter = String(src.deleteAfter || (Number.isFinite(requestedMs)
    ? new Date(requestedMs + ACCOUNT_DELETION_GRACE_MS).toISOString()
    : ""));
  return {
    userId: sanitizeUserId(src.userId),
    requestedAt,
    deleteAfter,
    revokedBefore: Math.max(0, Number(src.revokedBefore) || 0),
    status: src.status === "completed" ? "completed" : "pending",
    attempts: Math.max(0, Number(src.attempts) || 0),
    lastAttemptAt: String(src.lastAttemptAt || ""),
    lastError: String(src.lastError || "").slice(0, 1000),
    completedAt: String(src.completedAt || ""),
  };
}

function normalizeRegistry(raw: any): AccountDeletionsRegistry {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    version: 1,
    updatedAt: String(src.updatedAt || ""),
    records: (Array.isArray(src.records) ? src.records : [])
      .map(normalizeRecord)
      .filter((record: AccountDeletionRecord) => !!record.userId && !!record.requestedAt && !!record.deleteAfter),
  };
}

export async function loadAccountDeletionsStrict(env: any, fresh = false): Promise<AccountDeletionsRegistry> {
  if (!fresh && cachedRegistry && (Date.now() - cachedAt) < CACHE_MS) return normalizeRegistry(cachedRegistry);
  const { found, data } = await readGcsJson(env, objectName(env));
  const registry = found ? normalizeRegistry(data) : emptyRegistry();
  cachedRegistry = registry;
  cachedAt = Date.now();
  return normalizeRegistry(registry);
}

export async function saveAccountDeletions(env: any, registry: AccountDeletionsRegistry): Promise<void> {
  const now = Date.now();
  const payload: AccountDeletionsRegistry = {
    version: 1,
    updatedAt: new Date(now).toISOString(),
    records: normalizeRegistry(registry).records.filter((record) => {
      if (record.status !== "completed") return true;
      const completedMs = Date.parse(record.completedAt || "");
      return !Number.isFinite(completedMs) || (now - completedMs) < ACCOUNT_DELETION_AUDIT_RETENTION_MS;
    }),
  };
  await writeGcsJson(env, objectName(env), payload);
  cachedRegistry = payload;
  cachedAt = Date.now();
}

export function findAccountDeletion(registry: AccountDeletionsRegistry, userId: string): AccountDeletionRecord | null {
  const uid = sanitizeUserId(userId);
  return registry.records.find((record) => record.userId === uid) || null;
}

export function requestAccountDeletion(
  registry: AccountDeletionsRegistry,
  userId: string,
  now = new Date(),
): AccountDeletionRecord {
  const uid = sanitizeUserId(userId);
  const requestedAt = now.toISOString();
  const deleteAfter = new Date(now.getTime() + ACCOUNT_DELETION_GRACE_MS).toISOString();
  let record = findAccountDeletion(registry, uid);
  if (!record || record.status === "completed") {
    record = normalizeRecord({
      userId: uid,
      requestedAt,
      deleteAfter,
      revokedBefore: Math.floor(now.getTime() / 1000),
      status: "pending",
    });
    registry.records = registry.records.filter((item) => item.userId !== uid);
    registry.records.push(record);
  }
  return record;
}

export function isDeletionRegistrationBlocked(record: AccountDeletionRecord | null): boolean {
  return !!record && record.status === "pending";
}

export function isDeletionDue(record: AccountDeletionRecord, now = new Date()): boolean {
  return record.status === "pending" && Date.parse(record.deleteAfter) <= now.getTime();
}

export async function checkAccountSession(
  env: any,
  userId: string,
  issuedAt: number,
): Promise<{ ok: true } | { ok: false; error: string; deleteAfter?: string }> {
  const registry = await loadAccountDeletionsStrict(env);
  const record = findAccountDeletion(registry, userId);
  if (!record) return { ok: true };
  if (record.status === "pending") {
    return { ok: false, error: "account_deletion_pending", deleteAfter: record.deleteAfter };
  }
  if (issuedAt > 0 && issuedAt <= record.revokedBefore) {
    return { ok: false, error: "account_session_revoked" };
  }
  return { ok: true };
}
