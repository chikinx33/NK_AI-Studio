// GET /api/publishing/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD&brand= — 게시 일정·상태(다른 도구가 읽는 용도, 읽기 전용).
// 응답 { ok, from, to, brand, items:[{date, time, channelType, channelName, brand, title, status, postedUrl, postedAt, scheduledAt,
//        approved, needsReapproval, itemId, deliveryId, externalId, packagePath}] }
// 날짜·시각은 한국 시간. 기본 기간 오늘-7일 ~ 오늘+30일, 최대 120일. 개인 API 키(publishing:read)로 읽을 수 있다.
import { authorizeRequest } from "../_shared/auth.js";
import { publishingDb, loadSchedule } from "../_shared/publishing-store";
import { send, sendError } from "../_shared/publishing-http";

export const onRequestGet = async ({ request, env }: any) => {
  const auth = await authorizeRequest(request, env, { apiKey: "publishing:read" });
  if (!auth.ok) return send({ error: auth.error }, auth.status);
  try {
    const url = new URL(request.url);
    const db = await publishingDb(env);
    return send({ ok: true, ...(await loadSchedule(db, auth.userId, {
      from: url.searchParams.get("from") || "", to: url.searchParams.get("to") || "", brand: url.searchParams.get("brand") || "",
    })) });
  } catch (e) {
    return sendError(e);
  }
};
