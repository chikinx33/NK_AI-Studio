import { useState } from "react";
import { appDialog } from "../../lib/appDialog";
import { companyFileUrl, deleteCampaign } from "../../lib/publishing";
import { apiErrorText } from "./i18n";
import { Button, Icon, selectClass } from "./ui";
import { NO_CAMPAIGN, brandTitle, channelById, type PublishingCtx } from "./helpers";

/**
 * 캠페인 고르기(글·달력 공용) + 고른 캠페인 요약.
 * 캠페인은 에이전트가 만든다(publishing_campaign 도구: 지침 문서 + 날짜별 글 초안). 화면은 보고·고르고·지우기만 한다.
 */
export default function CampaignBar({ ctx }: { ctx: PublishingCtx }) {
  const { t, state } = ctx;
  const [busy, setBusy] = useState(false);
  if (!state.campaigns.length) return <p className="mb-3 text-[11px] leading-relaxed text-faint">{t.campaign.hint}</p>;
  const c = state.campaigns.find((x) => x.id === ctx.campaign);
  const channels = channelById(state);
  const items = c ? state.items.filter((i) => i.campaignId === c.id) : [];
  const live = items.flatMap((i) => i.deliveries.filter((d) => d.status !== "cancelled"));
  const sns = live.filter((d) => channels.get(d.channelId)?.mode === "api").length;
  const missing = items.filter((i) => i.missingImages > 0).length;
  const noChannel = items.filter((i) => !i.deliveries.some((d) => d.status !== "cancelled")).length;
  const count = (statuses: string[]) => live.filter((d) => statuses.includes(d.status)).length;

  async function remove() {
    if (!c || !(await appDialog.confirm(t.campaign.removeAsk(c.title), { title: t.campaign.remove }))) return;
    setBusy(true);
    try {
      await deleteCampaign(c.id);
      ctx.setCampaign("");
      ctx.toast(t.campaign.removed);
      await ctx.reload();
    } catch (e) {
      ctx.toast(apiErrorText(t, e), "warn");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-secondary"><Icon name="megaphone" className="h-3.5 w-3.5 text-tone-emerald" />{t.campaign.label}</span>
        <select className={`${selectClass} max-w-[320px]`} value={ctx.campaign} onChange={(e) => ctx.setCampaign(e.target.value)}>
          <option value="">{t.campaign.all}</option>
          {state.campaigns.map((x) => <option key={x.id} value={x.id}>{x.title}{x.startDate ? ` · ${x.startDate.slice(5)}~${x.endDate.slice(5)}` : ""}</option>)}
          <option value={NO_CAMPAIGN}>{t.campaign.none}</option>
        </select>
      </div>
      {c && (
        <div className="rounded-2xl border border-edge bg-panel p-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-strong">{c.title}</span>
                <span className="rounded-full bg-inset px-2 py-0.5 text-[10px] font-semibold text-secondary">{c.brandTitle || brandTitle(ctx, c.brandId)}</span>
                <span className="text-[11px] tabular-nums text-muted">{t.campaign.period(c.startDate, c.endDate)}</span>
              </div>
              {c.goal && <p className="mt-1.5 text-[11px] leading-relaxed text-secondary"><span className="font-bold text-muted">{t.campaign.goal} · </span>{c.goal}</p>}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-semibold text-muted">
                <span>{t.campaign.counts(items.length, sns, live.length - sns)}</span>
                <span>{t.campaign.progress(count(["draft"]), count(["scheduled", "claimed", "publishing", "ready_manual"]), count(["posted", "done_manual"]))}</span>
                {missing > 0 && <span className="text-tone-amber">{t.campaign.missingImages(missing)}</span>}
                {noChannel > 0 && <span className="text-tone-amber">{t.campaign.noChannel(noChannel)}</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {c.guidePath && (
                <a href={companyFileUrl(c.guidePath, "preview")} target="_blank" rel="noreferrer" title={c.guidePath}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-edge px-3 text-[11px] font-semibold text-secondary transition hover:bg-inset hover:text-strong">
                  <Icon name="fileText" className="h-3.5 w-3.5" />{t.campaign.openGuide}
                </a>
              )}
              <Button size="sm" icon="trash" busy={busy} onClick={() => void remove()}>{t.campaign.remove}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
