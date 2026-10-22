/**
 * 퍼블리싱 화면 ↔ 서버(/api/publishing/*). 서버 모양은 prototype/functions/api/_shared/publishing-store.ts 의 public* 함수.
 * PC 앱(NK Publisher)은 이 경로를 쓰지 않는다 — 기기 토큰으로 /api/publisher/v1/* 만 쓴다.
 */

import { withMediaToken } from "./api";

export type ChannelMode = "pc" | "manual" | "api";
export type DeliveryStatus = "draft" | "scheduled" | "claimed" | "publishing" | "posted" | "failed" | "needs_human" | "ready_manual" | "done_manual" | "tested" | "cancelled";
export type ItemStatus = "draft" | "approved" | "scheduled" | "posted" | "failed" | "needs_human" | "tested";

export interface PublishingChannel {
  id: string; type: string; mode: ChannelMode; name: string; brandId: string; accountLabel: string;
  target: Record<string, string>; dailyLimit: number; minIntervalHours: number; enabled: boolean; writeUrl: string;
  createdAt: string; updatedAt: string;
}
export interface PublishingDelivery {
  id: string; itemId: string; channelId: string; status: DeliveryStatus; scheduledAt: string; attempt: number;
  leaseUntil: string; deviceId: string; stage: string; stageMessage: string; postedUrl: string; postedAt: string;
  errorCode: string; errorMessage: string; screenshotObject: string; guardReason: string; updatedAt: string;
}
export interface PublishingImage {
  ref: string; objectName: string; sha256: string; width: number; height: number; contentType: string;
  alt: string; caption: string; sourceUrl: string; sourcePath: string; fileName: string; missing: boolean;
  /** 업무 파일에서 옮기지 못한 이유(not_found 등). 있으면 자동으로 다시 옮기지 않는다. */
  sourceError: string;
}
/** 패키지(업무 파일 폴더)에서 온 글의 덧붙임. 영상은 업무 파일 경로(복사하지 않음). */
export interface PublishingExtras {
  videos: Array<{ path: string; name: string; size: number; contentType: string }>;
  translation: string; notes: string; firstComment: string; packagePath: string; lang: string;
}
export interface PublishingItem {
  id: string; brandId: string; externalId: string; campaignId: string; title: string; body: string; tags: string[]; images: PublishingImage[];
  extras: PublishingExtras; needsReapproval: boolean;
  approvedAt: string; createdAt: string; updatedAt: string; status: ItemStatus; missingImages: number; blockedCount: number;
  copyHtml: string; plainText: string; deliveries: PublishingDelivery[];
}
export interface PublisherDevice {
  id: string; name: string; os: string; appVersion: string; lastSeenAt: string; lastHeartbeatAt: string; createdAt: string;
  sessions: Array<{ channelType: string; accountLabel: string; loggedIn: boolean; checkedAt: string }>;
}
/** 캠페인: 한 브랜드의 기간 행사 홍보. 에이전트가 지침 문서(업무 파일)와 날짜별 글 초안을 만든다. */
export interface PublishingCampaign {
  id: string; key: string; title: string; brandId: string; brandTitle: string; goal: string;
  startDate: string; endDate: string; guidePath: string; createdAt: string; updatedAt: string;
}
export interface PublishingState { serverTime: string; channels: PublishingChannel[]; items: PublishingItem[]; devices: PublisherDevice[]; campaigns: PublishingCampaign[] }
export interface BrandOption { id: string; title: string }

export class PublishingApiError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message || code); this.code = code; }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) throw new PublishingApiError(String(data?.error || `http_${res.status}`), String(data?.message || ""));
  return data as T;
}
const post = <T,>(url: string, body: unknown) => call<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const getPublishingState = () => call<PublishingState>("/api/publishing/state");

export async function listBrandOptions(): Promise<BrandOption[]> {
  const data = await call<{ ids?: string[]; brands?: Array<Record<string, unknown>> }>("/api/brand/list?full=1");
  const brands = Array.isArray(data.brands) ? data.brands : [];
  return (data.ids || []).map((id) => {
    const b = brands.find((x) => x.id === id) || {};
    return { id, title: String(b.brandTitle || b.title || id) };
  });
}

