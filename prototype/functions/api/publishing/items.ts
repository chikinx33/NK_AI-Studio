// POST /api/publishing/items
//   { action:'save', item }                      글 저장(승인된 글을 고치면 다시 초안)
//   { action:'delete', id }
//   { action:'approve', ids }                    고른 글 승인(스팸 방지 검사 후 예약)
//   { action:'approve_week', weekStart }         그 주(월~일, 한국 시간)에 예약 시각이 있는 초안 전부 승인
//   { action:'unapprove', ids }
//   { action:'cancel_delivery', id }
//   { action:'done_manual', id, postedUrl }      직접 올렸다고 기록
//   { action:'reschedule', id, scheduledAt, confirmUncertain }  확인 필요·실패 건 다시 예약
import { authorizeRequest } from "../_shared/auth.js";
import {
  publishingDb, saveItem, deleteItem, approveItems, unapproveItems, cancelDelivery, markDoneManual, rescheduleDelivery,
} from "../_shared/publishing-store";
import { send, sendError, readJson } from "../_shared/publishing-http";

export const onRequestPost = async ({ request, env }: any) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);
  try {
    const body: any = await readJson(request);
    const db = await publishingDb(env);
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    switch (body.action) {
      case "save": return send({ ok: true, ...(await saveItem(db, env, auth.userId, body.item || {})) });
      case "delete": return send({ ok: true, ...(await deleteItem(db, auth.userId, String(body.id || ""))) });
      case "approve": return send({ ok: true, ...(await approveItems(db, auth.userId, { itemIds: ids })) });
      case "approve_week": return send({ ok: true, ...(await approveItems(db, auth.userId, { weekStart: String(body.weekStart || "") })) });
      case "unapprove": return send({ ok: true, ...(await unapproveItems(db, auth.userId, ids)) });
      case "cancel_delivery": return send({ ok: true, delivery: await cancelDelivery(db, auth.userId, String(body.id || "")) });
      case "done_manual": return send({ ok: true, delivery: await markDoneManual(db, auth.userId, String(body.id || ""), String(body.postedUrl || "")) });
      case "reschedule": return send({ ok: true, delivery: await rescheduleDelivery(db, auth.userId, String(body.id || ""), String(body.scheduledAt || ""), body.confirmUncertain === true) });
      default: return send({ error: "invalid_action" }, 400);
    }
  } catch (e) {
    return sendError(e);
  }
};
