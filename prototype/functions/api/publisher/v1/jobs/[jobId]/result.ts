// POST /api/publisher/v1/jobs/{jobId}/result — CONTRACT §5.5
// 요청 { attempt, status: posted|failed|needs_human, postedUrl, errorCode, message, screenshotPng, finishedAt } → 응답 { ok:true }
// (jobId, attempt) 기준 멱등. attempt 가 지금 값과 다르면 409. 재시도는 서버가 정한다(CONTRACT §6.3).
import { reportResult } from "../../../../_shared/publishing-store";
import { send, sendError, readJson, authorizeDevice } from "../../../../_shared/publishing-http";

export const onRequestPost = async ({ request, env, params }: any) => {
  try {
    const auth = await authorizeDevice(request, env);
    if (auth instanceof Response) return auth;
    const body: any = await readJson(request);
    return send(await reportResult(env, auth.db, auth.device, String(params?.jobId || ""), body));
  } catch (e) {
    return sendError(e);
  }
};
