// POST /api/publishing/packages/import { path, dryRun?, only? } — 업무 파일 폴더에서 패키지(post.md 가 있는 폴더 = 글 하나)를 가져온다.
//   path: 업무 파일 폴더(그 폴더와 하위 3단계까지 찾는다). dryRun:true 면 저장하지 않고 미리보기만.
//   only: 이 폴더들만(미리보기에서 고른 것, 앞 응답의 pending 이어서 하기).
// 응답 { imported, unchanged, items:[{id, externalId, path, status, warnings[]}], errors:[{path, error}], pending[], more }
//   more:true 면 한 번에 다 못 한 것(서브요청 한도) — 같은 path 에 only: pending 으로 다시 보낸다.
// 개인 API 키(publishing:write)로도 부를 수 있다. 업무 파일을 읽으므로 키에 files:read 도 있어야 한다.
import { authorizeRequest } from "../../_shared/auth.js";
import { authHasScope } from "../../_shared/api-keys-core.js";
import { publishingDb } from "../../_shared/publishing-store";
import { importPackages } from "../../_shared/publishing-packages";
import { send, sendError, readJson } from "../../_shared/publishing-http";

export const onRequestPost = async ({ request, env }: any) => {
  const auth = await authorizeRequest(request, env, { apiKey: "publishing:write" });
  if (!auth.ok) return send({ error: auth.error }, auth.status);
  if (!authHasScope(auth, "files:read")) return send({ error: "api_key_scope_missing", scope: "files:read" }, 403);
  try {
    const body: any = await readJson(request);
    const db = await publishingDb(env);
    return send({ ok: true, ...(await importPackages(db, env, auth.userId, body)) });
  } catch (e) {
    return sendError(e);
  }
};
