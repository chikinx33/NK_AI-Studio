/**
 * 퍼블리싱 화면 ↔ 서버(/api/publishing/*). 서버 모양은 prototype/functions/api/_shared/publishing-store.ts 의 public* 함수.
 * PC 앱(NK Publisher)은 이 경로를 쓰지 않는다 — 기기 토큰으로 /api/publisher/v1/* 만 쓴다.
 */

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
}
export interface PublishingItem {
  id: string; brandId: string; externalId: string; title: string; body: string; tags: string[]; images: PublishingImage[];
  approvedAt: string; createdAt: string; updatedAt: string; status: ItemStatus; missingImages: number; blockedCount: number;
  copyHtml: string; plainText: string; deliveries: PublishingDelivery[];
}
export interface PublisherDevice {
  id: string; name: string; os: string; appVersion: string; lastSeenAt: string; lastHeartbeatAt: string; createdAt: string;
  sessions: Array<{ channelType: string; accountLabel: string; loggedIn: boolean; checkedAt: string }>;
}
export interface PublishingState { serverTime: string; channels: PublishingChannel[]; items: PublishingItem[]; devices: PublisherDevice[] }
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

export interface ApproveResult { approvedItems: number; scheduled: number; blocked: Array<{ deliveryId: string; itemId: string; reason: string }> }
export const approveItems = (ids: string[]) => post<ApproveResult>("/api/publishing/items", { action: "approve", ids });
export const approveWeek = (weekStart: string) => post<ApproveResult>("/api/publishing/items", { action: "approve_week", weekStart });
export const unapproveItems = (ids: string[]) => post("/api/publishing/items", { action: "unapprove", ids });
export const cancelDelivery = (id: string) => post("/api/publishing/items", { action: "cancel_delivery", id });
export const markDoneManual = (id: string, postedUrl: string) => post("/api/publishing/items", { action: "done_manual", id, postedUrl });
export const rescheduleDelivery = (id: string, scheduledAt: string, confirmUncertain = false) =>
  post("/api/publishing/items", { action: "reschedule", id, scheduledAt, confirmUncertain });

export interface ImportResult {
  imported: number; missingChannelTypes: string[];
  errors: Array<{ index: number; externalId: string; error: string }>;
  items: Array<{ id: string; externalId: string; images: Array<{ index: number; missing: boolean; sourceUrl: string; fileName: string }> }>;
}
export const importItems = (items: unknown[]) => post<ImportResult>("/api/publishing/import", { items });

export async function uploadImageFile(file: File, target?: { itemId: string; index: number }): Promise<PublishingImage> {
  const fd = new FormData();
  fd.append("file", file);
  if (target) { fd.append("itemId", target.itemId); fd.append("index", String(target.index)); }
  return (await call<{ image: PublishingImage }>("/api/publishing/images", { method: "POST", body: fd })).image;
}
export async function uploadImageUrl(sourceUrl: string, target?: { itemId: string; index: number }): Promise<PublishingImage> {
  return (await post<{ image: PublishingImage }>("/api/publishing/images", { sourceUrl, ...(target || {}) })).image;
}

export const createPairingCode = () => post<{ code: string; expiresAt: string }>("/api/publishing/devices", { action: "create_code" });
export const revokeDevice = (id: string) => post("/api/publishing/devices", { action: "revoke", id });

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
