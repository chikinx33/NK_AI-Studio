// prototype/functions/api/_shared/publishing-store.ts
//
// 퍼블리싱 저장소(Neon Postgres). 모든 행은 user_id 로 사용자마다 갈린다.
//   publishing_channels   게시할 곳(네이버 블로그 등). 방식 pc | manual (api 는 3단계)
//   publishing_items      글(제목·본문 표시·태그·이미지·브랜드, extras = 패키지에서 온 첨부 영상·번역·메모·첫 댓글)
//   publishing_deliveries 글 하나가 채널 하나로 나가는 단위(CONTRACT §2)
//   publisher_devices     연결된 PC(NK Publisher). 기기 토큰은 sha256 만 저장
//   publisher_pairing_codes 8자리 연결 코드(10분, 한 번)
//   publishing_events     작업 배정·결과 기록. 결과는 (작업, 시도) 하나만 반영(dedupe_key)
//   publishing_campaigns  캠페인(한 브랜드의 기간 행사 홍보). 글은 campaign_id 로 묶인다(에이전트가 지침·날짜별 초안을 만든다)
//
// SNS 채널(api 방식): 승인하면 게시를 SNS 예약 대기열(sns_scheduled_posts)에 넣고 sns_job_id 로 잇는다.
// 정기 실행이 SNS 세팅에 연결된 계정으로 올리고, 화면을 읽을 때 대기열 결과를 게시 상태로 옮긴다(snsSyncQuery).
// 승인이 풀리거나 취소되면 아직 안 나간 대기열 건도 같은 배치에서 취소한다(snsCancelQuery).
//
// Worker 서브요청 50번 한도(Neon 질의 1번 = 1번): 화면 한 번 읽기·일괄 승인·가져오기는 getSqlBatch 로
// 읽기 1번 + 쓰기 1번에 끝낸다. 글 수에 비례해 질의를 늘리지 않는다.
import { getSql, getSqlBatch } from "../knowledge/_shared";
import { ensureSchemaOnce } from "./schema-marks.js";
import { resolveGcsEnv, getGoogleAccessToken, signGcsObjectUrl } from "./gcs.js";
import { buildUserRoot } from "./storage";
import { runScheduleSchemaDdl } from "./sns-schedule";
import { accessContext, copyObject, getObject, workspacePrefix } from "./company-files-gcs";
import {
  LEASE_MS, MAX_ATTEMPTS, RETRY_DELAY_MS, PAIRING_CODE_TTL_MS, TITLE_MAX, TAGS_MAX, PUBLISHING_TIME_ZONE,
  validateChannelInput, normalizeTitle, normalizeTagList, contentHashOf, planApproval, checkSpamGuard,
  normalizeImportItem, weekRange, randomId, generatePairingCode, normalizePairingCode, generateDeviceToken, sha256Hex,
  markupToBlocks, blocksToPlainText, blocksToHtml, channelWriteUrl, decideResultOutcome, imageInfo, FINAL_STATUSES, pickImportChannel,
  PUBLISHING_TZ_OFFSET_MIN, CHANNEL_TYPES, isChannelModeAvailable, snsCaption, snsContentBlock, buildSnsPublishBody,
  normalizeCampaignInput, normalizeCampaignPost, campaignIdFor, campaignExternalId, CAMPAIGN_POSTS_PER_CALL, DEFAULT_DAILY_LIMIT, DEFAULT_MIN_INTERVAL_HOURS,
} from "./publishing-core.js";
import { normalizePackagePath, videoContentType } from "./publishing-packages-core.js";

type SqlFn = (query: string, params?: any[]) => Promise<any[]>;
type BatchFn = (queries: Array<{ query: string; params?: any[] }>) => Promise<any[][]>;
export type PublishingDb = { sql: SqlFn; batch: BatchFn };

export class PublishingError extends Error {
  status: number;
  code: string;
  constructor(code: string, status = 400, message = "") {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

export async function publishingDb(env: any): Promise<PublishingDb> {
  const sql = getSql(env) as SqlFn | null;
  const batch = getSqlBatch(env) as BatchFn | null;
  if (!sql || !batch) throw new PublishingError("publishing_db_unavailable", 503);
  await ensureSchemaOnce(sql, "publishing_v1", runPublishingDdl);
  // SNS 채널 예약은 SNS 대기열 표에 넣고 화면 읽기가 그 결과를 조인한다 — 표가 먼저 있어야 한다.
  await ensureSchemaOnce(sql, "sns_scheduled_posts", runScheduleSchemaDdl);
  return { sql, batch };
}

// 이 함수의 소스가 바뀐 배포에서만 한 번 돈다(schema-marks.js). 질의 수를 줄이려 DO 블록 하나로 묶는다.
export async function runPublishingDdl(sql: SqlFn): Promise<void> {
  await sql(`DO $$ BEGIN
    CREATE TABLE IF NOT EXISTS publishing_channels (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, mode TEXT NOT NULL, name TEXT NOT NULL,
      brand_id TEXT NOT NULL DEFAULT '', account_label TEXT NOT NULL DEFAULT '', target JSONB NOT NULL DEFAULT '{}'::jsonb,
      daily_limit INT NOT NULL DEFAULT 1, min_interval_hours DOUBLE PRECISION NOT NULL DEFAULT 20, enabled BOOLEAN NOT NULL DEFAULT TRUE,
      deleted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS publishing_channels_user ON publishing_channels (user_id);
    CREATE TABLE IF NOT EXISTS publishing_items (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, brand_id TEXT NOT NULL DEFAULT '', external_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', tags JSONB NOT NULL DEFAULT '[]'::jsonb, images JSONB NOT NULL DEFAULT '[]'::jsonb,
      content_hash TEXT NOT NULL DEFAULT '', approved_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS publishing_items_user ON publishing_items (user_id, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS publishing_items_external ON publishing_items (user_id, external_id) WHERE external_id <> '';
    CREATE TABLE IF NOT EXISTS publishing_deliveries (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, item_id TEXT NOT NULL, channel_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft', scheduled_at TIMESTAMPTZ, content_hash TEXT NOT NULL DEFAULT '', guard_reason TEXT NOT NULL DEFAULT '',
      attempt INT NOT NULL DEFAULT 0, attempt_base INT NOT NULL DEFAULT 0, lease_until TIMESTAMPTZ, device_id TEXT NOT NULL DEFAULT '', claimed_at TIMESTAMPTZ,
      stage TEXT NOT NULL DEFAULT '', stage_message TEXT NOT NULL DEFAULT '',
      posted_url TEXT NOT NULL DEFAULT '', posted_at TIMESTAMPTZ, error_code TEXT NOT NULL DEFAULT '', error_message TEXT NOT NULL DEFAULT '',
      screenshot_object TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS publishing_deliveries_due ON publishing_deliveries (user_id, status, scheduled_at);
    CREATE INDEX IF NOT EXISTS publishing_deliveries_channel ON publishing_deliveries (channel_id, scheduled_at);
    CREATE INDEX IF NOT EXISTS publishing_deliveries_item ON publishing_deliveries (item_id);
    CREATE TABLE IF NOT EXISTS publisher_devices (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', os TEXT NOT NULL DEFAULT '', app_version TEXT NOT NULL DEFAULT '',
      token_hash TEXT NOT NULL UNIQUE, sessions JSONB NOT NULL DEFAULT '[]'::jsonb, last_seen_at TIMESTAMPTZ, last_heartbeat_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS publisher_devices_user ON publisher_devices (user_id);
    CREATE TABLE IF NOT EXISTS publisher_pairing_codes (
      code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, device_id TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS publisher_pairing_codes_user ON publisher_pairing_codes (user_id);
    CREATE TABLE IF NOT EXISTS publishing_events (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, delivery_id TEXT NOT NULL DEFAULT '', device_id TEXT NOT NULL DEFAULT '', attempt INT NOT NULL DEFAULT 0,
      kind TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}'::jsonb, dedupe_key TEXT UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS publishing_events_delivery ON publishing_events (delivery_id, created_at);
    ALTER TABLE publishing_items ADD COLUMN IF NOT EXISTS extras JSONB NOT NULL DEFAULT '{}'::jsonb;
    CREATE TABLE IF NOT EXISTS publishing_campaigns (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, key TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
      brand_id TEXT NOT NULL DEFAULT '', brand_title TEXT NOT NULL DEFAULT '', goal TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL DEFAULT '', end_date TEXT NOT NULL DEFAULT '', guide_path TEXT NOT NULL DEFAULT '',
      deleted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS publishing_campaigns_user ON publishing_campaigns (user_id);
    ALTER TABLE publishing_items ADD COLUMN IF NOT EXISTS campaign_id TEXT NOT NULL DEFAULT '';
    CREATE INDEX IF NOT EXISTS publishing_items_campaign ON publishing_items (user_id, campaign_id);
    ALTER TABLE publishing_deliveries ADD COLUMN IF NOT EXISTS sns_job_id TEXT NOT NULL DEFAULT '';
  END $$`);
}

// ── 행 → 화면/약속 모양 ──────────────────────────────────────────────────────

const iso = (v: any): string => {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(String(v).replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
};
/** 키 순서와 상관없는 비교용 문자열(jsonb 는 키 순서를 바꿔 돌려준다). */
const stable = (v: any): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
};
const json = (v: any, fallback: any) => {
  if (v == null) return fallback;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return fallback; } }
  return v;
};

export function publicChannel(r: any) {
  return {
    id: String(r.id), type: String(r.type), mode: String(r.mode), name: String(r.name || ""),
    brandId: String(r.brand_id || ""), accountLabel: String(r.account_label || ""), target: json(r.target, {}),
    dailyLimit: Number(r.daily_limit) || 1, minIntervalHours: Number(r.min_interval_hours ?? 20), enabled: r.enabled !== false,
    writeUrl: channelWriteUrl(String(r.type), json(r.target, {})),
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  };
}

export function publicDelivery(r: any) {
  return {
    id: String(r.id), itemId: String(r.item_id), channelId: String(r.channel_id), status: String(r.status),
    scheduledAt: iso(r.scheduled_at), attempt: Number(r.attempt) || 0, leaseUntil: iso(r.lease_until), deviceId: String(r.device_id || ""),
    stage: String(r.stage || ""), stageMessage: String(r.stage_message || ""), postedUrl: String(r.posted_url || ""), postedAt: iso(r.posted_at),
    errorCode: String(r.error_code || ""), errorMessage: String(r.error_message || ""), screenshotObject: String(r.screenshot_object || ""),
    guardReason: String(r.guard_reason || ""), updatedAt: iso(r.updated_at),
  };
}

type PublicDelivery = ReturnType<typeof publicDelivery>;

/** 글 목록의 상태 칸(draft/approved/scheduled/posted/failed/needs_human). 사람 손이 필요한 것이 가장 앞선다. */
export function itemDisplayStatus(approved: boolean, deliveries: Array<{ status: string }>): string {
  const live = deliveries.filter((d) => d.status !== "cancelled");
  if (live.some((d) => d.status === "needs_human" || d.status === "ready_manual")) return "needs_human";
  if (live.some((d) => d.status === "failed")) return "failed";
  if (live.some((d) => d.status === "tested")) return "tested";
  if (!approved) return "draft";
  if (live.length && live.every((d) => d.status === "posted" || d.status === "done_manual")) return "posted";
  if (live.some((d) => ["scheduled", "claimed", "publishing"].includes(d.status))) return "scheduled";
  return "approved";
}

function publicImage(img: any, i: number) {
  return {
    ref: `img${i + 1}`, objectName: String(img?.objectName || ""), sha256: String(img?.sha256 || ""),
    width: Number(img?.width) || 0, height: Number(img?.height) || 0, contentType: String(img?.contentType || ""),
    alt: String(img?.alt || ""), caption: String(img?.caption || ""),
    sourceUrl: String(img?.sourceUrl || ""), sourcePath: String(img?.sourcePath || ""), fileName: String(img?.fileName || ""),
    // 업무 파일에서 옮기지 못한 이유(파일이 없음 등). 있으면 자동으로 다시 옮기지 않는다 — 사람이 사진을 올려 채운다.
    sourceError: String(img?.sourceError || ""),
    missing: !img?.objectName,
  };
}

