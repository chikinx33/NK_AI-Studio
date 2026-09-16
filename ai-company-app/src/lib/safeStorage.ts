type StorageKind = "local" | "session";

function getStorage(kind: StorageKind): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readStorage(key: string, fallback = "", kind: StorageKind = "local") {
  try {
    return getStorage(kind)?.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage(key: string, value: string, kind: StorageKind = "local") {
  try {
    const storage = getStorage(kind);
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(key: string, kind: StorageKind = "local") {
  try {
    const storage = getStorage(kind);
    if (!storage) return false;
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function readStorageJson<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): T {
  const raw = readStorage(key);
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

// ── 계정별 저장소 ──
// 같은 브라우저에서 여러 계정이 번갈아 쓰므로, 이 앱이 소유한 상태(프로젝트·배치·잡·UI 선호)는
// 로그인 사용자 id 로 키를 나눈다: `u:<userId>:<key>`.
// 부모 사이트가 소유한 기기 단위 키(nk_auth_token·nk_is_logged_in·nk_lang·nk_ai_image_provider 등)는 여기에 넣지 않는다.
// 사용자 id 는 부모 사이트(js/auth.js)가 저장한 세션 토큰의 payload.sub(서버 userId 와 동일)에서 읽는다.
const AUTH_TOKEN_KEY = "nk_auth_token";
const LOGIN_USER_KEY = "nk_login_user";
const USER_ROLE_KEY = "nk_user_role";
const PERMISSIONS_KEY = "nk_user_permissions";

let cachedToken: string | null = null;
let cachedUserId = "";

function userIdFromToken(token: string): string {
  try {
    const encoded = String(token || "").trim().replace(/^"|"$/g, "").split(".")[0];
    if (!encoded) return "";
    const raw = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(raw + "=".repeat((4 - (raw.length % 4)) % 4));
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
    return String(payload?.sub || "").trim();
  } catch {
    return "";
  }
}

/** 현재 로그인 사용자 id. 토큰이 바뀌면(다른 계정 로그인) 다시 읽는다. 알 수 없으면 "anon". */
export function storageUserId(): string {
  const token = readStorage(AUTH_TOKEN_KEY);
  if (token !== cachedToken) {
    cachedToken = token;
    cachedUserId = userIdFromToken(token) || String(readStorage(LOGIN_USER_KEY) || "").trim();
  }
  return encodeURIComponent(cachedUserId || "anon");
}

export function userStorageKey(key: string): string {
  return `u:${storageUserId()}:${key}`;
}

// 계정 구분 전의 전역 키는 누가 쓴 값인지 알 수 없으므로 옮기지 않고 지운다(캐시일 뿐이다).
const clearedLegacyKeys = new Set<string>();
function dropLegacyKey(key: string, kind: StorageKind) {
  const id = `${kind}:${key}`;
  if (clearedLegacyKeys.has(id)) return;
  clearedLegacyKeys.add(id);
  removeStorage(key, kind);
}

export function readUserStorage(key: string, fallback = "", kind: StorageKind = "local") {
  dropLegacyKey(key, kind);
  return readStorage(userStorageKey(key), fallback, kind);
}

export function writeUserStorage(key: string, value: string, kind: StorageKind = "local") {
  dropLegacyKey(key, kind);
  return writeStorage(userStorageKey(key), value, kind);
}

export function removeUserStorage(key: string, kind: StorageKind = "local") {
  dropLegacyKey(key, kind);
  return removeStorage(userStorageKey(key), kind);
}

/**
 * 마스터(1차 관리자) 여부. 부모 사이트(js/auth.js)가 로그인 응답으로 저장한 등급을 읽는다.
 * 옵션(설정) 화면은 두뇌 모드·Claude 인증·직원별 모델을 다루므로 일반 회원에게는 보이지 않는다.
 * 회원 본인의 Claude 키 등록은 런처(/app)의 'API 설정' 위젯에서 계속 할 수 있다.
 * 설정은 서버에서 user_id 별로 저장되므로 이 게이트는 권한 경계가 아니라 노출 범위 제한이다.
 */
export function isMasterUser(): boolean {
  const role = String(readStorage(USER_ROLE_KEY) || "").trim().toLowerCase();
  if (role === "master") return true;
  // 하위호환: 'master' 도입 전 마스터 세션은 role='admin' + 빈 권한으로 저장돼 있다(js/auth.js isMaster 와 동일).
  if (role !== "admin") return false;
  try {
    const parsed: unknown = JSON.parse(readStorage(PERMISSIONS_KEY) || "[]");
    return Array.isArray(parsed) && parsed.length === 0;
  } catch {
    return false;
  }
}

/** 다른 탭에서 다른 계정으로 로그인해 사용자 id 가 바뀌면 콜백(로그아웃·같은 계정 토큰 갱신은 무시). */
export function onStorageUserChange(callback: () => void) {
  let current = userIdFromToken(readStorage(AUTH_TOKEN_KEY));
  const handler = (event: StorageEvent) => {
    if (event.key !== AUTH_TOKEN_KEY && event.key !== null) return;
    const next = userIdFromToken(readStorage(AUTH_TOKEN_KEY));
    if (!next || next === current) return;
    current = next;
    callback();
  };
  try { window.addEventListener("storage", handler); } catch { /* ignore */ }
  return () => { try { window.removeEventListener("storage", handler); } catch { /* ignore */ } };
}
