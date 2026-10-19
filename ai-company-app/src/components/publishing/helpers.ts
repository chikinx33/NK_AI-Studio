import type { PublishingChannel, PublishingDelivery, PublishingItem, PublishingState, BrandOption } from "../../lib/publishing";
import { DEVICE_ONLINE_MS } from "./constants";
import type { PublishingDict } from "./i18n";

const KST_MS = 9 * 60 * 60 * 1000;

/** 화면 전체가 같이 쓰는 값·동작. */
export interface PublishingCtx {
  t: PublishingDict;
  state: PublishingState;
  brands: BrandOption[];
  now: number;
  reload: () => Promise<void>;
  toast: (message: string, tone?: "ok" | "warn") => void;
  openItem: (id: string | null, preset?: { scheduledAt?: string }) => void;
  openCopy: (deliveryId: string) => void;
  goTab: (tab: PublishingTab) => void;
}
export type PublishingTab = "overview" | "calendar" | "items" | "channels" | "settings";

/** ISO → '10/23(목) 09:00' (한국 시간). */
export function fmtDateTime(t: PublishingDict, iso: string): string {
  if (!iso) return "—";
  const d = new Date(Date.parse(iso) + KST_MS);
  const w = t.weekday[(d.getUTCDay() + 6) % 7];
  return `${t.dateShort(d.getUTCMonth() + 1, d.getUTCDate(), w)} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
export function fmtDay(t: PublishingDict, day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return t.dateShort(d.getUTCMonth() + 1, d.getUTCDate(), t.weekday[(d.getUTCDay() + 6) % 7]);
}

export const channelTypeLabel = (t: PublishingDict, type: string) => t.channelType[type] || type;
export const brandTitle = (ctx: PublishingCtx, id: string) => (id ? ctx.brands.find((b) => b.id === id)?.title || id : ctx.t.brandNone);

export function channelById(state: PublishingState): Map<string, PublishingChannel> {
  return new Map(state.channels.map((c) => [c.id, c]));
}

/** 게시 한 건이 왜 멈췄는지(규칙·오류) 사람 문구. 없으면 "". */
export function deliveryReason(t: PublishingDict, d: PublishingDelivery): string {
  if (d.status === "draft" && d.guardReason) return t.guard[d.guardReason] || d.guardReason;
  if (["needs_human", "failed"].includes(d.status) || (d.status === "scheduled" && d.errorCode)) {
    const base = t.errorCode[d.errorCode] || "";
    const extra = d.errorMessage && d.errorMessage !== base ? d.errorMessage : "";
    return [base, extra].filter(Boolean).join(" — ");
  }
  return "";
}

export interface DeliveryRow { item: PublishingItem; delivery: PublishingDelivery; channel?: PublishingChannel }

export function allDeliveryRows(state: PublishingState): DeliveryRow[] {
  const channels = channelById(state);
  return state.items.flatMap((item) => item.deliveries.map((delivery) => ({ item, delivery, channel: channels.get(delivery.channelId) })));
}

/** 사람이 손대야 하는 것: 확인 필요·실패·올릴 차례 + 규칙에 걸린 초안. */
export function attentionRows(state: PublishingState): DeliveryRow[] {
  return allDeliveryRows(state)
    .filter(({ delivery: d }) => ["needs_human", "failed", "ready_manual"].includes(d.status) || (d.status === "draft" && !!d.guardReason))
    .sort((a, b) => (a.delivery.scheduledAt || "").localeCompare(b.delivery.scheduledAt || ""));
}

export function pcStatus(state: PublishingState, now: number) {
  const latest = state.devices.map((d) => d.lastSeenAt).filter(Boolean).sort().pop() || "";
  const pcChannels = new Set(state.channels.filter((c) => c.mode === "pc").map((c) => c.id));
  const waiting = allDeliveryRows(state).filter(({ delivery: d }) => pcChannels.has(d.channelId) && d.status === "scheduled" && d.scheduledAt && Date.parse(d.scheduledAt) <= now).length;
  const kind: "none" | "online" | "offline" = !state.devices.length ? "none" : latest && now - Date.parse(latest) < DEVICE_ONLINE_MS ? "online" : "offline";
  return { kind, latest, waiting };
}

export function kstDayOf(iso: string): string {
  return iso ? new Date(Date.parse(iso) + KST_MS).toISOString().slice(0, 10) : "";
}
