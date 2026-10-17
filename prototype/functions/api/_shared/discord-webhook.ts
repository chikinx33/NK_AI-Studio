// prototype/functions/api/_shared/discord-webhook.ts
//
// 디스코드 채널 = 웹훅 주소 하나로 연결한다(봇·OAuth 없음).
// ★웹훅 주소는 비밀번호와 같다.★ 아는 사람은 누구나 그 채널에 글을 올릴 수 있다.
//   - 저장은 서버(GCS sns-settings.json 의 sns.discord.webhookUrl)에만 한다.
//   - 화면에는 webhookHint(토큰을 가린 표기)만 내려간다(userdata/sns/get.ts SAFE_SNS_FIELDS).
//   - 로그·오류 문구·배포 이력에 원문을 넣지 않는다. 이 파일의 어떤 함수도 주소를 반환값·오류에 싣지 않는다.
import { buildUserDataObject, gcsObjectPath } from "./storage";
import { getGoogleServiceAccountToken } from "./youtube-token";

/** 본문 글자 수 상한(디스코드 content). 넘으면 잘라 올리지 않고 배포 전에 알린다. */
export const DISCORD_CONTENT_LIMIT = 2000;
/** 첨부 한 개 상한(부스트 없는 서버 기준 10MB). 넘는 파일은 링크로 올린다. */
export const DISCORD_FILE_LIMIT = 10 * 1024 * 1024;
/** 메시지 한 건에 붙일 수 있는 첨부 수. */
export const DISCORD_MAX_ATTACHMENTS = 10;
/** 429 재시도 횟수와 한 번 기다리는 최대 시간(초). retry_after 가 이보다 길면 기다리지 않고 실패로 남긴다. */
export const DISCORD_MAX_RETRIES = 3;
export const DISCORD_MAX_RETRY_WAIT_SEC = 30;

const ALLOWED_HOSTS = new Set(["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"]);

export type ParsedWebhook = { url: string; id: string; token: string };

/**
 * 웹훅 주소 검사. https://discord.com/api/webhooks/{id}/{token} 형식만 받는다(api/v10 등 버전 경로 허용).
 * 다른 호스트로 서버가 요청을 보내지 않게(SSRF) 호스트를 고정하고, 정규화한 주소를 돌려준다.
 */
export function parseDiscordWebhookUrl(raw: unknown): ParsedWebhook | null {
  const text = String(raw == null ? "" : raw).trim();
  if (!text || text.length > 300) return null;
  let u: URL;
  try { u = new URL(text); } catch { return null; }
  if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname.toLowerCase()) || u.port) return null;
  const m = u.pathname.match(/^\/api(?:\/v\d+)?\/webhooks\/(\d{15,25})\/([A-Za-z0-9_-]{30,120})\/?$/);
  if (!m) return null;
  return { url: `https://discord.com/api/webhooks/${m[1]}/${m[2]}`, id: m[1], token: m[2] };
}

/** 화면 표기용. 토큰은 가리고 웹훅 id 끝 4자리만 남긴다(id 만으로는 글을 올릴 수 없다). */
export function webhookHintOf(id: string): string {
  const tail = String(id || "").slice(-4);
  return `discord.com/api/webhooks/…${tail}/••••••`;
}

export type WebhookInfo = { id: string; name: string; channelId: string; guildId: string };

/** 웹훅 정보 조회(GET). 살아 있는 주소인지 확인한다. 무효면 { ok:false, status }. */
export async function fetchWebhookInfo(url: string, fetchFn: typeof fetch = fetch): Promise<{ ok: true; info: WebhookInfo } | { ok: false; status: number }> {
  const res = await fetchFn(url, { method: "GET" });
  if (!res.ok) return { ok: false, status: res.status };
  const j: any = await res.json().catch(() => ({}));
  if (!j || !j.id) return { ok: false, status: 500 };
  return {
    ok: true,
    info: {
      id: String(j.id),
      name: String(j.name || "").slice(0, 80),
      channelId: String(j.channel_id || ""),
      guildId: String(j.guild_id || ""),
    },
  };
}

export type DiscordFile = { name: string; bytes: ArrayBuffer; contentType: string };
export type DiscordPostResult =
  | { ok: true; messageId: string; channelId: string }
  | { ok: false; status: number; error: string; retryAfterSec?: number };

/**
 * 메시지 게시. ?wait=true 로 보내 메시지 id 를 받는다.
 * - 429 는 응답의 retry_after(초)만큼 기다렸다가 다시 보낸다(최대 DISCORD_MAX_RETRIES 회).
 * - allowed_mentions.parse=[] — 본문의 @everyone/@here/역할 멘션이 사람들을 호출하지 않게 한다.
 * 오류 문구에는 웹훅 주소를 넣지 않는다(디스코드 응답의 message/code 만 쓴다).
 */