export const saveChannel = (channel: Partial<PublishingChannel>) => post<{ channel: PublishingChannel }>("/api/publishing/channels", { action: "save", channel });
export const deleteChannel = (id: string) => post("/api/publishing/channels", { action: "delete", id });

export interface ItemDraft {
  id?: string; brandId: string; title: string; body: string; tags: string[];
  images: Array<Partial<PublishingImage>>;
  deliveries: Array<{ id?: string; channelId: string; scheduledAt: string }>;
}
export const saveItem = (item: ItemDraft) => post<{ id: string }>("/api/publishing/items", { action: "save", item });
export const deleteItem = (id: string) => post("/api/publishing/items", { action: "delete", id });
/** 고른 글 한꺼번에 삭제. 지금 올리는 중인 글은 지우지 않고 busy 로 돌아온다. */
export const deleteItems = (ids: string[]) => post<{ deleted: number; busy: string[] }>("/api/publishing/items", { action: "delete_many", ids });

export interface ApproveResult { approvedItems: number; scheduled: number; blocked: Array<{ deliveryId: string; itemId: string; reason: string }> }
export const approveItems = (ids: string[]) => post<ApproveResult>("/api/publishing/items", { action: "approve", ids });
export const approveWeek = (weekStart: string) => post<ApproveResult>("/api/publishing/items", { action: "approve_week", weekStart });
export const unapproveItems = (ids: string[]) => post("/api/publishing/items", { action: "unapprove", ids });
export const cancelDelivery = (id: string) => post("/api/publishing/items", { action: "cancel_delivery", id });
export const markDoneManual = (id: string, postedUrl: string) => post("/api/publishing/items", { action: "done_manual", id, postedUrl });
export const rescheduleDelivery = (id: string, scheduledAt: string, confirmUncertain = false) =>
  post("/api/publishing/items", { action: "reschedule", id, scheduledAt, confirmUncertain });
/** 캠페인 글의 업무 파일 사진을 퍼블리싱 저장소로 옮긴다. 한 번에 일부만 — more 면 다시 부른다. */
export const fillCampaignImages = (campaignId = "") =>
  post<{ copied: number; failed: number; more: boolean }>("/api/publishing/items", { action: "fill_images", campaignId });
export const deleteCampaign = (id: string) => post("/api/publishing/items", { action: "delete_campaign", id });

export interface ImportResult {
  imported: number; missingChannelTypes: string[];
  errors: Array<{ index: number; externalId: string; error: string }>;
  items: Array<{ id: string; externalId: string; images: Array<{ index: number; missing: boolean; sourceUrl: string; fileName: string }> }>;
}
export const importItems = (items: unknown[]) => post<ImportResult>("/api/publishing/import", { items });

/** 패키지 가져오기(업무 파일 폴더). 미리보기 status: new | update | unchanged, 가져오기: created | updated | unchanged | partial. */
export interface PackageReport {
  path: string; status: "new" | "update" | "unchanged" | "created" | "updated" | "partial"; id?: string; externalId: string;
  title?: string; channel?: string; channelName?: string; scheduledAt?: string; images?: number; videos?: number;
  hasTranslation?: boolean; hasNotes?: boolean; hasFirstComment?: boolean; warnings: string[];
}
export interface PackageImportResult {
  imported: number; unchanged: number; items: PackageReport[]; errors: Array<{ path: string; error: string; message?: string }>;
  pending: string[]; more: boolean; truncated: boolean;
}
export const importPackages = (input: { path: string; dryRun?: boolean; only?: string[] }) =>
  post<PackageImportResult>("/api/publishing/packages/import", input);

