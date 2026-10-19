// POST /api/publisher/v1/jobs/claim — CONTRACT §5.3 (pollIntervalSec 마다)
// 요청 { max } → 응답 { jobs:[Job] } (없으면 []). 서버는 한 번에 한 건만 내준다(채널 간격·하루 횟수를 지키려고).
import { claimJobs } from "../../../_shared/publishing-store";
import { send, sendError, authorizeDevice } from "../../../_shared/publishing-http";

export const onRequestPost = async ({ request, env }: any) => {
  try {
    const auth = await authorizeDevice(request, env);
    if (auth instanceof Response) return auth;
    return send({ jobs: await claimJobs(env, auth.db, auth.device) });
  } catch (e) {
    return sendError(e);
  }
};
