// prototype/functions/api/_shared/sns-schedule.ts
//
// SNS 예약 발행 대기열. YouTube 는 플랫폼이 직접 예약(private + publishAt)하고 TikTok 은 초안 전송이라 예약이 없다.
// Instagram·Facebook·Threads·X 는 플랫폼에 예약 API 가 없어서 예전엔 예약 시각을 무시하고 바로 게시했다(2026-10-17 발견).
// 이제 예약 시각이 미래면 이 대기열에 넣고, 정기 실행(/api/sns/scheduled-run, GitHub Actions 5분 주기)이
// 시각이 된 건을 요청자 권한으로 /api/sns/publish 에 다시 보낸다 — 게시 로직은 한 벌만 둔다.
import { getSql } from "../knowledge/_shared";
import { ensureSchemaOnce } from "./schema-marks.js";

type SqlFn = (query: string, params?: any[]) => Promise<any[]>;

/** 대기열로 예약하는 채널. YouTube(플랫폼 예약)·TikTok(초안 전송)은 여기 없다. 디스코드 웹훅도 예약 기능이 없어 여기서 예약한다. */
export const QUEUED_SCHEDULE_PLATFORMS = new Set(["instagram", "facebook", "threads", "x", "discord"]);
/** 이보다 가까운 시각은 예약이 아니라 지금 게시로 본다(정기 실행 주기보다 짧은 예약은 의미가 없다). */
export const MIN_SCHEDULE_LEAD_MS = 60_000;
/** 너무 먼 예약은 받지 않는다(토큰 만료·잊힌 예약 방지). */
export const MAX_SCHEDULE_LEAD_MS = 90 * 24 * 60 * 60 * 1000;
/** 한 번 실행에 보내는 건수. 게시 한 건이 하위 요청(게시 API 1번)이고, 실제 게시는 그 요청 안에서 돈다. */
export const MAX_SCHEDULED_PER_RUN = 5;
/** 이 시간 넘게 running 이면 실행이 끊긴 것으로 보고 실패 처리한다(같은 글이 두 번 올라가지 않게 재시도는 하지 않는다). */
export const STALE_RUNNING_MS = 15 * 60 * 1000;

export async function scheduleSql(env: any): Promise<SqlFn> {
  const sql = getSql(env) as SqlFn | null;
  if (!sql) throw new Error("schedule_db_unavailable");
  await ensureSchemaOnce(sql, "sns_scheduled_posts", runScheduleSchemaDdl);
  return sql;
}

// 이 함수의 소스가 바뀐 배포에서만 한 번 돈다(schema-marks.js). 퍼블리싱 저장소도 SNS 채널 예약을 이 표에 넣으므로 같이 준비한다.
export async function runScheduleSchemaDdl(sql: SqlFn): Promise<void> {
  await sql(`CREATE TABLE IF NOT EXISTS sns_scheduled_posts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, platform TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '',
    run_at TIMESTAMPTZ NOT NULL, body JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
    result JSONB, error TEXT NOT NULL DEFAULT '', attempts INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await sql(`CREATE INDEX IF NOT EXISTS sns_scheduled_posts_due ON sns_scheduled_posts (status, run_at)`);
  await sql(`CREATE INDEX IF NOT EXISTS sns_scheduled_posts_user ON sns_scheduled_posts (user_id, created_at DESC)`);
}

/**
 * 요청 본문에서 예약 시각을 읽는다. 스튜디오는 scheduledAt, 에이전트는 privacyStatus:'scheduled' + publishAt 을 보낸다.
 * 반환: 대기열에 넣을 ISO 시각 | "" (지금 게시) | { error } (받을 수 없는 시각).
 */
export function readQueuedSchedule(platform: string, body: any, now = Date.now()): string | { error: string } {
  if (!QUEUED_SCHEDULE_PLATFORMS.has(String(platform || ""))) return "";
  const raw = String(body?.scheduledAt || (body?.privacyStatus === "scheduled" ? body?.publishAt : "") || "").trim();
  if (!raw || raw === "now") return "";
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return { error: "schedule_invalid_time" };
  if (at - now < MIN_SCHEDULE_LEAD_MS) return "";
  if (at - now > MAX_SCHEDULE_LEAD_MS) return { error: "schedule_too_far" };
  return new Date(at).toISOString();
}

/** 예약 건을 넣는다. 저장하는 본문에서는 예약 표시를 지워, 정기 실행이 다시 보낼 때 바로 게시되게 한다. */
export async function enqueueScheduledPost(env: any, userId: string, platform: string, runAtIso: string, body: any) {
  const sql = await scheduleSql(env);
  const stored = { ...body };
  delete stored.scheduledAt;
  delete stored.publishAt;
  if (stored.privacyStatus === "scheduled") delete stored.privacyStatus;
  const q = scheduledPostInsert(userId, platform, runAtIso, stored);
  await sql(q.query, q.params);
  return { id: q.id, runAt: runAtIso };
}

/**
 * 예약 건 한 줄 넣기 질의(id 를 미리 정한다). 퍼블리싱 승인은 이 질의를 게시(delivery) 갱신과 같은 배치에 넣어
 * 'SNS 대기열에 들어갔는데 퍼블리싱엔 기록이 없는' 어긋남이 생기지 않게 한다.
 */
export function scheduledPostInsert(userId: string, platform: string, runAtIso: string, body: any) {
  const id = crypto.randomUUID();
  return {
    id,
    query: `INSERT INTO sns_scheduled_posts (id,user_id,platform,project_id,run_at,body) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    params: [id, userId, platform, String(body?.projectId || ""), runAtIso, JSON.stringify(body)],
  };
}

