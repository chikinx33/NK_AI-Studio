// GET /api/publishing/state — 퍼블리싱 화면 전체(채널·글·게시·연결된 PC). 질의 1번(배치)으로 읽는다.
// 읽으면서 직접 올리기 채널의 예약 시각 지난 건은 '올릴 차례'로, 임대 끝난 PC 작업은 재시도/확인 필요로 정리한다.
import { authorizeRequest } from "../_shared/auth.js";
import { publishingDb, loadPublishingState } from "../_shared/publishing-store";
import { send, sendError } from "../_shared/publishing-http";

export const onRequestGet = async ({ request, env }: any) => {
  const auth = await authorizeRequest(request, env, { apiKey: "publishing:read" });
  if (!auth.ok) return send({ error: auth.error }, auth.status);
  try {
    const db = await publishingDb(env);
    return send({ ok: true, ...(await loadPublishingState(db, auth.userId)) });
  } catch (e) {
    return sendError(e);
  }
};