/**
 * 글 extras(패키지 가져오기가 채운다). 영상은 복사하지 않고 업무 파일 경로를 가리킨다.
 * changedAfterApproval: 승인된 글의 내용·일정이 바뀌어 승인이 풀린 시각 — 다시 승인하면 지운다.
 */
export function sanitizeExtras(raw: any) {
  const src = raw && typeof raw === "object" ? raw : {};
  const text = (v: any, max: number) => String(v ?? "").slice(0, max);
  const out: any = {};
  const videos = (Array.isArray(src.videos) ? src.videos : []).slice(0, 10).map((v: any) => ({
    path: text(v?.path, 600), name: text(v?.name, 200), size: Math.max(0, Number(v?.size) || 0), contentType: text(v?.contentType, 60),
  })).filter((v: any) => v.path && !v.path.split("/").includes(".."));
  if (videos.length) out.videos = videos;
  for (const key of ["translation", "notes", "firstComment"]) if (src[key]) out[key] = text(src[key], 60000);
  if (src.packagePath) out.packagePath = text(src.packagePath, 600);
  if (src.packageHash) out.packageHash = text(src.packageHash, 80);
  if (src.lang) out.lang = text(src.lang, 10);
  if (src.changedAfterApproval) out.changedAfterApproval = text(src.changedAfterApproval, 40);
  return out;
}

/** 게시되는 내용에 드는 extras(첨부 영상·첫 댓글). 번역·메모는 올리는 사람용이라 바뀌어도 승인을 풀지 않는다. */
const publishedExtras = (e: any) => ({ videos: (e?.videos || []).map((v: any) => `${v.path}|${v.size}`), firstComment: e?.firstComment || "" });

export function publicItem(r: any, deliveries: PublicDelivery[]) {
  const images = (json(r.images, []) as any[]).map(publicImage);
  const body = String(r.body || "");
  const blocks = markupToBlocks(body, images);
  const extras = sanitizeExtras(json(r.extras, {}));
  return {
    id: String(r.id), brandId: String(r.brand_id || ""), externalId: String(r.external_id || ""), campaignId: String(r.campaign_id || ""),
    title: String(r.title || ""), body, tags: json(r.tags, []) as string[], images,
    extras: {
      videos: extras.videos || [], translation: extras.translation || "", notes: extras.notes || "", firstComment: extras.firstComment || "",
      packagePath: extras.packagePath || "", lang: extras.lang || "",
    },
    needsReapproval: !r.approved_at && !!extras.changedAfterApproval,
    approvedAt: iso(r.approved_at), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
    status: itemDisplayStatus(!!r.approved_at, deliveries),
    missingImages: images.filter((img) => img.missing).length,
    blockedCount: deliveries.filter((d) => d.status === "draft" && d.guardReason).length,
    // 수동 복사 화면: 서식 복사(text/html)·글자 복사(text/plain). 블록은 PC 앱 Job 과 같은 변환을 거친다.
    copyHtml: blocksToHtml(blocks), plainText: blocksToPlainText(blocks),
    deliveries,
  };
}

export function publicCampaign(r: any) {
  return {
    id: String(r.id), key: String(r.key || ""), title: String(r.title || ""), brandId: String(r.brand_id || ""), brandTitle: String(r.brand_title || ""),
    goal: String(r.goal || ""), startDate: String(r.start_date || ""), endDate: String(r.end_date || ""), guidePath: String(r.guide_path || ""),
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  };
}

export function publicDevice(r: any) {
  return {
    id: String(r.id), name: String(r.name || ""), os: String(r.os || ""), appVersion: String(r.app_version || ""),
    sessions: json(r.sessions, []), lastSeenAt: iso(r.last_seen_at), lastHeartbeatAt: iso(r.last_heartbeat_at), createdAt: iso(r.created_at),
  };
}

// ── 상태 정리(읽을 때마다 같이 돈다) ────────────────────────────────────────

/**
 * 결과 보고 없이 임대가 끝난 작업을 정리한다. publishing-core.js decideLeaseExpiry 와 같은 규칙:
 * 등록 단계(submitting)였으면 needs_human/UNCERTAIN(다시 올리지 않음), 아니면 LEASE_EXPIRED 재시도(30분 뒤, 3번까지).
 */
export function leaseExpiryQuery(userId?: string) {
  const retryMin = Math.round(RETRY_DELAY_MS / 60000);
  return {
    query: `UPDATE publishing_deliveries SET
      status = CASE WHEN stage = 'submitting' THEN 'needs_human' WHEN attempt - attempt_base < ${MAX_ATTEMPTS} THEN 'scheduled' ELSE 'failed' END,
      error_code = CASE WHEN stage = 'submitting' THEN 'UNCERTAIN' ELSE 'LEASE_EXPIRED' END,
      error_message = CASE WHEN stage = 'submitting' THEN '등록 단계에서 PC 앱 응답이 끊겼어요. 글이 올라갔는지 확인해 주세요.' ELSE 'PC 앱이 제한 시간 안에 결과를 보내지 않았어요.' END,
      scheduled_at = CASE WHEN stage <> 'submitting' AND attempt - attempt_base < ${MAX_ATTEMPTS} THEN now() + interval '${retryMin} minutes' ELSE scheduled_at END,
      lease_until = NULL, updated_at = now()
      WHERE status = 'claimed' AND lease_until < now()${userId ? " AND user_id = $1" : ""}`,
    params: userId ? [userId] : [],
  };
}

/** 직접 올리기(manual) 채널은 예약 시각이 되면 '올릴 차례(ready_manual)'로 바꾼다. */
export function manualDueQuery(userId: string) {
  return {
    query: `UPDATE publishing_deliveries d SET status = 'ready_manual', updated_at = now()
      FROM publishing_channels c WHERE d.user_id = $1 AND d.status = 'scheduled' AND d.scheduled_at <= now()
      AND c.id = d.channel_id AND c.mode = 'manual'`,
    params: [userId],
  };
}

/**
 * SNS 대기열 결과 → 게시 상태. 올라갔으면 posted(주소·시각), 실패면 failed(사람이 다시 예약), 올리는 중이면 publishing.
 * 승인이 풀려 초안으로 돌아간 뒤에 대기열이 이미 올렸다면(취소보다 실행이 빨랐다) 그 사실이 이긴다 — 실제로 올라갔기 때문이다.
 */
export function snsSyncQuery(userId: string) {
  return {
    query: `UPDATE publishing_deliveries d SET
      status = CASE s.status WHEN 'done' THEN 'posted' WHEN 'running' THEN 'publishing' ELSE 'failed' END,
      posted_url = CASE WHEN s.status = 'done' THEN COALESCE(s.result->>'url', '') ELSE d.posted_url END,
      posted_at = CASE WHEN s.status = 'done' THEN s.updated_at ELSE d.posted_at END,
      error_code = CASE WHEN s.status = 'error' THEN 'UNKNOWN' ELSE '' END,
      error_message = CASE WHEN s.status = 'error' THEN left(s.error, 1000) ELSE '' END,
      updated_at = now()
      FROM sns_scheduled_posts s
      WHERE d.user_id = $1 AND d.sns_job_id <> '' AND s.id = d.sns_job_id AND s.user_id = d.user_id AND (
        (s.status = 'done' AND d.status NOT IN ('posted', 'done_manual', 'cancelled'))
        OR (s.status = 'running' AND d.status = 'scheduled')
        OR (s.status = 'error' AND d.status IN ('scheduled', 'publishing')))`,
    params: [userId],
  };
}

/**
 * 아직 안 나간 SNS 대기열 건 취소. cond 는 publishing_deliveries 조건(별칭 없이, $1 = user_id 뒤에 params 가 $2…).
 * 게시 상태를 초안·취소로 바꾸는 질의보다 먼저(같은 배치에서) 넣는다 — 바뀐 뒤엔 'scheduled' 조건으로 못 찾는다.
 */
export function snsCancelQuery(userId: string, cond: string, params: any[] = []) {
  return {
    query: `UPDATE sns_scheduled_posts SET status = 'cancelled', updated_at = now()
      WHERE user_id = $1 AND status = 'queued' AND id IN
        (SELECT sns_job_id FROM publishing_deliveries WHERE user_id = $1 AND sns_job_id <> '' AND status = 'scheduled' AND ${cond})`,
    params: [userId, ...params],
  };
}

// ── 화면 전체 읽기 ──────────────────────────────────────────────────────────

const ITEM_LIMIT = 500;

export async function loadPublishingState(db: PublishingDb, userId: string) {
  const [, , , channels, items, deliveries, devices, campaigns] = await db.batch([
    manualDueQuery(userId),
    leaseExpiryQuery(userId),
    snsSyncQuery(userId),
    { query: `SELECT * FROM publishing_channels WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at`, params: [userId] },
    { query: `SELECT * FROM publishing_items WHERE user_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ${ITEM_LIMIT}`, params: [userId] },
    {
      query: `SELECT d.* FROM publishing_deliveries d WHERE d.user_id = $1 AND d.item_id IN
        (SELECT id FROM publishing_items WHERE user_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ${ITEM_LIMIT})
        ORDER BY d.scheduled_at NULLS LAST`,
      params: [userId],
    },
    { query: `SELECT * FROM publisher_devices WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at`, params: [userId] },
    { query: `SELECT * FROM publishing_campaigns WHERE user_id = $1 AND deleted_at IS NULL ORDER BY start_date DESC, created_at DESC`, params: [userId] },
  ]);
  const byItem = new Map<string, PublicDelivery[]>();
  for (const row of deliveries) {
    const d = publicDelivery(row);
    if (!byItem.has(d.itemId)) byItem.set(d.itemId, []);
    byItem.get(d.itemId)!.push(d);
  }
  return {
    serverTime: new Date().toISOString(),
    channels: channels.map(publicChannel),
    items: items.map((r) => publicItem(r, byItem.get(String(r.id)) || [])),
    devices: devices.map(publicDevice),
    campaigns: campaigns.map(publicCampaign),
  };
}

// ── 일정 읽기(다른 도구용, publishing:read) ─────────────────────────────────

export const SCHEDULE_MAX_DAYS = 120;