export function publicScheduledPost(row: any) {
  const result = row?.result && typeof row.result === "object" ? row.result : null;
  return {
    id: String(row?.id || ""), platform: String(row?.platform || ""), projectId: String(row?.project_id || ""),
    runAt: row?.run_at ? new Date(row.run_at).toISOString() : "", status: String(row?.status || ""),
    error: String(row?.error || ""), postId: String(result?.postId || result?.remotePostId || ""),
    url: String(result?.url || ""), publishedAt: String(result?.publishedAt || ""),
  };
}

/** 본인 예약 건 조회(ids 를 주면 그 건들만). */
export async function listScheduledPosts(env: any, userId: string, ids: string[] = []) {
  const sql = await scheduleSql(env);
  const clean = ids.map((v) => String(v || "").trim()).filter((v) => /^[a-f0-9-]{36}$/.test(v)).slice(0, 100);
  const rows = clean.length
    ? await sql(`SELECT * FROM sns_scheduled_posts WHERE user_id=$1 AND id = ANY($2::text[])`, [userId, clean])
    : await sql(`SELECT * FROM sns_scheduled_posts WHERE user_id=$1 ORDER BY run_at DESC LIMIT 100`, [userId]);
  return rows.map(publicScheduledPost);
}

/** 아직 시작 전인 본인 예약 건을 취소한다. */
export async function cancelScheduledPost(env: any, userId: string, id: string) {
  const sql = await scheduleSql(env);
  const rows = await sql(`UPDATE sns_scheduled_posts SET status='cancelled', updated_at=now()
    WHERE id=$1 AND user_id=$2 AND status='queued' RETURNING *`, [id, userId]);
  return rows[0] ? publicScheduledPost(rows[0]) : null;
}

/**
 * 시각이 된 예약 건을 게시한다. publish(userId, body) 는 요청자 권한으로 게시 API 를 부르는 함수다.
 * 건마다 queued→running 을 원자적으로 바꿔 집어 가므로 실행이 겹쳐도 한 건이 두 번 게시되지 않는다.
 */
export async function runDueScheduledPosts(
  env: any,
  publish: (userId: string, body: any) => Promise<{ ok: boolean; status: number; data: any }>,
  now = new Date(),
) {
  const sql = await scheduleSql(env);
  // 끊긴 실행: 같은 글이 이미 올라갔을 수도 있어 다시 보내지 않고 실패로 남긴다.
  await sql(`UPDATE sns_scheduled_posts SET status='error', error='scheduled_run_interrupted', updated_at=now()
    WHERE status='running' AND updated_at < $1`, [new Date(now.getTime() - STALE_RUNNING_MS).toISOString()]);
  const claimed = await sql(`UPDATE sns_scheduled_posts SET status='running', attempts=attempts+1, updated_at=now()
    WHERE id IN (SELECT id FROM sns_scheduled_posts WHERE status='queued' AND run_at <= $1
      ORDER BY run_at LIMIT ${MAX_SCHEDULED_PER_RUN} FOR UPDATE SKIP LOCKED)
    RETURNING *`, [now.toISOString()]);
  const outcomes: Array<{ id: string; status: string; error?: string }> = [];
  for (const row of claimed) {
    let status = "error";
    let error = "";
    let result: any = null;
    try {
      const res = await publish(String(row.user_id), row.body || {});
      if (res.ok && res.data?.ok !== false) {
        status = "done";
        result = res.data?.result && typeof res.data.result === "object" ? res.data.result : {};
        if (!result.publishedAt) result.publishedAt = new Date().toISOString();
      } else {
        error = String(res.data?.error || res.data?.message || `publish_failed_${res.status}`).slice(0, 1000);
      }
    } catch (e: any) {
      error = String(e?.message || e || "publish_failed").slice(0, 1000);
    }
    await sql(`UPDATE sns_scheduled_posts SET status=$2, result=$3::jsonb, error=$4, updated_at=now() WHERE id=$1`,
      [row.id, status, result ? JSON.stringify(result) : null, error]);
    outcomes.push({ id: String(row.id), status, ...(error ? { error } : {}) });
  }
  return { processed: claimed.length, outcomes };
}
