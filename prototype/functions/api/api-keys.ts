// GET  /api/api-keys                                   내 개인 API 키 목록(원문은 없다)
// POST /api/api-keys { action:'create', name, scopes }  새 키 → { key, token, fileName } (원문은 이때 한 번만)
//                    { action:'revoke', id }              끊기(즉시 무효)
// 키 관리는 로그인한 사람만 한다 — 이 경로는 authorizeRequest 에 apiKey 옵션을 주지 않아 키로는 열리지 않는다.
import { authorizeRequest } from "./_shared/auth.js";
import { ApiKeyError, apiKeysSql, createApiKey, listApiKeys, revokeApiKey } from "./_shared/api-keys";
import { API_KEY_SCOPES } from "./_shared/api-keys-core.js";

const send = (body: any, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

function sendError(e: any) {
  if (e instanceof ApiKeyError) return send({ error: e.code }, e.status);
  try { console.error("[api-keys]", e?.message || e); } catch { /* noop */ }
  return send({ error: "api_keys_error", message: String(e?.message || e).slice(0, 300) }, 500);
}

export const onRequestGet = async ({ request, env }: any) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);
  try {
    return send({ ok: true, scopes: API_KEY_SCOPES, keys: await listApiKeys(await apiKeysSql(env), auth.userId) });
  } catch (e) {
    return sendError(e);
  }
};

export const onRequestPost = async ({ request, env }: any) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);
  try {
    const body: any = await request.json().catch(() => ({}));
    const sql = await apiKeysSql(env);
    if (body.action === "create") return send({ ok: true, ...(await createApiKey(sql, auth.userId, body)) });
    if (body.action === "revoke") return send({ ok: true, ...(await revokeApiKey(sql, auth.userId, String(body.id || ""))) });
    return send({ error: "invalid_action" }, 400);
  } catch (e) {
    return sendError(e);
  }
};