/** 'YYYY-MM-DD'(한국 날짜) → 그날 0시(한국 시간)의 UTC ms. 형식이 아니면 NaN. */
function kstMidnightMs(day: string) {
  const m = String(day || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - PUBLISHING_TZ_OFFSET_MIN * 60000 : NaN;
}
const kstParts = (isoText: string) => {
  const d = new Date(Date.parse(isoText) + PUBLISHING_TZ_OFFSET_MIN * 60000).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
};

/**
 * 게시 일정 목록(취소된 건·지운 글 제외). 기간은 한국 날짜 from~to(둘 다 포함), 기본 오늘-7일 ~ 오늘+30일, 최대 120일.
 * 한 줄 = 게시 한 건(글 하나가 채널 둘로 나가면 두 줄). 상태는 게시(delivery) 상태 그대로.
 */
export async function loadSchedule(db: PublishingDb, userId: string, q: { from?: string; to?: string; brand?: string }) {
  const today = kstParts(new Date().toISOString()).date;
  const from = String(q.from || "") || new Date(kstMidnightMs(today) + PUBLISHING_TZ_OFFSET_MIN * 60000 - 7 * 86400000).toISOString().slice(0, 10);
  const to = String(q.to || "") || new Date(kstMidnightMs(today) + PUBLISHING_TZ_OFFSET_MIN * 60000 + 30 * 86400000).toISOString().slice(0, 10);
  const startMs = kstMidnightMs(from);
  const endMs = kstMidnightMs(to) + 86400000;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new PublishingError("schedule_range_invalid");
  if (endMs - startMs > SCHEDULE_MAX_DAYS * 86400000) throw new PublishingError("schedule_range_too_long");
  const brand = String(q.brand || "").slice(0, 120);
  const [, , rows] = await db.batch([
    manualDueQuery(userId),
    snsSyncQuery(userId),
    {
      query: `SELECT d.id, d.item_id, d.status, d.scheduled_at, d.posted_url, d.posted_at, c.type AS channel_type, c.name AS channel_name,
          i.brand_id, i.title, i.external_id, i.approved_at, i.extras, i.campaign_id, g.title AS campaign_title
        FROM publishing_deliveries d
        JOIN publishing_items i ON i.id = d.item_id AND i.user_id = d.user_id AND i.deleted_at IS NULL
        LEFT JOIN publishing_channels c ON c.id = d.channel_id
        LEFT JOIN publishing_campaigns g ON g.id = i.campaign_id AND g.user_id = i.user_id
        WHERE d.user_id = $1 AND d.status <> 'cancelled'
          AND COALESCE(d.scheduled_at, d.posted_at) >= $2::timestamptz AND COALESCE(d.scheduled_at, d.posted_at) < $3::timestamptz
          AND ($4::text = '' OR i.brand_id = $4::text)
        ORDER BY COALESCE(d.scheduled_at, d.posted_at), d.id LIMIT 1000`,
      params: [userId, new Date(startMs).toISOString(), new Date(endMs).toISOString(), brand],
    },
  ]);
  return {
    from, to, brand,
    items: rows.map((r: any) => {
      const at = iso(r.scheduled_at) || iso(r.posted_at);
      const extras = sanitizeExtras(json(r.extras, {}));
      return {
        ...kstParts(at), scheduledAt: iso(r.scheduled_at),
        channelType: String(r.channel_type || ""), channelName: String(r.channel_name || ""), brand: String(r.brand_id || ""),
        title: String(r.title || ""), status: String(r.status), postedUrl: String(r.posted_url || ""), postedAt: iso(r.posted_at),
        approved: !!r.approved_at, needsReapproval: !r.approved_at && !!extras.changedAfterApproval,
        itemId: String(r.item_id), deliveryId: String(r.id), externalId: String(r.external_id || ""), packagePath: extras.packagePath || "",
        campaignId: String(r.campaign_id || ""), campaignTitle: String(r.campaign_title || ""),
      };
    }),
  };
}

// ── 채널 ────────────────────────────────────────────────────────────────────

export async function saveChannel(db: PublishingDb, userId: string, input: any) {
  const v = validateChannelInput(input);
  if (!v.ok) throw new PublishingError(v.error);
  const c = v.channel;
  const id = String(input?.id || "").trim();
  if (id) {
    const rows = await db.sql(`UPDATE publishing_channels SET type=$3, mode=$4, name=$5, brand_id=$6, account_label=$7, target=$8::jsonb,
      daily_limit=$9, min_interval_hours=$10, enabled=$11, updated_at=now() WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING *`,
      [id, userId, c.type, c.mode, c.name, c.brandId, c.accountLabel, JSON.stringify(c.target), c.dailyLimit, c.minIntervalHours, c.enabled]);
    if (!rows[0]) throw new PublishingError("channel_not_found", 404);
    return publicChannel(rows[0]);
  }
  const rows = await db.sql(`INSERT INTO publishing_channels (id,user_id,type,mode,name,brand_id,account_label,target,daily_limit,min_interval_hours,enabled)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11) RETURNING *`,
    [randomId("ch"), userId, c.type, c.mode, c.name, c.brandId, c.accountLabel, JSON.stringify(c.target), c.dailyLimit, c.minIntervalHours, c.enabled]);
  return publicChannel(rows[0]);
}

/** 채널을 지우면 아직 안 나간 게시는 취소한다(올라간 기록은 남는다). */
export async function deleteChannel(db: PublishingDb, userId: string, id: string) {
  const [, rows] = await db.batch([
    snsCancelQuery(userId, "channel_id = $2", [id]),
    { query: `UPDATE publishing_channels SET deleted_at=now(), enabled=FALSE, updated_at=now() WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING id`, params: [id, userId] },
    { query: `UPDATE publishing_deliveries SET status='cancelled', updated_at=now() WHERE channel_id=$1 AND user_id=$2 AND status IN ('draft','scheduled','ready_manual','failed','needs_human')`, params: [id, userId] },
  ]);
  if (!rows[0]) throw new PublishingError("channel_not_found", 404);
  return { id };
}

// ── 글 저장(한 건·가져오기 공용) ─────────────────────────────────────────────

/** 사람이 고칠 수 있는 게시 상태. 집어 간 것·끝난 것·결과가 난 것은 그대로 둔다. */
const EDITABLE_DELIVERY = new Set(["draft", "scheduled", "ready_manual"]);

export function publishingImagePrefix(env: any, userId: string) {
  return `${buildUserRoot(resolveGcsEnv(env).basePrefix, userId)}/publishing/images/`;
}

function sanitizeImages(env: any, userId: string, raw: any): any[] {
  const prefix = (() => { try { return publishingImagePrefix(env, userId); } catch { return "\u0000"; } })();
  return (Array.isArray(raw) ? raw : []).slice(0, 20).map((img: any) => {
    const objectName = String(img?.objectName || "");
    // 남의 파일이나 퍼블리싱 폴더 밖 객체를 글에 걸어 PC 앱으로 서명 주소를 받아 가지 못하게 한다.
    const owned = objectName.startsWith(prefix) && !objectName.includes("..");
    return {
      ...(owned ? {
        objectName, sha256: String(img?.sha256 || "").slice(0, 64), width: Number(img?.width) || 0, height: Number(img?.height) || 0,
        contentType: String(img?.contentType || "").slice(0, 40),
      } : {}),
      alt: String(img?.alt || "").slice(0, 200), caption: String(img?.caption || "").slice(0, 200),
      sourceUrl: String(img?.sourceUrl || "").slice(0, 1000), sourcePath: String(img?.sourcePath || "").slice(0, 1000),
      fileName: String(img?.fileName || "").slice(0, 200),
      // 패키지에서 복사한 이미지: 원본 업무 파일의 md5. 같으면 다시 가져올 때 복사하지 않는다.
      ...(img?.sourceMd5 ? { sourceMd5: String(img.sourceMd5).slice(0, 40) } : {}),
      ...(!owned && img?.sourceError ? { sourceError: String(img.sourceError).slice(0, 60) } : {}),
    };
  });
}

export type ItemInput = {
  id?: string; externalId?: string; brandId?: string; title: string; body: string; tags: string[]; images: any[];
  deliveries: Array<{ id?: string; channelId: string; scheduledAt: string }>;
  /** 주면 extras 를 이 값으로 바꾼다(패키지 가져오기). 안 주면 있던 extras 를 그대로 둔다(화면에서 글 고치기). */
  extras?: any;
  /** 주면 이 캠페인으로 묶는다("" 는 캠페인에서 뺀다). 안 주면 있던 값을 그대로 둔다. */
  campaignId?: string;
};

/**
 * 글 여러 개를 한 번에 저장한다(읽기 1번 + 쓰기 1번).
 * 승인된 글의 내용·이미지·일정이 바뀌면 승인을 풀고 예약을 초안으로 되돌린다 — 확인하지 않은 내용이 나가지 않게.
 * 반환: 저장된 글 id 목록(입력 순서).
 */
export async function applyItemSaves(db: PublishingDb, env: any, userId: string, inputs: ItemInput[]) {
  if (!inputs.length) return [];
  const ids = inputs.map((i) => String(i.id || "")).filter(Boolean);
  const externalIds = inputs.map((i) => String(i.externalId || "")).filter(Boolean);
  const [items, deliveries, channels] = await db.batch([
    { query: `SELECT * FROM publishing_items WHERE user_id=$1 AND (id = ANY($2::text[]) OR (external_id <> '' AND external_id = ANY($3::text[])))`, params: [userId, ids, externalIds] },
    {
      query: `SELECT * FROM publishing_deliveries WHERE user_id=$1 AND item_id IN
        (SELECT id FROM publishing_items WHERE user_id=$1 AND (id = ANY($2::text[]) OR (external_id <> '' AND external_id = ANY($3::text[]))))`,
      params: [userId, ids, externalIds],
    },
    { query: `SELECT id FROM publishing_channels WHERE user_id=$1 AND deleted_at IS NULL`, params: [userId] },
  ]);
  const channelIds = new Set(channels.map((c: any) => String(c.id)));
  const byId = new Map(items.map((r: any) => [String(r.id), r]));
  const byExternal = new Map(items.filter((r: any) => r.external_id).map((r: any) => [String(r.external_id), r]));
  const writes: Array<{ query: string; params: any[] }> = [];
  const savedIds: string[] = [];
  for (const input of inputs) {
    const title = normalizeTitle(input.title);
    if (!title) throw new PublishingError("title_required");
    const body = String(input.body || "").slice(0, 60000);
    const tags = normalizeTagList(input.tags);
    const hash = await contentHashOf(title, body);
    const existing: any = (input.id && byId.get(String(input.id))) || (input.externalId && byExternal.get(String(input.externalId))) || null;
    if (input.id && !existing) throw new PublishingError("item_not_found", 404);
    // 원본 md5(sourceMd5)는 서버가 패키지에서 복사할 때 남기는 값이다. 화면이 글을 고쳐 보낼 때 빠뜨려도
    // 같은 저장본(objectName)이면 이어 붙인다 — 빠지면 '이미지 바뀜'으로 승인이 풀리고 다음 가져오기가 다시 복사한다.
    const keptMd5 = new Map((json(existing?.images, []) as any[]).filter((img) => img?.objectName && img?.sourceMd5).map((img) => [String(img.objectName), String(img.sourceMd5)]));
    const images = sanitizeImages(env, userId, input.images)
      .map((img: any) => (img.objectName && !img.sourceMd5 && keptMd5.has(img.objectName) ? { ...img, sourceMd5: keptMd5.get(img.objectName) } : img));
    const itemId = existing ? String(existing.id) : randomId("itm");
    savedIds.push(itemId);
    const old = existing ? deliveries.filter((d: any) => String(d.item_id) === itemId) : [];
    const wanted = (input.deliveries || []).filter((d) => d && channelIds.has(String(d.channelId)));
    const plan: Array<{ query: string; params: any[] }> = [];
    let scheduleChanged = false;
    const keep = new Set<string>();
    for (const w of wanted) {
      const at = Number.isFinite(Date.parse(w.scheduledAt)) ? new Date(Date.parse(w.scheduledAt)).toISOString() : null;
      // 같은 글·같은 채널에 이미 올라간(또는 결과가 난) 게시가 있으면 다시 만들지 않는다(가져오기를 두 번 해도 두 번 올라가지 않게).
      const settled = old.find((d: any) => String(d.channel_id) === String(w.channelId) && !EDITABLE_DELIVERY.has(String(d.status)) && String(d.status) !== "cancelled");
      if (settled && !w.id) continue;
      const match = old.find((d: any) => (w.id ? String(d.id) === String(w.id) : String(d.channel_id) === String(w.channelId)) && EDITABLE_DELIVERY.has(String(d.status)) && !keep.has(String(d.id)));
      if (match) {
        keep.add(String(match.id));
        const sameTime = iso(match.scheduled_at) === (at || "");
        if (String(match.channel_id) !== String(w.channelId) || !sameTime) {
          scheduleChanged = true;
          plan.push({ query: `UPDATE publishing_deliveries SET channel_id=$2, scheduled_at=$3::timestamptz, status='draft', guard_reason='', updated_at=now() WHERE id=$1 AND user_id=$4`, params: [match.id, w.channelId, at, userId] });
        }
      } else if (!w.id) {
        scheduleChanged = true;
        plan.push({ query: `INSERT INTO publishing_deliveries (id,user_id,item_id,channel_id,status,scheduled_at) VALUES ($1,$2,$3,$4,'draft',$5::timestamptz)`, params: [randomId("dlv"), userId, itemId, w.channelId, at] });
      }
    }
    for (const d of old) {
      if (EDITABLE_DELIVERY.has(String(d.status)) && !keep.has(String(d.id))) {
        scheduleChanged = true;
        plan.push({ query: `DELETE FROM publishing_deliveries WHERE id=$1 AND user_id=$2`, params: [d.id, userId] });
      }
    }
    const oldExtras = sanitizeExtras(json(existing?.extras, {}));
    const extras = input.extras === undefined ? { ...oldExtras } : sanitizeExtras(input.extras);
    const contentChanged = !existing || String(existing.content_hash) !== hash
      || stable(json(existing.tags, [])) !== stable(tags)
      || stable(json(existing.images, [])) !== stable(images)
      || stable(publishedExtras(oldExtras)) !== stable(publishedExtras(extras));
    const unapprove = !!existing?.approved_at && (contentChanged || scheduleChanged);
    // "내용이 바뀌어 다시 승인 필요" 표시: 이번에 승인이 풀리면 지금 시각, 이미 풀려 기다리는 중이면 그대로 둔다.
    delete extras.changedAfterApproval;
    if (unapprove) extras.changedAfterApproval = new Date().toISOString();
    else if (existing && !existing.approved_at && oldExtras.changedAfterApproval) extras.changedAfterApproval = oldExtras.changedAfterApproval;
    const campaignId = input.campaignId === undefined ? String(existing?.campaign_id || "") : String(input.campaignId || "").slice(0, 80);
    // 승인이 풀리면 SNS 대기열에 들어간 건도 같이 취소한다(게시 상태가 초안으로 바뀌기 전에).
    if (unapprove) writes.push(snsCancelQuery(userId, "item_id = $2", [itemId]));
    if (existing) {
      writes.push({
        query: `UPDATE publishing_items SET brand_id=$3, external_id=$4, title=$5, body=$6, tags=$7::jsonb, images=$8::jsonb, content_hash=$9,
          approved_at = CASE WHEN $10::boolean THEN NULL ELSE approved_at END, extras=$11::jsonb, campaign_id=$12, deleted_at=NULL, updated_at=now() WHERE id=$1 AND user_id=$2`,
        params: [itemId, userId, String(input.brandId || ""), String(input.externalId || existing.external_id || ""), title, body, JSON.stringify(tags), JSON.stringify(images), hash, unapprove, JSON.stringify(extras), campaignId],
      });
    } else {
      writes.push({
        query: `INSERT INTO publishing_items (id,user_id,brand_id,external_id,title,body,tags,images,content_hash,extras,campaign_id) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11)`,
        params: [itemId, userId, String(input.brandId || ""), String(input.externalId || ""), title, body, JSON.stringify(tags), JSON.stringify(images), hash, JSON.stringify(extras), campaignId],
      });
    }
    writes.push(...plan);
    if (unapprove) {
      writes.push({ query: `UPDATE publishing_deliveries SET status='draft', updated_at=now() WHERE item_id=$1 AND user_id=$2 AND status IN ('scheduled','ready_manual')`, params: [itemId, userId] });
    }
  }
  await db.batch(writes);
  return savedIds;
}

export async function saveItem(db: PublishingDb, env: any, userId: string, input: any) {
  const [id] = await applyItemSaves(db, env, userId, [{
    id: String(input?.id || "") || undefined,
    brandId: String(input?.brandId || ""),
    title: String(input?.title || ""), body: String(input?.body || ""),
    tags: Array.isArray(input?.tags) ? input.tags : String(input?.tags || "").split(/[\s,]+/),
    images: Array.isArray(input?.images) ? input.images : [],
    deliveries: (Array.isArray(input?.deliveries) ? input.deliveries : []).map((d: any) => ({ id: String(d?.id || "") || undefined, channelId: String(d?.channelId || ""), scheduledAt: String(d?.scheduledAt || "") })),
  }]);
  return { id };
}

/** 글 삭제. PC 가 지금 올리는 중(claimed)이면 막는다. 안 나간 게시는 취소, 올라간 기록은 남긴다. */
export async function deleteItem(db: PublishingDb, userId: string, id: string) {
  const busy = await db.sql(`SELECT 1 FROM publishing_deliveries WHERE item_id=$1 AND user_id=$2 AND status='claimed' LIMIT 1`, [id, userId]);
  if (busy[0]) throw new PublishingError("item_busy", 409);
  const [, rows] = await db.batch([
    snsCancelQuery(userId, "item_id = $2", [id]),
    { query: `UPDATE publishing_items SET deleted_at=now(), updated_at=now() WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING id`, params: [id, userId] },
    { query: `UPDATE publishing_deliveries SET status='cancelled', updated_at=now() WHERE item_id=$1 AND user_id=$2 AND status NOT IN ('posted','done_manual','cancelled')`, params: [id, userId] },
  ]);
  if (!rows[0]) throw new PublishingError("item_not_found", 404);
  return { id };
}

// ── 승인 (한 건·주간 일괄) ──────────────────────────────────────────────────

const toMs = (v: any) => { const s = iso(v); return s ? Date.parse(s) : NaN; };

/** SNS 게시에 붙일 사진(퍼블리싱 저장본)·영상(업무 파일 경로 → 객체 이름). */
function snsMediaOf(env: any, userId: string, item: any) {
  const images = (json(item?.images, []) as any[]).filter((img) => img?.objectName).map((img) => ({ mediaType: "image", gcsPath: String(img.objectName) }));
  const videos = sanitizeExtras(json(item?.extras, {})).videos || [];
  if (!videos.length) return images;
  // 영상은 복사하지 않고 업무 파일을 가리킨다(화면 경로 @work/날짜/… → 저장 위치). SNS 게시가 본인 루트 안 경로만 받는다.
  const root = workspacePrefix(resolveGcsEnv(env).basePrefix, userId);
  const paths = videos.map((v: any) => normalizePackagePath(v.path)).filter((w: any) => w.ok && w.path);
  return [...images, ...paths.map((w: any) => ({ mediaType: "video", gcsPath: `${root}${w.path}` }))];
}

/** SNS 채널 승인 전 내용 검사(사진 필수 채널·글자 수·장수). 반환: 막는 이유 | "". */
function snsDeliveryCheck(type: string, item: any) {
  const images = (json(item?.images, []) as any[]).filter((img) => img?.objectName).length;
  const videos = (sanitizeExtras(json(item?.extras, {})).videos || []).length;
  return snsContentBlock(type, { caption: snsCaption({ body: String(item?.body || ""), tags: json(item?.tags, []) }), mediaCount: images + videos });
}

/**
 * SNS 채널 게시를 예약한다: 게시를 scheduled 로 바꾸면서(바뀐 경우에만) 같은 문장에서 SNS 대기열에 한 건 넣는다.
 * 게시 상태가 그사이 바뀌었으면 대기열에도 아무것도 들어가지 않는다(올라가는데 기록이 없는 일이 없게).
 * 예약 시각이 이미 지났으면 다음 정기 실행(5분 주기)에 올라간다 — PC·직접 올리기 채널의 '밀린 글'과 같은 규칙.
 */
function snsScheduleQuery(env: any, userId: string, o: { deliveryId: string; fromStatuses: string[]; type: string; item: any; atMs: number; contentHash: string; resetAttempts?: boolean }) {
  const body = buildSnsPublishBody({
    type: o.type,
    caption: snsCaption({ body: String(o.item?.body || ""), tags: json(o.item?.tags, []) }),
    firstComment: sanitizeExtras(json(o.item?.extras, {})).firstComment || "",
    media: snsMediaOf(env, userId, o.item),
  });
  const jobId = crypto.randomUUID();
  const runAt = new Date(Math.max(Number.isFinite(o.atMs) ? o.atMs : Date.now(), Date.now())).toISOString();
  return {
    query: `WITH up AS (
        UPDATE publishing_deliveries SET status='scheduled', sns_job_id=$4, guard_reason='', content_hash=$5, scheduled_at=$6::timestamptz,
          ${o.resetAttempts ? "attempt_base=attempt, error_code='', error_message='', stage='', stage_message='', lease_until=NULL," : ""} updated_at=now()
        WHERE id=$1 AND user_id=$2 AND status = ANY($3::text[]) RETURNING id)
      INSERT INTO sns_scheduled_posts (id,user_id,platform,project_id,run_at,body)
        SELECT $4::text, $2::text, $7::text, '', $8::timestamptz, $9::jsonb FROM up`,
    params: [o.deliveryId, userId, o.fromStatuses, jobId, o.contentHash, new Date(Number.isFinite(o.atMs) ? o.atMs : Date.now()).toISOString(), o.type, runAt, JSON.stringify(body)],
  };
}

/**
 * 글을 승인한다. 초안 게시마다 스팸 방지(하루 횟수·간격·30일 중복)를 검사해 통과한 것만 예약하고,
 * 걸린 것은 초안에 이유(guard_reason)를 남긴다. 게시가 모두 걸린 글은 승인하지 않는다.
 * target: { itemIds } | { weekStart:'YYYY-MM-DD' } (그 주에 예약 시각이 있는 초안 글 전부).
 */
export async function approveItems(db: PublishingDb, userId: string, target: { itemIds?: string[]; weekStart?: string }, env?: any) {
  let itemFilter = "";
  let params: any[] = [userId];
  if (target.weekStart) {
    const range = weekRange(target.weekStart);
    if (!range) throw new PublishingError("week_invalid");
    itemFilter = `i.approved_at IS NULL AND EXISTS (SELECT 1 FROM publishing_deliveries x WHERE x.item_id = i.id AND x.status = 'draft' AND x.scheduled_at >= $2 AND x.scheduled_at < $3)`;
    params = [userId, range.startIso, range.endIso];
  } else {
    const ids = (target.itemIds || []).map(String).filter(Boolean).slice(0, 200);
    if (!ids.length) throw new PublishingError("items_required");
    itemFilter = `i.id = ANY($2::text[])`;
    params = [userId, ids];
  }
  const [items, drafts, channels, existing] = await db.batch([
    { query: `SELECT i.* FROM publishing_items i WHERE i.user_id=$1 AND i.deleted_at IS NULL AND ${itemFilter}`, params },
    { query: `SELECT d.* FROM publishing_deliveries d JOIN publishing_items i ON i.id=d.item_id WHERE d.user_id=$1 AND d.status='draft' AND i.deleted_at IS NULL AND ${itemFilter}`, params },
    { query: `SELECT * FROM publishing_channels WHERE user_id=$1 AND deleted_at IS NULL`, params: [userId] },
    // 같은 채널의 다른 게시(앞뒤 31일). 30일 중복·간격·하루 횟수를 여기서 센다.
    {
      query: `SELECT d.id, d.channel_id, d.status, d.error_code, d.content_hash, COALESCE(d.posted_at, d.scheduled_at) AS at
        FROM publishing_deliveries d WHERE d.user_id=$1 AND d.status <> 'draft' AND d.status <> 'cancelled'
        AND COALESCE(d.posted_at, d.scheduled_at) > now() - interval '62 days'`,
      params: [userId],
    },
  ]);
  const channelsById: Record<string, any> = {};
  for (const c of channels) {
    channelsById[String(c.id)] = {
      id: String(c.id), dailyLimit: Number(c.daily_limit) || 1, minIntervalHours: Number(c.min_interval_hours ?? 20), enabled: c.enabled !== false,
      type: String(c.type), mode: String(c.mode),
    };
  }
  const itemsById = new Map(items.map((r: any) => [String(r.id), r]));
  const candidates = drafts.map((d: any) => {
    const item: any = itemsById.get(String(d.item_id));
    const ch = channelsById[String(d.channel_id)];
    return {
      deliveryId: String(d.id), itemId: String(d.item_id), channelId: String(d.channel_id), atMs: toMs(d.scheduled_at),
      contentHash: String(item?.content_hash || ""),
      missingImages: (json(item?.images, []) as any[]).some((img) => !img?.objectName),
      contentBlock: ch?.mode === "api" && item ? snsDeliveryCheck(ch.type, item) : "",
    };
  });
  const pool = existing.map((e: any) => ({ id: String(e.id), channelId: String(e.channel_id), atMs: toMs(e.at), contentHash: String(e.content_hash || ""), status: String(e.status), errorCode: String(e.error_code || "") }));
  const plan = planApproval(candidates, pool, channelsById);
  const okByItem = new Map<string, number>();
  const blockedByItem = new Map<string, number>();
  const writes: Array<{ query: string; params: any[] }> = [];
  for (const p of plan) {
    const c = candidates.find((x) => x.deliveryId === p.deliveryId)!;
    if (p.ok) {
      okByItem.set(c.itemId, (okByItem.get(c.itemId) || 0) + 1);
      const ch = channelsById[c.channelId];
      if (ch?.mode === "api") {
        writes.push(snsScheduleQuery(env, userId, { deliveryId: c.deliveryId, fromStatuses: ["draft"], type: ch.type, item: itemsById.get(c.itemId), atMs: c.atMs, contentHash: c.contentHash }));
      } else {
        writes.push({ query: `UPDATE publishing_deliveries SET status='scheduled', guard_reason='', content_hash=$3, updated_at=now() WHERE id=$1 AND user_id=$2 AND status='draft'`, params: [c.deliveryId, userId, c.contentHash] });
      }
    } else {
      blockedByItem.set(c.itemId, (blockedByItem.get(c.itemId) || 0) + 1);
      writes.push({ query: `UPDATE publishing_deliveries SET guard_reason=$3, updated_at=now() WHERE id=$1 AND user_id=$2`, params: [c.deliveryId, userId, p.reason] });
    }
  }
  const approvedIds = items.map((r: any) => String(r.id)).filter((id) => (okByItem.get(id) || 0) > 0 || !blockedByItem.get(id));
  if (approvedIds.length) writes.push({ query: `UPDATE publishing_items SET approved_at=now(), extras = extras - 'changedAfterApproval', updated_at=now() WHERE user_id=$1 AND id = ANY($2::text[])`, params: [userId, approvedIds] });
  if (writes.length) await db.batch(writes);
  return {
    approvedItems: approvedIds.length,
    scheduled: plan.filter((p) => p.ok).length,
    blocked: plan.filter((p) => !p.ok).map((p) => ({ deliveryId: p.deliveryId, itemId: candidates.find((x) => x.deliveryId === p.deliveryId)?.itemId || "", reason: p.reason || "" })),
  };
}

export async function unapproveItems(db: PublishingDb, userId: string, itemIds: string[]) {
  const ids = itemIds.map(String).filter(Boolean).slice(0, 200);
  await db.batch([
    snsCancelQuery(userId, "item_id = ANY($2::text[])", [ids]),
    { query: `UPDATE publishing_items SET approved_at=NULL, updated_at=now() WHERE user_id=$1 AND id = ANY($2::text[])`, params: [userId, ids] },
    { query: `UPDATE publishing_deliveries SET status='draft', guard_reason='', updated_at=now() WHERE user_id=$1 AND item_id = ANY($2::text[]) AND status IN ('scheduled','ready_manual')`, params: [userId, ids] },
  ]);
  return { ok: true };
}

// ── 게시 한 건 처리(사람) ───────────────────────────────────────────────────

export async function cancelDelivery(db: PublishingDb, userId: string, id: string) {
  // SNS 대기열에서 이미 올리는 중(publishing)인 건은 취소할 수 없다 — 올라갈지 모르는데 취소로 보이면 안 된다.
  const [, rows] = await db.batch([
    snsCancelQuery(userId, "id = $2", [id]),
    { query: `UPDATE publishing_deliveries SET status='cancelled', updated_at=now() WHERE id=$1 AND user_id=$2 AND status NOT IN ('posted','done_manual','cancelled','publishing') RETURNING *`, params: [id, userId] },
  ]);
  if (!rows[0]) throw new PublishingError("delivery_not_cancellable", 409);
  return publicDelivery(rows[0]);
}

/** 사람이 직접 올렸다고 기록한다(수동 복사 화면). 올린 글 주소는 있으면 함께. */
export async function markDoneManual(db: PublishingDb, userId: string, id: string, postedUrl: string) {
  const url = String(postedUrl || "").trim();
  if (url && !/^https?:\/\/\S+$/i.test(url)) throw new PublishingError("posted_url_invalid");
  const rows = await db.sql(`UPDATE publishing_deliveries SET status='done_manual', posted_url=$3, posted_at=now(), lease_until=NULL, updated_at=now()
    WHERE id=$1 AND user_id=$2 AND status IN ('draft','scheduled','ready_manual','needs_human','failed') RETURNING *`, [id, userId, url.slice(0, 1000)]);
  if (!rows[0]) throw new PublishingError("delivery_not_manual", 409);
  return publicDelivery(rows[0]);
}

/**
 * 확인 필요(needs_human)·실패(failed) 건을 사람이 다시 예약한다(예: 로그인을 다시 한 뒤). 재시도 횟수는 0부터 다시 센다.
 * 시험 완료(tested) 건의 "실제로 올리기"도 같은 길이다(같은 게시를 다시 scheduled 로, 스팸 방지 검사 포함).
 * '올라갔는지 모름(UNCERTAIN)'은 사이트에서 확인했다는 뜻으로 confirmUncertain 을 받아야만 다시 예약한다.
 */
const RESCHEDULABLE = ["needs_human", "failed", "tested"];

export async function rescheduleDelivery(db: PublishingDb, userId: string, id: string, scheduledAt: string, confirmUncertain: boolean, env?: any) {
  const [rows, channels] = await db.batch([
    {
      query: `SELECT d.*, i.content_hash AS item_hash, i.body AS item_body, i.tags AS item_tags, i.images AS item_images, i.extras AS item_extras
        FROM publishing_deliveries d JOIN publishing_items i ON i.id=d.item_id WHERE d.id=$1 AND d.user_id=$2`,
      params: [id, userId],
    },
    { query: `SELECT * FROM publishing_channels WHERE user_id=$1 AND deleted_at IS NULL`, params: [userId] },
  ]);
  const d: any = rows[0];
  if (!d) throw new PublishingError("delivery_not_found", 404);
  if (!RESCHEDULABLE.includes(String(d.status))) throw new PublishingError("delivery_not_reschedulable", 409);
  if (String(d.error_code) === "UNCERTAIN" && !confirmUncertain) throw new PublishingError("uncertain_confirm_required", 409);
  const ch: any = channels.find((c: any) => String(c.id) === String(d.channel_id));
  if (!ch || ch.enabled === false) throw new PublishingError("channel_disabled", 409);
  const atMs = Number.isFinite(Date.parse(scheduledAt)) ? Date.parse(scheduledAt) : Date.now();
  const others = await db.sql(`SELECT id, channel_id, status, error_code, content_hash, COALESCE(posted_at, scheduled_at) AS at FROM publishing_deliveries
    WHERE user_id=$1 AND channel_id=$2 AND id <> $3 AND status NOT IN ('draft','cancelled') AND COALESCE(posted_at, scheduled_at) > now() - interval '62 days'`, [userId, d.channel_id, id]);
  const guard = checkSpamGuard(
    { deliveryId: id, channel: { id: String(ch.id), dailyLimit: Number(ch.daily_limit) || 1, minIntervalHours: Number(ch.min_interval_hours ?? 20) }, atMs, contentHash: String(d.item_hash || "") },
    others.map((e: any) => ({ id: String(e.id), channelId: String(e.channel_id), atMs: toMs(e.at), contentHash: String(e.content_hash || ""), status: String(e.status), errorCode: String(e.error_code || "") })),
  );
  if (!guard.ok) throw new PublishingError(`guard_${(guard as any).reason}`, 409);
  if (ch.mode === "api") {
    // SNS 채널: 실패한 건을 다시 SNS 대기열에 넣는다(새 대기열 건). 내용 검사도 승인 때와 같다.
    const item = { body: d.item_body, tags: d.item_tags, images: d.item_images, extras: d.item_extras };
    const block = snsDeliveryCheck(String(ch.type), item);
    if (block) throw new PublishingError(`guard_${block}`, 409);
    const [, after] = await db.batch([
      snsScheduleQuery(env, userId, { deliveryId: id, fromStatuses: RESCHEDULABLE, type: String(ch.type), item, atMs, contentHash: String(d.item_hash || ""), resetAttempts: true }),
      { query: `SELECT * FROM publishing_deliveries WHERE id=$1 AND user_id=$2 AND status='scheduled'`, params: [id, userId] },
    ]);
    if (!after[0]) throw new PublishingError("delivery_not_reschedulable", 409);
    return publicDelivery(after[0]);
  }
  const next = ch.mode === "manual" && atMs <= Date.now() ? "ready_manual" : "scheduled";
  const updated = await db.sql(`UPDATE publishing_deliveries SET status=$3, scheduled_at=$4, attempt_base=attempt, error_code='', error_message='', stage='', stage_message='',
    lease_until=NULL, guard_reason='', content_hash=$5, updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('needs_human','failed','tested') RETURNING *`,
    [id, userId, next, new Date(atMs).toISOString(), String(d.item_hash || "")]);
  if (!updated[0]) throw new PublishingError("delivery_not_reschedulable", 409);
  return publicDelivery(updated[0]);
}

// ── 가져오기 (CONTRACT §7) ──────────────────────────────────────────────────

export const IMPORT_MAX_ITEMS = 100;

/**
 * externalId 가 같으면 고친다. deliveries[].channelType 은 이 사용자의 같은 종류 채널로 잇는다
 * (같은 브랜드 채널 → 브랜드 없는 채널 → 그 종류 첫 채널). 채널이 없으면 그 일정은 빼고 알려 준다 —
 * 채널을 만든 뒤 같은 파일을 다시 가져오면 externalId 로 이어 붙는다.
 */
export async function importItems(db: PublishingDb, env: any, userId: string, payload: any) {
  const raw = Array.isArray(payload?.items) ? payload.items : [];
  if (!raw.length) throw new PublishingError("import_empty");
  if (raw.length > IMPORT_MAX_ITEMS) throw new PublishingError("import_too_many");
  const channels = (await db.sql(`SELECT * FROM publishing_channels WHERE user_id=$1 AND deleted_at IS NULL AND enabled ORDER BY created_at`, [userId])).map(publicChannel);
  const errors: Array<{ index: number; externalId: string; error: string }> = [];
  const missingChannels = new Set<string>();
  const inputs: ItemInput[] = [];
  raw.forEach((r: any, index: number) => {
    const n = normalizeImportItem(r);
    if (!n.ok) { errors.push({ index, externalId: String(r?.externalId || ""), error: n.error }); return; }
    const deliveries: ItemInput["deliveries"] = [];
    for (const d of n.item.deliveries) {
      const pick = pickImportChannel(channels, { channelId: d.channelId, channelType: d.channelType, brandId: n.item.brandId });
      if (!pick) { missingChannels.add(d.channelType || d.channelId); continue; }
      deliveries.push({ channelId: pick.id, scheduledAt: d.scheduledAt });
    }
    inputs.push({ externalId: n.item.externalId, brandId: n.item.brandId, title: n.item.title, body: n.item.body, tags: n.item.tags, images: n.item.images, deliveries });
  });
  // 다시 가져올 때 이미 올려 둔 이미지는 지우지 않는다(같은 자리·같은 파일 이름이면 저장본 유지).
  if (inputs.length) {
    const existing = await db.sql(`SELECT external_id, images FROM publishing_items WHERE user_id=$1 AND external_id = ANY($2::text[])`, [userId, inputs.map((i) => i.externalId)]);
    const oldImages = new Map(existing.map((r: any) => [String(r.external_id), json(r.images, []) as any[]]));
    for (const input of inputs) {
      const old = oldImages.get(String(input.externalId)) || [];
      input.images = input.images.map((img: any, i: number) => {
        const prev = old[i];
        const same = prev?.objectName && ((img.fileName && prev.fileName === img.fileName) || (img.sourceUrl && prev.sourceUrl === img.sourceUrl));
        return same ? { ...prev, alt: img.alt || prev.alt, caption: img.caption || prev.caption } : img;
      });
    }
  }
  const ids = await applyItemSaves(db, env, userId, inputs);
  return {
    imported: ids.length,
    items: ids.map((id, i) => ({ id, externalId: inputs[i].externalId, images: inputs[i].images.map((img: any, k: number) => ({ index: k, missing: !img.objectName, sourceUrl: img.sourceUrl || "", fileName: img.fileName || "" })) })),
    errors,
    missingChannelTypes: [...missingChannels],
  };
}

// ── 이미지 저장 ─────────────────────────────────────────────────────────────

export const IMAGE_MAX_BYTES = 15 * 1024 * 1024;

export async function uploadGcsBytes(env: any, objectName: string, bytes: Uint8Array, contentType: string) {
  const ctx = resolveGcsEnv(env);
  const token = await getGoogleAccessToken({ clientEmail: ctx.clientEmail, privateKeyPem: ctx.privateKeyRaw, scope: "https://www.googleapis.com/auth/cloud-platform" });
  const once = async (useUserProject: boolean) => fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}${useUserProject && ctx.userProject ? `&userProject=${encodeURIComponent(ctx.userProject)}` : ""}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType, ...(useUserProject && ctx.userProject ? { "X-Goog-User-Project": ctx.userProject } : {}) }, body: bytes as unknown as BodyInit },
  );
  let res = await once(true);
  if (!res.ok && ctx.userProject && (res.status === 400 || res.status === 403)) res = await once(false);
  if (!res.ok) throw new PublishingError("image_store_failed", 500, (await res.text()).slice(0, 300));
}

