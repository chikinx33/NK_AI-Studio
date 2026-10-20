// prototype/functions/api/_shared/api-keys-core.js
//
// 개인 API 키 규칙(DB 없이 판단하는 부분). 저장·조회는 api-keys.ts, 요청 인증은 auth.js(authorizeRequest)의 키 갈래.
//
// 왜: 외부 스크립트(자기 PC 의 자동화, 다른 서버)가 로그인 세션 토큰 없이 업무 파일·퍼블리싱을 쓰게 하는 출입증.
// 키는 경로가 "키를 받겠다"고 밝힌 곳(authorizeRequest 의 apiKey 옵션)에서만 통한다 — 밝히지 않은 경로(로그인·결제·
// 키 관리·승인·게시 등)는 기본으로 막힌다. 승인·게시는 사람만 한다.

export const API_KEY_PREFIX = "nkk_";
/** 사용자 한 명이 동시에 쓸 수 있는 키 수. */
export const API_KEY_MAX_ACTIVE = 20;
export const API_KEY_NAME_MAX = 60;

/** 권한. 순서가 화면 표시 순서다. */
export const API_KEY_SCOPES = ["files:read", "files:write", "publishing:read", "publishing:write"];

/** files:write 는 업로드 뒤 확인을 위해 읽기도 함께 쓴다 — 쓰기 권한은 같은 영역의 읽기를 포함한다. */
const IMPLIED = { "files:write": ["files:read"], "publishing:write": ["publishing:read"] };

function base64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 키 원문 'nkk_…'. 서버는 이 값을 저장하지 않고 sha256 만 저장한다(만들 때 한 번만 사람에게 준다). */
export function generateApiKey(randomBytes = crypto.getRandomValues(new Uint8Array(32))) {
  return `${API_KEY_PREFIX}${base64url(randomBytes)}`;
}

export function isApiKeyToken(token) {
  return /^nkk_[A-Za-z0-9_-]{20,}$/.test(String(token || ""));
}

/** 알려진 권한만, 겹침 없이, 정해진 순서로. */
export function normalizeScopes(raw) {
  const wanted = new Set((Array.isArray(raw) ? raw : String(raw || "").split(/[\s,]+/)).map((s) => String(s || "").trim()));
  return API_KEY_SCOPES.filter((s) => wanted.has(s));
}

export function keyHasScope(scopes, scope) {
  const list = Array.isArray(scopes) ? scopes : [];
  if (list.includes(scope)) return true;
  return list.some((s) => (IMPLIED[s] || []).includes(scope));
}

export function normalizeKeyName(raw) {
  return String(raw == null ? "" : raw).replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, API_KEY_NAME_MAX);
}

/** 키 파일 이름 'nkstudio-key-<이름>.txt'. 파일 이름에 못 쓰는 글자는 '-' 로. */
export function apiKeyFileName(name) {
  const safe = normalizeKeyName(name).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return `nkstudio-key-${safe || "key"}.txt`;
}

/**
 * 인증 결과(authorizeRequest)가 이 권한을 가졌는지. 로그인 세션은 사람 본인이라 모든 권한을 가진다.
 * 한 경로 안에서 동작마다 권한이 다를 때(예: 글 저장은 되고 승인은 안 됨) 경로가 직접 묻는다.
 */
export function authHasScope(auth, scope) {
  if (!auth || !auth.ok) return false;
  if (auth.via !== "api_key") return true;
  return keyHasScope(auth.apiKey && auth.apiKey.scopes, scope);
}
