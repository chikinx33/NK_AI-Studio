// POST /api/publishing/items
//   { action:'save', item }                      글 저장(승인된 글을 고치면 다시 초안)
//   { action:'delete', id }
//   { action:'delete_many', ids }                고른 글 한꺼번에 삭제(지금 올리는 중인 글은 남기고 busy 로 알림)
//   { action:'approve', ids }                    고른 글 승인(스팸 방지 검사 후 예약)
//   { action:'approve_week', weekStart }         그 주(월~일, 한국 시간)에 예약 시각이 있는 초안 전부 승인
//   { action:'unapprove', ids }
//   { action:'cancel_delivery', id }
//   { action:'done_manual', id, postedUrl }      직접 올렸다고 기록(패키지에서 온 글이면 그 폴더에 result.json)
//   { action:'reschedule', id, scheduledAt, confirmUncertain }  확인 필요·실패 건 다시 예약
//   { action:'fill_images', campaignId? }        캠페인 글의 업무 파일 사진을 퍼블리싱 저장소로 옮긴다(남으면 more:true)
//   { action:'delete_campaign', id }             캠페인과 안 나간 글 지우기(올라간 기록은 남는다)
// SNS 채널(api) 게시는 승인·다시 예약 때 SNS 예약 대기열에 들어간다(영상 경로 해석에 env 가 필요하다).
// 개인 API 키(publishing:write)는 글 저장만 할 수 있다. 승인·게시 기록·취소·삭제는 사람(로그인 세션)만 한다.
import { authorizeRequest } from "../_shared/auth.js";
import {
  publishingDb, saveItem, deleteItem, deleteItems, approveItems, unapproveItems, cancelDelivery, markDoneManual, rescheduleDelivery,
  fillCampaignImages, deleteCampaign,
} from "../_shared/publishing-store";
import { writePackageResult } from "../_shared/publishing-packages";
import { send, sendError, readJson } from "../_shared/publishing-http";

const API_KEY_ACTIONS = new Set(["save"]);

export const onRequestPost = async ({ request, env }: any) => {
  const auth = await authorizeRequest(request, env, { apiKey: "publishing:write" });
  if (!auth.ok) return send({ error: auth.error }, auth.status);
  try {
    const body: any = await readJson(request);
    if (auth.via === "api_key" && !API_KEY_ACTIONS.has(String(body.action || ""))) {
      return send({ error: "api_key_action_not_allowed", message: "승인·게시 기록·취소·삭제는 로그인한 사람만 할 수 있어요." }, 403);
    }
    const db = await publishingDb(env);
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    switch (body.action) {
      case "save": return send({ ok: true, ...(await saveItem(db, env, auth.userId, body.item || {})) });
      case "delete": return send({ ok: true, ...(await deleteItem(db, auth.userId, String(body.id || ""))) });
      case "delete_many": return send({ ok: true, ...(await deleteItems(db, auth.userId, ids)) });
      case "approve": return send({ ok: true, ...(await approveItems(db, auth.userId, { itemIds: ids }, env)) });
      case "approve_week": return send({ ok: true, ...(await approveItems(db, auth.userId, { weekStart: String(body.weekStart || "") }, env)) });
      case "unapprove": return send({ ok: true, ...(await unapproveItems(db, auth.userId, ids)) });
      case "cancel_delivery": return send({ ok: true, delivery: await cancelDelivery(db, auth.userId, String(body.id || "")) });
      case "done_manual": {
        const delivery = await markDoneManual(db, auth.userId, String(body.id || ""), String(body.postedUrl || ""));
        const result = await writePackageResult(env, db, auth.userId, delivery.id)
          .catch((e: any) => { try { console.error("[publishing] result.json", e?.message || e); } catch { /* noop */ } return { written: false, reason: "write_failed" }; });
        return send({ ok: true, delivery, packageResult: result });
      }
      case "reschedule": return send({ ok: true, delivery: await rescheduleDelivery(db, auth.userId, String(body.id || ""), String(body.scheduledAt || ""), body.confirmUncertain === true, env) });
      case "fill_images": return send({ ok: true, ...(await fillCampaignImages(db, env, auth.userId, { campaignId: String(body.campaignId || "") })) });
      case "delete_campaign": return send({ ok: true, ...(await deleteCampaign(db, auth.userId, String(body.id || ""))) });
      default: return send({ error: "invalid_action" }, 400);
    }
  } catch (e) {
    return sendError(e);
  }
};
