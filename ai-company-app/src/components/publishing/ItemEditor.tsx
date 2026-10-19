import { useMemo, useRef, useState } from "react";
import StoredImage from "../StoredImage";
import { appDialog } from "../../lib/appDialog";
import {
  saveItem, deleteItem, approveItems, cancelDelivery, uploadImageFile, toLocalInput, fromLocalInput,
  type PublishingImage, type PublishingDelivery,
} from "../../lib/publishing";
import { apiErrorText } from "./i18n";
import { Button, Field, Icon, IconButton, Modal, StatusBadge, inputClass, selectClass, textareaClass, type IconName } from "./ui";
import { channelTypeLabel, deliveryReason, fmtDateTime, type PublishingCtx } from "./helpers";
import { TAGS_MAX, TITLE_MAX } from "./constants";

/** 사람이 고칠 수 있는 게시 상태(서버 publishing-store.ts EDITABLE_DELIVERY 와 같다). */
const EDITABLE = new Set(["draft", "scheduled", "ready_manual"]);

type ImageRow = Partial<PublishingImage>;
type DeliveryRow = { key: string; id?: string; channelId: string; local: string; saved?: PublishingDelivery };

const parseTags = (s: string) => s.split(/[\s,，]+/).map((x) => x.replace(/^#+/, "").trim()).filter(Boolean);

/** 글 쓰기·고치기. 본문은 가벼운 표시(## 소제목, **굵게** …)로 저장하고, PC 앱·복사 화면이 같은 규칙으로 서식을 만든다. */
export default function ItemEditor({ ctx, itemId, preset, onClose }: { ctx: PublishingCtx; itemId: string | null; preset?: { scheduledAt?: string }; onClose: () => void }) {
  const { t, state } = ctx;
  const item = itemId ? state.items.find((i) => i.id === itemId) || null : null;
  const enabledChannels = state.channels.filter((c) => c.enabled);
  const [brandId, setBrandId] = useState(item?.brandId || (ctx.brands.length === 1 ? ctx.brands[0].id : ""));
  const [title, setTitle] = useState(item?.title || "");
  const [body, setBody] = useState(item?.body || "");
  const [tagsText, setTagsText] = useState((item?.tags || []).join(" "));
  const [images, setImages] = useState<ImageRow[]>(item?.images || []);
  const [rows, setRows] = useState<DeliveryRow[]>(() => item
    ? item.deliveries.filter((d) => d.status !== "cancelled").map((d) => ({ key: d.id, id: d.id, channelId: d.channelId, local: toLocalInput(d.scheduledAt), saved: d }))
    : enabledChannels.length === 1 || preset?.scheduledAt
      ? [{ key: "new0", channelId: enabledChannels[0]?.id || "", local: toLocalInput(preset?.scheduledAt || "") }]
      : []);
  const [saving, setSaving] = useState<"" | "save" | "approve" | "delete">("");
  const [uploading, setUploading] = useState("");
  const [dirty, setDirty] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const slotRef = useRef<HTMLInputElement>(null);
  const slotIndex = useRef(-1);
  const touch = () => setDirty(true);
  const tags = useMemo(() => parseTags(tagsText), [tagsText]);
  const channelOf = (id: string) => state.channels.find((c) => c.id === id);

  async function close() {
    if (dirty && !(await appDialog.confirm(t.unsavedAsk, { title: t.close }))) return;
    onClose();
  }

  function insert(kind: string) {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const sel = body.slice(start, end);
    const lineStart = body.lastIndexOf("\n", start - 1) + 1;
    let next = body;
    let caret = start;
    if (kind === "bold") { next = `${body.slice(0, start)}**${sel || t.fmt.bold}**${body.slice(end)}`; caret = start + 2 + (sel || t.fmt.bold).length + 2; }
    else if (kind === "link") { const text = sel || t.fmt.link; next = `${body.slice(0, start)}[${text}](https://)${body.slice(end)}`; caret = start + text.length + 11; }
    else if (kind === "image") {
      const marker = `[이미지 ${Math.max(1, images.length)}]`;
      next = `${body.slice(0, start)}${start && body[start - 1] !== "\n" ? "\n" : ""}${marker}\n${body.slice(end)}`;
      caret = start + marker.length + 2;
    } else {
      const prefix = kind === "heading" ? "## " : kind === "list" ? "- " : "> ";
      next = `${body.slice(0, lineStart)}${prefix}${body.slice(lineStart)}`;
      caret = start + prefix.length;
    }
    setBody(next); touch();
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(caret, caret); });
  }

  async function addFiles(files: FileList | null, slot = -1) {
    const list = Array.from(files || []).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    try {
      const uploaded: PublishingImage[] = [];
      for (let i = 0; i < list.length; i++) {
        setUploading(t.uploading(i + 1, list.length));
        uploaded.push(await uploadImageFile(list[i]));
      }
      setImages((prev) => {
        if (slot >= 0) { const next = prev.slice(); next[slot] = { ...prev[slot], ...uploaded[0], missing: false }; return next; }
        return [...prev, ...uploaded].slice(0, 20);
      });
      touch();
    } catch (e) {
      ctx.toast(apiErrorText(t, e), "warn");
    } finally {
      setUploading("");
    }
  }

  async function submit(approve: boolean) {
    setSaving(approve ? "approve" : "save");
    try {
      const { id } = await saveItem({
        id: item?.id, brandId, title, body, tags,
        images: images.map((img) => ({ objectName: img.objectName, sha256: img.sha256, width: img.width, height: img.height, contentType: img.contentType, alt: img.alt, caption: img.caption, sourceUrl: img.sourceUrl, sourcePath: img.sourcePath, fileName: img.fileName })),
        deliveries: rows.filter((r) => r.channelId).map((r) => ({ id: r.id, channelId: r.channelId, scheduledAt: fromLocalInput(r.local) })),
      });
      if (approve) {
        const r = await approveItems([id]);
        ctx.toast(t.approveResult(r.scheduled, r.blocked.length), r.blocked.length ? "warn" : "ok");
      } else {
        ctx.toast(t.saved);
      }
      await ctx.reload();
      onClose();
    } catch (e) {
      ctx.toast(apiErrorText(t, e), "warn");
    } finally {
      setSaving("");
    }
  }

  async function remove() {
    if (!item || !(await appDialog.confirm(t.deleteAsk, { title: t.delete }))) return;
    setSaving("delete");
    try {
      await deleteItem(item.id);
      await ctx.reload();
      onClose();
    } catch (e) {
      ctx.toast(apiErrorText(t, e), "warn");
      setSaving("");
    }
  }

  async function cancelOne(d: PublishingDelivery) {
    try {
      await cancelDelivery(d.id);
      setRows((prev) => prev.filter((r) => r.id !== d.id));
      await ctx.reload();
    } catch (e) {
      ctx.toast(apiErrorText(t, e), "warn");
    }
  }

  const FMT: Array<[string, IconName]> = [["heading", "heading"], ["bold", "bold"], ["list", "list"], ["quote", "quote"], ["image", "image"], ["link", "link"]];

  return (
    <Modal wide title={item ? t.editorEdit : t.editorNew} onClose={() => void close()}
      footer={<>
        {item && <Button tone="danger" icon="trash" busy={saving === "delete"} onClick={() => void remove()}>{t.delete}</Button>}
        <span className="flex-1" />
        <Button onClick={() => void close()}>{t.cancel}</Button>
        <Button icon="check" busy={saving === "save"} disabled={!!saving || !!uploading || !title.trim()} onClick={() => void submit(false)}>{t.save}</Button>
        <Button tone="primary" icon="checkCheck" busy={saving === "approve"} disabled={!!saving || !!uploading || !title.trim()} onClick={() => void submit(true)}>{t.saveAndApprove}</Button>
      </>}>
      {item?.approvedAt && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-sky-500/30 bg-tint-sky/30 px-3 py-2 text-[11px] text-tone-sky"><Icon name="alert" className="h-3.5 w-3.5" />{t.approvedNotice}</div>
      )}
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-3">
          <Field label={<span className="flex justify-between"><span>{t.title}</span><span className="tabular-nums text-faint">{title.length}/{TITLE_MAX}</span></span>}>
            <input className={inputClass} value={title} maxLength={TITLE_MAX} onChange={(e) => { setTitle(e.target.value); touch(); }} autoFocus={!item} />
          </Field>
          <div>
            <div className="mb-1 flex items-center gap-1">
              <span className="flex-1 text-[11px] font-bold text-secondary">{t.body}</span>
              {FMT.map(([kind, icon]) => <IconButton key={kind} icon={icon} label={t.fmt[kind]} className="h-7 w-7" onClick={() => insert(kind)} />)}
            </div>
            <textarea ref={bodyRef} className={`${textareaClass} min-h-[300px] font-mono`} value={body} onChange={(e) => { setBody(e.target.value); touch(); }} spellCheck={false} />
            <p className="mt-1 text-[10px] leading-relaxed text-faint">{t.bodyHint}</p>
          </div>
          <Field label={<span className="flex justify-between"><span>{t.tags}</span><span className={`tabular-nums ${tags.length > TAGS_MAX ? "text-tone-amber" : "text-faint"}`}>{tags.length}/{TAGS_MAX}</span></span>} hint={t.tagsHint}>
            <input className={inputClass} value={tagsText} onChange={(e) => { setTagsText(e.target.value); touch(); }} placeholder="#태그 #tag" />
          </Field>
        </div>

        <div className="space-y-4">
          <Field label={t.brand}>
            <select className={selectClass} value={brandId} onChange={(e) => { setBrandId(e.target.value); touch(); }}>
              <option value="">{t.brandNone}</option>
              {ctx.brands.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
              {brandId && !ctx.brands.some((b) => b.id === brandId) && <option value={brandId}>{brandId}</option>}
            </select>
          </Field>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-bold text-secondary">{t.deliveries}</span>
              <Button size="sm" icon="plus" disabled={!enabledChannels.length} onClick={() => { setRows((p) => [...p, { key: `new${Date.now()}`, channelId: enabledChannels[0]?.id || "", local: "" }]); touch(); }}>{t.addDelivery}</Button>
            </div>
            {!state.channels.length && <p className="rounded-lg border border-dashed border-edge p-2 text-[10px] text-faint">{t.noChannelsYet}</p>}
            <ul className="space-y-2">
              {rows.map((r) => {
                const d = r.saved;
                const editable = !d || EDITABLE.has(d.status);
                const ch = channelOf(r.channelId);
                const reason = d ? deliveryReason(t, d) : "";
                return (
                  <li key={r.key} className="rounded-xl border border-edge bg-inset/50 p-2">
                    {editable ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <select className={`${selectClass} h-8`} value={r.channelId} onChange={(e) => { setRows((p) => p.map((x) => x.key === r.key ? { ...x, channelId: e.target.value } : x)); touch(); }}>
                            {state.channels.filter((c) => c.enabled || c.id === r.channelId).map((c) => <option key={c.id} value={c.id}>{c.name} · {channelTypeLabel(t, c.type)}</option>)}
                          </select>
                          <IconButton icon="x" label={t.removeDelivery} onClick={() => { setRows((p) => p.filter((x) => x.key !== r.key)); touch(); }} />
                        </div>
                        <input type="datetime-local" className={`${inputClass} h-8`} value={r.local} onChange={(e) => { setRows((p) => p.map((x) => x.key === r.key ? { ...x, local: e.target.value } : x)); touch(); }} />
                        {d && <div className="flex items-center gap-1.5"><StatusBadge status={d.status} label={t.deliveryStatus[d.status]} />{reason && <span className="truncate text-[10px] text-tone-amber" title={reason}>{reason}</span>}</div>}
                      </div>
                    ) : d && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-strong">{ch?.name || "—"}</span>
                          <StatusBadge status={d.status} label={t.deliveryStatus[d.status]} />
                        </div>
                        <div className="text-[10px] tabular-nums text-muted">{fmtDateTime(t, d.postedAt || d.scheduledAt)}{d.attempt > 0 ? ` · ${t.attemptInfo(d.attempt)}` : ""}</div>
                        {reason && <p className="text-[10px] leading-relaxed text-tone-amber">{reason}</p>}
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {d.postedUrl && <a className="inline-flex h-7 items-center gap-1 rounded-lg border border-edge px-2 text-[11px] font-semibold text-tone-emerald hover:bg-inset" href={d.postedUrl} target="_blank" rel="noreferrer"><Icon name="external" className="h-3.5 w-3.5" />{t.postedLink}</a>}
                          {["needs_human", "failed"].includes(d.status) && <Button size="sm" icon="copy" onClick={() => ctx.openCopy(d.id)}>{t.openCopy}</Button>}
                          {!["posted", "done_manual", "cancelled"].includes(d.status) && <Button size="sm" tone="ghost" onClick={() => void cancelOne(d)}>{t.cancel}</Button>}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-bold text-secondary">{t.images} {images.length > 0 && <span className="text-faint">{images.length}</span>}</span>
              <Button size="sm" icon="upload" busy={!!uploading} onClick={() => fileRef.current?.click()}>{uploading || t.addImages}</Button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
              <input ref={slotRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { void addFiles(e.target.files, slotIndex.current); e.target.value = ""; }} />
            </div>
            <ul className="grid grid-cols-2 gap-2">
              {images.map((img, i) => (
                <li key={`${img.objectName || img.fileName || "img"}-${i}`} className="group relative overflow-hidden rounded-xl border border-edge bg-inset">
                  <span className="absolute left-1.5 top-1.5 z-10 rounded-md bg-black/60 px-1.5 text-[10px] font-bold text-white">{i + 1}</span>
                  <button type="button" onClick={() => { setImages((p) => p.filter((_, k) => k !== i)); touch(); }}
                    className="absolute right-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-md bg-black/60 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100" aria-label={t.removeImage} title={t.removeImage}>
                    <Icon name="x" className="h-3.5 w-3.5" />
                  </button>
                  {img.objectName ? (
                    <StoredImage objectName={img.objectName} alt={img.alt || `${i + 1}`} className="aspect-square w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex aspect-square flex-col items-center justify-center gap-1.5 p-2 text-center">
                      <Icon name="image" className="h-5 w-5 text-tone-amber" />
                      <span className="line-clamp-2 break-all text-[10px] text-tone-amber">{t.imageMissing(img.fileName || "")}</span>
                      <Button size="sm" onClick={() => { slotIndex.current = i; slotRef.current?.click(); }}>{t.uploadThis}</Button>
                    </div>
                  )}
                  <input className="w-full border-t border-edge bg-transparent px-2 py-1 text-[10px] text-secondary outline-none placeholder:text-faint" placeholder={t.imageCaption}
                    value={img.caption || ""} onChange={(e) => { const v = e.target.value; setImages((p) => p.map((x, k) => (k === i ? { ...x, caption: v } : x))); touch(); }} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Modal>
  );
}
