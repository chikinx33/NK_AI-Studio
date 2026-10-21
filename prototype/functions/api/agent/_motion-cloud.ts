// 인포그래픽 영상 클라우드 렌더러(2026-10-22 엔케 "PC가 꺼져 있어도 되게").
// 사이트가 Cloud Run Jobs(nk-motion-render, us-central1)를 한 번 실행시키면, 그 작업이 이 사용자 권한(짧은 위임 토큰)으로
// 기획 회의 → 자산 받기·정리 → 감독(Claude 구독) → 렌더 → 저장소 저장까지 혼자 끝낸다. 브라우저를 닫아도 된다.
// 진행 상황은 motion_cloud_runs 한 줄에 쌓이고, 화면은 그 줄을 몇 초마다 읽는다(DB 폴링은 진행 중일 때만).
import { issueSessionToken } from "../_shared/auth.js";
import { getGoogleAccessToken, resolveGcsEnv } from "../_shared/gcs.js";
import { ensureSchemaOnce } from "../_shared/schema-marks.js";
import type { SqlFn } from "../knowledge/_shared";

// 작업 위치는 고정이다(CF Pages 환경 변수 64개 한도 — 새 변수를 늘리지 않는다).
// 저장소 버킷(nkstudio-video-out)과 같은 미국 중부: 같은 지역이라 전송료가 없고, 1등급 가격이다.
// 두 단계로 나눈다: 기다리는 시간이 긴 기획·감독은 작은 작업(1 vCPU), 촬영·인코딩만 큰 작업(4 vCPU).
// Cloud Run 은 작업이 떠 있는 시간 전체를 CPU 크기만큼 매기므로, 큰 작업이 감독(4~8분)을 기다리면 비용이 세 배가 된다.
export const MOTION_CLOUD_JOBS = {
  prep: "projects/arboreal-lane-477616-d4/locations/us-central1/jobs/nk-motion-prep",
  render: "projects/arboreal-lane-477616-d4/locations/us-central1/jobs/nk-motion-render",
} as const;
// 작업 하나는 길어야 1시간(기획 3분 + 감독 최대 14분 + 렌더 10분 남짓). 위임 토큰은 그보다 조금 길게.
export const MOTION_CLOUD_TOKEN_TTL_SEC = 2 * 60 * 60;
// 진행 보고가 이만큼 끊기면 작업이 죽은 것으로 본다(작업은 15초마다 살아 있다고 알린다).
export const MOTION_CLOUD_STALE_SEC = 10 * 60;

export type MotionCloudMode = "new" | "revise" | "render";
export const MOTION_CLOUD_STATUSES = ["queued", "running", "awaiting-approval", "done", "error"] as const;
export const MOTION_CLOUD_PHASES = ["start", "plan", "assets", "director", "review", "render", "save"] as const;

async function runMotionCloudDdl(sql: SqlFn) {
  await sql(`CREATE TABLE IF NOT EXISTS motion_cloud_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    work_id text,
    skill_job_id text,
    mode text NOT NULL DEFAULT 'new',
    status text NOT NULL DEFAULT 'queued',
    phase text NOT NULL DEFAULT 'start',
    progress integer NOT NULL DEFAULT 0,
    chars integer NOT NULL DEFAULT 0,
    error text,
    input jsonb NOT NULL DEFAULT '{}'::jsonb,
    output jsonb NOT NULL DEFAULT '{}'::jsonb,
    execution text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
  )`);
  await sql("CREATE INDEX IF NOT EXISTS idx_motion_cloud_runs_user ON motion_cloud_runs(user_id, created_at DESC)");
  await sql("CREATE INDEX IF NOT EXISTS idx_motion_cloud_runs_work ON motion_cloud_runs(user_id, work_id, created_at DESC)");
}

export function ensureMotionCloudSchema(sql: SqlFn) {
  return ensureSchemaOnce(sql, "motion_cloud_runs_v1", runMotionCloudDdl);
}

const isUuid = (value: unknown) => /^[0-9a-f-]{36}$/i.test(String(value || ""));
const FINISHED = new Set(["done", "error", "awaiting-approval"]);

// 보고가 오래 끊긴 진행 중 작업은 오류로 바꿔 보여 준다(다음 작업을 막지 않게)
export function isStaleRun(row: any, now = Date.now()) {
  if (FINISHED.has(String(row?.status))) return false;
  const updated = Date.parse(String(row?.updated_at || ""));
  return Number.isFinite(updated) && now - updated > MOTION_CLOUD_STALE_SEC * 1000;
}

export async function getMotionCloudRun(sql: SqlFn, userId: string, runId: string) {
  if (!isUuid(runId)) return null;
  const rows = await sql("SELECT * FROM motion_cloud_runs WHERE id = $1 AND user_id = $2 LIMIT 1", [runId, userId]);
  return rows[0] || null;
}

export async function latestMotionCloudRun(sql: SqlFn, userId: string, workId: string) {
  if (!isUuid(workId)) return null;
  const rows = await sql(
    "SELECT * FROM motion_cloud_runs WHERE user_id = $1 AND work_id = $2 ORDER BY created_at DESC LIMIT 1",
    [userId, workId],
  );
  return rows[0] || null;
}

