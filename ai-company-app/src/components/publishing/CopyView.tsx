import { useState, type ReactNode } from "react";
import StoredImage from "../StoredImage";
import { fetchStoredImage, markDoneManual } from "../../lib/publishing";
import { apiErrorText } from "./i18n";
import { Button, Icon, Modal, StatusBadge, inputClass } from "./ui";
import { channelTypeLabel, deliveryReason, fmtDateTime, type PublishingCtx } from "./helpers";

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-edge bg-inset/40 p-3">
      <h4 className="mb-2 text-[11px] font-bold text-secondary">{title}</h4>
      {children}
    </section>
  );
}

/**
 * 직접 올리기(수동 복사) 화면 — manual 채널의 '올릴 차례'와 PC 앱이 넘긴 '확인 필요'·'실패' 건.
 * 브랜드 스튜디오 네이버 블로그 반자동(js/ui/brand-studio.js)과 같은 방식: 본문은 text/html + text/plain 으로 함께 복사
 * (스마트에디터 ONE 이 소제목·굵게·목록을 살린다), 이미지는 PNG 로 한 장씩 복사하거나 모두 받는다. 마지막에 올린 글 주소를 남긴다.
 */
export default function CopyView({ ctx, deliveryId, onClose }: { ctx: PublishingCtx; deliveryId: string; onClose: () => void }) {
  const { t, state } = ctx;
  const item = state.items.find((i) => i.deliveries.some((d) => d.id === deliveryId));
  const delivery = item?.deliveries.find((d) => d.id === deliveryId);
  const channel = state.channels.find((c) => c.id === delivery?.channelId);
  const [url, setUrl] = useState(delivery?.postedUrl || "");
  const [busy, setBusy] = useState("");
  if (!item || !delivery) return null;
  const reason = deliveryReason(t, delivery);
  const images = item.images.filter((img) => img.objectName);
  const tagsText = item.tags.map((tag) => `#${tag}`).join(" ");

  const done = (ok: boolean) => ctx.toast(ok ? t.copied : t.copyFailed, ok ? "ok" : "warn");
  const copyText = (text: string) => navigator.clipboard?.writeText(text).then(() => done(true), () => done(false));

  function copyBody() {
    if (navigator.clipboard?.write && typeof window.ClipboardItem === "function") {
      void navigator.clipboard.write([new window.ClipboardItem({
        "text/html": new Blob([item!.copyHtml], { type: "text/html" }),
        "text/plain": new Blob([item!.plainText], { type: "text/plain" }),
      })]).then(() => done(true), () => done(false));
    } else void copyText(item!.plainText);
  }

  // ClipboardItem 에 Promise 를 넘겨야 Safari 도 클릭 안의 쓰기로 인정한다. 클립보드는 PNG 만 확실히 받으므로 바꿔 싣는다.
  function copyImage(objectName: string) {
    if (!navigator.clipboard?.write || typeof window.ClipboardItem !== "function") { done(false); return; }
    const png = fetchStoredImage(objectName).then(async (blob) => {
      if (blob.type === "image/png") return blob;
      const bmp = await createImageBitmap(blob);
      const cv = document.createElement("canvas");
      cv.width = bmp.width; cv.height = bmp.height;
      cv.getContext("2d")!.drawImage(bmp, 0, 0);
      bmp.close?.();
      return await new Promise<Blob>((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error("png"))), "image/png"));
    });
    void navigator.clipboard.write([new window.ClipboardItem({ "image/png": png })]).then(() => done(true), () => done(false));
  }

  async function downloadAll() {
    setBusy("download");
    try {
      for (let i = 0; i < images.length; i++) {
        const blob = await fetchStoredImage(images[i].objectName);
        const ext = (images[i].contentType.split("/")[1] || "png").replace("jpeg", "jpg");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = images.length > 1 ? `${String(i + 1).padStart(2, "0")}.${ext}` : `image.${ext}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
    } catch (e) {
      ctx.toast(apiErrorText(t, e), "warn");
    } finally {
      setBusy("");
    }
  }

  async function finish() {
    setBusy("done");
    try {
      await markDoneManual(delivery!.id, url.trim());
      ctx.toast(t.doneSaved);
      await ctx.reload();
      onClose();
    } catch (e) {
      ctx.toast(apiErrorText(t, e), "warn");
      setBusy("");
    }
  }

  return (
    <Modal wide title={`${t.copyTitle} · ${channel?.name || channelTypeLabel(t, channel?.type || "")}`} onClose={onClose}
      footer={<>
        <span className="flex-1 truncate text-[11px] text-muted">{item.title}</span>
        <Button onClick={onClose}>{t.close}</Button>
      </>}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatusBadge status={delivery.status} label={t.deliveryStatus[delivery.status]} />
        <span className="text-[11px] tabular-nums text-muted">{fmtDateTime(t, delivery.scheduledAt)}</span>
        {reason && <span className="text-[11px] text-tone-amber">{reason}</span>}
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <Step title={t.copyStep1}>
            {channel?.writeUrl
              ? <Button tone="primary" icon="external" onClick={() => window.open(channel.writeUrl, "_blank", "noopener")}>{t.copyOpenWrite}</Button>
              : <p className="text-[11px] text-faint">{t.copyNoWriteUrl}</p>}
          </Step>
          <Step title={t.copyStep2}>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" icon="copy" onClick={() => void copyText(item.title)}>{t.copyTitleBtn}</Button>
              <Button size="sm" icon="copy" tone="primary" onClick={copyBody}>{t.copyBodyBtn}</Button>
              <Button size="sm" icon="copy" onClick={() => void copyText(item.plainText)}>{t.copyBodyPlainBtn}</Button>
              {tagsText && <Button size="sm" icon="copy" onClick={() => void copyText(tagsText)}>{t.copyTagsBtn}</Button>}
            </div>
            {tagsText && <p className="mt-2 break-all text-[10px] text-faint">{tagsText}</p>}
          </Step>
          <Step title={t.copyStep3}>
            {!images.length ? <p className="text-[11px] text-faint">{t.copyNoImages}</p> : (
              <>
                <ul className="grid grid-cols-3 gap-2">
                  {images.map((img) => {
                    const n = Number(img.ref.replace(/^img/, ""));
                    return (
                      <li key={img.ref} className="overflow-hidden rounded-lg border border-edge bg-inset">
                        <StoredImage objectName={img.objectName} alt={img.alt || img.ref} className="aspect-square w-full object-cover" loading="lazy" />
                        <button type="button" onClick={() => copyImage(img.objectName)} className="flex w-full items-center justify-center gap-1 border-t border-edge py-1 text-[10px] font-semibold text-secondary hover:bg-panel hover:text-strong">
                          <Icon name="copy" className="h-3 w-3" />{t.copyImageBtn(n)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <Button size="sm" icon="download" className="mt-2" busy={busy === "download"} onClick={() => void downloadAll()}>{t.downloadAll}</Button>
              </>
            )}
          </Step>
          <Step title={t.copyStep4}>
            <div className="flex gap-1.5">
              <input className={inputClass} value={url} placeholder={t.postedUrlPlaceholder} onChange={(e) => setUrl(e.target.value)} />
              <Button tone="primary" icon="check" busy={busy === "done"} onClick={() => void finish()} className="min-w-[96px]">{t.markDone}</Button>
            </div>
          </Step>
        </div>
        <div className="space-y-3">
          {delivery.screenshotObject && (
            <StoredImage objectName={delivery.screenshotObject} alt="PC" className="w-full rounded-xl border border-edge" loading="lazy" />
          )}
          <section>
            <h4 className="mb-1.5 text-[11px] font-bold text-secondary">{t.preview}</h4>
            <div className="nk-publishing-preview max-h-[60vh] overflow-y-auto rounded-xl border border-edge bg-panel p-4 text-xs leading-relaxed text-strong">
              <h3 className="mb-3 text-base font-bold">{item.title}</h3>
              {/* 서버(publishing-core.js blocksToHtml)가 모든 글자를 이스케이프해 만든 HTML 이다. */}
              <div className="space-y-2 [&_a]:text-tone-emerald [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-edge [&_blockquote]:pl-3 [&_blockquote]:text-secondary [&_h3]:mt-3 [&_h3]:text-sm [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: item.copyHtml }} />
            </div>
          </section>
        </div>
      </div>
    </Modal>
  );
}
