import { useMemo, useState } from "react";
import { approveItems, unapproveItems, type ItemStatus } from "../../lib/publishing";
import { apiErrorText } from "./i18n";
import { Button, Empty, Icon, StatusBadge, inputClass, selectClass } from "./ui";
import { brandTitle, channelById, fmtDateTime, type PublishingCtx } from "./helpers";
import ImportDialog from "./ImportDialog";

const FILTERS: Array<"all" | ItemStatus> = ["all", "draft", "approved", "scheduled", "posted", "failed", "needs_human"];

/** 글: 상태별 목록, 여러 개 골라 승인, 가져오기. */
export default function ItemsTab({ ctx }: { ctx: PublishingCtx }) {
  const { t, state } = ctx;
  const [filter, setFilter] = useState<"all" | ItemStatus>("all");
  const [brand, setBrand] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const channels = useMemo(() => channelById(state), [state]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: state.items.length };
    for (const item of state.items) c[item.status] = (c[item.status] || 0) + 1;
    return c;
  }, [state.items]);
  const brandIds = useMemo(() => [...new Set(state.items.map((i) => i.brandId))], [state.items]);
  const q = query.trim().toLowerCase();
  const list = state.items
    .filter((i) => (filter === "all" || i.status === filter) && (!brand || i.brandId === brand) && (!q || i.title.toLowerCase().includes(q)))
    .sort((a, b) => {
      const at = (x: typeof a) => x.deliveries.map((d) => d.scheduledAt).filter(Boolean).sort()[0] || x.updatedAt;
      return at(b).localeCompare(at(a));
    });
  const pickedList = list.filter((i) => picked.has(i.id));
  const allPicked = list.length > 0 && pickedList.length === list.length;

  async function bulk(kind: "approve" | "unapprove") {
    setBusy(true);
    try {
      const ids = pickedList.map((i) => i.id);
      if (kind === "approve") {
        const r = await approveItems(ids);
        ctx.toast(t.approveResult(r.scheduled, r.blocked.length), r.blocked.length ? "warn" : "ok");
      } else {
        await unapproveItems(ids);
      }
      setPicked(new Set());
      await ctx.reload();
    } catch (e) {
      ctx.toast(apiErrorText(t, e), "warn");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="status">
          {FILTERS.map((f) => (
            <button key={f} type="button" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)}
              className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition ${filter === f ? "border-emerald-500/60 bg-tint-emerald/40 text-tone-emerald" : "border-edge text-muted hover:text-strong"}`}>
              {t.itemStatus[f]}<span className="tabular-nums opacity-70">{counts[f] || 0}</span>
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <Button icon="fileUp" onClick={() => setImportOpen(true)}>{t.importBtn}</Button>
        <Button tone="primary" icon="plus" onClick={() => ctx.openItem(null)}>{t.newItem}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${inputClass} max-w-xs`} placeholder={t.searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} />
        {brandIds.length > 1 && (
          <select className={`${selectClass} max-w-[200px]`} value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">{t.allBrands}</option>
            {brandIds.map((id) => <option key={id} value={id}>{brandTitle(ctx, id)}</option>)}
          </select>
        )}
        {pickedList.length > 0 && (
          <div className="ml-auto flex items-center gap-2 rounded-full border border-edge bg-panel py-1 pl-3 pr-1">
            <span className="text-[11px] font-semibold text-secondary">{t.selected(pickedList.length)}</span>
            <Button size="sm" tone="primary" icon="check" busy={busy} onClick={() => void bulk("approve")}>{t.approveSelected}</Button>
            <Button size="sm" busy={busy} onClick={() => void bulk("unapprove")}>{t.unapproveSelected}</Button>
          </div>
        )}
      </div>

      {!list.length ? (
        <Empty icon="fileText" action={<Button tone="primary" icon="plus" onClick={() => ctx.openItem(null)}>{t.newItem}</Button>}>{t.itemsEmpty}</Empty>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-edge bg-panel">
          <div className="flex items-center gap-3 border-b border-edge bg-inset/50 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-faint">
            <input type="checkbox" className="h-3.5 w-3.5 accent-emerald-500" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(list.map((i) => i.id)))} aria-label="select all" />
            <span className="flex-1">{t.title}</span>
            <span className="hidden w-[260px] md:block">{t.deliveries}</span>
            <span className="w-[76px] text-right">{t.itemStatus.all}</span>
          </div>
          <ul className="divide-y divide-edge">
            {list.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-inset/40">
                <input type="checkbox" className="h-3.5 w-3.5 accent-emerald-500" checked={picked.has(item.id)} aria-label={item.title}
                  onChange={() => setPicked((prev) => { const next = new Set(prev); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} />
                <button type="button" onClick={() => ctx.openItem(item.id)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-xs font-bold text-strong">{item.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted">
                    <span>{brandTitle(ctx, item.brandId)}</span>
                    {item.images.length > 0 && <span className="inline-flex items-center gap-0.5"><Icon name="image" className="h-3 w-3" />{item.images.length}</span>}
                    {item.missingImages > 0 && <span className="font-semibold text-tone-amber">{t.missingBadge(item.missingImages)}</span>}
                    {item.blockedCount > 0 && <span className="font-semibold text-tone-amber">{t.blockedBadge(item.blockedCount)}</span>}
                  </div>
                </button>
                <div className="hidden w-[260px] flex-wrap gap-1 md:flex">
                  {!item.deliveries.length && <span className="text-[10px] text-faint">{t.noDeliveries}</span>}
                  {item.deliveries.filter((d) => d.status !== "cancelled").slice(0, 3).map((d) => (
                    <span key={d.id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-inset px-1.5 py-0.5 text-[10px] text-secondary" title={t.deliveryStatus[d.status]}>
                      <span className="truncate font-semibold">{channels.get(d.channelId)?.name || "—"}</span>
                      <span className="shrink-0 tabular-nums text-faint">{fmtDateTime(t, d.scheduledAt)}</span>
                    </span>
                  ))}
                </div>
                <div className="flex w-[76px] justify-end"><StatusBadge status={item.status} label={t.itemStatus[item.status]} /></div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {importOpen && <ImportDialog ctx={ctx} onClose={() => setImportOpen(false)} />}
    </div>
  );
}
