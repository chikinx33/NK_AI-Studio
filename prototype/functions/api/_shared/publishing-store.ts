// prototype/functions/api/_shared/publishing-store.ts
//
// 퍼블리싱 저장소(Neon Postgres). 모든 행은 user_id 로 사용자마다 갈린다.
//   publishing_channels   게시할 곳(네이버 블로그 등). 방식 pc | manual (api 는 3단계)
//   publishing_items      글(제목·본문 표시·태그·이미지·브랜드)
//   publishing_deliveries 글 하나가 채널 하나로 나가는 단위(CONTRACT §2)
//   publisher_devices     연결된 PC(NK Publisher). 기기 토큰은 sha256 만 저장
//   publisher_pairing_codes 8자리 연결 코드(10분, 한 번)
//   publishing_events     작업 배정·결과 기록. 결과는 (작업, 시도) 하나만 반영(dedupe_key)
//
// Worker 서브요청 50번 한도(Neon 질의 1번 = 1번): 화면 한 번 읽기·일괄 승인·가져오기는 getSqlBatch 로
// 읽기 1번 + 쓰기 1번에 끝낸다. 글 수에 비례해 질의를 늘리지 않는다.
import { getSql, getSqlBatch } from "../knowledge/_shared";
import { ensureSchemaOnce } from "./schema-marks.js";
import { resolveGcsEnv, getGoogleAccessToken, signGcsObjectUrl } from "./gcs.js";
import { buildUserRoot } from "./storage";
import {
  LEASE_MS, MAX_ATTEMPTS, RETRY_DELAY_MS, PAIRING_CODE_TTL_MS, TITLE_MAX, TAGS_MAX, PUBLISHING_TIME_ZONE,
  validateChannelInput, normalizeTitle, normalizeTagList, contentHashOf, planApproval, checkSpamGuard,
  normalizeImportItem, weekRange, randomId, generatePairingCode, normalizePairingCode, generateDeviceToken, sha256Hex,
  markupToBlocks, blocksToPlainText, blocksToHtml, channelWriteUrl, decideResultOutcome, imageInfo, FINAL_STATUSES,
} from "./publishing-core.js";

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
    missing: !img?.objectName,
  };
}

