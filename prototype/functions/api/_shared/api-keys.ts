// prototype/functions/api/_shared/api-keys.ts
//
// 개인 API 키 저장소(Neon). 키 원문은 저장하지 않고 sha256 만 둔다(만들 때 한 번만 사람에게 파일로 준다).
//   nk_api_keys(id, user_id, name, token_hash, scopes, created_at, last_used_at, revoked_at)
// 규칙(권한 이름·키 모양)은 api-keys-core.js, 요청 인증 갈래는 auth.js(authorizeRequest 의 apiKey 옵션).
import { getSql } from "../knowledge/_shared";
import { ensureSchemaOnce } from "./schema-marks.js";
import { sha256Hex, randomId } from "./publishing-core.js";
import { API_KEY_MAX_ACTIVE, generateApiKey, isApiKeyToken, normalizeKeyName, normalizeScopes, apiKeyFileName } from "./api-keys-core.js";

type SqlFn = (query: string, params?: any[]) => Promise<any[]>;

export class ApiKeyError extends Error {
  status: number;
  code: string;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// 이 함수의 소스가 바뀐 배포에서만 한 번 돈다(schema-marks.js).
export async function runApiKeysDdl(sql: SqlFn): Promise<void> {
  await sql(`DO $$ BEGIN
    CREATE TABLE IF NOT EXISTS nk_api_keys (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', token_hash TEXT NOT NULL UNIQUE,
      scopes JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ);
    CREATE INDEX IF NOT EXISTS nk_api_keys_user ON nk_api_keys (user_id, created_at DESC);
  END $$`);
}

export async function apiKeysSql(env: any): Promise<SqlFn> {
  const sql = getSql(env) as SqlFn | null;
  if (!sql) throw new ApiKeyError("api_keys_db_unavailable", 503);
  await ensureSchemaOnce(sql, "nk_api_keys_v1", runApiKeysDdl);
  return sql;
}

const iso = (v: any): string => {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(String(v).replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
};
const scopesOf = (v: any): string[] => normalizeScopes(typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return []; } })() : v);

export function publicApiKey(r: any) {
  return { id: String(r.id), name: String(r.name || ""), scopes: scopesOf(r.scopes), createdAt: iso(r.created_at), lastUsedAt: iso(r.last_used_at) };
}

export async function listApiKeys(sql: SqlFn, userId: string) {
  const rows = await sql(`SELECT * FROM nk_api_keys WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC`, [userId]);
  return rows.map(publicApiKey);
}

/** 새 키. 원문(token)은 이 응답에서 한 번만 돌려준다 — 화면은 파일로 내려받게 하고 다시 보여 주지 않는다. */
export async function createApiKey(sql: SqlFn, userId: string, input: any) {
  const name = normalizeKeyName(input?.name);
  if (!name) throw new ApiKeyError("api_key_name_required");
  const scopes = normalizeScopes(input?.scopes);
  if (!scopes.length) throw new ApiKeyError("api_key_scopes_required");
  const token = generateApiKey();
  const id = randomId("key");
  // 개수 한도 확인과 넣기를 한 문장으로(동시에 두 번 눌러도 한도를 넘지 않게).
  const rows = await sql(`INSERT INTO nk_api_keys (id,user_id,name,token_hash,scopes)
    SELECT $1::text, $2::text, $3::text, $4::text, $5::jsonb
    WHERE (SELECT count(*) FROM nk_api_keys WHERE user_id=$2::text AND revoked_at IS NULL) < ${API_KEY_MAX_ACTIVE} RETURNING *`,
  [id, userId, name, await sha256Hex(token), JSON.stringify(scopes)]);
  if (!rows[0]) throw new ApiKeyError("api_key_limit", 409);
  return { key: publicApiKey(rows[0]), token, fileName: apiKeyFileName(name) };
}

/** 끊기: 그 키는 즉시 무효(다음 요청부터 401). */
export async function revokeApiKey(sql: SqlFn, userId: string, id: string) {
  const rows = await sql(`UPDATE nk_api_keys SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id`, [id, userId]);
  if (!rows[0]) throw new ApiKeyError("api_key_not_found", 404);
  return { id };
}

/** Bearer nkk_… → 키(요청 인증용). 모양이 아니면 DB 를 보지 않는다. */
export async function authenticateApiKey(env: any, token: string) {
  if (!isApiKeyToken(token)) return null;
  return findApiKeyByToken(await apiKeysSql(env), token);
}

/** 해시로만 찾고, 찾으면 마지막 사용 시각을 같은 문장에서 남긴다. 끊긴 키는 찾지 않는다. */
export async function findApiKeyByToken(sql: SqlFn, token: string) {
  if (!isApiKeyToken(token)) return null;
  const rows = await sql(`UPDATE nk_api_keys SET last_used_at=now() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING id, user_id, name, scopes, created_at`, [await sha256Hex(token)]);
  const r = rows[0];
  if (!r) return null;
  return { id: String(r.id), userId: String(r.user_id), name: String(r.name || ""), scopes: scopesOf(r.scopes), createdAtMs: Date.parse(iso(r.created_at)) || 0 };
}
