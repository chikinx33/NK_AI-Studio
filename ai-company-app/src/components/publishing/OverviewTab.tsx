import { useMemo, useState } from "react";
import { approveWeek, rescheduleDelivery, weekStartOf, addDays, todayKst } from "../../lib/publishing";
import { promoteTested } from "./TestedView";
import { appDialog } from "../../lib/appDialog";
import { apiErrorText, agoText } from "./i18n";
import { Button, Card, Empty, Icon, StatusBadge, ChannelChip } from "./ui";
import { allDeliveryRows, attentionRows, deliveryReason, fmtDateTime, fmtDay, kstDayOf, pcStatus, channelTypeLabel, type DeliveryRow, type PublishingCtx } from "./helpers";

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-2xl border border-edge bg-panel px-4 py-3">
      <div className="text-[11px] font-semibold text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-black tabular-nums ${tone || "text-strong"}`}>{value}</div>
    </div>
  );
}

/** 개요: 오늘·이번 주, 주간 일괄 승인, PC 상태, 확인 필요, 다가오는 일정. */
export default function OverviewTab({ ctx }: { ctx: PublishingCtx }) {
  const { t, state, now } = ctx;
  const today = todayKst();
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today));
  const [approving, setApproving] = useState(false);
  const [lastResult, setLastResult] = useState("");
  const weekEnd = addDays(weekStart, 6);
  const rows = useMemo(() => allDeliveryRows(state), [state]);
  const attention = useMemo(() => attentionRows(state), [state]);
  const pc = pcStatus(state, now);

  const thisWeek = weekStartOf(today);
  const inWeek = (r: DeliveryRow, start: string) => { const day = kstDayOf(r.delivery.scheduledAt); return !!day && day >= start && day <= addDays(start, 6); };
  const live = (r: DeliveryRow) => !["cancelled", "draft"].includes(r.delivery.status);
  const stats = {
    today: rows.filter((r) => live(r) && kstDayOf(r.delivery.postedAt || r.delivery.scheduledAt) === today).length,
    week: rows.filter((r) => live(r) && inWeek(r, thisWeek)).length,
    attention: attention.length,
    drafts: new Set(rows.filter((r) => r.delivery.status === "draft" && !r.item.approvedAt && inWeek(r, thisWeek)).map((r) => r.item.id)).size,
  };
  const weekDraftItems = new Set(rows.filter((r) => r.delivery.status === "draft" && !r.item.approvedAt && inWeek(r, weekStart)).map((r) => r.item.id));
  // 승인을 마친 주는 "초안 없음"이 실패처럼 보이지 않게, 이미 승인돼 나갈(또는 나간) 건수를 보여 준다.
  const weekApprovedCount = rows.filter((r) => !!r.item.approvedAt && !["draft", "cancelled"].includes(r.delivery.status) && inWeek(r, weekStart)).length;
  const weekDone = !weekDraftItems.size && weekApprovedCount > 0;
  const upcoming = rows
    .filter((r) => ["scheduled", "claimed", "publishing", "posted", "done_manual"].includes(r.delivery.status) && inWeek(r, thisWeek))
    .sort((a, b) => (a.delivery.scheduledAt || "").localeCompare(b.delivery.scheduledAt || ""));

  async function runApproveWeek() {
    setApproving(true);
    try {
      const r = await approveWeek(weekStart);
      const msg = t.approveResult(r.scheduled, r.blocked.length);
      setLastResult(msg);
      ctx.toast(msg, r.blocked.length ? "warn" : "ok");
      await ctx.reload();
    } catch (e) {
      ctx.toast(apiErrorText(t, e), "warn");
    } finally {
      setApproving(false);
    }
  }

  async function reschedule(r: DeliveryRow) {
    const uncertain = r.delivery.errorCode === "UNCERTAIN";
    if (!(await appDialog.confirm(uncertain ? t.rescheduleUncertainAsk : t.rescheduleAsk, { title: t.reschedule }))) return;
    try {
      await rescheduleDelivery(r.delivery.id, new Date().toISOString(), uncertain);
      await ctx.reload();
    } catch (e) {
      ctx.toast(apiErrorText(t, e), "warn");
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t.statToday} value={stats.today} />
        <Stat label={t.statWeek} value={stats.week} />
        <Stat label={t.statAttention} value={stats.attention} tone={stats.attention ? "text-tone-amber" : undefined} />
        <Stat label={t.statDrafts} value={stats.drafts} tone={stats.drafts ? "text-tone-sky" : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title={t.weekTitle} icon="checkCheck">
          <p className="mb-3 text-[11px] leading-relaxed text-muted">{t.weekHint}</p>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-edge bg-inset/60 p-3">
            <div className="flex items-center gap-1">
              <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-panel hover:text-strong" aria-label={t.prevWeek} title={t.prevWeek} onClick={() => setWeekStart(addDays(weekStart, -7))}><Icon name="chevronLeft" /></button>
              <span className="min-w-[150px] text-center text-sm font-bold tabular-nums text-strong">{t.weekRange(fmtDay(t, weekStart), fmtDay(t, weekEnd))}</span>
              <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-panel hover:text-strong" aria-label={t.nextWeek} title={t.nextWeek} onClick={() => setWeekStart(addDays(weekStart, 7))}><Icon name="chevronRight" /></button>
            </div>
            <span className={`flex-1 text-xs ${weekDone ? "font-semibold text-tone-emerald" : "text-secondary"}`}>{weekDone ? t.weekDone(weekApprovedCount) : t.weekDrafts(weekDraftItems.size)}</span>
            <Button tone="primary" icon={weekDone ? "check" : "checkCheck"} busy={approving} disabled={!weekDraftItems.size} onClick={() => void runApproveWeek()} className="min-w-[170px]">{weekDone ? t.weekApproved : t.approveWeek}</Button>
          </div>
          {lastResult && <p className="mt-2 text-[11px] text-secondary" role="status">{lastResult}</p>}
        </Card>

        <Card title={t.pcTitle} icon="monitor">
          {!state.devices.length ? (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-muted">{t.pcNone}</p>
              <Button icon="link" onClick={() => ctx.goTab("settings")}>{t.pcGoSettings}</Button>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {state.devices.map((d) => {
                const online = d.lastSeenAt && now - Date.parse(d.lastSeenAt) < 12 * 60 * 1000;
                return (
                  <li key={d.id} className="rounded-xl border border-edge bg-inset/50 p-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${online ? "bg-tone-emerald" : "bg-tone-amber"}`} />
                      <span className="flex-1 truncate text-xs font-bold text-strong">{d.name || "PC"}</span>
                      <span className="text-[10px] text-faint">{t.pcLastSeen(agoText(t, d.lastSeenAt, now))}</span>
                    </div>
                    {d.sessions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {d.sessions.map((s) => (
                          <span key={`${s.channelType}:${s.accountLabel}`} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.loggedIn ? "bg-tint-emerald/40 text-tone-emerald" : "bg-tint-amber/50 text-tone-amber"}`}>
                            {channelTypeLabel(t, s.channelType)}{s.accountLabel ? ` · ${s.accountLabel}` : ""} — {s.loggedIn ? t.loginOk : t.loginNeeded}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
              {pc.kind === "offline" && pc.waiting > 0 && <li className="text-[11px] leading-relaxed text-tone-amber">{t.pcWaiting(pc.waiting)}</li>}
            </ul>
          )}
        </Card>
      </div>

      <Card title={`${t.attentionTitle}${attention.length ? ` · ${attention.length}` : ""}`} icon="alert">
        {!attention.length ? <p className="text-xs text-faint">{t.attentionEmpty}</p> : (
          <ul className="divide-y divide-edge">
            {attention.map((r) => {
              const reason = deliveryReason(t, r.delivery);
              const copyable = ["needs_human", "failed", "ready_manual"].includes(r.delivery.status);
              return (
                <li key={r.delivery.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <ChannelChip type={r.channel?.type || ""} label={channelTypeLabel(t, r.channel?.type || "")} />
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => ctx.openItem(r.item.id)} className="block max-w-full truncate text-left text-xs font-bold text-strong hover:text-tone-emerald">{r.item.title}</button>
                    <div className="mt-0.5 truncate text-[11px] text-muted">{r.channel?.name || "—"} · {fmtDateTime(t, r.delivery.scheduledAt)}{reason ? ` · ${reason}` : ""}</div>
                  </div>
                  <StatusBadge status={r.delivery.status} label={t.deliveryStatus[r.delivery.status] || r.delivery.status} />
                  <div className="flex gap-1.5">
                    {r.delivery.status === "tested" && <>
                      <Button size="sm" icon="image" onClick={() => ctx.openCopy(r.delivery.id)}>{t.viewCapture}</Button>
                      <Button size="sm" tone="primary" icon="send" onClick={() => void promoteTested(ctx, r.delivery.id)}>{t.promoteTested}</Button>
                    </>}
                    {copyable && <Button size="sm" tone={r.delivery.status === "ready_manual" ? "primary" : "default"} icon="copy" onClick={() => ctx.openCopy(r.delivery.id)}>{t.openCopy}</Button>}
                    {["needs_human", "failed"].includes(r.delivery.status) && r.channel?.mode === "pc" && <Button size="sm" icon="refresh" onClick={() => void reschedule(r)}>{t.reschedule}</Button>}
                    {r.delivery.status === "draft" && <Button size="sm" icon="pencil" onClick={() => ctx.openItem(r.item.id)}>{t.openItem}</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title={t.upcomingTitle} icon="clock">
        {!upcoming.length ? <Empty icon="calendar">{t.upcomingEmpty}</Empty> : (
          <ul className="divide-y divide-edge">
            {upcoming.map((r) => (
              <li key={r.delivery.id} className="flex items-center gap-3 py-2">
                <span className="w-[104px] shrink-0 text-[11px] font-semibold tabular-nums text-secondary">{fmtDateTime(t, r.delivery.scheduledAt)}</span>
                <ChannelChip type={r.channel?.type || ""} label={channelTypeLabel(t, r.channel?.type || "")} />
                <button type="button" onClick={() => ctx.openItem(r.item.id)} className="min-w-0 flex-1 truncate text-left text-xs text-strong hover:text-tone-emerald">{r.item.title}</button>
                {r.delivery.postedUrl && <a href={r.delivery.postedUrl} target="_blank" rel="noreferrer" className="text-tone-emerald hover:underline" title={t.postedLink} aria-label={t.postedLink}><Icon name="external" className="h-3.5 w-3.5" /></a>}
                <StatusBadge status={r.delivery.status} label={t.deliveryStatus[r.delivery.status] || r.delivery.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
