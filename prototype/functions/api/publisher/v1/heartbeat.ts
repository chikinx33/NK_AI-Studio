// POST /api/publisher/v1/heartbeat — CONTRACT §5.2 (5분마다, 앱 켤 때)
// 요청 { appVersion, sessions:[{channelType, accountLabel, loggedIn, checkedAt}] }
// 응답 { serverTime, pollIntervalSec, minAppVersion, channels:[이 사용자의 pc 채널] }
import { deviceHeartbeat } from "../../_shared/publishing-store";
import { send, sendError, readJson, authorizeDevice } from "../../_shared/publishing-http";
import { MIN_APP_VERSION, POLL_INTERVAL_SEC } from "../../_shared/publishing-core.js";

export const onRequestPost = async ({ request, env }: any) => {
  try {
    const auth = await authorizeDevice(request, env);
    if (auth instanceof Response) return auth;
    const body: any = await readJson(request);
    const channels = await deviceHeartbeat(auth.db, auth.device, body);
    return send({ serverTime: new Date().toISOString(), pollIntervalSec: POLL_INTERVAL_SEC, minAppVersion: MIN_APP_VERSION, channels });
  } catch (e) {
    return sendError(e);
  }
};
