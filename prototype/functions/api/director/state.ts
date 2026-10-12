// GET/POST /api/director/state — 사용자별 디렉터 상태(메모리 스토어 ID, 프로젝트별 세션 목록 등).
// Cloud Run 디렉터는 상태를 두지 않는다. 여기(GCS users/{uid}/director/state.json)에 둔다.
// 쓰기는 디렉터 서비스만, 읽기는 본인(화면)도 가능하다. 비밀값은 저장하지 않는다.
import { readGcsJson, writeGcsJson, resolveGcsEnv } from "../_shared/gcs.js";
import { buildUserRoot } from "../_shared/storage";
import { directorAuth, onOptions, send, type PagesFunction } from "./_shared";

const MAX_STATE_BYTES = 256 * 1024;

export function directorStateObject(env: any, userId: string): string {
  const { basePrefix } = resolveGcsEnv(env);
  return `${buildUserRoot(basePrefix, userId)}/director/state.json`;
}

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await directorAuth(request, env, false);
  if (!auth.ok) return auth.response;
  try {
    const r = await readGcsJson(env, directorStateObject(env, auth.userId));
    return send({ state: r.found && r.data && typeof r.data === "object" ? r.data : {} }, 200, origin);
  } catch (e: any) {
    return send({ error: "director_state_unavailable", detail: String(e?.message || e) }, 503, origin);
  }
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await directorAuth(request, env, true);
  if (!auth.ok) return auth.response;
  const body: any = await request.json().catch(() => null);
  const state = body && typeof body.state === "object" && !Array.isArray(body.state) ? body.state : null;
  if (!state) return send({ error: "state_object_required" }, 400, origin);
  const text = JSON.stringify(state);
  if (text.length > MAX_STATE_BYTES) return send({ error: "state_too_large", bytes: text.length }, 413, origin);
  if (/sk-ant-|-----BEGIN|"token"\s*:/i.test(text)) return send({ error: "state_must_not_contain_secrets" }, 400, origin);
  try {
    await writeGcsJson(env, directorStateObject(env, auth.userId), { ...state, updatedAt: new Date().toISOString() });
    return send({ ok: true }, 200, origin);
  } catch (e: any) {
    return send({ error: "director_state_write_failed", detail: String(e?.message || e) }, 503, origin);
  }
};

export const onRequestOptions = onOptions;
