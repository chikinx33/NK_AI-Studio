// POST /api/publishing/channels { action: 'save', channel } | { action: 'delete', id }
// 채널 = 게시할 곳(CONTRACT §3). 사이트 비밀번호 같은 로그인 정보는 받지도 저장하지도 않는다.
import { authorizeRequest } from "../_shared/auth.js";
import { publishingDb, saveChannel, deleteChannel } from "../_shared/publishing-store";
import { send, sendError, readJson } from "../_shared/publishing-http";

export const onRequestPost = async ({ request, env }: any) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);
  try {
    const body: any = await readJson(request);
    const db = await publishingDb(env);
    if (body.action === "save") return send({ ok: true, channel: await saveChannel(db, auth.userId, body.channel || {}) });
    if (body.action === "delete") return send({ ok: true, ...(await deleteChannel(db, auth.userId, String(body.id || ""))) });
    return send({ error: "invalid_action" }, 400);
  } catch (e) {
    return sendError(e);
  }
};
