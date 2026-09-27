import { getSql, getSqlBatch } from "../knowledge/_shared";
import { loadRegistryStrict, saveRegistry, primaryAdminId } from "./admin-users";
import {
  loadAccountDeletionsStrict,
  saveAccountDeletions,
  isDeletionDue,
} from "./account-deletions";
import { deleteGcsObjects, listGcsObjects, resolveGcsEnv } from "./gcs.js";
import { buildUserRoot, sanitizeUserId } from "./storage";
import { loadSharesStrict, saveShares, removeAllOwnerShares, removeAllGrantsToUser } from "./shares";

// Cloudflare Worker 는 한 요청에서 외부 요청(서브요청)을 50번까지만 보낼 수 있다.
// 넘으면 "Too many subrequests" 로 죽어 정리가 영영 끝나지 않는다(2026-09-22~27 전부 실패, 오류 1101).
// 그래서 한 번 실행에서는 회원 1명, GCS 객체 1000개(배치 10건)까지만 처리하고 나머지는 다음 15분 실행이 잇는다.
const MAX_DELETIONS_PER_RUN = 1;
const MAX_GCS_DELETES_PER_RUN = 1000;

type CleanupSummary = {
  storageRoots: number;
  storageObjects: number;
  databaseRows: number;
};

type CleanupResult = CleanupSummary & { done: boolean; storageRemaining: number };

function audioStorageEnv(env: any): any | null {
  if (!env?.AUDIO_OUTPUT_GCS_URI) return null;
  return {
    ...env,
    VIDEO_OUTPUT_GCS_URI: env.AUDIO_OUTPUT_GCS_URI,
    GOOGLE_CLIENT_EMAIL: env.TTS_GOOGLE_CLIENT_EMAIL || env.GOOGLE_CLIENT_EMAIL,
    GOOGLE_PRIVATE_KEY: env.TTS_GOOGLE_PRIVATE_KEY || env.GOOGLE_PRIVATE_KEY,
  };
}

async function cleanupStorageRoot(
  env: any,
  userId: string,
  budget: number,
): Promise<{ key: string; deleted: number; remaining: number }> {
  const ctx = resolveGcsEnv(env);
  const prefix = `${buildUserRoot(ctx.basePrefix, userId)}/`;
  const key = `${ctx.bucket}/${prefix}`;
  const names = await listGcsObjects(env, prefix);
  const batch = names.slice(0, Math.max(0, budget));
  let deleted = 0;
  if (batch.length) {
    const result = await deleteGcsObjects(env, batch);
    // 실패가 있으면 throw — 회원 레코드를 남겨 다음 실행이 재시도하게 한다(고아 데이터 방지).
    if (result.failures.length) throw new Error(`gcs_delete_failed: ${result.failures.slice(0, 10).join(", ")}`);
    deleted = result.deletedCount;
  }
  if (batch.length < names.length) return { key, deleted, remaining: names.length - batch.length };
  if (batch.length) {
    const remaining = await listGcsObjects(env, prefix);
    if (remaining.length) throw new Error(`gcs_cleanup_incomplete:${remaining.length}`);
  }
  return { key, deleted, remaining: 0 };
}

async function cleanupAllStorage(env: any, userId: string): Promise<{ roots: number; deleted: number; remaining: number }> {
  const candidates = [env, audioStorageEnv(env)].filter(Boolean);
  const completed = new Set<string>();
  let deleted = 0;
  let remaining = 0;
  for (const candidate of candidates) {
    const ctx = resolveGcsEnv(candidate);
    const prefix = `${buildUserRoot(ctx.basePrefix, userId)}/`;
    const key = `${ctx.bucket}/${prefix}`;
    if (completed.has(key)) continue;
    const result = await cleanupStorageRoot(candidate, userId, MAX_GCS_DELETES_PER_RUN - deleted);
    completed.add(result.key);
    deleted += result.deleted;
    remaining += result.remaining;
  }
  return { roots: completed.size, deleted, remaining };
}

// 자식 행부터 지우면 구버전 스키마에 FK cascade가 없어도 정리가 중단되지 않는다.
const USER_TABLES: Array<[string, "user_id" | "owner_id"]> = [
  ["company_skill_artifacts", "user_id"],
  ["company_skill_job_events", "user_id"],
  ["company_skill_jobs", "user_id"],
  ["credit_transactions", "user_id"],
  ["credit_operations", "user_id"],
  ["credit_accounts", "user_id"],
  ["nk_subscription_image_jobs", "user_id"],
  ["nk_image_connectors", "user_id"],
  ["app_settings", "user_id"],
  ["agent_jobs", "user_id"],
  ["agent_messages", "user_id"],
  ["agent_ui_actions", "user_id"],
  ["agent_personas", "user_id"],
  ["agent_knowledge", "user_id"],
  ["company_knowledge", "user_id"],
  ["company_projects", "user_id"],
  ["company_work_items", "user_id"],
  ["company_work_folders", "user_id"],
  ["company_runtime", "user_id"],
  ["company_skills", "user_id"],
  ["agent_google_oauth", "user_id"],
  ["agent_conversation_meta", "user_id"],
  ["agent_reminders", "user_id"],
  ["agent_credentials", "user_id"],
  ["agent_daily_brief", "user_id"],
  ["knowledge_documents", "user_id"],
  ["voice_favorites", "owner_id"],
  ["voices", "owner_id"],
];

