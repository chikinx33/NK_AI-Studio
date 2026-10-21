import { useState } from "react";
import { appDialog } from "../../lib/appDialog";
import { saveChannel, deleteChannel, type PublishingChannel } from "../../lib/publishing";
import { apiErrorText } from "./i18n";
import { Button, ChannelChip, Empty, Field, IconButton, Modal, inputClass, selectClass } from "./ui";
import { brandTitle, channelTypeLabel, type PublishingCtx } from "./helpers";
import { CHANNEL_TYPES, DEFAULT_DAILY_LIMIT, DEFAULT_MIN_INTERVAL_HOURS, isModeAvailable } from "./constants";

/** 채널: 글을 올릴 곳. 종류마다 방식(PC 자동 / 직접 올리기)과 사이트 정보(약속 §3 target)를 갖는다. */
export default function ChannelsTab({ ctx }: { ctx: PublishingCtx }) {
  const { t, state } = ctx;
  const [editing, setEditing] = useState<Partial<PublishingChannel> | null>(null);

  async function toggle(c: PublishingChannel) {
    try {
      await saveChannel({ ...c, enabled: !c.enabled });
      await ctx.reload();
    } catch (e) {
      ctx.toast(apiErrorText(t, e), "warn");
    }
  }
  async function remove(c: PublishingChannel) {
    if (!(await appDialog.confirm(t.channelDeleteAsk, { title: t.delete }))) return;
    try {
      await deleteChannel(c.id);
      await ctx.reload();
    } catch (e) {
      ctx.toast(apiErrorText(t, e), "warn");
    }
  }
  const targetSummary = (c: PublishingChannel) => {
    const tg = c.target || {};
    if (c.mode === "api") return t.campaign.snsAccount;
    if (c.type === "naver_blog" && !tg.blogId) return t.accountBlog;
    return tg.blogId ? `blog.naver.com/${tg.blogId}` : tg.cafeUrl || tg.boardUrl || (tg.galleryId ? `${tg.galleryType || ""} · ${tg.galleryId}` : "") || (tg.subreddit ? `r/${tg.subreddit}` : "") || tg.writeUrl || tg.note || "";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center">
        <span className="flex-1 text-[11px] text-muted">{t.limitsHint}</span>
        <Button tone="primary" icon="plus" onClick={() => setEditing({})}>{t.addChannel}</Button>
      </div>
      {!state.channels.length ? (
        <Empty icon="rss" action={<Button tone="primary" icon="plus" onClick={() => setEditing({})}>{t.addChannel}</Button>}>{t.channelsEmpty}</Empty>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {state.channels.map((c) => (
            <li key={c.id} className={`flex items-start gap-3 rounded-2xl border border-edge bg-panel p-4 ${c.enabled ? "" : "opacity-60"}`}>
              <ChannelChip type={c.type} label={channelTypeLabel(t, c.type)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-bold text-strong">{c.name}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${c.mode === "pc" ? "bg-tint-violet/50 text-tone-violet" : c.mode === "api" ? "bg-tint-sky/50 text-tone-sky" : "bg-inset text-secondary"}`}>{t.mode[c.mode]}</span>
                </div>
                <div className="mt-0.5 truncate text-[11px] text-muted">{channelTypeLabel(t, c.type)} · {brandTitle(ctx, c.brandId)}{c.accountLabel ? ` · ${c.accountLabel}` : ""}</div>
                {targetSummary(c) && <div className="mt-0.5 truncate text-[11px] text-faint">{targetSummary(c)}</div>}
                <div className="mt-1.5 text-[10px] font-semibold text-secondary">{t.limitsSummary(c.dailyLimit, c.minIntervalHours)}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" role="switch" aria-checked={c.enabled} onClick={() => void toggle(c)} title={c.enabled ? t.enabled : t.disabled}
                  className={`relative h-5 w-9 rounded-full transition ${c.enabled ? "bg-emerald-500" : "bg-edge"}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${c.enabled ? "left-[18px]" : "left-0.5"}`} />
                </button>
                <IconButton icon="pencil" label={t.edit} onClick={() => setEditing(c)} />
                <IconButton icon="trash" label={t.delete} onClick={() => void remove(c)} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <ChannelEditor ctx={ctx} channel={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ChannelEditor({ ctx, channel, onClose }: { ctx: PublishingCtx; channel: Partial<PublishingChannel>; onClose: () => void }) {
  const { t } = ctx;
  const [type, setType] = useState(channel.type || "naver_blog");
  const firstMode = (ty: string) => (CHANNEL_TYPES[ty]?.modes.find((m) => isModeAvailable(ty, m)) || "manual");
  const [mode, setMode] = useState<string>(channel.mode || firstMode(channel.type || "naver_blog"));
  const [name, setName] = useState(channel.name || "");
  const [brandId, setBrandId] = useState(channel.brandId || "");
  const [accountLabel, setAccountLabel] = useState(channel.accountLabel || "");
  const [target, setTarget] = useState<Record<string, string>>({ ...(channel.target || {}) });
  const [dailyLimit, setDailyLimit] = useState(String(channel.dailyLimit ?? DEFAULT_DAILY_LIMIT));
  const [minIntervalHours, setMinIntervalHours] = useState(String(channel.minIntervalHours ?? DEFAULT_MIN_INTERVAL_HOURS));
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setTarget((p) => ({ ...p, [k]: v }));
  const types = Object.keys(CHANNEL_TYPES);

  async function submit() {
    setSaving(true);
    try {
      await saveChannel({
        id: channel.id, type, mode: mode as PublishingChannel["mode"], name, brandId, accountLabel, target,
        dailyLimit: Number(dailyLimit), minIntervalHours: Number(minIntervalHours), enabled: channel.enabled !== false,
      });
      ctx.toast(t.saved);
      await ctx.reload();
      onClose();
    } catch (e) {
      ctx.toast(apiErrorText(t, e), "warn");
    } finally {
      setSaving(false);
    }
  }

  const text = (key: string, label: string, hint?: string, placeholder?: string) => (
    <Field label={label} hint={hint}><input className={inputClass} value={target[key] || ""} placeholder={placeholder} onChange={(e) => set(key, e.target.value)} /></Field>
  );

  return (
    <Modal title={channel.id ? t.channelEditorEdit : t.channelEditorNew} onClose={onClose}
      footer={<><span className="flex-1" /><Button onClick={onClose}>{t.cancel}</Button><Button tone="primary" icon="check" busy={saving} disabled={!name.trim()} onClick={() => void submit()}>{t.save}</Button></>}>
      <div className="space-y-3">
        <Field label={t.channelTypeLabel}>
          <select className={selectClass} value={type} onChange={(e) => { const v = e.target.value; setType(v); setMode(firstMode(v)); setTarget({}); }}>
            {types.map((ty) => {
              const usable = CHANNEL_TYPES[ty].modes.some((m) => isModeAvailable(ty, m));
              return <option key={ty} value={ty} disabled={!usable}>{channelTypeLabel(t, ty)}{usable ? "" : ` (${t.soon})`}</option>;
            })}
          </select>
        </Field>
        <div>
          <span className="mb-1 block text-[11px] font-bold text-secondary">{t.channelModeLabel}</span>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
            {CHANNEL_TYPES[type].modes.map((m) => {
              const ok = isModeAvailable(type, m);
              const on = mode === m;
              return (
                <button key={m} type="button" role="radio" aria-checked={on} disabled={!ok} onClick={() => setMode(m)}
                  className={`rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-emerald-500/70 bg-tint-emerald/30" : "border-edge bg-inset/40 hover:border-emerald-500/40"}`}>
                  <span className="flex items-center gap-2 text-xs font-bold text-strong">{t.mode[m]}{!ok && <span className="text-[9px] font-bold text-faint">{t.soon}</span>}</span>
                  <span className="mt-1 block text-[10px] leading-relaxed text-muted">{t.modeHint[m]}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.channelName}><input className={inputClass} value={name} placeholder={t.channelNamePlaceholder} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
          <Field label={t.brand}>
            <select className={selectClass} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              <option value="">{t.brandNone}</option>
              {ctx.brands.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
          </Field>
        </div>
        {type === "naver_blog" && (
          <div className="grid gap-3 sm:grid-cols-2">
            {text("blogId", t.targetBlogId, t.targetBlogIdHint, "myblog")}
            {text("categoryNo", t.targetCategoryNo)}
            <Field label={t.targetVisibility}>
              <select className={selectClass} value={target.visibility || "public"} onChange={(e) => set("visibility", e.target.value)}>
                <option value="public">{t.visibilityPublic}</option>
                <option value="private">{t.visibilityPrivate}</option>
              </select>
            </Field>
          </div>
        )}
        {type === "naver_cafe" && <div className="grid gap-3 sm:grid-cols-2">{text("cafeUrl", t.targetCafeUrl, undefined, "https://cafe.naver.com/…")}{text("menuId", t.targetMenuId)}</div>}
        {type === "dcinside" && (
          <div className="grid gap-3 sm:grid-cols-3">
            {text("galleryId", t.targetGalleryId)}
            <Field label={t.targetGalleryType}>
              <select className={selectClass} value={target.galleryType || "minor"} onChange={(e) => set("galleryType", e.target.value)}>
                <option value="major">{t.galleryMajor}</option><option value="minor">{t.galleryMinor}</option><option value="mini">{t.galleryMini}</option>
              </select>
            </Field>
            {text("headText", t.targetHeadText)}
          </div>
        )}
        {type === "ruliweb" && text("boardUrl", t.targetBoardUrl, undefined, "https://bbs.ruliweb.com/…")}
        {type === "reddit" && text("subreddit", t.targetSubreddit, t.targetSubredditHint, "IndieGaming")}
        {type === "custom" && <div className="grid gap-3 sm:grid-cols-2">{text("writeUrl", t.targetWriteUrl, undefined, "https://")}{text("note", t.targetNote)}</div>}
        {mode === "pc" && (
          <Field label={t.accountLabel} hint={t.accountLabelHint}><input className={inputClass} value={accountLabel} onChange={(e) => setAccountLabel(e.target.value)} /></Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.dailyLimit}><input type="number" min={1} max={20} className={inputClass} value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} /></Field>
          <Field label={t.minIntervalHours}><input type="number" min={0} max={336} step={0.5} className={inputClass} value={minIntervalHours} onChange={(e) => setMinIntervalHours(e.target.value)} /></Field>
        </div>
        <p className="text-[10px] leading-relaxed text-faint">{t.limitsHint}</p>
      </div>
    </Modal>
  );
}