/** 이미지 바이트를 저장하고 PC 앱이 확인할 지문(sha256)·크기를 돌려준다. */
export async function storePublishingImage(env: any, userId: string, bytes: Uint8Array, fileName: string) {
  if (bytes.byteLength > IMAGE_MAX_BYTES) throw new PublishingError("image_too_large", 413);
  const info = imageInfo(bytes);
  if (!info) throw new PublishingError("image_type_invalid", 415);
  const objectName = publishingImageObjectName(env, userId, fileName, info.contentType);
  await uploadGcsBytes(env, objectName, bytes, info.contentType);
  return { objectName, sha256: await bytesSha256(bytes), width: info.width, height: info.height, contentType: info.contentType, fileName: String(fileName || "").slice(0, 200) };
}

/** 퍼블리싱 이미지 공간 안의 새 객체 이름(sanitizeImages 가 받아 주는 곳). */
export function publishingImageObjectName(env: any, userId: string, fileName: string, contentType: string) {
  const ext = contentType.split("/")[1].replace("jpeg", "jpg");
  const safe = String(fileName || "image").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60) || "image";
  return `${publishingImagePrefix(env, userId)}${Date.now()}-${randomId("i").slice(2, 10)}-${safe}.${ext}`;
}

export async function bytesSha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 저장한 이미지를 글의 index 번째 자리에 넣는다(가져오기 뒤 빠진 이미지 채우기). 승인된 글이면 다시 초안. */
export async function attachItemImage(db: PublishingDb, env: any, userId: string, itemId: string, index: number, meta: any) {
  const [rows, deliveries] = await db.batch([
    { query: `SELECT * FROM publishing_items WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL`, params: [itemId, userId] },
    { query: `SELECT * FROM publishing_deliveries WHERE item_id=$1 AND user_id=$2`, params: [itemId, userId] },
  ]);
  const item: any = rows[0];
  if (!item) throw new PublishingError("item_not_found", 404);
  const images = (json(item.images, []) as any[]).slice();
  const i = Math.trunc(Number(index));
  if (!(i >= 0 && i <= images.length && i < 20)) throw new PublishingError("image_index_invalid");
  images[i] = { ...(images[i] || {}), ...meta };
  await applyItemSaves(db, env, userId, [{
    id: itemId, externalId: String(item.external_id || ""), brandId: String(item.brand_id || ""), title: String(item.title), body: String(item.body),
    tags: json(item.tags, []), images,
    deliveries: deliveries.filter((d: any) => EDITABLE_DELIVERY.has(String(d.status))).map((d: any) => ({ id: String(d.id), channelId: String(d.channel_id), scheduledAt: iso(d.scheduled_at) })),
  }]);
  return publicImage(images[i], i);
}