async function cleanupDatabase(env: any, userId: string): Promise<number> {
  const sql = getSql(env);
  const batch = getSqlBatch(env);
  if (!sql || !batch) return 0;

  // 테이블 존재 확인 1번 + 삭제 전체를 한 트랜잭션 1번 = 서브요청 2건(예전엔 테이블마다 2건씩 약 60건).
  const names = [...USER_TABLES.map(([table]) => table), "sound_assets"];
  const existing = new Set(
    (await sql("SELECT t AS table_name FROM unnest($1::text[]) AS t WHERE to_regclass(t) IS NOT NULL", [names]))
      .map((row: any) => String(row.table_name)),
  );

  const queries: Array<{ query: string; params?: any[] }> = [];
  for (const [table, column] of USER_TABLES) {
    if (!existing.has(table)) continue;
    queries.push({ query: `DELETE FROM ${table} WHERE ${column} = $1 RETURNING 1`, params: [userId] });
  }

  if (existing.has("sound_assets")) {
    queries.push({ query: "ALTER TABLE sound_assets ADD COLUMN IF NOT EXISTS owner_id text" });
    // LIKE 에서 _ 는 한 글자 와일드카드라 a_b 삭제가 axb 경로까지 지우지 않게 이스케이프한다.
    // URL 인코딩 경로의 %2F 도 LIKE 에선 와일드카드라 같이 이스케이프한다.
    const likeId = userId.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const pathToken = `%/users/${likeId}/%`;
    const encodedPathToken = `%\\%2Fusers\\%2F${likeId}\\%2F%`;
    queries.push({
      query: `DELETE FROM sound_assets
       WHERE owner_id = $1
          OR COALESCE(params->>'objectName', '') LIKE $2
          OR COALESCE(output_url, '') LIKE $2
          OR COALESCE(output_url, '') LIKE $3
       RETURNING 1`,
      params: [userId, pathToken, encodedPathToken],
    });
  }

  const results = await batch(queries);
  return results.reduce((sum, rows) => sum + rows.length, 0);
}

async function cleanupShares(env: any, userId: string): Promise<void> {
  const registry = await loadSharesStrict(env);
  removeAllOwnerShares(registry, userId);
  removeAllGrantsToUser(registry, userId);
  await saveShares(env, registry);
}

export async function cleanupUserData(env: any, userId: string): Promise<CleanupResult> {
  const uid = sanitizeUserId(userId);
  const storage = await cleanupAllStorage(env, uid);
  // 파일이 아직 남았으면 DB·공유는 다음 실행에서 파일을 다 지운 뒤 정리한다.
  if (storage.remaining) {
    return { storageRoots: storage.roots, storageObjects: storage.deleted, databaseRows: 0, done: false, storageRemaining: storage.remaining };
  }
  const databaseRows = await cleanupDatabase(env, uid);
  await cleanupShares(env, uid);
  return { storageRoots: storage.roots, storageObjects: storage.deleted, databaseRows, done: true, storageRemaining: 0 };
}

export function conciseError(error: any): string {
  return String(error?.message || error || "cleanup_failed").slice(0, 1000);
}

export async function sweepExpiredUserDeletions(
  env: any,
  now = new Date(),
): Promise<{
  processed: number;
  completed: number;
  failed: number;
  inProgress: number;
  waiting: number;
  errors: string[];
  summaries: CleanupSummary[];
}> {
  const deletionRegistry = await loadAccountDeletionsStrict(env, true);
  const adminId = primaryAdminId(env);
  const due = deletionRegistry.records.filter((record) => isDeletionDue(record, now) && record.userId !== adminId);
  const batch = due.slice(0, MAX_DELETIONS_PER_RUN);
  const empty = { processed: 0, completed: 0, failed: 0, inProgress: 0, waiting: 0, errors: [], summaries: [] };
  if (!batch.length) return empty;

  const usersRegistry = await loadRegistryStrict(env);
  const summaries: CleanupSummary[] = [];
  const errors: string[] = [];
  let completed = 0;
  let failed = 0;
  let inProgress = 0;

  for (const record of batch) {
    record.attempts += 1;
    record.lastAttemptAt = now.toISOString();
    record.lastError = "";
    await saveAccountDeletions(env, deletionRegistry);
    try {
      const result = await cleanupUserData(env, record.userId);
      summaries.push({ storageRoots: result.storageRoots, storageObjects: result.storageObjects, databaseRows: result.databaseRows });
      if (!result.done) {
        record.lastError = `storage_in_progress:${result.storageRemaining}`;
        inProgress += 1;
      } else {
        usersRegistry.users = usersRegistry.users.filter((user) => sanitizeUserId(user.id) !== record.userId);
        await saveRegistry(env, usersRegistry);
        record.status = "completed";
        record.completedAt = new Date().toISOString();
        record.lastError = "";
        completed += 1;
      }
    } catch (error: any) {
      record.lastError = conciseError(error);
      errors.push(`${record.userId}: ${record.lastError}`);
      failed += 1;
    }
    try {
      await saveAccountDeletions(env, deletionRegistry);
    } catch (error: any) {
      // 기록 저장 실패는 다음 실행이 같은 회원을 다시 잡아 이어가므로 요청 전체를 죽이지 않는다.
      errors.push(`save_deletions: ${conciseError(error)}`);
    }
  }

  return { processed: batch.length, completed, failed, inProgress, waiting: due.length - batch.length, errors, summaries };
}