export function publicItem(r: any, deliveries: PublicDelivery[]) {
  const images = (json(r.images, []) as any[]).map(publicImage);
  const body = String(r.body || "");
  const blocks = markupToBlocks(body, images);
  return {
    id: String(r.id), brandId: String(r.brand_id || ""), externalId: String(r.external_id || ""),
    title: String(r.title || ""), body, tags: json(r.tags, []) as string[], images,
    approvedAt: iso(r.approved_at), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
    status: itemDisplayStatus(!!r.approved_at, deliveries),
    missingImages: images.filter((img) => img.missing).length,
    blockedCount: deliveries.filter((d) => d.status === "draft" && d.guardReason).length,
    // 수동 복사 화면: 서식 복사(text/html)·글자 복사(text/plain). 블록은 PC 앱 Job 과 같은 변환을 거친다.
    copyHtml: blocksToHtml(blocks), plainText: blocksToPlainText(blocks),
    deliveries,
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
function manualDueQuery(userId: string) {
  return {
    query: `UPDATE publishing_deliveries d SET status = 'ready_manual', updated_at = now()
      FROM publishing_channels c WHERE d.user_id = $1 AND d.status = 'scheduled' AND d.scheduled_at <= now()
      AND c.id = d.channel_id AND c.mode = 'manual'`,
    params: [userId],
  };
}

// ── 화면 전체 읽기 ──────────────────────────────────────────────────────────

const ITEM_LIMIT = 500;

export async function loadPublishingState(db: PublishingDb, userId: string) {
  const [, , channels, items, deliveries, devices] = await db.batch([
    manualDueQuery(userId),
    leaseExpiryQuery(userId),
    { query: `SELECT * FROM publishing_channels WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at`, params: [userId] },
    { query: `SELECT * FROM publishing_items WHERE user_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ${ITEM_LIMIT}`, params: [userId] },
    {
      query: `SELECT d.* FROM publishing_deliveries d WHERE d.user_id = $1 AND d.item_id IN
        (SELECT id FROM publishing_items WHERE user_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ${ITEM_LIMIT})
        ORDER BY d.scheduled_at NULLS LAST`,
      params: [userId],
    },
    { query: `SELECT * FROM publisher_devices WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at`, params: [userId] },
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
  const [rows] = await db.batch([
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
    };
  });
}

type ItemInput = {
  id?: string; externalId?: string; brandId?: string; title: string; body: string; tags: string[]; images: any[];
  deliveries: Array<{ id?: string; channelId: string; scheduledAt: string }>;
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
    const images = sanitizeImages(env, userId, input.images);
    const hash = await contentHashOf(title, body);
    const existing: any = (input.id && byId.get(String(input.id))) || (input.externalId && byExternal.get(String(input.externalId))) || null;
    if (input.id && !existing) throw new PublishingError("item_not_found", 404);
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
    const contentChanged = !existing || String(existing.content_hash) !== hash
      || stable(json(existing.tags, [])) !== stable(tags)
      || stable(json(existing.images, [])) !== stable(images);
    const unapprove = !!existing?.approved_at && (contentChanged || scheduleChanged);
    if (existing) {
      writes.push({
        query: `UPDATE publishing_items SET brand_id=$3, external_id=$4, title=$5, body=$6, tags=$7::jsonb, images=$8::jsonb, content_hash=$9,
          approved_at = CASE WHEN $10::boolean THEN NULL ELSE approved_at END, deleted_at=NULL, updated_at=now() WHERE id=$1 AND user_id=$2`,
        params: [itemId, userId, String(input.brandId || ""), String(input.externalId || existing.external_id || ""), title, body, JSON.stringify(tags), JSON.stringify(images), hash, unapprove],
      });
    } else {
      writes.push({
        query: `INSERT INTO publishing_items (id,user_id,brand_id,external_id,title,body,tags,images,content_hash) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
        params: [itemId, userId, String(input.brandId || ""), String(input.externalId || ""), title, body, JSON.stringify(tags), JSON.stringify(images), hash],
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
  const [rows] = await db.batch([
    { query: `UPDATE publishing_items SET deleted_at=now(), updated_at=now() WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING id`, params: [id, userId] },
    { query: `UPDATE publishing_deliveries SET status='cancelled', updated_at=now() WHERE item_id=$1 AND user_id=$2 AND status NOT IN ('posted','done_manual','cancelled')`, params: [id, userId] },
  ]);
  if (!rows[0]) throw new PublishingError("item_not_found", 404);
  return { id };
}

// ── 승인 (한 건·주간 일괄) ──────────────────────────────────────────────────

const toMs = (v: any) => { const s = iso(v); return s ? Date.parse(s) : NaN; };

/**
 * 글을 승인한다. 초안 게시마다 스팸 방지(하루 횟수·간격·30일 중복)를 검사해 통과한 것만 예약하고,
 * 걸린 것은 초안에 이유(guard_reason)를 남긴다. 게시가 모두 걸린 글은 승인하지 않는다.
 * target: { itemIds } | { weekStart:'YYYY-MM-DD' } (그 주에 예약 시각이 있는 초안 글 전부).
 */
export async function approveItems(db: PublishingDb, userId: string, target: { itemIds?: string[]; weekStart?: string }) {
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
  for (const c of channels) channelsById[String(c.id)] = { id: String(c.id), dailyLimit: Number(c.daily_limit) || 1, minIntervalHours: Number(c.min_interval_hours ?? 20), enabled: c.enabled !== false };
  const itemsById = new Map(items.map((r: any) => [String(r.id), r]));
  const candidates = drafts.map((d: any) => {
    const item: any = itemsById.get(String(d.item_id));
    return {
      deliveryId: String(d.id), itemId: String(d.item_id), channelId: String(d.channel_id), atMs: toMs(d.scheduled_at),
      contentHash: String(item?.content_hash || ""),
      missingImages: (json(item?.images, []) as any[]).some((img) => !img?.objectName),
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
      writes.push({ query: `UPDATE publishing_deliveries SET status='scheduled', guard_reason='', content_hash=$3, updated_at=now() WHERE id=$1 AND user_id=$2 AND status='draft'`, params: [c.deliveryId, userId, c.contentHash] });
    } else {
      blockedByItem.set(c.itemId, (blockedByItem.get(c.itemId) || 0) + 1);
      writes.push({ query: `UPDATE publishing_deliveries SET guard_reason=$3, updated_at=now() WHERE id=$1 AND user_id=$2`, params: [c.deliveryId, userId, p.reason] });
    }
  }
  const approvedIds = items.map((r: any) => String(r.id)).filter((id) => (okByItem.get(id) || 0) > 0 || !blockedByItem.get(id));
  if (approvedIds.length) writes.push({ query: `UPDATE publishing_items SET approved_at=now(), updated_at=now() WHERE user_id=$1 AND id = ANY($2::text[])`, params: [userId, approvedIds] });
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
    { query: `UPDATE publishing_items SET approved_at=NULL, updated_at=now() WHERE user_id=$1 AND id = ANY($2::text[])`, params: [userId, ids] },
    { query: `UPDATE publishing_deliveries SET status='draft', guard_reason='', updated_at=now() WHERE user_id=$1 AND item_id = ANY($2::text[]) AND status IN ('scheduled','ready_manual')`, params: [userId, ids] },
  ]);
  return { ok: true };
}

// ── 게시 한 건 처리(사람) ───────────────────────────────────────────────────

export async function cancelDelivery(db: PublishingDb, userId: string, id: string) {
  const rows = await db.sql(`UPDATE publishing_deliveries SET status='cancelled', updated_at=now() WHERE id=$1 AND user_id=$2 AND status NOT IN ('posted','done_manual','cancelled') RETURNING *`, [id, userId]);
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
 * '올라갔는지 모름(UNCERTAIN)'은 사이트에서 확인했다는 뜻으로 confirmUncertain 을 받아야만 다시 예약한다.
 */
export async function rescheduleDelivery(db: PublishingDb, userId: string, id: string, scheduledAt: string, confirmUncertain: boolean) {
  const [rows, channels] = await db.batch([
    { query: `SELECT d.*, i.content_hash AS item_hash FROM publishing_deliveries d JOIN publishing_items i ON i.id=d.item_id WHERE d.id=$1 AND d.user_id=$2`, params: [id, userId] },
    { query: `SELECT * FROM publishing_channels WHERE user_id=$1 AND deleted_at IS NULL`, params: [userId] },
  ]);
  const d: any = rows[0];
  if (!d) throw new PublishingError("delivery_not_found", 404);
  if (!["needs_human", "failed"].includes(String(d.status))) throw new PublishingError("delivery_not_reschedulable", 409);
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
  const next = ch.mode === "manual" && atMs <= Date.now() ? "ready_manual" : "scheduled";
  const updated = await db.sql(`UPDATE publishing_deliveries SET status=$3, scheduled_at=$4, attempt_base=attempt, error_code='', error_message='', stage='', stage_message='',
    lease_until=NULL, guard_reason='', content_hash=$5, updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('needs_human','failed') RETURNING *`,
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
      const pick = d.channelId ? channels.find((c) => c.id === d.channelId)
        : channels.find((c) => c.type === d.channelType && c.brandId && c.brandId === n.item.brandId)
          || channels.find((c) => c.type === d.channelType && !c.brandId)
          || channels.find((c) => c.type === d.channelType);
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
  const ext = info.contentType.split("/")[1].replace("jpeg", "jpg");
  const safe = String(fileName || "image").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60) || "image";
  const objectName = `${publishingImagePrefix(env, userId)}${Date.now()}-${randomId("i").slice(2, 10)}-${safe}.${ext}`;
  await uploadGcsBytes(env, objectName, bytes, info.contentType);
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  const sha256 = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return { objectName, sha256, width: info.width, height: info.height, contentType: info.contentType, fileName: String(fileName || "").slice(0, 200) };
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
  if (!["posted", "failed", "needs_human"].includes(status)) throw new PublishingError("result_status_invalid");
  const cur = await db.sql(`SELECT id, attempt, attempt_base, status FROM publishing_deliveries WHERE id=$1 AND user_id=$2`, [jobId, device.userId]);
  if (!cur[0]) throw new PublishingError("job_not_found", 404);
  if (Number(cur[0].attempt) !== attempt) throw new PublishingError("stale_attempt", 409);
  const outcome = decideResultOutcome({ status, errorCode: String(input?.errorCode || ""), attemptsUsed: attempt - Number(cur[0].attempt_base || 0) });
  const postedUrl = /^https?:\/\/\S+$/i.test(String(input?.postedUrl || "")) ? String(input.postedUrl).slice(0, 1000) : "";
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