// ── 캠페인 ──────────────────────────────────────────────────────────────────
// 에이전트가 "한 달 동안 ○○ 팝업 홍보"를 받으면 지침 문서(업무 파일)를 쓰고, 날짜별 글 초안을 여기로 보낸다.
// 초안은 승인 전이라 아무 데도 나가지 않는다 — 사람이 퍼블리싱 '개요'에서 주 단위로 승인한다(스팸 방지 검사 포함).

/** SNS 세팅에 연결된 계정으로 올리는 채널은 따로 설정할 게 없어, 캠페인이 처음 쓸 때 이 이름으로 만든다. */
const SNS_CHANNEL_NAMES: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", threads: "Threads", x: "X", discord: "Discord" };
/** 업무 파일 사진 옮기기 한 번에 쓰는 저장소 요청 수(사진 한 장 = 읽기 1 + 복사 1). 나머지는 다음 요청이 이어서 옮긴다. */
export const CAMPAIGN_IMAGE_BUDGET = 24;

/**
 * 캠페인 머리와 글 초안을 저장한다(에이전트 도구 publishing_campaign).
 * input: { campaign:{ key, title, brandId, brandTitle, goal, startDate, endDate }, guidePath?, posts:[…], removeKeys?:[글 key] }
 * - 같은 key 의 캠페인·글은 고친다(여러 번 나눠 보내도 한 캠페인). 승인된 글은 건드리지 않고 알려 준다.
 * - 채널은 종류·id·target 으로 고른다(가져오기와 같은 규칙). 없는 SNS 채널(api)은 만들고, 다른 종류는 '채널 없음'으로 알려 준다.
 * - 사진은 업무 파일 경로만 적어 두고(빠진 사진), 퍼블리싱 화면이 열릴 때 fillCampaignImages 가 옮긴다 — 대화 한 턴의 요청 한도를 지키려고.
 */