export async function uploadImageFile(file: File, target?: { itemId: string; index: number }): Promise<PublishingImage> {
  const fd = new FormData();
  fd.append("file", file);
  if (target) { fd.append("itemId", target.itemId); fd.append("index", String(target.index)); }
  return (await call<{ image: PublishingImage }>("/api/publishing/images", { method: "POST", body: fd })).image;
}
export async function uploadImageUrl(sourceUrl: string, target?: { itemId: string; index: number }): Promise<PublishingImage> {
  return (await post<{ image: PublishingImage }>("/api/publishing/images", { sourceUrl, ...(target || {}) })).image;
}

/** 개인 API 키(외부 스크립트용 출입증). 원문 token 은 만들 때 한 번만 온다 — 화면은 파일로 내려받게만 한다. */
export interface ApiKeyInfo { id: string; name: string; scopes: string[]; createdAt: string; lastUsedAt: string }
export const listApiKeys = () => call<{ keys: ApiKeyInfo[]; scopes: string[] }>("/api/api-keys");
export const createApiKey = (name: string, scopes: string[]) =>
  post<{ key: ApiKeyInfo; token: string; fileName: string }>("/api/api-keys", { action: "create", name, scopes });
export const revokeApiKey = (id: string) => post("/api/api-keys", { action: "revoke", id });

/** 업무 파일 받기·미리보기 주소(<video src>·<a href> 는 헤더를 못 붙여 쿼리 토큰을 싣는다). */
export const companyFileUrl = (path: string, mode: "preview" | "download") =>
  withMediaToken(`/api/agent/company-files?path=${encodeURIComponent(path)}&${mode}=1`);

export const createPairingCode = () => post<{ code: string; expiresAt: string }>("/api/publishing/devices", { action: "create_code" });
export const revokeDevice = (id: string) => post("/api/publishing/devices", { action: "revoke", id });

/**
 * NK Publisher(PC 앱) 설치 파일 정보. 원천은 저장소의 prototype/downloads/nk-publisher/latest.json 한 파일이다
 * (새 버전이 나오면 그 파일만 고친다). url 이 비었거나 https 가 아니면 "준비 중".
 */
export interface PublisherRelease { version: string; fileName: string; url: string; size: number; sha256: string; releasedAt: string }
export async function getPublisherRelease(): Promise<PublisherRelease | null> {
  try {
    const res = await fetch("/downloads/nk-publisher/latest.json", { cache: "no-store" });
    if (!res.ok) return null;
    const d = await res.json();
    const url = String(d?.url || "");
    if (!/^https:\/\//i.test(url)) return null;
    return { version: String(d.version || ""), fileName: String(d.fileName || ""), url, size: Number(d.size) || 0, sha256: String(d.sha256 || ""), releasedAt: String(d.releasedAt || "") };
  } catch {
    return null;
  }
}

/** 저장된 이미지 읽기(로그인 세션으로 본인 파일만). */
export async function fetchStoredImage(objectName: string): Promise<Blob> {
  const res = await fetch(`/api/media/proxy?objectName=${encodeURIComponent(objectName)}`);
  if (!res.ok) throw new PublishingApiError(`http_${res.status}`, "");
  return res.blob();
}

// ── 시간(게시 일정은 한국 시간 하루 기준 — 서버 publishing-core.js 와 같다) ──
const KST_MS = 9 * 60 * 60 * 1000;
/** ISO → 'YYYY-MM-DD'(한국 날짜). */
export const kstDay = (iso: string | number) => new Date((typeof iso === "number" ? iso : Date.parse(iso)) + KST_MS).toISOString().slice(0, 10);
/** ISO → datetime-local 값(한국 시간). */
export const toLocalInput = (iso: string) => (iso ? new Date(Date.parse(iso) + KST_MS).toISOString().slice(0, 16) : "");
/** datetime-local 값(한국 시간) → ISO. */
export const fromLocalInput = (v: string) => (v ? new Date(Date.parse(`${v}:00+09:00`)).toISOString() : "");
/** 그 주 월요일(한국 날짜). */
export function weekStartOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const weekday = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - weekday * 86400000).toISOString().slice(0, 10);
}
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const todayKst = () => kstDay(Date.now());
