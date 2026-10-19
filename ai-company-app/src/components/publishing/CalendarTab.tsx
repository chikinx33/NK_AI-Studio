import { useMemo, useState } from "react";
import { addDays, todayKst, weekStartOf } from "../../lib/publishing";
import { Button, Icon, STATUS_DOT } from "./ui";
import { ATTENTION, allDeliveryRows, channelTypeLabel, kstDayOf, type PublishingCtx } from "./helpers";

const MAX_PER_DAY = 4;

/** 달력: 달마다 게시(채널 하나로 나가는 한 건)를 날짜 칸에 놓는다. 칸의 글을 누르면 글 편집, 빈 칸 + 는 그날 새 글. */
export default function CalendarTab({ ctx }: { ctx: PublishingCtx }) {
  const { t, state } = ctx;
  const today = todayKst();
  const [month, setMonth] = useState(() => today.slice(0, 7)); // 'YYYY-MM'
  const [expanded, setExpanded] = useState("");
  const byDay = useMemo(() => {
    const map = new Map<string, ReturnType<typeof allDeliveryRows>>();
    for (const r of allDeliveryRows(state)) {
      if (r.delivery.status === "cancelled") continue;
      const day = kstDayOf(r.delivery.postedAt || r.delivery.scheduledAt);
      if (!day) continue;
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(r);
    }
    for (const list of map.values()) list.sort((a, b) => (a.delivery.scheduledAt || "").localeCompare(b.delivery.scheduledAt || ""));
    return map;
  }, [state]);

  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const gridStart = weekStartOf(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const weeks = days[35].slice(0, 7) === month ? 6 : 5;
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const timeOf = (iso: string) => (iso ? new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(11, 16) : "");

  return (
    <div className="rounded-2xl border border-edge bg-panel">
      <header className="flex items-center gap-2 border-b border-edge px-4 py-3">
        <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-inset hover:text-strong" onClick={() => shift(-1)} aria-label={t.prevMonth} title={t.prevMonth}><Icon name="chevronLeft" /></button>
        <h3 className="min-w-[130px] text-center text-sm font-bold text-strong">{t.monthTitle(y, m)}</h3>
        <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-inset hover:text-strong" onClick={() => shift(1)} aria-label={t.nextMonth} title={t.nextMonth}><Icon name="chevronRight" /></button>
        <Button size="sm" onClick={() => setMonth(today.slice(0, 7))}>{t.today}</Button>
        <span className="flex-1" />
        <Button size="sm" tone="primary" icon="plus" onClick={() => ctx.openItem(null)}>{t.newItem}</Button>
      </header>
      <div className="grid grid-cols-7 border-b border-edge text-center text-[10px] font-bold uppercase tracking-wider text-faint">
        {t.weekday.map((w, i) => <div key={w} className={`py-2 ${i >= 5 ? "text-tone-rose/80" : ""}`}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.slice(0, weeks * 7).map((day) => {
          const inMonth = day.slice(0, 7) === month;
          const list = byDay.get(day) || [];
          const open = expanded === day;
          const shown = open ? list : list.slice(0, MAX_PER_DAY);
          return (
            <div key={day} className={`group relative min-h-[108px] border-b border-r border-edge p-1.5 ${inMonth ? "" : "bg-inset/40"} ${day === today ? "bg-tint-emerald/10" : ""}`}>
              <div className="mb-1 flex items-center justify-between">
                <span className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-bold tabular-nums ${day === today ? "bg-emerald-500 text-black" : inMonth ? "text-secondary" : "text-faint"}`}>{Number(day.slice(8))}</span>
                <button type="button" onClick={() => ctx.openItem(null, { scheduledAt: new Date(Date.parse(`${day}T09:00:00+09:00`)).toISOString() })}
                  className="grid h-5 w-5 place-items-center rounded text-faint opacity-0 transition hover:bg-inset hover:text-tone-emerald focus:opacity-100 group-hover:opacity-100" aria-label={t.newItem} title={t.newItem}>
                  <Icon name="plus" className="h-3 w-3" />
                </button>
              </div>
              <div className="space-y-0.5">
                {shown.map((r) => (
                  <button key={r.delivery.id} type="button" onClick={() => (ATTENTION.includes(r.delivery.status) ? ctx.openCopy(r.delivery.id) : ctx.openItem(r.item.id))}
                    title={`${timeOf(r.delivery.scheduledAt)} ${r.channel?.name || ""} · ${r.item.title} · ${t.deliveryStatus[r.delivery.status] || ""}`}
                    className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] leading-tight text-secondary hover:bg-inset">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[r.delivery.status] || "bg-muted"}`} />
                    <span className="shrink-0 tabular-nums text-faint">{timeOf(r.delivery.scheduledAt)}</span>
                    <span className="truncate"><span className="font-semibold">{channelTypeLabel(t, r.channel?.type || "").slice(0, 4)}</span> {r.item.title}</span>
                  </button>
                ))}
                {list.length > MAX_PER_DAY && (
                  <button type="button" onClick={() => setExpanded(open ? "" : day)} className="w-full rounded px-1 text-left text-[10px] font-bold text-tone-emerald hover:bg-inset">
                    {open ? "−" : t.moreCount(list.length - MAX_PER_DAY)}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
