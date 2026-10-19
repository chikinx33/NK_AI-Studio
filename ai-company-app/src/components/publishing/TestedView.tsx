import { useState } from "react";
import StoredImage from "../StoredImage";
import { appDialog } from "../../lib/appDialog";
import { rescheduleDelivery } from "../../lib/publishing";
import { apiErrorText } from "./i18n";
import { Button, Icon, Modal, StatusBadge } from "./ui";
import { channelTypeLabel, fmtDateTime, type PublishingCtx } from "./helpers";

/**
 * 시험 완료(tested) 건을 실제로 올린다: 같은 게시를 지금 시각으로 다시 예약(서버가 스팸 방지 검사).
 * 약속 §2 — 시험 결과는 재시도 대상이 아니고, 사람이 누를 때만 다시 scheduled 가 된다.
 */
export async function promoteTested(ctx: PublishingCtx, deliveryId: string): Promise<boolean> {
  const { t } = ctx;
  if (!(await appDialog.confirm(t.promoteAsk, { title: t.promoteTested }))) return false;
  try {
    await rescheduleDelivery(deliveryId, new Date().toISOString());
    ctx.toast(t.promoted);
    await ctx.reload();
    return true;
  } catch (e) {
    ctx.toast(apiErrorText(t, e), "warn");
    return false;
  }
}

/** 시험 완료 화면: PC 앱이 채운 글쓰기 화면 캡처와 요약, "실제로 올리기". */
export default function TestedView({ ctx, deliveryId, onClose }: { ctx: PublishingCtx; deliveryId: string; onClose: () => void }) {
  const { t, state } = ctx;
  const item = state.items.find((i) => i.deliveries.some((d) => d.id === deliveryId));
  const delivery = item?.deliveries.find((d) => d.id === deliveryId);
  const channel = state.channels.find((c) => c.id === delivery?.channelId);
  const [busy, setBusy] = useState(false);
  if (!item || !delivery) return null;

  return (
    <Modal wide title={`${t.testedTitle} · ${channel?.name || channelTypeLabel(t, channel?.type || "")}`} onClose={onClose}
      footer={<>
        <Button icon="pencil" onClick={() => { onClose(); ctx.openItem(item.id); }}>{t.openItem}</Button>
        <span className="flex-1" />
        <Button onClick={onClose}>{t.close}</Button>
        <Button tone="primary" icon="send" busy={busy} className="min-w-[132px]"
          onClick={() => { setBusy(true); void promoteTested(ctx, delivery.id).then((ok) => { setBusy(false); if (ok) onClose(); }); }}>
          {t.promoteTested}
        </Button>
      </>}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatusBadge status={delivery.status} label={t.deliveryStatus[delivery.status]} />
        <span className="text-[11px] tabular-nums text-muted">{fmtDateTime(t, delivery.updatedAt || delivery.scheduledAt)}</span>
        <span className="min-w-0 flex-1 truncate text-xs font-bold text-strong">{item.title}</span>
      </div>
      <p className="mb-3 flex items-start gap-2 rounded-xl border border-teal-500/30 bg-tint-teal/30 px-3 py-2 text-[11px] leading-relaxed text-tone-teal">
        <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t.testedHint}
      </p>
      {delivery.errorMessage && (
        <div className="mb-3 rounded-xl border border-edge bg-inset/40 p-3">
          <h4 className="mb-1 text-[11px] font-bold text-secondary">{t.testedSummary}</h4>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-strong">{delivery.errorMessage}</p>
        </div>
      )}
      {delivery.screenshotObject
        ? <StoredImage objectName={delivery.screenshotObject} alt={t.viewCapture} className="w-full rounded-xl border border-edge" />
        : <p className="rounded-xl border border-dashed border-edge p-6 text-center text-xs text-faint">{t.testedNoCapture}</p>}
    </Modal>
  );
}