export async function applyCampaignPlan(db: PublishingDb, env: any, userId: string, input: any) {
  const head = normalizeCampaignInput(input?.campaign || input);
  if (!head.ok) throw new PublishingError(head.error);
  const c = head.campaign;
  const campaignId = await campaignIdFor(userId, c.key);
  const rawPosts = Array.isArray(input?.posts) ? input.posts : [];
  if (rawPosts.length > CAMPAIGN_POSTS_PER_CALL) throw new PublishingError("campaign_too_many_posts", 400, `한 번에 ${CAMPAIGN_POSTS_PER_CALL}개까지 보낼 수 있어요. 나눠서 보내 주세요.`);
  const errors: Array<{ index: number; key: string; error: string }> = [];
  const posts: any[] = [];
  const seen = new Set<string>();
  rawPosts.forEach((r: any, index: number) => {
    const n = normalizeCampaignPost(r, index);
    if (!n.ok) { errors.push({ index, key: String(r?.key || ""), error: n.error }); return; }
    if (seen.has(n.post.key)) { errors.push({ index, key: n.post.key, error: "post_key_duplicate" }); return; }
    seen.add(n.post.key);
    posts.push(n.post);
  });
  const removeIds = (Array.isArray(input?.removeKeys) ? input.removeKeys : []).slice(0, 100)
    .map((k: any) => campaignExternalId(campaignId, String(k || ""))).filter((id: string) => !id.endsWith(":"));
  const [channelRows, existingRows] = await db.batch([
    { query: `SELECT * FROM publishing_channels WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at`, params: [userId] },
    { query: `SELECT id, external_id, approved_at, images, extras, deleted_at FROM publishing_items WHERE user_id=$1 AND external_id = ANY($2::text[])`, params: [userId, posts.map((p) => campaignExternalId(campaignId, p.key))] },
  ]);
  const all = channelRows.map(publicChannel);
  const usable = all.filter((ch) => ch.enabled);
  const createdChannels: any[] = [];
  const missing = new Set<string>();
  const pick = (p: any) => {
    const isId = /^ch_/.test(p.channel);
    const found = pickImportChannel(usable, { channelId: isId ? p.channel : "", channelType: isId ? "" : p.channel, brandId: c.brandId, target: p.target });
    if (found) return found;
    // 꺼 둔 같은 종류 채널이 있으면 새로 만들지 않는다(사람이 일부러 끈 것).
    const off = !isId && all.some((ch) => ch.type === p.channel && !ch.enabled);
    if (!isId && !p.target && !off && isChannelModeAvailable(p.channel, "api")) {
      const ch = { id: randomId("ch"), type: p.channel, mode: "api", name: SNS_CHANNEL_NAMES[p.channel] || p.channel, brandId: "", accountLabel: "", target: {}, enabled: true };
      usable.push(ch as any);
      createdChannels.push(ch);
      return ch;
    }
    missing.add(`${p.channel}${p.target ? ` · ${p.target}` : ""}${off ? " (꺼짐)" : ""}`);
    if (!isId && !CHANNEL_TYPES[p.channel as keyof typeof CHANNEL_TYPES]) errors.push({ index: -1, key: p.key, error: "channel_type_invalid" });
    return null;
  };
  const byExternal = new Map(existingRows.map((r: any) => [String(r.external_id), r]));
  const inputs: ItemInput[] = [];
  const keys: string[] = [];
  const skippedApproved: string[] = [];
  let pendingImages = 0;
  for (const p of posts) {
    const externalId = campaignExternalId(campaignId, p.key);
    const prev: any = byExternal.get(externalId);
    if (prev && !prev.deleted_at && prev.approved_at) { skippedApproved.push(p.key); continue; }
    const ch = pick(p);
    const prevImages = json(prev?.images, []) as any[];
    const images = p.images.map((path: string) => {
      const reuse = prevImages.find((img) => img?.objectName && img.sourcePath === path);
      if (reuse) return reuse;
      pendingImages += 1;
      return { sourcePath: path, fileName: path.split("/").pop() || "" };
    });
    const prevExtras = sanitizeExtras(json(prev?.extras, {}));
    inputs.push({
      externalId, brandId: c.brandId, campaignId, title: p.title, body: p.body, tags: p.tags, images,
      deliveries: ch ? [{ channelId: ch.id, scheduledAt: p.scheduledAt }] : [],
      extras: {
        ...prevExtras,
        videos: p.videos.map((path: string) => ({ path, name: path.split("/").pop() || "", size: 0, contentType: videoContentType(path) })),
        notes: p.notes, firstComment: p.firstComment,
      },
    });
    keys.push(p.key);
  }
  const head1: Array<{ query: string; params: any[] }> = createdChannels.map((ch) => ({
    query: `INSERT INTO publishing_channels (id,user_id,type,mode,name,brand_id,account_label,target,daily_limit,min_interval_hours,enabled)
      VALUES ($1,$2,$3,'api',$4,'','','{}'::jsonb,$5,$6,TRUE)`,
    params: [ch.id, userId, ch.type, ch.name, DEFAULT_DAILY_LIMIT, DEFAULT_MIN_INTERVAL_HOURS],
  }));
  const guidePath = String(input?.guidePath || "").slice(0, 600);
  head1.push({
    query: `INSERT INTO publishing_campaigns (id,user_id,key,title,brand_id,brand_title,goal,start_date,end_date,guide_path)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,
        brand_id = CASE WHEN EXCLUDED.brand_id <> '' THEN EXCLUDED.brand_id ELSE publishing_campaigns.brand_id END,
        brand_title = CASE WHEN EXCLUDED.brand_title <> '' THEN EXCLUDED.brand_title ELSE publishing_campaigns.brand_title END,
        goal = CASE WHEN EXCLUDED.goal <> '' THEN EXCLUDED.goal ELSE publishing_campaigns.goal END,
        start_date = CASE WHEN EXCLUDED.start_date <> '' THEN EXCLUDED.start_date ELSE publishing_campaigns.start_date END,
        end_date = CASE WHEN EXCLUDED.end_date <> '' THEN EXCLUDED.end_date ELSE publishing_campaigns.end_date END,
        guide_path = CASE WHEN EXCLUDED.guide_path <> '' THEN EXCLUDED.guide_path ELSE publishing_campaigns.guide_path END,
        deleted_at = NULL, updated_at = now()
      RETURNING *`,
    params: [campaignId, userId, c.key, c.title, c.brandId, c.brandTitle, c.goal, c.startDate, c.endDate, guidePath],
  });
  const headRows = await db.batch(head1);
  const campaignRow = headRows[headRows.length - 1][0];
  const createdKeys = new Set(inputs.filter((i) => { const prev: any = byExternal.get(String(i.externalId)); return !prev || prev.deleted_at; }).map((i) => String(i.externalId)));
  const ids = inputs.length ? await applyItemSaves(db, env, userId, inputs) : [];
  let removed = 0;
  if (removeIds.length) {
    // 뺄 글: 승인 전 글만 지운다(승인된 글은 사람이 화면에서 승인을 풀거나 지운다).
    const [, gone] = await db.batch([
      {
        query: `UPDATE publishing_deliveries SET status='cancelled', updated_at=now() WHERE user_id=$1 AND status NOT IN ('posted','done_manual','cancelled','claimed','publishing')
          AND item_id IN (SELECT id FROM publishing_items WHERE user_id=$1 AND external_id = ANY($2::text[]) AND approved_at IS NULL AND deleted_at IS NULL)`,
        params: [userId, removeIds],
      },
      { query: `UPDATE publishing_items SET deleted_at=now(), updated_at=now() WHERE user_id=$1 AND external_id = ANY($2::text[]) AND approved_at IS NULL AND deleted_at IS NULL RETURNING id`, params: [userId, removeIds] },
    ]);
    removed = gone.length;
  }
  return {
    campaign: publicCampaign(campaignRow),
    saved: ids.length,
    created: inputs.filter((i) => createdKeys.has(String(i.externalId))).length,
    items: ids.map((id, i) => ({ id, key: keys[i], scheduledAt: inputs[i].deliveries[0]?.scheduledAt || "", hasChannel: inputs[i].deliveries.length > 0 })),
    skippedApproved, removed, pendingImages,
    createdChannels: createdChannels.map((ch) => ({ id: ch.id, type: ch.type, name: ch.name })),
    missingChannels: [...missing],
    errors,
  };
}

