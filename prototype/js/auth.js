; (function () {
    var NK = window.NK || (window.NK = {});
    var auth = NK.auth || (NK.auth = {});
    const KEYS = NK.config.KEYS;
    const REFRESH_BEFORE_SEC = 60 * 60 * 24 * 14;
    let lastError = '';
    let refreshPromise = null;

    const decodeBase64Url = function (input) {
        const raw = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
        const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
        const bin = atob(padded);
        const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    };

    const parseTokenPayload = function (token) {
        try {
            const parts = String(token || '').trim().split('.');
            if (parts.length !== 2 || !parts[0]) return null;
            const payload = JSON.parse(decodeBase64Url(parts[0]));
            return payload && typeof payload === 'object' ? payload : null;
        } catch (_) {
            return null;
        }
    };

    auth.getToken = function () {
        try { return localStorage.getItem(KEYS.AUTH_TOKEN) || ''; } catch (_) { return ''; }
    };

    auth.getRememberDevice = function () {
        try { return localStorage.getItem(KEYS.REMEMBER_DEVICE) !== 'false'; } catch (_) { return true; }
    };

    auth.setRememberDevice = function (rememberDevice) {
        try { localStorage.setItem(KEYS.REMEMBER_DEVICE, rememberDevice === false ? 'false' : 'true'); } catch (_) { }
    };

    auth.isAuthed = function () {
        try {
            if (localStorage.getItem(KEYS.AUTH) !== 'true') return false;
            const token = auth.getToken();
            if (!token) return false;
            const payload = parseTokenPayload(token);
            const exp = Number(payload && payload.exp);
            const now = Math.floor(Date.now() / 1000);
            if (!payload || !Number.isFinite(exp) || exp <= now) {
                lastError = '세션이 만료되었습니다. 다시 로그인해 주세요.';
                auth.setAuthed(false);
                return false;
            }
            if (auth.refreshSession) void auth.refreshSession(false);
            return true;
        } catch (_) { return false; }
    };

    auth.setAuthed = function (val, user = '', token = '', permissions = [], role = '', options = {}) {
        try {
            localStorage.setItem(KEYS.AUTH, val ? 'true' : 'false');
            localStorage.setItem(KEYS.USER, val ? user : '');
            localStorage.setItem(KEYS.AUTH_TOKEN, val ? String(token || '') : '');
            localStorage.setItem(KEYS.PERMISSIONS, val ? JSON.stringify(Array.isArray(permissions) ? permissions : []) : '[]');
            if (KEYS.ROLE) localStorage.setItem(KEYS.ROLE, val ? String(role || '') : '');
            if (val && Object.prototype.hasOwnProperty.call(options, 'rememberDevice')) {
                auth.setRememberDevice(options.rememberDevice !== false);
            }
        } catch (_) { }
    };

    auth.getRole = function () {
        try { return KEYS.ROLE ? (localStorage.getItem(KEYS.ROLE) || '') : ''; } catch (_) { return ''; }
    };

    // 어드민(전체 권한) 여부: role이 'admin'/'master' 이거나 권한 배열이 비어있으면 전체 권한으로 간주.
    auth.isAdmin = function () {
        var r = String(auth.getRole() || '').toLowerCase();
        if (r === 'admin' || r === 'master') return true;
        return auth.getPermissions().length === 0;
    };

    // 마스터(이 프로젝트의 유일한 최고 관리자) 여부 — 회원 관리 등 운영 기능 전용.
    auth.isMaster = function () {
        var r = String(auth.getRole() || '').toLowerCase();
        if (r === 'master') return true;
        // 하위호환: 'master' 도입 이전 마스터 세션은 role='admin' + 빈 권한으로 저장돼 있음.
        // (변경 후 일반 회원은 role='member'라 여기에 걸리지 않음)
        if (r === 'admin' && auth.getPermissions().length === 0) return true;
        return false;
    };

    auth.getPermissions = function () {
        try {
            const raw = localStorage.getItem(KEYS.PERMISSIONS) || '[]';
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) { return []; }
    };

    auth.hasPermission = function (page) {
        const perms = auth.getPermissions();
        if (!perms.length) return true;
        return perms.indexOf(page) !== -1;
    };

    auth.getUser = function () {
        try { return localStorage.getItem(KEYS.USER) || ''; } catch (_) { return ''; }
    };

    auth.getLastError = function () {
        return String(lastError || '');
    };

    auth.login = async function (id, pw, rememberDevice = auth.getRememberDevice()) {
        try {
            auth.setRememberDevice(rememberDevice);
            const res = await NK.api.login(id, pw, rememberDevice);
            if (res && res.ok && res.token) {
                lastError = '';
                auth.setAuthed(true, res.user || id, res.token, res.permissions || [], res.role || '', {
                    rememberDevice: res.persistent !== false,
                });
                return true;
            }
            lastError = '로그인 응답이 올바르지 않습니다.';
        } catch (err) {
            lastError = String(err && err.message ? err.message : 'login_error');
        }
        return false;
    };

    auth.refreshSession = function (force) {
        if (refreshPromise) return refreshPromise;
        const token = auth.getToken();
        const payload = parseTokenPayload(token);
        if (!payload || !token || !NK.api || !NK.api.sessionRefresh) return Promise.resolve(false);
        const now = Math.floor(Date.now() / 1000);
        const remaining = Number(payload.exp) - now;
        const rememberDevice = auth.getRememberDevice();
        const legacyPersistentMigration = Number(payload.v || 1) < 2 && rememberDevice;
        const shouldRefresh = force === true
            || legacyPersistentMigration
            || (payload.persistent === true && remaining <= REFRESH_BEFORE_SEC);
        if (!shouldRefresh || remaining <= 0) return Promise.resolve(true);

        refreshPromise = NK.api.sessionRefresh(rememberDevice)
            .then(function (res) {
                if (!res || !res.ok || !res.token) return false;
                auth.setAuthed(
                    true,
                    res.user || auth.getUser(),
                    res.token,
                    Array.isArray(res.permissions) ? res.permissions : auth.getPermissions(),
                    res.role || auth.getRole(),
                    { rememberDevice: res.persistent === true },
                );
                lastError = '';
                return true;
            })
            .catch(function (err) {
                // 네트워크·저장소 장애는 아직 유효한 세션을 지우지 않는다. 인증 거절만 로그아웃한다.
                if (err && (err.status === 401 || err.status === 403)) {
                    lastError = '로그인 상태를 갱신할 수 없습니다. 다시 로그인해 주세요.';
                    auth.setAuthed(false);
                }
                return false;
            })
            .finally(function () { refreshPromise = null; });
        return refreshPromise;
    };

    auth.logout = function () {
        lastError = '';
        auth.setAuthed(false);
    };

    const refreshWhenActive = function () {
        try {
            if (auth.isAuthed()) void auth.refreshSession(false);
        } catch (_) { }
    };
    setTimeout(refreshWhenActive, 1000);
    setInterval(refreshWhenActive, 60 * 60 * 1000);
    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') refreshWhenActive();
        });
    }

})();
