import { getSql, type SqlFn } from "../knowledge/_shared";
import { loadRegistryStrict, saveRegistry, primaryAdminId } from "./admin-users";
import {
  loadAccountDeletionsStrict,
  saveAccountDeletions,
  isDeletionDue,
  type AccountDeletionRecord,
} from "./account-deletions";
import { deleteGcsPrefix, listGcsObjects, resolveGcsEnv } from "./gcs.js";
import { buildUserRoot, sanitizeUserId } from "./storage";
import { loadSharesStrict, saveShares, removeAllOwnerShares, removeAllGrantsToUser } from "./shares";

type CleanupSummary = {
  storageRoots: number;
  storageObjects: number;
  databaseRows: number;
};

function audioStorageEnv(env: any): any | null {
  if (!env?.AUDIO_OUTPUT_GCS_URI) return null;
  return {
    ...env,
    VIDEO_OUTPUT_GCS_URI: env.AUDIO_OUTPUT_GCS_URI,
    GOOGLE_CLIENT_EMAIL: env.TTS_GOOGLE_CLIENT_EMAIL || env.GOOGLE_CLIENT_EMAIL,
    GOOGLE_PRIVATE_KEY: env.TTS_GOOGLE_PRIVATE_KEY || env.GOOGLE_PRIVATE_KEY,
  };
}

async function cleanupStorageRoot(env: any, userId: string): Promise<{ key: string; deleted: number }> {
  const ctx = resolveGcsEnv(env);
  const prefix = `${buildUserRoot(ctx.basePrefix, userId)}/`;
  const deleted = await deleteGcsPrefix(env, prefix);
  const remaining = await listGcsObjects(env, prefix);
  if (remaining.length) throw new Error(`gcs_cleanup_incomplete:${remaining.length}`);
  return { key: `${ctx.bucket}/${prefix}`, deleted };
}

async function cleanupAllStorage(env: any, userId: string): Promise<{ roots: number; deleted: number }> {
  const candidates = [env, audioStorageEnv(env)].filter(Boolean);
  const completed = new Set<string>();
  let deleted = 0;
  for (const candidate of candidates) {
    const ctx = resolveGcsEnv(candidate);
    const prefix = `${buildUserRoot(ctx.basePrefix, userId)}/`;
    const key = `${ctx.bucket}/${prefix}`;
    if (completed.has(key)) continue;
    const result = await cleanupStorageRoot(candidate, userId);
    completed.add(result.key);
    deleted += result.deleted;
  }
  return { roots: completed.size, deleted };
}

async function tableExists(sql: SqlFn, table: string): Promise<boolean> {
  const rows = await sql("SELECT to_regclass($1) AS table_name", [table]);
  return !!rows[0]?.table_name;
}

async function deleteFromUserTable(sql: SqlFn, table: string, column: string, userId: string): Promise<number> {
  if (!(await tableExists(sql, table))) return 0;
  const safeTables = new Set([
    "app_settings", "agent_jobs", "agent_messages", "agent_ui_actions", "agent_personas",
    "agent_knowledge", "company_knowledge", "company_projects", "company_work_items",
    "company_work_folders", "company_runtime", "company_skills", "agent_google_oauth",
    "agent_conversation_meta", "agent_reminders", "agent_credentials", "agent_daily_brief",
    "company_skill_artifacts", "company_skill_job_events", "company_skill_jobs",
    "knowledge_documents", "voice_favorites", "voices",
  ]);
  const safeColumns = new Set(["user_id", "owner_id"]);
  if (!safeTables.has(table) || !safeColumns.has(column)) throw new Error("unsafe_cleanup_table");
  const rows = await sql(`DELETE FROM ${table} WHERE ${column} = $1 RETURNING 1`, [userId]);
  return rows.length;
}

