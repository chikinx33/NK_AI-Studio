// POST /api/publishing/import — CONTRACT §7 가져오기 { items:[...] } (한 번에 100개까지, externalId 가 같으면 고친다)
// 응답의 items[].images[] 에 빠진 이미지(missing)가 표시된다. 화면은 같은 이름 파일·URL 을 /api/publishing/images 로 채운다.
import { authorizeRequest } from "../_shared/auth.js";
import { publishingDb, importItems } from "../_shared/publishing-store";
import { send, sendError, readJson } from "../_shared/publishing-http";

export const onRequestPost = async ({ request, env }: any) => {
  const auth = await authorizeRequest(request, env, { apiKey: "publishing:write" });
  if (!auth.ok) return send({ error: auth.error }, auth.status);
  try {
    const body: any = await readJson(request);
    const db = await publishingDb(env);
    return send({ ok: true, ...(await importItems(db, env, auth.userId, body)) });
  } catch (e) {
    return sendError(e);
  }
};