/**
 * 캠페인 글의 '업무 파일 사진'을 퍼블리싱 저장소로 옮긴다(승인 전 글만). 한 번에 CAMPAIGN_IMAGE_BUDGET 만큼, 남으면 more:true.
 * 옮기지 못한 사진은 이유(sourceError)를 남겨 다시 시도하지 않는다 — 화면에서 사람이 사진을 올려 채운다.
 */
export async function fillCampaignImages(db: PublishingDb, env: any, userId: string, input: any = {}) {
  const campaignId = String(input?.campaignId || "");
  const pendingCond = `EXISTS (SELECT 1 FROM jsonb_array_elements(i.images) e
    WHERE COALESCE(e->>'objectName','') = '' AND COALESCE(e->>'sourcePath','') <> '' AND COALESCE(e->>'sourceError','') = '')`;
  const [items, deliveries] = await db.batch([
    {
      query: `SELECT i.* FROM publishing_items i WHERE i.user_id=$1 AND i.deleted_at IS NULL AND i.approved_at IS NULL AND i.campaign_id <> ''
        AND ($2::text = '' OR i.campaign_id = $2::text) AND ${pendingCond} ORDER BY i.updated_at LIMIT 20`,
      params: [userId, campaignId],
    },
    {
      query: `SELECT d.* FROM publishing_deliveries d WHERE d.user_id=$1 AND d.item_id IN (SELECT i.id FROM publishing_items i WHERE i.user_id=$1 AND i.deleted_at IS NULL
        AND i.approved_at IS NULL AND i.campaign_id <> '' AND ($2::text = '' OR i.campaign_id = $2::text) AND ${pendingCond} ORDER BY i.updated_at LIMIT 20)`,
      params: [userId, campaignId],
    },
  ]);
  if (!items.length) return { copied: 0, failed: 0, more: false };
  const ctx = await accessContext(env);
  const root = workspacePrefix(ctx.basePrefix, userId);
  let budget = CAMPAIGN_IMAGE_BUDGET;
  let copied = 0;
  let failed = 0;
  let more = false;
  const saves: ItemInput[] = [];
  for (const item of items) {
    let changed = false;
    const images = (json(item.images, []) as any[]).map((img) => ({ ...img }));
    for (const img of images) {
      if (img.objectName || !img.sourcePath || img.sourceError) continue;
      if (budget < 2) { more = true; break; }
      const where = normalizePackagePath(img.sourcePath);
      if (!where.ok || !where.path) { img.sourceError = "path_invalid"; failed += 1; changed = true; continue; }
      budget -= 2;
      try {
        const res = await getObject(ctx, `${root}${where.path}`, true);
        if (res.status === 404) { img.sourceError = "not_found"; failed += 1; changed = true; continue; }
        if (!res.ok) { more = true; continue; } // 잠깐 실패 — 다음에 다시
        const bytes = new Uint8Array(await res.arrayBuffer());
        const info = imageInfo(bytes);
        if (!info) { img.sourceError = "type_invalid"; failed += 1; changed = true; continue; }
        if (bytes.byteLength > IMAGE_MAX_BYTES) { img.sourceError = "too_large"; failed += 1; changed = true; continue; }
        const objectName = publishingImageObjectName(env, userId, img.fileName || "image", info.contentType);
        await copyObject(ctx, `${root}${where.path}`, objectName);
        Object.assign(img, { objectName, sha256: await bytesSha256(bytes), width: info.width, height: info.height, contentType: info.contentType });
        copied += 1;
        changed = true;
      } catch {
        more = true;
      }
    }
    if (changed) {
      saves.push({
        id: String(item.id), externalId: String(item.external_id || ""), brandId: String(item.brand_id || ""), title: String(item.title), body: String(item.body),
        tags: json(item.tags, []), images,
        deliveries: deliveries.filter((d: any) => String(d.item_id) === String(item.id) && EDITABLE_DELIVERY.has(String(d.status)))
          .map((d: any) => ({ id: String(d.id), channelId: String(d.channel_id), scheduledAt: iso(d.scheduled_at) })),
      });
    }
    if (budget < 2) { more = true; break; }
  }
  if (saves.length) await applyItemSaves(db, env, userId, saves);
  return { copied, failed, more: more || items.length === 20 };
}

/** 캠페인 지우기: 안 나간 글은 지우고 게시는 취소한다(올라간 기록은 남는다). PC 가 지금 올리는 글은 그대로 둔다. */
export async function deleteCampaign(db: PublishingDb, userId: string, id: string) {
  const ofCampaign = `item_id IN (SELECT id FROM publishing_items WHERE user_id=$1 AND campaign_id=$2)`;
  const [, , , rows] = await db.batch([
    snsCancelQuery(userId, ofCampaign, [id]),
    { query: `UPDATE publishing_deliveries SET status='cancelled', updated_at=now() WHERE user_id=$1 AND status NOT IN ('posted','done_manual','cancelled','claimed','publishing') AND ${ofCampaign}`, params: [userId, id] },
    {
      query: `UPDATE publishing_items i SET deleted_at=now(), updated_at=now() WHERE i.user_id=$1 AND i.campaign_id=$2 AND i.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM publishing_deliveries d WHERE d.item_id=i.id AND d.status IN ('claimed','publishing'))`,
      params: [userId, id],
    },
    { query: `UPDATE publishing_campaigns SET deleted_at=now(), updated_at=now() WHERE user_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id`, params: [userId, id] },
  ]);
  if (!rows[0]) throw new PublishingError("campaign_not_found", 404);
  return { id };
}

/**
 * 에이전트가 캠페인을 이어서 고칠 때 보는 목록(글 key·채널·시각·상태·본문 앞부분). 지운 글은 뺀다.
 */
export async function loadCampaignDetail(db: PublishingDb, userId: string, campaignId: string) {
  const [campaigns, items, deliveries] = await db.batch([
    { query: `SELECT * FROM publishing_campaigns WHERE user_id=$1 AND id=$2 AND deleted_at IS NULL`, params: [userId, campaignId] },
    { query: `SELECT * FROM publishing_items WHERE user_id=$1 AND campaign_id=$2 AND deleted_at IS NULL ORDER BY created_at LIMIT 300`, params: [userId, campaignId] },
    {
      query: `SELECT d.*, c.type AS channel_type, c.name AS channel_name FROM publishing_deliveries d LEFT JOIN publishing_channels c ON c.id=d.channel_id
        WHERE d.user_id=$1 AND d.status <> 'cancelled' AND d.item_id IN (SELECT id FROM publishing_items WHERE user_id=$1 AND campaign_id=$2 AND deleted_at IS NULL)`,
      params: [userId, campaignId],
    },
  ]);
  if (!campaigns[0]) throw new PublishingError("campaign_not_found", 404);
  const prefix = `campaign:${campaignId}:`;
  const posts = items.map((r: any) => {
    const ds = deliveries.filter((d: any) => String(d.item_id) === String(r.id));
    const d: any = ds[0];
    const at = d ? iso(d.scheduled_at) || iso(d.posted_at) : "";
    const images = json(r.images, []) as any[];
    return {
      key: String(r.external_id || "").startsWith(prefix) ? String(r.external_id).slice(prefix.length) : "",
      itemId: String(r.id), title: String(r.title || ""), body: String(r.body || "").slice(0, 400),
      channelType: String(d?.channel_type || ""), channelName: String(d?.channel_name || ""),
      ...(at ? kstParts(at) : { date: "", time: "" }),
      status: itemDisplayStatus(!!r.approved_at, ds.map((x: any) => ({ status: String(x.status) }))),
      images: images.length, missingImages: images.filter((img) => !img?.objectName).length,
    };
  }).sort((a: any, b: any) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  return { campaign: publicCampaign(campaigns[0]), posts };
}

// ── PC 연결(사람 쪽) ────────────────────────────────────────────────────────

export async function createPairingCode(db: PublishingDb, userId: string) {
  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS).toISOString();
  await db.batch([
    { query: `DELETE FROM publisher_pairing_codes WHERE user_id=$1 AND (expires_at < now() OR used_at IS NOT NULL)`, params: [userId] },
    { query: `INSERT INTO publisher_pairing_codes (code_hash,user_id,expires_at) VALUES ($1,$2,$3)`, params: [await sha256Hex(code), userId, expiresAt] },
  ]);
  return { code, expiresAt };
}

/** 연결 해제: 그 기기 토큰은 즉시 무효(CONTRACT §4.2). 집어 간 작업은 임대 만료 규칙이 정리한다. */
export async function revokeDevice(db: PublishingDb, userId: string, deviceId: string) {
  const rows = await db.sql(`UPDATE publisher_devices SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id`, [deviceId, userId]);
  if (!rows[0]) throw new PublishingError("device_not_found", 404);
  return { id: deviceId };
}

// ── PC 앱 API (CONTRACT §5) ─────────────────────────────────────────────────

/** 연결 코드로 기기를 만든다. 코드는 한 번만, 10분 안에만 쓸 수 있다(UPDATE 한 문장으로 '사용함' 표시와 확인을 같이 한다). */
export async function pairDevice(db: PublishingDb, input: { pairingCode: string; deviceName: string; appVersion: string; os: string }) {
  const code = normalizePairingCode(input.pairingCode);
  if (!code) throw new PublishingError("pairing_code_invalid", 400, "연결 코드 형식이 맞지 않아요. 8자리를 다시 확인해 주세요.");
  const deviceId = randomId("dev");
  const token = generateDeviceToken();
  const rows = await db.sql(`WITH code AS (
      UPDATE publisher_pairing_codes SET used_at=now(), device_id=$2::text WHERE code_hash=$1::text AND used_at IS NULL AND expires_at > now() RETURNING user_id)
    INSERT INTO publisher_devices (id,user_id,name,os,app_version,token_hash,last_seen_at)
      SELECT $2::text, code.user_id, $3::text, $4::text, $5::text, $6::text, now() FROM code RETURNING id, user_id`,
  [await sha256Hex(code), deviceId, String(input.deviceName || "PC").slice(0, 80), String(input.os || "").slice(0, 120), String(input.appVersion || "").slice(0, 40), await sha256Hex(token)]);
  if (!rows[0]) throw new PublishingError("pairing_code_invalid", 400, "연결 코드가 맞지 않거나 시간이 지났어요. NK_Studio 에서 새 코드를 만들어 주세요.");
  await db.sql(`INSERT INTO publishing_events (id,user_id,device_id,kind,data) VALUES ($1,$2,$3,'pair',$4::jsonb)`,
    [randomId("evt"), rows[0].user_id, deviceId, JSON.stringify({ deviceName: input.deviceName, appVersion: input.appVersion, os: input.os })]);
  return { deviceId, deviceToken: token };
}