export async function postDiscordMessage(opts: {
  webhookUrl: string;
  content: string;
  files?: DiscordFile[];
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): Promise<DiscordPostResult> {
  const fetchFn = opts.fetchFn || fetch;
  const sleep = opts.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const files = (opts.files || []).slice(0, DISCORD_MAX_ATTACHMENTS);
  const payload = {
    content: String(opts.content || ""),
    allowed_mentions: { parse: [] as string[] },
    ...(files.length ? { attachments: files.map((f, i) => ({ id: i, filename: f.name })) } : {}),
  };
  for (let attempt = 0; attempt <= DISCORD_MAX_RETRIES; attempt++) {
    let init: RequestInit;
    if (files.length) {
      const form = new FormData();
      form.append("payload_json", JSON.stringify(payload));
      files.forEach((f, i) => form.append(`files[${i}]`, new Blob([f.bytes], { type: f.contentType }), f.name));
      init = { method: "POST", body: form };
    } else {
      init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
    }
    const res = await fetchFn(`${opts.webhookUrl}?wait=true`, init);
    const j: any = await res.json().catch(() => ({}));
    if (res.ok && j && j.id) return { ok: true, messageId: String(j.id), channelId: String(j.channel_id || "") };
    if (res.status === 429) {
      const retryAfter = Number(j?.retry_after);
      const waitSec = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : 1;
      if (attempt >= DISCORD_MAX_RETRIES || waitSec > DISCORD_MAX_RETRY_WAIT_SEC) {
        return { ok: false, status: 429, error: `디스코드 요청 과다(429): ${waitSec}초 뒤 다시 시도해야 합니다.`, retryAfterSec: waitSec };
      }
      await sleep(Math.ceil(waitSec * 1000));
      continue;
    }
    const detail = String(j?.message || res.statusText || "").slice(0, 200);
    return { ok: false, status: res.status, error: `디스코드 게시 실패(${res.status}${j?.code ? ` · ${j.code}` : ""}): ${detail}` };
  }
  return { ok: false, status: 429, error: "디스코드 요청 과다(429)" };
}

/** 디스코드 메시지 주소. 서버(guild) id 를 모르면 ''. */
export function discordMessageUrl(guildId: string, channelId: string, messageId: string): string {
  if (!guildId || !channelId || !messageId) return "";
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

// ── 저장소(GCS sns-settings.json) ─────────────────────────────────────────

function parseGcsUri(uri: string): { bucket: string; object: string } {
  const without = String(uri || "").replace(/^gs:\/\//, "");
  const slash = without.indexOf("/");
  if (slash === -1) return { bucket: without, object: "" };
  return { bucket: without.slice(0, slash), object: without.slice(slash + 1) };
}

async function settingsLocation(env: any, userId: string) {
  const out = parseGcsUri(env.VIDEO_OUTPUT_GCS_URI);
  const objectName = buildUserDataObject(out.object.replace(/\/$/, ""), userId, "sns-settings.json");
  const googleToken = await getGoogleServiceAccountToken({
    clientEmail: env.GOOGLE_CLIENT_EMAIL,
    privateKeyPem: env.GOOGLE_PRIVATE_KEY,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  });
  return { bucket: out.bucket, objectName, googleToken };
}

async function readSettings(loc: { bucket: string; objectName: string; googleToken: string }): Promise<any> {
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${loc.bucket}/o/${gcsObjectPath(loc.objectName)}?alt=media`,
    { headers: { Authorization: `Bearer ${loc.googleToken}` } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GCS read error: ${res.status}`);
  return await res.json().catch(() => null);
}

/**
 * sns.discord 항목을 바꾼다. replace=true 면 통째로 교체(연결·해제), 아니면 병합(needsReconnect 등).
 * 다른 채널의 항목은 건드리지 않는다.
 */
export async function writeDiscordEntry(env: any, userId: string, entry: Record<string, unknown>, replace = false): Promise<void> {
  const loc = await settingsLocation(env, userId);
  const existing: any = (await readSettings(loc)) || { sns: {}, deployDefaults: {} };
  existing.sns = existing.sns || {};
  existing.sns.discord = replace ? { ...entry } : Object.assign({}, existing.sns.discord, entry);
  existing.updatedAt = new Date().toISOString();
  const writeName = loc.objectName.split("/").map(encodeURIComponent).join("/");
  const up = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${loc.bucket}/o?uploadType=media&name=${writeName}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${loc.googleToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(existing),
  });
  if (!up.ok) throw new Error(`GCS save error: ${up.status}`);
}

export type DiscordRecord = { webhookUrl: string; guildId: string; channelId: string; username: string };

/** 게시용 웹훅. 미연결이면 "discord_not_connected" 를 던진다. */
export async function getDiscordWebhook(env: any, userId: string): Promise<DiscordRecord> {
  const loc = await settingsLocation(env, userId);
  const settings = await readSettings(loc);
  const d = settings?.sns?.discord;
  const parsed = d && d.connected ? parseDiscordWebhookUrl(d.webhookUrl) : null;
  if (!parsed) throw new Error("discord_not_connected");
  return {
    webhookUrl: parsed.url,
    guildId: String(d.guildId || ""),
    channelId: String(d.channelId || ""),
    username: String(d.username || ""),
  };
}
