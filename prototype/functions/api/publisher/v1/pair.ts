// POST /api/publisher/v1/pair — CONTRACT §5.1
// 요청 { pairingCode, deviceName, appVersion, os } → 응답 { deviceId, deviceToken }
// 연결 코드는 NK_Studio 퍼블리싱 > 설정 > PC 연결에서 만든 8자리(10분, 한 번). 토큰은 이 응답에서만 보이고 서버에는 해시만 남는다.
import { publishingDb, pairDevice } from "../../_shared/publishing-store";
import { send, sendError, readJson } from "../../_shared/publishing-http";
import { MIN_APP_VERSION, compareVersions } from "../../_shared/publishing-core.js";

export const onRequestPost = async ({ request, env }: any) => {
  try {
    const body: any = await readJson(request);
    const version = String(request.headers.get("X-Publisher-Version") || body?.appVersion || "").trim();
    if (version && compareVersions(version, MIN_APP_VERSION) < 0) {
      return send({ error: "app_update_required", minAppVersion: MIN_APP_VERSION, message: "NK Publisher 를 새 버전으로 업데이트해 주세요." }, 426);
    }
    const db = await publishingDb(env);
    return send(await pairDevice(db, {
      pairingCode: String(body?.pairingCode || ""), deviceName: String(body?.deviceName || ""),
      appVersion: String(body?.appVersion || version || ""), os: String(body?.os || ""),
    }));
  } catch (e) {
    return sendError(e);
  }
};