/** Bearer 기기 토큰 → 기기. 해시로만 찾고, 찾으면 마지막 접속 시각을 같은 문장에서 남긴다. */
export async function authenticateDevice(db: PublishingDb, token: string) {
  if (!/^npt_[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const rows = await db.sql(`UPDATE publisher_devices SET last_seen_at=now() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING id, user_id, name`, [await sha256Hex(token)]);
  return rows[0] ? { deviceId: String(rows[0].id), userId: String(rows[0].user_id), name: String(rows[0].name || "") } : null;
}

export async function deviceHeartbeat(db: PublishingDb, device: { deviceId: string; userId: string }, input: any) {
  const sessions = (Array.isArray(input?.sessions) ? input.sessions : []).slice(0, 50).map((s: any) => ({
    channelType: String(s?.channelType || "").slice(0, 40), accountLabel: String(s?.accountLabel || "").slice(0, 80),
    loggedIn: s?.loggedIn === true, checkedAt: iso(s?.checkedAt) || new Date().toISOString(),
  }));
  const [, channels] = await db.batch([
    { query: `UPDATE publisher_devices SET app_version=$2, sessions=$3::jsonb, last_heartbeat_at=now() WHERE id=$1`, params: [device.deviceId, String(input?.appVersion || "").slice(0, 40), JSON.stringify(sessions)] },
    { query: `SELECT * FROM publishing_channels WHERE user_id=$1 AND mode='pc' AND enabled AND deleted_at IS NULL ORDER BY created_at`, params: [device.userId] },
  ]);
  return channels.map((r: any) => {
    const c = publicChannel(r);
    return { channelId: c.id, type: c.type, name: c.name, accountLabel: c.accountLabel, target: c.target, dailyLimit: c.dailyLimit, minIntervalHours: c.minIntervalHours };
  });
}

/**
 * 올릴 차례인 PC 게시 하나를 집어 준다(CONTRACT §5.3).
 * 행 잠금(FOR UPDATE OF d SKIP LOCKED)으로 두 기기가 같은 게시를 받지 않는다. 임대 15분, attempt += 1.
 * PC 가 꺼져 있다 켜져 밀린 글이 한꺼번에 나가지 않게, 그 채널의 간격·하루 횟수 안에서만 내준다.
 * 한 번에 한 건(채널 간격 검사를 같은 문장 안에서 두 건에 동시에 적용할 수 없어서).
 */
export async function claimJobs(env: any, db: PublishingDb, device: { deviceId: string; userId: string }) {
  const leaseMin = Math.round(LEASE_MS / 60000);
  const [, rows] = await db.batch([
    leaseExpiryQuery(device.userId),
    {
      query: `WITH picked AS (
          SELECT d.id FROM publishing_deliveries d
          JOIN publishing_channels c ON c.id = d.channel_id AND c.mode = 'pc' AND c.enabled AND c.deleted_at IS NULL
          JOIN publishing_items i ON i.id = d.item_id AND i.deleted_at IS NULL AND i.approved_at IS NOT NULL
          WHERE d.user_id = $1 AND d.status = 'scheduled' AND d.scheduled_at <= now()
            AND NOT EXISTS (SELECT 1 FROM publishing_deliveries p WHERE p.channel_id = d.channel_id AND p.id <> d.id
              AND (p.status IN ('claimed','posted','done_manual') OR (p.status = 'needs_human' AND p.error_code = 'UNCERTAIN'))
              AND COALESCE(p.posted_at, p.claimed_at) > now() - (c.min_interval_hours * interval '1 hour'))
            AND (SELECT count(*) FROM publishing_deliveries p WHERE p.channel_id = d.channel_id AND p.id <> d.id
              AND (p.status IN ('claimed','posted','done_manual') OR (p.status = 'needs_human' AND p.error_code = 'UNCERTAIN'))
              AND (COALESCE(p.posted_at, p.claimed_at) AT TIME ZONE '${PUBLISHING_TIME_ZONE}')::date = (now() AT TIME ZONE '${PUBLISHING_TIME_ZONE}')::date) < c.daily_limit
          ORDER BY d.scheduled_at LIMIT 1
          FOR UPDATE OF d SKIP LOCKED),
        upd AS (
          UPDATE publishing_deliveries d SET status = 'claimed', attempt = d.attempt + 1, lease_until = now() + interval '${leaseMin} minutes',
            device_id = $2, claimed_at = now(), stage = '', stage_message = '', error_code = '', error_message = '', updated_at = now()
          FROM picked WHERE d.id = picked.id RETURNING d.*)
        SELECT upd.*, c.type AS channel_type, c.account_label, c.target, i.title, i.body, i.tags, i.images
        FROM upd JOIN publishing_channels c ON c.id = upd.channel_id JOIN publishing_items i ON i.id = upd.item_id`,
      params: [device.userId, device.deviceId],
    },
  ]);
  if (!rows.length) return [];
  const jobs = await Promise.all(rows.map((r: any) => buildJob(env, r)));
  await db.batch(rows.map((r: any) => ({
    query: `INSERT INTO publishing_events (id,user_id,delivery_id,device_id,attempt,kind,data) VALUES ($1,$2,$3,$4,$5,'claim','{}'::jsonb)`,
    params: [randomId("evt"), device.userId, r.id, device.deviceId, Number(r.attempt)],
  })));
  return jobs;
}

/** 집은 게시 → CONTRACT Job. 이미지는 1시간짜리 서명 주소로 준다(서명은 서버 안 계산이라 서브요청이 없다). */
export async function buildJob(env: any, r: any) {
  const images = (json(r.images, []) as any[]).map(publicImage);
  const present = images.filter((img) => !img.missing);
  const refs = new Set(present.map((img) => img.ref));
  const blocks = markupToBlocks(String(r.body || ""), images).filter((b: any) => b.type !== "image" || refs.has(b.imageRef));
  const signed = await Promise.all(present.map(async (img) => ({
    ref: img.ref, url: (await signGcsObjectUrl(env, img.objectName, { expiresInSec: 3600 })).url,
    sha256: img.sha256, width: img.width, height: img.height, alt: img.alt,
  })));
  return {
    jobId: String(r.id), attempt: Number(r.attempt), leaseUntil: iso(r.lease_until), scheduledAt: iso(r.scheduled_at),
    channel: { channelId: String(r.channel_id), type: String(r.channel_type), accountLabel: String(r.account_label || ""), target: json(r.target, {}) },
    content: {
      title: String(r.title || "").slice(0, TITLE_MAX), blocks, plainText: blocksToPlainText(blocks),
      tags: (json(r.tags, []) as string[]).slice(0, TAGS_MAX), images: signed,
    },
    limits: { titleMax: TITLE_MAX, tagsMax: TAGS_MAX },
  };
}

/** 진행 보고: 단계 기록 + 임대 연장. 지금 시도(attempt)가 아니거나 집힌 상태가 아니면 409. */
export async function reportProgress(db: PublishingDb, device: { deviceId: string; userId: string }, jobId: string, input: any) {
  const leaseMin = Math.round(LEASE_MS / 60000);
  if (!Number.isInteger(Number(input?.attempt))) throw new PublishingError("attempt_required");
  const stage = ["opening", "filling", "uploading_images", "submitting"].includes(input?.stage) ? input.stage : "";
  const rows = await db.sql(`UPDATE publishing_deliveries SET stage = CASE WHEN $4::text = '' THEN stage ELSE $4::text END, stage_message=$5::text,
    lease_until = now() + interval '${leaseMin} minutes', updated_at=now()
    WHERE id=$1 AND user_id=$2 AND attempt=$3 AND status='claimed' RETURNING lease_until`,
  [jobId, device.userId, Math.trunc(Number(input?.attempt)), stage, String(input?.message || "").slice(0, 500)]);
  if (rows[0]) return { leaseUntil: iso(rows[0].lease_until) };
  const cur = await db.sql(`SELECT attempt, status FROM publishing_deliveries WHERE id=$1 AND user_id=$2`, [jobId, device.userId]);
  if (!cur[0]) throw new PublishingError("job_not_found", 404);
  throw new PublishingError("stale_attempt", 409);
}

/**
 * 결과 보고(CONTRACT §5.5). (jobId, attempt) 기준 멱등: 같은 보고는 dedupe_key 로 한 번만 반영한다.
 * attempt 가 지금 값과 다르면 409(옛 시도의 보고는 무시). 재시도 여부는 서버가 정한다(decideResultOutcome).
 */
export async function reportResult(env: any, db: PublishingDb, device: { deviceId: string; userId: string }, jobId: string, input: any) {
  if (!Number.isInteger(Number(input?.attempt))) throw new PublishingError("attempt_required");
  const attempt = Number(input.attempt);
  const status = String(input?.status || "");
  if (!["posted", "failed", "needs_human", "tested"].includes(status)) throw new PublishingError("result_status_invalid");
  const cur = await db.sql(`SELECT id, attempt, attempt_base, status FROM publishing_deliveries WHERE id=$1 AND user_id=$2`, [jobId, device.userId]);
  if (!cur[0]) throw new PublishingError("job_not_found", 404);
  if (Number(cur[0].attempt) !== attempt) throw new PublishingError("stale_attempt", 409);
  const outcome = decideResultOutcome({ status, errorCode: String(input?.errorCode || ""), attemptsUsed: attempt - Number(cur[0].attempt_base || 0) });
  const postedUrl = status === "posted" && /^https?:\/\/\S+$/i.test(String(input?.postedUrl || "")) ? String(input.postedUrl).slice(0, 1000) : "";
  let screenshotObject = "";
  const png = String(input?.screenshotPng || "");
  if (png && status !== "posted" && png.length <= Math.ceil((1024 * 1024 * 4) / 3) + 4) {
    try {
      const bytes = Uint8Array.from(atob(png.replace(/^data:image\/png;base64,/, "")), (ch) => ch.charCodeAt(0));
      if (imageInfo(bytes)?.contentType === "image/png") {
        screenshotObject = `${buildUserRoot(resolveGcsEnv(env).basePrefix, device.userId)}/publishing/shots/${jobId}-${attempt}.png`;
        await uploadGcsBytes(env, screenshotObject, bytes, "image/png");
      }
    } catch { screenshotObject = ""; }
  }
  // 시험 모드(§5.5): 채운 화면 캡처가 결과 그 자체다. 없으면 받지 않는다.
  if (status === "tested" && !screenshotObject) throw new PublishingError("screenshot_required", 400, "시험 모드 결과에는 채운 화면 캡처(screenshotPng, 1MB 이하 PNG)가 꼭 있어야 해요.");
  const message = String(input?.message || "").slice(0, 1000);
  const finishedAt = iso(input?.finishedAt) || new Date().toISOString();
  const rows = await db.sql(`WITH ev AS (
      INSERT INTO publishing_events (id,user_id,delivery_id,device_id,attempt,kind,data,dedupe_key)
      SELECT $3::text, $2::text, $1::text, $4::text, $5::int, 'result', $6::jsonb, $7::text FROM publishing_deliveries WHERE id=$1::text AND user_id=$2::text AND attempt=$5::int
      ON CONFLICT (dedupe_key) DO NOTHING RETURNING delivery_id),
    up AS (
      UPDATE publishing_deliveries d SET status=$8::text, error_code=$9::text, error_message=$10::text,
        posted_url = CASE WHEN $8::text = 'posted' THEN $11::text ELSE posted_url END,
        posted_at = CASE WHEN $8::text = 'posted' THEN $12::timestamptz ELSE posted_at END,
        scheduled_at = COALESCE($13::timestamptz, scheduled_at),
        screenshot_object = CASE WHEN $14::text = '' THEN screenshot_object ELSE $14::text END,
        lease_until = NULL, updated_at = now()
      FROM ev WHERE d.id = ev.delivery_id AND d.attempt = $5::int RETURNING d.id)
    SELECT (SELECT count(*) FROM ev)::int AS inserted, (SELECT count(*) FROM up)::int AS updated`,
  [jobId, device.userId, randomId("evt"), device.deviceId, attempt,
    JSON.stringify({ status, errorCode: input?.errorCode || "", message, postedUrl, finishedAt, outcome: outcome.status }), `result:${jobId}:${attempt}`,
    outcome.status, outcome.errorCode, outcome.status === "posted" ? "" : message, postedUrl, finishedAt, outcome.retryAt || null, screenshotObject]);
  const r = rows[0] || {};
  if (Number(r.inserted) === 0) {
    // 같은 (작업, 시도)의 보고가 이미 반영됐으면 그대로 성공. 그 사이 다시 집혀 시도가 바뀌었으면 409.
    const again = await db.sql(`SELECT attempt FROM publishing_deliveries WHERE id=$1 AND user_id=$2`, [jobId, device.userId]);
    if (Number(again[0]?.attempt) !== attempt) throw new PublishingError("stale_attempt", 409);
    return { ok: true, duplicate: true };
  }
  return { ok: true, status: outcome.status };
}

export { FINAL_STATUSES };