async function cleanupDatabase(env: any, userId: string): Promise<number> {
  const sql = getSql(env);
  if (!sql) return 0;
  let deleted = 0;

  // 자식 행부터 지우면 구버전 스키마에 FK cascade가 없어도 정리가 중단되지 않는다.
  deleted += await deleteFromUserTable(sql, "company_skill_artifacts", "user_id", userId);
  deleted += await deleteFromUserTable(sql, "company_skill_job_events", "user_id", userId);
  deleted += await deleteFromUserTable(sql, "company_skill_jobs", "user_id", userId);

  for (const table of [
    "app_settings", "agent_jobs", "agent_messages", "agent_ui_actions", "agent_personas",
    "agent_knowledge", "company_knowledge", "company_projects", "company_work_items",
    "company_work_folders", "company_runtime", "company_skills", "agent_google_oauth",
    "agent_conversation_meta", "agent_reminders", "agent_credentials", "agent_daily_brief",
    "knowledge_documents",
  ]) {
    deleted += await deleteFromUserTable(sql, table, "user_id", userId);
  }

  deleted += await deleteFromUserTable(sql, "voice_favorites", "owner_id", userId);
  deleted += await deleteFromUserTable(sql, "voices", "owner_id", userId);

  if (await tableExists(sql, "sound_assets")) {
    await sql("ALTER TABLE sound_assets ADD COLUMN IF NOT EXISTS owner_id text");
    const pathToken = `%/users/${userId}/%`;
    const encodedPathToken = `%2Fusers%2F${userId}%2F`;
    const rows = await sql(
      `DELETE FROM sound_assets
       WHERE owner_id = $1
          OR COALESCE(params->>'objectName', '') LIKE $2
          OR COALESCE(output_url, '') LIKE $2
          OR COALESCE(output_url, '') LIKE $3
       RETURNING 1`,
      [userId, pathToken, encodedPathToken],
    );
    deleted += rows.length;
  }
  return deleted;
}

async function cleanupShares(env: any, userId: string): Promise<void> {
  const registry = await loadSharesStrict(env);
  removeAllOwnerShares(registry, userId);
  removeAllGrantsToUser(registry, userId);
  await saveShares(env, registry);
}

export async function cleanupUserData(env: any, userId: string): Promise<CleanupSummary> {
  const uid = sanitizeUserId(userId);
  const storage = await cleanupAllStorage(env, uid);
  const databaseRows = await cleanupDatabase(env, uid);
  await cleanupShares(env, uid);
  return { storageRoots: storage.roots, storageObjects: storage.deleted, databaseRows };
}

function conciseError(error: any): string {
  return String(error?.message || error || "cleanup_failed").slice(0, 1000);
}

export async function sweepExpiredUserDeletions(
  env: any,
  now = new Date(),
): Promise<{ processed: number; completed: number; failed: number; summaries: CleanupSummary[] }> {
  const deletionRegistry = await loadAccountDeletionsStrict(env, true);
  const due = deletionRegistry.records.filter((record) => isDeletionDue(record, now));
  if (!due.length) return { processed: 0, completed: 0, failed: 0, summaries: [] };

  const usersRegistry = await loadRegistryStrict(env);
  const summaries: CleanupSummary[] = [];
  let completed = 0;
  let failed = 0;

  for (const record of due) {
    if (record.userId === primaryAdminId(env)) continue;
    record.attempts += 1;
    record.lastAttemptAt = now.toISOString();
    record.lastError = "";
    await saveAccountDeletions(env, deletionRegistry);
    try {
      const summary = await cleanupUserData(env, record.userId);
      usersRegistry.users = usersRegistry.users.filter((user) => sanitizeUserId(user.id) !== record.userId);
      await saveRegistry(env, usersRegistry);
      record.status = "completed";
      record.completedAt = new Date().toISOString();
      record.lastError = "";
      summaries.push(summary);
      completed += 1;
    } catch (error: any) {
      record.lastError = conciseError(error);
      failed += 1;
    }
    await saveAccountDeletions(env, deletionRegistry);
  }

  return { processed: due.length, completed, failed, summaries };
}
