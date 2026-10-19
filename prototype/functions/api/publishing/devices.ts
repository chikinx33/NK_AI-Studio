// POST /api/publishing/devices { action:'create_code' } → { code, expiresAt }   PC 연결 코드(8자리, 10분, 한 번)
//                              { action:'revoke', id }                            연결 해제(그 PC 의 기기 토큰 즉시 무효)
import { authorizeRequest } from "../_shared/auth.js";
import { publishingDb, createPairingCode, revokeDevice } from "../_shared/publishing-store";
import { send, sendError, readJson } from "../_shared/publishing-http";

export const onRequestPost = async ({ request, env }: any) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);
  try {
    const body: any = await readJson(request);
    const db = await publishingDb(env);
    if (body.action === "create_code") return send({ ok: true, ...(await createPairingCode(db, auth.userId)) });
    if (body.action === "revoke") return send({ ok: true, ...(await revokeDevice(db, auth.userId, String(body.id || ""))) });
    return send({ error: "invalid_action" }, 400);
  } catch (e) {
    return sendError(e);
  }
};