// 화면에 넘기는 형태(위임 토큰·장면 코드 같은 큰 입력은 싣지 않는다)
export function toMotionCloudRunDto(row: any) {
  const stale = isStaleRun(row);
  return {
    id: String(row.id),
    workId: row.work_id ? String(row.work_id) : null,
    skillJobId: row.skill_job_id ? String(row.skill_job_id) : null,
    mode: String(row.mode || "new"),
    status: stale ? "error" : String(row.status),
    phase: String(row.phase || "start"),
    progress: Number(row.progress) || 0,
    chars: Number(row.chars) || 0,
    error: stale ? "motion_cloud_stale" : (row.error ? String(row.error) : ""),
    output: row.output && typeof row.output === "object" ? row.output : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at || null,
  };
}

// 렌더 입력: 새 영상(기획 회의 작업 id) / 부분 수정(지금 장면 코드 + 요청 + 가리킨 시점) / 다시 렌더(AI 없이 바꾼 장면 코드)
export function normalizeMotionCloudStart(body: any): { ok: true; value: { mode: MotionCloudMode; workId: string | null; skillJobId: string | null; input: Record<string, unknown> } } | { ok: false; error: string } {
  const mode: MotionCloudMode = body?.mode === "revise" ? "revise" : body?.mode === "render" ? "render" : "new";
  const workId = isUuid(body?.workId) ? String(body.workId).toLowerCase() : null;
  const skillJobId = /^[0-9a-f-]{36}$/i.test(String(body?.skillJobId || "")) ? String(body.skillJobId) : null;
  const lang = body?.lang === "en" ? "en" : "ko";
  if (mode === "new") {
    if (!skillJobId && !workId) return { ok: false, error: "skillJobId 또는 workId가 필요합니다." };
    return { ok: true, value: { mode, workId, skillJobId, input: { lang } } };
  }
  if (!workId) return { ok: false, error: "workId가 필요합니다." };
  const html = String(body?.html || "");
  if (!/id=["']stage["']/.test(html) || !/window\.READY\s*=/.test(html) || html.length > 400_000) {
    return { ok: false, error: "장면 코드가 올바르지 않습니다." };
  }
  const episode = body?.episode && typeof body.episode === "object" ? body.episode : { bgm: null, cues: [] };
  if (mode === "render") return { ok: true, value: { mode, workId, skillJobId, input: { lang, html, episode } } };
  const request = String(body?.request || "").trim().slice(0, 4000);
  if (!request) return { ok: false, error: "수정 요청이 필요합니다." };
  const frameTimes = (Array.isArray(body?.frameTimes) ? body.frameTimes : [])
    .map(Number).filter((t: number) => Number.isFinite(t) && t >= 0 && t <= 120).slice(0, 4);
  return { ok: true, value: { mode, workId, skillJobId, input: { lang, html, episode, request, frameTimes } } };
}

// Cloud Run Jobs 실행: 사이트 서비스 계정(imagen-worker)은 이 작업 하나에만 '재정의해 실행' 권한이 있다.
export async function runMotionCloudJob(env: any, args: { job: keyof typeof MOTION_CLOUD_JOBS; runId: string; token: string; origin: string }) {
  const gcs = resolveGcsEnv(env);
  const accessToken = await getGoogleAccessToken({
    clientEmail: gcs.clientEmail,
    privateKeyPem: gcs.privateKeyRaw,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  });
  const response = await fetch(`https://run.googleapis.com/v2/${MOTION_CLOUD_JOBS[args.job]}:run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      overrides: {
        containerOverrides: [{
          env: [
            { name: "NK_RUN_ID", value: args.runId },
            { name: "NK_SESSION_TOKEN", value: args.token },
            { name: "NK_SITE_ORIGIN", value: args.origin },
          ],
        }],
      },
    }),
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `클라우드 렌더러 실행 실패 (HTTP ${response.status})`);
  return String(payload?.metadata?.name || payload?.name || "");
}

export async function startMotionCloudRun(sql: SqlFn, env: any, args: {
  userId: string;
  origin: string;
  value: { mode: MotionCloudMode; workId: string | null; skillJobId: string | null; input: Record<string, unknown> };
}) {
  await ensureMotionCloudSchema(sql);
  // 한 사람당 한 번에 하나(렌더가 겹치면 무료 한도를 빨리 쓴다)
  const active = await sql(
    "SELECT * FROM motion_cloud_runs WHERE user_id = $1 AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 3",
    [args.userId],
  );
  for (const row of active) {
    if (isStaleRun(row)) {
      await sql("UPDATE motion_cloud_runs SET status = 'error', error = 'motion_cloud_stale', finished_at = now(), updated_at = now() WHERE id = $1", [row.id]);
    } else {
      return { ok: false as const, status: 409, error: "motion_cloud_busy", run: toMotionCloudRunDto(row) };
    }
  }
  const rows = await sql(
    `INSERT INTO motion_cloud_runs (user_id, work_id, skill_job_id, mode, input)
     VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
    [args.userId, args.value.workId, args.value.skillJobId, args.value.mode, JSON.stringify(args.value.input)],
  );
  const row = rows[0];
  try {
    const { token } = await issueSessionToken(args.userId, env, MOTION_CLOUD_TOKEN_TTL_SEC, { persistent: false });
    // AI 없이 바꾼 장면 코드는 바로 렌더, 나머지는 기획·감독부터
    const job = args.value.mode === "render" ? "render" : "prep";
    const execution = await runMotionCloudJob(env, { job, runId: String(row.id), token, origin: args.origin });
    const updated = await sql(
      "UPDATE motion_cloud_runs SET execution = $2, updated_at = now() WHERE id = $1 RETURNING *",
      [row.id, execution],
    );
    return { ok: true as const, run: toMotionCloudRunDto(updated[0] || row) };
  } catch (error: any) {
    const message = String(error?.message || error || "클라우드 렌더러를 시작하지 못했습니다.");
    await sql("UPDATE motion_cloud_runs SET status = 'error', error = $2, finished_at = now(), updated_at = now() WHERE id = $1", [row.id, message]);
    return { ok: false as const, status: 500, error: message };
  }
}

// 작업이 보내는 진행 보고. 끝난 작업은 더 바꾸지 않는다.
export async function reportMotionCloudRun(sql: SqlFn, userId: string, body: any) {
  await ensureMotionCloudSchema(sql);
  const run = await getMotionCloudRun(sql, userId, String(body?.runId || ""));
  if (!run) return { ok: false as const, status: 404, error: "not_found" };
  if (FINISHED.has(String(run.status))) return { ok: false as const, status: 409, error: "motion_cloud_finished" };
  const status = MOTION_CLOUD_STATUSES.includes(body?.status) ? String(body.status) : "running";
  const phase = MOTION_CLOUD_PHASES.includes(body?.phase) ? String(body.phase) : String(run.phase || "start");
  const progress = Math.max(0, Math.min(100, Math.round(Number(body?.progress) || 0)));
  const chars = Math.max(0, Math.round(Number(body?.chars) || 0));
  const error = body?.error ? String(body.error).slice(0, 2000) : null;
  const workId = isUuid(body?.workId) ? String(body.workId).toLowerCase() : null;
  const output = body?.output && typeof body.output === "object" ? JSON.stringify(body.output).slice(0, 60_000) : null;
  const rows = await sql(
    `UPDATE motion_cloud_runs SET
       status = $3, phase = $4, progress = $5, chars = $6, error = $7,
       work_id = COALESCE($8, work_id),
       output = CASE WHEN $9::text IS NULL THEN output ELSE $9::jsonb END,
       finished_at = CASE WHEN $3 IN ('done','error','awaiting-approval') THEN now() ELSE finished_at END,
       updated_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [run.id, userId, status, phase, progress, chars, error, workId, output],
  );
  return { ok: true as const, run: rows[0] };
}

// 작은 작업(기획·감독)이 장면 코드를 넘기면 큰 작업(렌더)을 띄운다
export async function handoffMotionCloudRun(sql: SqlFn, env: any, userId: string, body: any, origin: string) {
  await ensureMotionCloudSchema(sql);
  const run = await getMotionCloudRun(sql, userId, String(body?.runId || ""));
  if (!run) return { ok: false as const, status: 404, error: "not_found" };
  if (FINISHED.has(String(run.status))) return { ok: false as const, status: 409, error: "motion_cloud_finished" };
  const html = String(body?.html || "");
  if (!/id=["']stage["']/.test(html) || !/window\.READY\s*=/.test(html) || html.length > 400_000) {
    return { ok: false as const, status: 400, error: "장면 코드가 올바르지 않습니다." };
  }
  const workId = isUuid(body?.workId) ? String(body.workId).toLowerCase() : run.work_id;
  if (!isUuid(workId)) return { ok: false as const, status: 400, error: "workId가 필요합니다." };
  const input = {
    ...(run.input && typeof run.input === "object" ? run.input : {}),
    html,
    episode: body?.episode && typeof body.episode === "object" ? body.episode : { bgm: null, cues: [] },
    prepTimings: body?.timings && typeof body.timings === "object" ? body.timings : {},
  };
  await sql(
    `UPDATE motion_cloud_runs SET input = $3::jsonb, work_id = $4, phase = 'render', progress = 0, chars = 0, updated_at = now()
     WHERE id = $1 AND user_id = $2`,
    [run.id, userId, JSON.stringify(input), workId],
  );
  const { token } = await issueSessionToken(userId, env, MOTION_CLOUD_TOKEN_TTL_SEC, { persistent: false });
  const execution = await runMotionCloudJob(env, { job: "render", runId: String(run.id), token, origin });
  await sql("UPDATE motion_cloud_runs SET execution = $2, updated_at = now() WHERE id = $1", [run.id, execution]);
  return { ok: true as const };
}
